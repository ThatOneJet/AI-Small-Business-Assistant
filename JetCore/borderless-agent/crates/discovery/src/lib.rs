//! Zero-config LAN peer discovery for JetCore Borderless.
//!
//! Each agent periodically broadcasts a small JSON [`Beacon`] to
//! `255.255.255.255:`[`DEFAULT_DISCOVERY_PORT`] advertising its
//! [`MachineId`], display name, session TCP port and protocol version. It
//! simultaneously listens for beacons from other agents on the same UDP port.
//!
//! Every discovered peer is surfaced as a [`protocol::PeerInfo`] (with
//! `online = true`, `paired = false`, `conn_state = Disconnected`) on a
//! [`tokio::sync::watch`] channel. Peers that go quiet for
//! [`PEER_STALE`] are first marked `online = false` and then, after
//! [`PEER_DROP`], removed entirely. Beacons carrying our own
//! [`MachineId`] are ignored so we never discover ourselves.
//!
//! Dropping the returned [`Discovery`] cancels the background tasks.
//!
//! ```no_run
//! # async fn run() -> anyhow::Result<()> {
//! use discovery::{start, MyInfo};
//! use protocol::MachineId;
//!
//! let me = MyInfo {
//!     machine_id: MachineId::new("this-box"),
//!     name: "My Desktop".into(),
//!     tcp_port: protocol::DEFAULT_SESSION_PORT,
//! };
//! let discovery = start(me)?;
//! let mut rx = discovery.subscribe();
//! // `rx.borrow()` always holds the latest peer list.
//! while rx.changed().await.is_ok() {
//!     for peer in rx.borrow().iter() {
//!         println!("peer: {} @ {}:{}", peer.name, peer.host, peer.port);
//!     }
//! }
//! # Ok(())
//! # }
//! ```

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::Arc;
use std::time::{Duration, Instant};

use protocol::{ConnState, MachineId, PeerId, PeerInfo, DEFAULT_DISCOVERY_PORT, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use tokio::sync::watch;
use tokio::task::JoinHandle;

/// How often we broadcast our own beacon.
pub const BEACON_INTERVAL: Duration = Duration::from_secs(2);

/// After this long without hearing from a peer it is marked `online = false`.
pub const PEER_STALE: Duration = Duration::from_secs(8);

/// After this long without hearing from a peer it is dropped from the list.
/// Slightly longer than [`PEER_STALE`] so the GUI can briefly show the peer as
/// offline before it disappears.
pub const PEER_DROP: Duration = Duration::from_secs(12);

/// How often the prune loop wakes to re-evaluate peer staleness.
const PRUNE_INTERVAL: Duration = Duration::from_secs(1);

/// Max UDP datagram we'll read for a beacon. Beacons are tiny JSON blobs.
const RECV_BUF: usize = 2048;

/// Identity this machine advertises on the LAN.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MyInfo {
    /// This machine's stable identity (used to filter out our own beacons).
    pub machine_id: MachineId,
    /// Human-friendly display name shown to peers.
    pub name: String,
    /// TCP port this machine's session listener is on (advertised to peers).
    pub tcp_port: u16,
}

/// A discovery beacon broadcast on the LAN advertising one machine.
///
/// Serialized with `serde_json` so it is self-describing and forward-compatible
/// (unknown future fields are ignored on decode).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Beacon {
    /// Advertiser's stable machine id.
    pub machine_id: MachineId,
    /// Advertiser's display name.
    pub name: String,
    /// Session TCP port the advertiser is listening on.
    pub tcp_port: u16,
    /// Protocol version of the advertiser; mismatches are surfaced but not
    /// hidden (pairing rejects across a mismatch elsewhere).
    pub proto_version: u32,
}

impl Beacon {
    /// Build a beacon from this machine's [`MyInfo`] at the current
    /// [`PROTOCOL_VERSION`].
    pub fn from_me(me: &MyInfo) -> Self {
        Self {
            machine_id: me.machine_id.clone(),
            name: me.name.clone(),
            tcp_port: me.tcp_port,
            proto_version: PROTOCOL_VERSION,
        }
    }

    /// Serialize to JSON bytes for the wire.
    pub fn to_bytes(&self) -> anyhow::Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Parse a beacon from received JSON bytes.
    pub fn from_bytes(bytes: &[u8]) -> anyhow::Result<Self> {
        Ok(serde_json::from_slice(bytes)?)
    }
}

