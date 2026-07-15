//! The control socket: the JSON integration surface JetCore drives.
//!
//! ## Wire protocol
//!
//! TCP `127.0.0.1:52008` (loopback only). **Newline-delimited JSON**:
//! - Every line the client sends is one [`protocol::ControlRequest`]
//!   (deserialized with [`protocol::decode_control_request`]).
//! - Every line the daemon sends is one [`protocol::ControlEvent`]
//!   (serialized with [`protocol::encode_control_event`]).
//!
//! Multiple clients may connect simultaneously. On connect, a client immediately
//! receives the current [`protocol::ControlEvent::State`] and
//! [`protocol::ControlEvent::Peers`]. Thereafter every engine event (`State`,
//! `Peers`, `Cursor`) is fanned out to all connected clients.
//!
//! ## Request handling
//!
//! - `Start`            — ensure the engine is running.
//! - `Stop`             — stop the engine (releasing suppression + modifiers).
//! - `Status`           — reply to *this* client with `State` + `Peers`.
//! - `SetConfig`        — update `config.json` and the engine (restart if running).
//! - `Pair { peer }`    — `engine.pair` + record intent in `config.json`.
//! - `Unpair { peer }`  — `engine.unpair` + drop from `config.json` and the
//!                        persisted [`pairing::PairingStore`].
//! - `SetLayout(layout)`— update `config.json` and push to the engine.
//!
//! This module hosts both the **server** (run inside `borderlessd run`) and the
//! small **client** helpers backing the `status` / `pair` CLI subcommands.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;

use anyhow::{Context, Result};
use protocol::{
    encode_control_event, encode_control_request, ControlEvent, ControlRequest, MachineId, PeerId,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;

use crate::run::Daemon;

/// Capacity of the fan-out broadcast channel feeding connected clients. Bursty
/// `Cursor` telemetry (~100 Hz) plus `State`/`Peers` — generous so a briefly
/// slow client gets `Lagged` rather than stalling the daemon.
const FANOUT_CAP: usize = 1024;

// ===========================================================================
// Server
// ===========================================================================

/// Run the control socket server until `shutdown` resolves.
///
/// `fanout` is the daemon-owned broadcast every client subscribes to; the
/// [`Daemon`] re-publishes the live engine's events into it (so client
/// subscriptions survive an engine restart triggered by `SetConfig`).
pub async fn serve(
    daemon: Arc<Daemon>,
    fanout: broadcast::Sender<ControlEvent>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, crate::CONTROL_PORT));
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("binding control socket {addr}"))?;
    tracing::info!(%addr, "control socket listening");

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, peer)) => {
                        let daemon = daemon.clone();
                        let rx = fanout.subscribe();
                        let shutdown = shutdown.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_client(stream, daemon, rx, shutdown).await {
                                tracing::debug!(%peer, "control client ended: {e:#}");
                            }
                        });
                    }
                    Err(e) => {
                        tracing::warn!("control accept error: {e}");
                    }
                }
            }
            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    tracing::info!("control socket shutting down");
                    break;
                }
            }
        }
    }
    Ok(())
}

/// Build the daemon-owned fan-out channel.
pub fn fanout_channel() -> broadcast::Sender<ControlEvent> {
    broadcast::channel(FANOUT_CAP).0
}