/// Build the [`PeerInfo`] for a peer learned from a beacon received from `addr`.
///
/// `online = true`, `paired = false`, `conn_state = Disconnected`; pairing and
/// connection state are owned by other crates. The [`PeerId`] is derived from
/// the peer's [`MachineId`] so it is stable across rebroadcasts.
fn peer_from_beacon(beacon: &Beacon, addr: SocketAddr) -> PeerInfo {
    PeerInfo {
        id: PeerId::new(beacon.machine_id.as_str()),
        name: beacon.name.clone(),
        host: addr.ip().to_string(),
        port: beacon.tcp_port,
        online: true,
        paired: false,
        conn_state: ConnState::Disconnected,
        error: None,
    }
}

/// Build a [`PeerInfo`] for a manually-entered `host:port`.
///
/// For LANs that block UDP broadcast, the user can type a peer's address by
/// hand. The peer is reported `online = true` (we assume the user knows it's
/// reachable), `paired = false`, `conn_state = Disconnected`. The [`PeerId`] is
/// derived from `host:port` since no [`MachineId`] is known until a session
/// handshake completes.
pub fn manual_add(host: String, port: u16) -> PeerInfo {
    PeerInfo {
        id: PeerId::new(format!("manual:{host}:{port}")),
        name: format!("{host}:{port}"),
        host,
        port,
        online: true,
        paired: false,
        conn_state: ConnState::Disconnected,
        error: None,
    }
}

/// One tracked peer: its last-known [`PeerInfo`] plus when we last heard it.
#[derive(Debug, Clone)]
struct TrackedPeer {
    info: PeerInfo,
    last_seen: Instant,
}

/// In-memory registry of discovered peers, keyed by [`MachineId`].
///
/// Kept free of any I/O so the freshness/prune logic is unit-testable.
#[derive(Debug, Default)]
struct PeerRegistry {
    peers: HashMap<MachineId, TrackedPeer>,
}

impl PeerRegistry {
    /// Record a beacon sighting. Returns `true` if the published peer list
    /// changed (new peer, came back online, or address/name/port changed).
    fn observe(&mut self, id: MachineId, info: PeerInfo, now: Instant) -> bool {
        match self.peers.get_mut(&id) {
            Some(existing) => {
                existing.last_seen = now;
                // Compare ignoring nothing relevant: if it was offline or any
                // advertised field changed, that's a visible change.
                let changed = existing.info != info;
                existing.info = info;
                changed
            }
            None => {
                self.peers.insert(id, TrackedPeer { info, last_seen: now });
                true
            }
        }
    }

    /// Apply staleness rules at time `now`:
    /// - peers unseen for >= [`PEER_DROP`] are removed,
    /// - peers unseen for >= [`PEER_STALE`] (but < drop) are marked offline.
    ///
    /// Returns `true` if anything changed.
    fn prune(&mut self, now: Instant) -> bool {
        let mut changed = false;

        // Drop the fully-dead first.
        let before = self.peers.len();
        self.peers
            .retain(|_, p| now.duration_since(p.last_seen) < PEER_DROP);
        if self.peers.len() != before {
            changed = true;
        }

        // Mark the merely-stale offline.
        for p in self.peers.values_mut() {
            let stale = now.duration_since(p.last_seen) >= PEER_STALE;
            if stale && p.info.online {
                p.info.online = false;
                changed = true;
            }
        }

        changed
    }

    /// Snapshot the current peer list for publication, sorted by id for a
    /// stable order across updates.
    fn snapshot(&self) -> Vec<PeerInfo> {
        let mut out: Vec<PeerInfo> = self.peers.values().map(|p| p.info.clone()).collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }
}

/// A running LAN discovery service.
///
/// Holds the background broadcast/receive/prune tasks and the watch channel
/// sender. Dropping it aborts the tasks.
pub struct Discovery {
    peers_rx: watch::Receiver<Vec<PeerInfo>>,
    tasks: Vec<JoinHandle<()>>,
}

impl Discovery {
    /// Subscribe to peer-list updates. The receiver always holds the latest
    /// full peer list; use [`watch::Receiver::changed`] to await updates and
    /// [`watch::Receiver::borrow`] to read the current value.
    pub fn subscribe(&self) -> watch::Receiver<Vec<PeerInfo>> {
        self.peers_rx.clone()
    }
}

impl Drop for Discovery {
    fn drop(&mut self) {
        for t in &self.tasks {
            t.abort();
        }
    }
}

/// Bind a UDP socket to `0.0.0.0:port` with `SO_REUSEADDR` (and `SO_REUSEPORT`
/// where available) and broadcast enabled, returning an async [`UdpSocket`].
///
/// `SO_REUSEADDR` lets two agents on the same host both bind the discovery port
/// (useful for local testing of two instances).
fn bind_socket(port: u16) -> anyhow::Result<UdpSocket> {
    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    sock.set_reuse_address(true)?;
    // SO_REUSEPORT is not available on Windows; ignore if unsupported.
    #[cfg(unix)]
    {
        let _ = sock.set_reuse_port(true);
    }
    sock.set_broadcast(true)?;
    sock.set_nonblocking(true)?;
    let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));
    sock.bind(&addr.into())?;
    let std_sock: std::net::UdpSocket = sock.into();
    Ok(UdpSocket::from_std(std_sock)?)
}

/// Start LAN discovery for this machine.
///
/// Binds the UDP discovery port, then spawns the broadcast, receive and prune
/// tasks. Discovered peers are published on the watch channel returned by
/// [`Discovery::subscribe`]. Fails only if the socket cannot be bound.
pub fn start(me: MyInfo) -> anyhow::Result<Discovery> {
    let socket = Arc::new(bind_socket(DEFAULT_DISCOVERY_PORT)?);
    let (peers_tx, peers_rx) = watch::channel(Vec::<PeerInfo>::new());
    let peers_tx = Arc::new(peers_tx);

    // Shared registry guarded by a std Mutex; all access is short and sync.
    let registry = Arc::new(std::sync::Mutex::new(PeerRegistry::default()));

    let broadcast_addr =
        SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::BROADCAST, DEFAULT_DISCOVERY_PORT));

    let mut tasks = Vec::with_capacity(3);

    // --- Broadcast task ---
    {
        let socket = socket.clone();
        let me = me.clone();
        tasks.push(tokio::spawn(async move {
            let beacon = Beacon::from_me(&me);
            let payload = match beacon.to_bytes() {
                Ok(p) => p,
                Err(e) => {
                    tracing::error!("failed to serialize beacon: {e}");
                    return;
                }
            };
            let mut ticker = tokio::time::interval(BEACON_INTERVAL);
            loop {
                ticker.tick().await;
                if let Err(e) = socket.send_to(&payload, broadcast_addr).await {
                    tracing::warn!("beacon broadcast failed: {e}");
                }
            }
        }));
    }

    // --- Receive task ---
    {
        let socket = socket.clone();
        let registry = registry.clone();
        let peers_tx = peers_tx.clone();
        let my_id = me.machine_id.clone();
        tasks.push(tokio::spawn(async move {
            let mut buf = vec![0u8; RECV_BUF];
            loop {
                let (len, addr) = match socket.recv_from(&mut buf).await {
                    Ok(v) => v,
                    Err(e) => {
                        tracing::warn!("discovery recv failed: {e}");
                        continue;
                    }
                };
                let beacon = match Beacon::from_bytes(&buf[..len]) {
                    Ok(b) => b,
                    Err(_) => continue, // ignore garbage / other protocols
                };
                if beacon.machine_id == my_id {
                    continue; // never discover ourselves
                }
                let info = peer_from_beacon(&beacon, addr);
                let changed = {
                    let mut reg = registry.lock().unwrap();
                    let changed = reg.observe(beacon.machine_id.clone(), info, Instant::now());
                    if changed {
                        let snap = reg.snapshot();
                        drop(reg);
                        let _ = peers_tx.send(snap);
                        true
                    } else {
                        false
                    }
                };
                let _ = changed;
            }
        }));
    }

    // --- Prune task ---
    {
        let registry = registry.clone();
        let peers_tx = peers_tx.clone();
        tasks.push(tokio::spawn(async move {
            let mut ticker = tokio::time::interval(PRUNE_INTERVAL);
            loop {
                ticker.tick().await;
                let mut reg = registry.lock().unwrap();
                if reg.prune(Instant::now()) {
                    let snap = reg.snapshot();
                    drop(reg);
                    let _ = peers_tx.send(snap);
                }
            }
        }));
    }

    Ok(Discovery { peers_rx, tasks })
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_beacon(id: &str) -> Beacon {
        Beacon {
            machine_id: MachineId::new(id),
            name: format!("{id}-name"),
            tcp_port: protocol::DEFAULT_SESSION_PORT,
            proto_version: PROTOCOL_VERSION,
        }
    }

    #[test]
    fn beacon_json_roundtrip() {
        let beacon = mk_beacon("box-a");
        let bytes = beacon.to_bytes().unwrap();
        let decoded = Beacon::from_bytes(&bytes).unwrap();
        assert_eq!(decoded, beacon);
    }

    #[test]
    fn beacon_from_me_uses_protocol_version() {
        let me = MyInfo {
            machine_id: MachineId::new("box-a"),
            name: "Box A".into(),
            tcp_port: 1234,
        };
        let b = Beacon::from_me(&me);
        assert_eq!(b.machine_id, me.machine_id);
        assert_eq!(b.name, me.name);
        assert_eq!(b.tcp_port, 1234);
        assert_eq!(b.proto_version, PROTOCOL_VERSION);
    }

    #[test]
    fn peer_from_beacon_has_expected_defaults() {
        let beacon = mk_beacon("box-b");
        let addr: SocketAddr = "192.168.1.50:9999".parse().unwrap();
        let p = peer_from_beacon(&beacon, addr);
        assert_eq!(p.id, PeerId::new("box-b"));
        assert_eq!(p.host, "192.168.1.50");
        assert_eq!(p.port, protocol::DEFAULT_SESSION_PORT);
        assert!(p.online);
        assert!(!p.paired);
        assert_eq!(p.conn_state, ConnState::Disconnected);
        assert!(p.error.is_none());
    }

    #[test]
    fn manual_add_builds_offline_unpaired_peer() {
        let p = manual_add("10.0.0.5".into(), 24800);
        assert_eq!(p.host, "10.0.0.5");
        assert_eq!(p.port, 24800);
        assert!(p.online);
        assert!(!p.paired);
        assert_eq!(p.conn_state, ConnState::Disconnected);
        // Distinct, stable id for the same host:port.
        assert_eq!(p, manual_add("10.0.0.5".into(), 24800));
    }

    #[test]
    fn observe_inserts_then_dedups() {
        let mut reg = PeerRegistry::default();
        let now = Instant::now();
        let beacon = mk_beacon("box-c");
        let addr: SocketAddr = "192.168.1.10:1000".parse().unwrap();
        let info = peer_from_beacon(&beacon, addr);

        // First sighting: changed.
        assert!(reg.observe(MachineId::new("box-c"), info.clone(), now));
        assert_eq!(reg.snapshot().len(), 1);

        // Identical re-sighting: no published change.
        assert!(!reg.observe(
            MachineId::new("box-c"),
            info.clone(),
            now + Duration::from_secs(1)
        ));

        // Changed address: published change.
        let addr2: SocketAddr = "192.168.1.11:1000".parse().unwrap();
        let info2 = peer_from_beacon(&beacon, addr2);
        assert!(reg.observe(
            MachineId::new("box-c"),
            info2,
            now + Duration::from_secs(2)
        ));
    }

    #[test]
    fn prune_marks_stale_then_drops() {
        let mut reg = PeerRegistry::default();
        let t0 = Instant::now();
        let beacon = mk_beacon("box-d");
        let addr: SocketAddr = "192.168.1.20:2000".parse().unwrap();
        reg.observe(
            MachineId::new("box-d"),
            peer_from_beacon(&beacon, addr),
            t0,
        );

        // Fresh: no change, still online.
        assert!(!reg.prune(t0 + Duration::from_secs(1)));
        assert!(reg.snapshot()[0].online);

        // Past PEER_STALE but before PEER_DROP: marked offline (changed once).
        let t_stale = t0 + PEER_STALE + Duration::from_millis(1);
        assert!(reg.prune(t_stale));
        assert!(!reg.snapshot()[0].online);
        // Pruning again at the same staleness: no further change.
        assert!(!reg.prune(t_stale + Duration::from_millis(1)));

        // Past PEER_DROP: removed entirely (changed).
        let t_drop = t0 + PEER_DROP + Duration::from_millis(1);
        assert!(reg.prune(t_drop));
        assert!(reg.snapshot().is_empty());

        // Empty registry: pruning is a no-op.
        assert!(!reg.prune(t_drop + Duration::from_secs(1)));
    }

    #[test]
    fn prune_refreshed_peer_comes_back_online() {
        let mut reg = PeerRegistry::default();
        let t0 = Instant::now();
        let beacon = mk_beacon("box-e");
        let addr: SocketAddr = "192.168.1.30:3000".parse().unwrap();
        let info = peer_from_beacon(&beacon, addr);
        reg.observe(MachineId::new("box-e"), info.clone(), t0);

        // Go stale -> offline.
        let t_stale = t0 + PEER_STALE + Duration::from_millis(1);
        assert!(reg.prune(t_stale));
        assert!(!reg.snapshot()[0].online);

        // Re-observe: the online flag flips back, which is a visible change.
        assert!(reg.observe(MachineId::new("box-e"), info, t_stale));
        assert!(reg.snapshot()[0].online);
    }

    #[test]
    fn snapshot_is_sorted_by_id() {
        let mut reg = PeerRegistry::default();
        let now = Instant::now();
        for id in ["box-z", "box-a", "box-m"] {
            let beacon = mk_beacon(id);
            let addr: SocketAddr = "192.168.1.40:4000".parse().unwrap();
            reg.observe(MachineId::new(id), peer_from_beacon(&beacon, addr), now);
        }
        let ids: Vec<String> = reg.snapshot().into_iter().map(|p| p.id.0).collect();
        assert_eq!(ids, vec!["box-a", "box-m", "box-z"]);
    }
}