/// Serve a single connected control client: write the initial snapshot, then
/// concurrently fan out engine events and process inbound request lines.
async fn handle_client(
    stream: TcpStream,
    daemon: Arc<Daemon>,
    mut events: broadcast::Receiver<ControlEvent>,
    mut shutdown: tokio::sync::watch::Receiver<bool>,
) -> Result<()> {
    let (read_half, mut write_half) = stream.into_split();
    let mut lines = BufReader::new(read_half).lines();

    // Immediate snapshot so the GUI renders without waiting for the next event.
    for ev in daemon.snapshot().await {
        write_event(&mut write_half, &ev).await?;
    }

    loop {
        tokio::select! {
            // Inbound request line.
            line = lines.next_line() => {
                match line {
                    Ok(Some(line)) => {
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        match protocol::decode_control_request(line) {
                            Ok(req) => {
                                // Reply directly to this client for Status; all
                                // resulting State/Peers changes also fan out.
                                let replies = daemon.handle_request(req).await;
                                for ev in replies {
                                    write_event(&mut write_half, &ev).await?;
                                }
                            }
                            Err(e) => {
                                tracing::debug!("bad control request: {e}");
                            }
                        }
                    }
                    Ok(None) => break, // client closed
                    Err(e) => return Err(e).context("reading control line"),
                }
            }

            // Outbound engine event.
            ev = events.recv() => {
                match ev {
                    Ok(ev) => write_event(&mut write_half, &ev).await?,
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::debug!("control client lagged, dropped {n} events");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }

            _ = shutdown.changed() => {
                if *shutdown.borrow() {
                    break;
                }
            }
        }
    }
    let _ = write_half.shutdown().await;
    Ok(())
}

/// Write one [`ControlEvent`] as a JSON line.
async fn write_event(w: &mut (impl AsyncWriteExt + Unpin), ev: &ControlEvent) -> Result<()> {
    let mut s = encode_control_event(ev).context("encoding control event")?;
    s.push('\n');
    w.write_all(s.as_bytes()).await.context("writing control event")?;
    Ok(())
}

// ===========================================================================
// Client helpers (status / pair CLI subcommands)
// ===========================================================================

/// Connect to a running daemon, send `Status`, print the first `State` and
/// `Peers` events, then exit. Returns `Ok(false)` if no daemon is listening.
pub async fn client_status(port: u16) -> Result<bool> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let stream = match TcpStream::connect(addr).await {
        Ok(s) => s,
        Err(e) if is_conn_refused(&e) => return Ok(false),
        Err(e) => return Err(e).context("connecting to control socket"),
    };

    let (read_half, mut write_half) = stream.into_split();
    let mut lines = BufReader::new(read_half).lines();

    send_request(&mut write_half, &ControlRequest::Status).await?;

    // The daemon sends State + Peers on connect (and again for Status). Read a
    // couple of lines until we've seen both, with a short timeout.
    let mut saw_state = false;
    let mut saw_peers = false;
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);

    while !(saw_state && saw_peers) {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let next = tokio::time::timeout(remaining, lines.next_line()).await;
        let line = match next {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => break, // closed
            // A read error after we already have state is fine (the daemon may
            // reset the socket once we stop draining its telemetry); only error
            // if we never got anything to show.
            Ok(Err(e)) => {
                if saw_state {
                    break;
                }
                return Err(e).context("reading control line");
            }
            Err(_) => break, // timed out
        };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match protocol::decode_control_event(line) {
            Ok(ControlEvent::State(state)) => {
                print_state(&state);
                saw_state = true;
            }
            Ok(ControlEvent::Peers(peers)) => {
                print_peers(&peers);
                saw_peers = true;
            }
            Ok(ControlEvent::Cursor { .. }) => { /* ignore telemetry */ }
            Err(e) => tracing::debug!("bad control event: {e}"),
        }
    }
    Ok(true)
}

/// Connect to a running daemon and pair with `target`.
///
/// `target` is either a peer machine id (paired directly), or an `ip`/`ip:port`
/// (added as a manual peer via `SetConfig`-style flow, then paired). Returns
/// `Ok(false)` if no daemon is listening.
pub async fn client_pair(port: u16, target: &str) -> Result<bool> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let stream = match TcpStream::connect(addr).await {
        Ok(s) => s,
        Err(e) if is_conn_refused(&e) => return Ok(false),
        Err(e) => return Err(e).context("connecting to control socket"),
    };
    let (read_half, mut write_half) = stream.into_split();
    let mut lines = BufReader::new(read_half).lines();

    // Drain the connect snapshot (State + Peers) so it doesn't interleave with
    // our result printing below; non-fatal if it doesn't arrive promptly.
    let _ = tokio::time::timeout(std::time::Duration::from_millis(300), async {
        let _ = lines.next_line().await;
        let _ = lines.next_line().await;
    })
    .await;

    let peer = PeerId::new(target.to_string());
    send_request(&mut write_half, &ControlRequest::Pair { peer }).await?;
    println!("Sent pair request for '{target}' to the daemon.");

    // The daemon publishes an updated Peers list after pairing; show it.
    if let Ok(Ok(Some(line))) =
        tokio::time::timeout(std::time::Duration::from_secs(2), lines.next_line()).await
    {
        if let Ok(ControlEvent::Peers(peers)) = protocol::decode_control_event(line.trim()) {
            print_peers(&peers);
        }
    }
    Ok(true)
}

/// Send one [`ControlRequest`] as a JSON line.
async fn send_request(w: &mut (impl AsyncWriteExt + Unpin), req: &ControlRequest) -> Result<()> {
    let mut s = encode_control_request(req).context("encoding control request")?;
    s.push('\n');
    w.write_all(s.as_bytes()).await.context("writing control request")?;
    w.flush().await.context("flushing control request")?;
    Ok(())
}

fn is_conn_refused(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::TimedOut
    )
}

fn print_state(s: &protocol::DaemonState) {
    println!("Daemon:");
    println!("  running:       {}", s.running);
    println!("  machine_id:    {}", s.machine_id);
    println!("  machine_name:  {}", s.machine_name);
    println!("  control_state: {:?}", s.control_state);
}

fn print_peers(peers: &[protocol::PeerInfo]) {
    if peers.is_empty() {
        println!("Peers: (none discovered)");
        return;
    }
    println!("Peers ({}):", peers.len());
    for p in peers {
        println!(
            "  - {} [{}] {}:{}  online={} paired={} conn={:?}",
            p.name, p.id, p.host, p.port, p.online, p.paired, p.conn_state
        );
    }
}

/// Best-effort conversion of a `PeerId` to a `MachineId` for pairing. Discovered
/// peers carry their machine id as the `PeerId` string, so this is the identity
/// in the common case; manual peers (`manual:host:port`) won't match a real
/// machine id until discovery learns it.
pub fn peer_to_machine_id(peer: &PeerId) -> MachineId {
    MachineId::new(peer.as_str())
}
