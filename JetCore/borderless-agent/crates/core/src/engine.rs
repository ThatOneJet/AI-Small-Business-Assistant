//! The async orchestration engine: the software-KVM state machine that ties
//! capture, inject, transport, discovery, pairing, layout and clipboard together.
//!
//! # State machine
//!
//! - **Local** — input stays on this machine. A cursor poll (~100 Hz) watches for
//!   the OS cursor hitting a virtual-desktop edge that the active [`Layout`] maps
//!   to a paired + connected peer. On such a crossing we transition to
//!   `Controlling(peer)`.
//! - **Controlling(peer)** — we set the shared `suppress` flag so [`capture`]
//!   swallows local input, send [`Message::Enter`], and *park* the local cursor
//!   each tick so it cannot drift into other local apps. Every captured
//!   [`InputEvent`] is forwarded to the peer as [`Message::Input`]. A virtual
//!   [`RemoteCursor`] accumulates the mouse deltas; when it runs off the remote
//!   screen back toward a local edge we send [`Message::Leave`], drop suppression,
//!   restore the local cursor and return to `Local`.
//! - **Controlled(peer)** — entered when we *receive* [`Message::Enter`]. Incoming
//!   [`InputEvent`]s are injected via [`inject::inject`]. On [`Message::Leave`]
//!   (or session loss) we return to `Local`.
//!
//! # Safety
//!
//! A stuck-suppressed keyboard or a held modifier would render the machine
//! unusable, so teardown is defensive: on session loss, error, or stop, if we
//! were `Controlling` we clear `suppress`, call [`inject::release_all_modifiers`]
//! and restore the cursor. The same cleanup runs on [`Engine`] drop.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use protocol::{
    ConnState, ControlEvent, ControlState, DaemonState, Edge, Hello, InputEvent, Layout, MachineId,
    Message, PeerId, PeerInfo, PROTOCOL_VERSION,
};
use tokio::sync::{broadcast, mpsc, oneshot, watch};
use tokio::task::JoinHandle;

use crate::cursor;
use crate::seam::{restore_point, RemoteCursor};

/// How often the cursor is polled while `Local` (and parked while
/// `Controlling`). ~100 Hz is responsive without burning a core.
const CURSOR_POLL: Duration = Duration::from_millis(8);

/// Heartbeat send interval. Each connected session is pinged this often.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(3);

/// If a session goes this long without any inbound traffic (Pong or otherwise)
/// it is considered dead and torn down.
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(9);

/// Clipboard poll cadence (mirrors [`clipboard::POLL_INTERVAL`]).
const CLIPBOARD_POLL: Duration = clipboard::POLL_INTERVAL;

/// Backoff between outbound dial attempts to an online, paired peer.
const DIAL_BACKOFF: Duration = Duration::from_secs(3);

/// Bound on the per-session outbound queue. Input events are small and frequent;
/// this absorbs bursts without unbounded growth.
const SESSION_OUT_CAP: usize = 1024;

/// Capacity of the broadcast channel of [`ControlEvent`]s to GUI subscribers.
const EVENT_CAP: usize = 256;

// ===========================================================================
// Public configuration / handle
// ===========================================================================

/// Runtime configuration for the [`Engine`].
#[derive(Debug, Clone)]
pub struct EngineConfig {
    /// This machine's human-friendly display name.
    pub machine_name: String,
    /// The shared pairing secret; the PSK is derived from this.
    pub secret: String,
    /// The active cross-machine layout.
    pub layout: Layout,
    /// Machines this machine trusts (paired). Peers not in this set are refused.
    pub paired: Vec<MachineId>,
    /// Manually-entered peers (`host`, `port`) for LANs without UDP discovery.
    pub manual_peers: Vec<(String, u16)>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            machine_name: "JetCore".to_string(),
            secret: String::new(),
            layout: Layout::default(),
            paired: Vec::new(),
            manual_peers: Vec::new(),
        }
    }
}

/// A running engine. Owns the orchestration task plus the discovery service; drop
/// or [`Engine::stop`] tears everything down (releasing suppression / modifiers).
pub struct Engine {
    machine_id: MachineId,
    machine_name: String,
    cmd_tx: mpsc::Sender<Command>,
    events_tx: broadcast::Sender<ControlEvent>,
    state_rx: watch::Receiver<DaemonState>,
    peers_rx: watch::Receiver<Vec<PeerInfo>>,
    task: Option<JoinHandle<()>>,
}

/// Commands the public API sends into the engine task.
enum Command {
    SetConfig(EngineConfig),
    Pair(PeerId),
    Unpair(PeerId),
    Stop(oneshot::Sender<()>),
}

impl Engine {
    /// Start the engine: load identity, enumerate topology, derive the PSK, bind
    /// the session listener, start discovery, and spawn the orchestration task.
    pub async fn start(cfg: EngineConfig) -> Result<Engine> {
        let identity = pairing::load_or_create_identity().context("loading machine identity")?;
        let machine_id = identity.machine_id.clone();
        let machine_name = cfg.machine_name.clone();

        let topo = topology::current_topology().context("enumerating local topology")?;

        // Bind the session listener (port 0 falls back to the default port).
        let listen_addr: SocketAddr =
            (std::net::Ipv4Addr::UNSPECIFIED, protocol::DEFAULT_SESSION_PORT).into();
        let listener = transport::listen(listen_addr)
            .await
            .context("binding session listener")?;
        let local_port = listener
            .local_addr()
            .map(|a| a.port())
            .unwrap_or(protocol::DEFAULT_SESSION_PORT);

        // Start LAN discovery advertising our listen port.
        let discovery = discovery::start(discovery::MyInfo {
            machine_id: machine_id.clone(),
            name: machine_name.clone(),
            tcp_port: local_port,
        })
        .context("starting discovery")?;

        let (cmd_tx, cmd_rx) = mpsc::channel::<Command>(64);
        let (events_tx, _) = broadcast::channel::<ControlEvent>(EVENT_CAP);

        let initial_state = DaemonState {
            running: true,
            machine_id: machine_id.clone(),
            machine_name: machine_name.clone(),
            control_state: ControlState::Running,
        };
        let (state_tx, state_rx) = watch::channel(initial_state);
        let (peers_tx, peers_rx) = watch::channel::<Vec<PeerInfo>>(Vec::new());

        let worker = Worker::new(
            identity,
            cfg,
            topo,
            listener,
            discovery,
            cmd_rx,
            events_tx.clone(),
            state_tx,
            peers_tx,
        )?;

        let task = tokio::spawn(worker.run());

        Ok(Engine {
            machine_id,
            machine_name,
            cmd_tx,
            events_tx,
            state_rx,
            peers_rx,
            task: Some(task),
        })
    }

    /// Current daemon state snapshot.
    pub fn state(&self) -> DaemonState {
        self.state_rx.borrow().clone()
    }

    /// Current peer-list snapshot.
    pub fn peers(&self) -> Vec<PeerInfo> {
        self.peers_rx.borrow().clone()
    }

    /// Subscribe to live control events (`State` / `Peers` / `Cursor`).
    pub fn subscribe_events(&self) -> broadcast::Receiver<ControlEvent> {
        self.events_tx.subscribe()
    }

    /// This machine's stable id.
    pub fn machine_id(&self) -> MachineId {
        self.machine_id.clone()
    }

    /// This machine's display name.
    pub fn machine_name(&self) -> String {
        self.machine_name.clone()
    }

    /// Replace the engine configuration (name, secret, layout, paired set,
    /// manual peers) at runtime.
    pub async fn set_config(&self, cfg: EngineConfig) -> Result<()> {
        self.cmd_tx
            .send(Command::SetConfig(cfg))
            .await
            .map_err(|_| anyhow::anyhow!("engine task is gone"))
    }

    /// Mark `peer` as paired/trusted.
    pub async fn pair(&self, peer: PeerId) -> Result<()> {
        self.cmd_tx
            .send(Command::Pair(peer))
            .await
            .map_err(|_| anyhow::anyhow!("engine task is gone"))
    }

    /// Remove `peer` from the trust store.
    pub async fn unpair(&self, peer: PeerId) -> Result<()> {
        self.cmd_tx
            .send(Command::Unpair(peer))
            .await
            .map_err(|_| anyhow::anyhow!("engine task is gone"))
    }

    /// Stop the engine: tear down the session loop, releasing any suppression and
    /// stuck modifiers, and join the orchestration task.
    pub async fn stop(mut self) {
        let (ack_tx, ack_rx) = oneshot::channel();
        if self.cmd_tx.send(Command::Stop(ack_tx)).await.is_ok() {
            let _ = ack_rx.await;
        }
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // If `stop` was not called, abort the task. The worker also runs its own
        // safety cleanup on the way out via `Worker::cleanup`, but an abort skips
        // that, so we additionally guarantee the global safety net here.
        if let Some(task) = self.task.take() {
            task.abort();
            // Defensive: releasing modifiers is always safe (key-ups for keys not
            // held are no-ops). The worker shares the `suppress` flag and clears
            // it in its own `Drop`/`cleanup`, so an aborted worker still ends up
            // un-suppressed once its `Worker` value is dropped.
            let _ = inject::release_all_modifiers();
        }
    }
}

// ===========================================================================
// Engine state machine
// ===========================================================================

/// Which machine currently owns input, from this machine's perspective.
#[derive(Debug)]
enum State {
    /// Input is local; poll for an outgoing crossing.
    Local,
    /// We are driving a remote peer; local input is suppressed + forwarded.
    Controlling {
        peer: MachineId,
        cursor: RemoteCursor,
        /// The local edge the cursor left through (to restore near on return).
        origin_edge: Edge,
        /// Where, along that edge, control left (to restore the local cursor).
        origin_along: (i32, i32),
    },
    /// A remote peer is driving us; inject its input until it leaves.
    Controlled { peer: MachineId },
}

// ===========================================================================
// Session actor plumbing
// ===========================================================================

/// A message routed from a session actor back to the worker.
enum SessionEvent {
    /// The session completed its handshake; `machine_id` is the verified peer.
    Up {
        machine_id: MachineId,
        out_tx: mpsc::Sender<Message>,
    },
    /// An inbound protocol message from the peer.
    Message { from: MachineId, msg: Message },
    /// The session terminated (clean EOF or error).
    Down { machine_id: MachineId },
}

/// A connected peer the worker can send to.
struct PeerConn {
    out_tx: mpsc::Sender<Message>,
    last_seen: tokio::time::Instant,
}

// ===========================================================================
// Worker
// ===========================================================================

/// The engine's single orchestration task. Owns all mutable state; everything
/// else feeds it over channels.
struct Worker {
    identity: pairing::Identity,
    machine_name: String,
    layout: Layout,
    psk: [u8; 32],
    store: pairing::PairingStore,

    // Subsystems / IO.
    listener: tokio::net::TcpListener,
    /// Held to keep the discovery service (and its background tasks) alive; its
    /// updates are consumed via `discovery_rx`.
    _discovery: discovery::Discovery,
    discovery_rx: watch::Receiver<Vec<PeerInfo>>,
    manual_peers: Vec<PeerInfo>,

    // Shared with capture.
    suppress: Arc<AtomicBool>,
    _capture: capture::Capture,
    input_rx: mpsc::Receiver<InputEvent>,

    // Clipboard bridge.
    clip_out_rx: mpsc::Receiver<protocol::ClipboardPayload>,
    clip_in_tx: mpsc::Sender<protocol::ClipboardPayload>,
    _clip_thread: ClipboardHandle,

    // Session actors.
    sess_tx: mpsc::Sender<SessionEvent>,
    sess_rx: mpsc::Receiver<SessionEvent>,
    conns: HashMap<MachineId, PeerConn>,
    dialing: std::collections::HashSet<MachineId>,
    last_dial: HashMap<MachineId, tokio::time::Instant>,

    // Control plumbing.
    cmd_rx: mpsc::Receiver<Command>,
    events_tx: broadcast::Sender<ControlEvent>,
    state_tx: watch::Sender<DaemonState>,
    peers_tx: watch::Sender<Vec<PeerInfo>>,

    // State machine.
    state: State,
    topo: protocol::LocalTopology,

    /// Machine ids trusted by configuration (in addition to anything persisted
    /// in `store`). Membership here gates handshakes and crossings.
    extra_paired: std::collections::HashSet<MachineId>,
}

/// Owns the clipboard polling thread; aborting it on drop is implicit (the
/// thread observes the closed channel and exits).
struct ClipboardHandle {
    _stop: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl Drop for ClipboardHandle {
    fn drop(&mut self) {
        self._stop.store(true, Ordering::Relaxed);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

impl Worker {
    #[allow(clippy::too_many_arguments)]
    fn new(
        identity: pairing::Identity,
        cfg: EngineConfig,
        topo: protocol::LocalTopology,
        listener: tokio::net::TcpListener,
        discovery: discovery::Discovery,
        cmd_rx: mpsc::Receiver<Command>,
        events_tx: broadcast::Sender<ControlEvent>,
        state_tx: watch::Sender<DaemonState>,
        peers_tx: watch::Sender<Vec<PeerInfo>>,
    ) -> Result<Self> {
        let psk = pairing::derive_psk(&cfg.secret);

        // Persisted trust store: holds learned static pubkeys for pinning. Runtime
        // trust is the configured paired set below.
        let store = pairing::PairingStore::load().unwrap_or_default();

        // --- Capture: bridge std mpsc -> tokio mpsc. ---
        let suppress = Arc::new(AtomicBool::new(false));
        let (std_tx, std_rx) = std::sync::mpsc::channel::<InputEvent>();
        let capture = capture::Capture::start(std_tx, suppress.clone())
            .context("starting input capture")?;
        let (input_tx, input_rx) = mpsc::channel::<InputEvent>(4096);
        std::thread::Builder::new()
            .name("capture-bridge".into())
            .spawn(move || {
                // Forward captured events into the async world until either side
                // closes. `blocking_send` keeps backpressure without spinning.
                while let Ok(ev) = std_rx.recv() {
                    if input_tx.blocking_send(ev).is_err() {
                        break;
                    }
                }
            })
            .context("spawning capture bridge thread")?;

        // --- Clipboard: dedicated blocking thread. ---
        let (clip_out_tx, clip_out_rx) = mpsc::channel::<protocol::ClipboardPayload>(64);
        let (clip_in_tx, clip_in_rx) = mpsc::channel::<protocol::ClipboardPayload>(64);
        let clip_thread = spawn_clipboard_thread(clip_out_tx, clip_in_rx);

        let (sess_tx, sess_rx) = mpsc::channel::<SessionEvent>(256);

        let discovery_rx = discovery.subscribe();

        let manual_peers = cfg
            .manual_peers
            .iter()
            .map(|(h, p)| discovery::manual_add(h.clone(), *p))
            .collect();

        // Configured trust set: authoritative for gating handshakes + crossings.
        let configured_paired: std::collections::HashSet<MachineId> =
            cfg.paired.iter().cloned().collect();

        Ok(Worker {
            identity,
            machine_name: cfg.machine_name,
            layout: cfg.layout,
            psk,
            store,
            listener,
            _discovery: discovery,
            discovery_rx,
            manual_peers,
            suppress,
            _capture: capture,
            input_rx,
            clip_out_rx,
            clip_in_tx,
            _clip_thread: clip_thread,
            sess_tx,
            sess_rx,
            conns: HashMap::new(),
            dialing: Default::default(),
            last_dial: HashMap::new(),
            cmd_rx,
            events_tx,
            state_tx,
            peers_tx,
            state: State::Local,
            topo,
            extra_paired: configured_paired,
        })
    }

    /// The full set of machine ids we trust: union of the configured paired set
    /// and anything persisted in the pairing store.
    fn is_trusted(&self, id: &MachineId) -> bool {
        self.extra_paired.contains(id) || self.store.is_paired(id)
    }

    /// Run the orchestration loop until a `Stop` command (or all inputs close).
    async fn run(mut self) {
        let mut cursor_tick = tokio::time::interval(CURSOR_POLL);
        cursor_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut hb_tick = tokio::time::interval(HEARTBEAT_INTERVAL);
        hb_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut dial_tick = tokio::time::interval(DIAL_BACKOFF);
        dial_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // Publish the initial peer snapshot.
        self.publish_peers();

        loop {
            tokio::select! {
                // --- Control commands ---
                cmd = self.cmd_rx.recv() => {
                    match cmd {
                        Some(Command::Stop(ack)) => {
                            self.cleanup();
                            let _ = ack.send(());
                            break;
                        }
                        Some(Command::SetConfig(cfg)) => self.apply_config(cfg),
                        Some(Command::Pair(peer)) => self.do_pair(peer),
                        Some(Command::Unpair(peer)) => self.do_unpair(peer),
                        None => { self.cleanup(); break; }
                    }
                }

                // --- Inbound TCP connections ---
                accepted = self.listener.accept() => {
                    if let Ok((stream, _addr)) = accepted {
                        self.spawn_inbound(stream);
                    }
                }

                // --- Session actor events ---
                Some(ev) = self.sess_rx.recv() => {
                    self.on_session_event(ev).await;
                }

                // --- Captured local input ---
                Some(ev) = self.input_rx.recv() => {
                    self.on_input(ev).await;
                }

                // --- Outbound clipboard changes ---
                Some(payload) = self.clip_out_rx.recv() => {
                    self.broadcast_clipboard(payload).await;
                }

                // --- Discovery updates ---
                changed = self.discovery_rx.changed() => {
                    if changed.is_ok() {
                        self.publish_peers();
                    }
                }

                // --- Cursor poll / parking tick ---
                _ = cursor_tick.tick() => {
                    self.on_cursor_tick().await;
                }

                // --- Heartbeat ---
                _ = hb_tick.tick() => {
                    self.on_heartbeat().await;
                }

                // --- Outbound dial attempts ---
                _ = dial_tick.tick() => {
                    self.dial_online_peers();
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Cursor poll / parking
    // -----------------------------------------------------------------------

    async fn on_cursor_tick(&mut self) {
        match &self.state {
            State::Local => {
                let Some((x, y)) = cursor::get_cursor_pos() else {
                    return;
                };
                let edge = topology::edge_at(&self.topo, x, y);

                // Decide whether this position hands off to a peer. Only trusted +
                // connected peers are eligible.
                let crossing = edge.and_then(|e| {
                    detect_crossing(
                        &self.layout,
                        &self.identity.machine_id,
                        (x, y),
                        e,
                        |id| self.is_trusted(id) && self.conns.contains_key(id),
                    )
                });

                let crossing_to = crossing.as_ref().map(|c| c.target.clone());

                // Emit cursor telemetry for the GUI overlay BEFORE the transition
                // so the overlay sees the imminent crossing.
                self.emit_cursor(x, y, edge, crossing_to);

                if let Some(c) = crossing {
                    let target = c.target.clone();
                    self.enter_controlling(target, edge.unwrap(), (x, y), c.entry)
                        .await;
                }
            }
            State::Controlling { .. } => {
                // Park the local cursor each tick so it can't drift to other apps.
                let park = self.park_point();
                cursor::set_cursor_pos(park.0, park.1);
            }
            State::Controlled { .. } => {
                // The human isn't here; nothing to poll.
            }
        }
    }

    /// A fixed local point to park the cursor at while controlling — the centre
    /// of the local virtual desktop, away from any edge so a stray real movement
    /// while parking can't immediately re-trigger an edge.
    fn park_point(&self) -> (i32, i32) {
        let (bx, by, bw, bh) = self.topo.virtual_bounds;
        (bx + bw / 2, by + bh / 2)
    }

    async fn enter_controlling(
        &mut self,
        peer: MachineId,
        origin_edge: Edge,
        origin_along: (i32, i32),
        entry: (i32, i32),
    ) {
        // Remote screen size from the layout.
        let (rw, rh) = self
            .layout
            .get(&peer)
            .map(|p| (p.w, p.h))
            .unwrap_or((1920, 1080));

        // Suppress local input, then announce the crossing to the peer.
        self.suppress.store(true, Ordering::Relaxed);
        let _ = self
            .send_to(&peer, Message::Enter { entry, screen: peer.clone() })
            .await;

        // Park immediately so the cursor doesn't sit on the seam.
        let park = self.park_point();
        cursor::set_cursor_pos(park.0, park.1);

        let cursor = RemoteCursor::new(entry.0, entry.1, rw, rh);
        tracing::info!(%peer, "entering Controlling");
        self.state = State::Controlling {
            peer,
            cursor,
            origin_edge,
            origin_along,
        };
        self.publish_state_running();
    }

    // -----------------------------------------------------------------------
    // Local input handling
    // -----------------------------------------------------------------------

    async fn on_input(&mut self, ev: InputEvent) {
        // Capture the data we need without holding a borrow across the await.
        let action = match &mut self.state {
            State::Controlling { peer, cursor, origin_edge, origin_along } => {
                let peer = peer.clone();
                // Advance the virtual remote cursor by mouse deltas to detect the
                // return seam crossing.
                let leaving = match ev {
                    InputEvent::MouseMove { dx, dy } => cursor.apply_delta(dx, dy),
                    _ => None,
                };
                if leaving.is_some() {
                    // The virtual cursor ran off an edge of the remote screen:
                    // hand control back to this machine.
                    Some(InputAction::Leave {
                        peer,
                        origin_edge: *origin_edge,
                        origin_along: *origin_along,
                    })
                } else {
                    Some(InputAction::Forward { peer, ev })
                }
            }
            // In Local/Controlled we ignore captured events (Local input passes
            // through the hook normally; Controlled has no local human).
            _ => None,
        };

        match action {
            Some(InputAction::Forward { peer, ev }) => {
                let _ = self.send_to(&peer, Message::Input(ev)).await;
            }
            Some(InputAction::Leave { peer, origin_edge, origin_along }) => {
                self.leave_controlling(&peer, origin_edge, origin_along).await;
            }
            None => {}
        }
    }

    /// Hand control back from `Controlling` to `Local`.
    async fn leave_controlling(&mut self, peer: &MachineId, origin_edge: Edge, origin_along: (i32, i32)) {
        let _ = self.send_to(peer, Message::Leave).await;
        self.suppress.store(false, Ordering::Relaxed);
        // Restore the local cursor near the edge it left through.
        let p = restore_point(self.topo.virtual_bounds, origin_edge, origin_along);
        cursor::set_cursor_pos(p.0, p.1);
        tracing::info!(%peer, "leaving Controlling -> Local");
        self.state = State::Local;
        self.publish_state_running();
    }

    // -----------------------------------------------------------------------
    // Session events
    // -----------------------------------------------------------------------

    async fn on_session_event(&mut self, ev: SessionEvent) {
        match ev {
            SessionEvent::Up { machine_id, out_tx } => {
                self.dialing.remove(&machine_id);
                tracing::info!(peer = %machine_id, "session up");
                self.conns.insert(
                    machine_id.clone(),
                    PeerConn {
                        out_tx,
                        last_seen: tokio::time::Instant::now(),
                    },
                );
                self.publish_peers();
            }
            SessionEvent::Message { from, msg } => {
                if let Some(c) = self.conns.get_mut(&from) {
                    c.last_seen = tokio::time::Instant::now();
                }
                self.on_peer_message(from, msg).await;
            }
            SessionEvent::Down { machine_id } => {
                tracing::info!(peer = %machine_id, "session down");
                self.dialing.remove(&machine_id);
                self.conns.remove(&machine_id);
                self.on_peer_lost(&machine_id);
                self.publish_peers();
            }
        }
    }

    /// Handle the loss of a peer's session. Critically, if we were controlling
    /// that peer, we must NOT leave the machine suppressed.
    fn on_peer_lost(&mut self, lost: &MachineId) {
        let recover = match &self.state {
            State::Controlling { peer, origin_edge, origin_along, .. } if peer == lost => {
                Some((*origin_edge, *origin_along))
            }
            State::Controlled { peer } if peer == lost => Some((Edge::Left, (0, 0))),
            _ => None,
        };

        if let Some((origin_edge, origin_along)) = recover {
            match &self.state {
                State::Controlling { .. } => {
                    self.suppress.store(false, Ordering::Relaxed);
                    let _ = inject::release_all_modifiers();
                    let p = restore_point(self.topo.virtual_bounds, origin_edge, origin_along);
                    cursor::set_cursor_pos(p.0, p.1);
                    tracing::warn!(peer = %lost, "controlling session lost; suppression cleared");
                }
                State::Controlled { .. } => {
                    // We were being controlled; release any keys the dead peer
                    // may have left held.
                    let _ = inject::release_all_modifiers();
                    tracing::warn!(peer = %lost, "controlled session lost; modifiers released");
                }
                _ => {}
            }
            self.state = State::Local;
            self.publish_state_running();
        }
    }

    async fn on_peer_message(&mut self, from: MachineId, msg: Message) {
        match msg {
            Message::Ping => {
                let _ = self.send_to(&from, Message::Pong).await;
            }
            Message::Pong => { /* liveness handled by last_seen update */ }
            Message::Enter { entry, .. } => {
                // A peer is handing control TO us: become Controlled and warp the
                // cursor to the entry point.
                if !self.is_trusted(&from) {
                    return;
                }
                // If we were controlling someone, abort that first (safety).
                if let State::Controlling { peer, origin_edge, origin_along, .. } = &self.state {
                    let (peer, oe, oa) = (peer.clone(), *origin_edge, *origin_along);
                    self.leave_controlling(&peer, oe, oa).await;
                }
                let _ = inject::inject(&InputEvent::MouseAbs { x: entry.0, y: entry.1 });
                tracing::info!(peer = %from, "entering Controlled");
                self.state = State::Controlled { peer: from };
                self.publish_state_running();
            }
            Message::Leave => {
                if let State::Controlled { peer } = &self.state {
                    if peer == &from {
                        let _ = inject::release_all_modifiers();
                        tracing::info!(peer = %from, "leaving Controlled -> Local");
                        self.state = State::Local;
                        self.publish_state_running();
                    }
                }
            }
            Message::Input(ev) => {
                // Only inject if this peer is the one currently controlling us.
                if let State::Controlled { peer } = &self.state {
                    if peer == &from {
                        if let Err(e) = inject::inject(&ev) {
                            tracing::debug!("inject failed: {e}");
                        }
                    }
                }
            }
            Message::ClipboardData(payload) => {
                let _ = self.clip_in_tx.send(payload).await;
            }
            Message::ClipboardOffer => { /* pull-model not used; data is pushed */ }
            Message::LayoutSync(layout) => {
                self.layout = layout;
            }
            Message::Hello(_) => { /* handled during handshake */ }
            Message::Error { msg } => {
                tracing::warn!(peer = %from, "peer error: {msg}");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Heartbeat
    // -----------------------------------------------------------------------

    async fn on_heartbeat(&mut self) {
        let now = tokio::time::Instant::now();
        // Find dead sessions and ping live ones.
        let mut dead: Vec<MachineId> = Vec::new();
        let mut to_ping: Vec<MachineId> = Vec::new();
        for (id, c) in self.conns.iter() {
            if now.duration_since(c.last_seen) > HEARTBEAT_TIMEOUT {
                dead.push(id.clone());
            } else {
                to_ping.push(id.clone());
            }
        }
        for id in to_ping {
            let _ = self.send_to(&id, Message::Ping).await;
        }
        for id in dead {
            tracing::warn!(peer = %id, "heartbeat timeout; dropping session");
            self.conns.remove(&id);
            self.on_peer_lost(&id);
        }
        if !self.conns.is_empty() {
            self.publish_peers();
        }
    }

    // -----------------------------------------------------------------------
    // Clipboard
    // -----------------------------------------------------------------------

    async fn broadcast_clipboard(&mut self, payload: protocol::ClipboardPayload) {
        let targets: Vec<MachineId> = self.conns.keys().cloned().collect();
        for id in targets {
            let _ = self
                .send_to(&id, Message::ClipboardData(payload.clone()))
                .await;
        }
    }

    // -----------------------------------------------------------------------
    // Outbound dialing
    // -----------------------------------------------------------------------

    fn dial_online_peers(&mut self) {
        let now = tokio::time::Instant::now();
        let discovered = self.discovery_rx.borrow().clone();
        let candidates = discovered.into_iter().chain(self.manual_peers.iter().cloned());

        for peer in candidates {
            // Only dial trusted peers we aren't already connected to / dialing.
            let mid = MachineId::new(peer.id.as_str());
            if !self.is_trusted(&mid) {
                continue;
            }
            if self.conns.contains_key(&mid) || self.dialing.contains(&mid) {
                continue;
            }
            if !peer.online {
                continue;
            }
            // Respect backoff.
            if let Some(t) = self.last_dial.get(&mid) {
                if now.duration_since(*t) < DIAL_BACKOFF {
                    continue;
                }
            }
            self.last_dial.insert(mid.clone(), now);
            self.dialing.insert(mid.clone());
            self.spawn_outbound(peer);
        }
    }

    // -----------------------------------------------------------------------
    // Session actors
    // -----------------------------------------------------------------------

    /// Spawn an actor for an inbound (accepted) TCP stream.
    fn spawn_inbound(&self, stream: tokio::net::TcpStream) {
        let keys = self.handshake_keys(None);
        let our_hello = self.our_hello();
        let sess_tx = self.sess_tx.clone();
        let trusted = self.trusted_snapshot();
        tokio::spawn(async move {
            match transport::Session::accept(stream, keys).await {
                Ok(session) => {
                    run_session(session, our_hello, trusted, sess_tx, true).await;
                }
                Err(e) => tracing::debug!("inbound handshake failed: {e}"),
            }
        });
    }

    /// Spawn an actor that dials `peer` and runs the session.
    fn spawn_outbound(&self, peer: PeerInfo) {
        let mid = MachineId::new(peer.id.as_str());
        let remote_public = self.store.remote_public(&mid);
        let keys = self.handshake_keys(remote_public);
        let our_hello = self.our_hello();
        let sess_tx = self.sess_tx.clone();
        let trusted = self.trusted_snapshot();
        let host = peer.host.clone();
        let port = peer.port;
        tokio::spawn(async move {
            let addr: SocketAddr = match format!("{host}:{port}").parse() {
                Ok(a) => a,
                Err(_) => {
                    // Resolve hostnames via tokio.
                    match tokio::net::lookup_host((host.as_str(), port)).await {
                        Ok(mut it) => match it.next() {
                            Some(a) => a,
                            None => {
                                let _ = sess_tx.send(SessionEvent::Down { machine_id: mid }).await;
                                return;
                            }
                        },
                        Err(_) => {
                            let _ = sess_tx.send(SessionEvent::Down { machine_id: mid }).await;
                            return;
                        }
                    }
                }
            };
            match transport::Session::connect(addr, keys).await {
                Ok(session) => {
                    run_session(session, our_hello, trusted, sess_tx, false).await;
                }
                Err(e) => {
                    tracing::debug!("outbound connect to {addr} failed: {e}");
                    let _ = sess_tx.send(SessionEvent::Down { machine_id: mid }).await;
                }
            }
        });
    }

    fn handshake_keys(&self, remote_public: Option<[u8; 32]>) -> transport::HandshakeKeys {
        let (local_private, psk, remote_public) =
            pairing::handshake_material(&self.identity, self.psk, remote_public);
        transport::HandshakeKeys {
            local_private,
            psk,
            remote_public,
        }
    }

    fn our_hello(&self) -> Hello {
        Hello {
            protocol_version: PROTOCOL_VERSION,
            machine_id: self.identity.machine_id.clone(),
            machine_name: self.machine_name.clone(),
        }
    }

    /// Snapshot of trusted machine ids for the session actor to gate the peer.
    ///
    /// Authoritative trust is the configured paired set (`extra_paired`), seeded
    /// from [`EngineConfig::paired`] and updated by [`Engine::pair`] /
    /// [`Engine::unpair`]. The persisted [`pairing::PairingStore`] holds learned
    /// static public keys for pinning but does not, on its own, grant trust.
    fn trusted_snapshot(&self) -> std::collections::HashSet<MachineId> {
        self.extra_paired.clone()
    }

    /// Send a message to a connected peer, if any. Drops on a full queue.
    async fn send_to(&self, peer: &MachineId, msg: Message) -> Result<()> {
        if let Some(c) = self.conns.get(peer) {
            c.out_tx
                .send(msg)
                .await
                .map_err(|_| anyhow::anyhow!("peer {peer} send channel closed"))
        } else {
            Err(anyhow::anyhow!("peer {peer} not connected"))
        }
    }

    // -----------------------------------------------------------------------
    // Control commands
    // -----------------------------------------------------------------------

    fn apply_config(&mut self, cfg: EngineConfig) {
        self.machine_name = cfg.machine_name;
        self.psk = pairing::derive_psk(&cfg.secret);
        self.layout = cfg.layout;
        self.extra_paired = cfg.paired.into_iter().collect();
        self.manual_peers = cfg
            .manual_peers
            .iter()
            .map(|(h, p)| discovery::manual_add(h.clone(), *p))
            .collect();
        self.publish_state_running();
        self.publish_peers();
    }

    fn do_pair(&mut self, peer: PeerId) {
        let mid = MachineId::new(peer.as_str());
        self.extra_paired.insert(mid.clone());
        tracing::info!(peer = %mid, "paired");
        // A newly-trusted, already-discovered peer will be dialed on the next
        // dial tick.
        self.publish_peers();
    }

    fn do_unpair(&mut self, peer: PeerId) {
        let mid = MachineId::new(peer.as_str());
        self.extra_paired.remove(&mid);
        let _ = self.store.unpair(&mid);
        // Drop any live session with the now-untrusted peer.
        if self.conns.remove(&mid).is_some() {
            self.on_peer_lost(&mid);
        }
        tracing::info!(peer = %mid, "unpaired");
        self.publish_peers();
    }

    // -----------------------------------------------------------------------
    // Telemetry / publishing
    // -----------------------------------------------------------------------

    fn emit_cursor(&self, x: i32, y: i32, edge: Option<Edge>, crossing_to: Option<MachineId>) {
        let _ = self.events_tx.send(ControlEvent::Cursor {
            x,
            y,
            edge: edge.map(|e| format!("{e:?}")),
            crossing_to,
        });
    }

    fn publish_state_running(&self) {
        let st = DaemonState {
            running: true,
            machine_id: self.identity.machine_id.clone(),
            machine_name: self.machine_name.clone(),
            control_state: ControlState::Running,
        };
        let _ = self.state_tx.send(st.clone());
        let _ = self.events_tx.send(ControlEvent::State(st));
    }

    /// Merge discovery + manual peers + connection + trust state into a published
    /// peer list.
    fn publish_peers(&self) {
        let mut peers = self.discovery_rx.borrow().clone();
        // Fold in manual peers not already present by id.
        for m in &self.manual_peers {
            if !peers.iter().any(|p| p.id == m.id) {
                peers.push(m.clone());
            }
        }
        for p in peers.iter_mut() {
            let mid = MachineId::new(p.id.as_str());
            p.paired = self.is_trusted(&mid);
            if self.conns.contains_key(&mid) {
                p.conn_state = ConnState::Connected;
            }
        }
        let _ = self.peers_tx.send(peers.clone());
        let _ = self.events_tx.send(ControlEvent::Peers(peers));
    }

    // -----------------------------------------------------------------------
    // Teardown safety
    // -----------------------------------------------------------------------

    /// Final safety cleanup: never leave the machine suppressed or with stuck
    /// modifiers. Idempotent.
    fn cleanup(&mut self) {
        // Clear suppression so local input flows again.
        self.suppress.store(false, Ordering::Relaxed);
        // Release any held modifiers/buttons regardless of state.
        let _ = inject::release_all_modifiers();
        // Restore the cursor somewhere sane if we were mid-control.
        if let State::Controlling { origin_edge, origin_along, .. } = &self.state {
            let p = restore_point(self.topo.virtual_bounds, *origin_edge, *origin_along);
            cursor::set_cursor_pos(p.0, p.1);
        }
        self.state = State::Local;

        let st = DaemonState {
            running: false,
            machine_id: self.identity.machine_id.clone(),
            machine_name: self.machine_name.clone(),
            control_state: ControlState::Stopped,
        };
        let _ = self.state_tx.send(st.clone());
        let _ = self.events_tx.send(ControlEvent::State(st));
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        // Guarantee the safety net runs even on an abnormal exit.
        self.cleanup();
    }
}

/// Pure sensing decision: given the active layout, this machine's id, the cursor
/// position, the edge it is touching, and an `eligible` predicate (trusted +
/// connected), resolve the crossing that should trigger a hand-off — or `None`.
///
/// Separated out so the Local→Controlling decision is unit-testable without any
/// OS / async dependency.
fn detect_crossing(
    layout: &Layout,
    me: &MachineId,
    pos: (i32, i32),
    edge: Edge,
    eligible: impl Fn(&MachineId) -> bool,
) -> Option<protocol::Crossing> {
    let crossing = layout::resolve_crossing(layout, me, edge, pos)?;
    if eligible(&crossing.target) {
        Some(crossing)
    } else {
        None
    }
}

/// What `on_input` decided to do, computed without holding a borrow across await.
enum InputAction {
    Forward { peer: MachineId, ev: InputEvent },
    Leave {
        peer: MachineId,
        origin_edge: Edge,
        origin_along: (i32, i32),
    },
}

// ===========================================================================
// Session actor body (free function so it owns the Session)
// ===========================================================================

/// Drive one established [`transport::Session`]: exchange Hello, verify the peer
/// is trusted, then pump outbound queue <-> inbound recv, routing events back to
/// the worker. Returns when the session ends.
async fn run_session(
    mut session: transport::Session,
    our_hello: Hello,
    trusted: std::collections::HashSet<MachineId>,
    sess_tx: mpsc::Sender<SessionEvent>,
    inbound: bool,
) {
    // Exchange Hello. Initiator (outbound) sends first; responder (inbound)
    // reads first, to avoid a deadlock where both wait to read.
    let peer_hello = if inbound {
        let peer = match session.recv().await {
            Ok(Message::Hello(h)) => h,
            Ok(_) | Err(_) => return,
        };
        if session.send(&Message::Hello(our_hello)).await.is_err() {
            return;
        }
        peer
    } else {
        if session.send(&Message::Hello(our_hello)).await.is_err() {
            return;
        }
        match session.recv().await {
            Ok(Message::Hello(h)) => h,
            Ok(_) | Err(_) => return,
        }
    };

    if peer_hello.protocol_version != PROTOCOL_VERSION {
        tracing::warn!(
            peer = %peer_hello.machine_id,
            "protocol version mismatch ({} vs {PROTOCOL_VERSION})",
            peer_hello.protocol_version
        );
        return;
    }

    let peer_id = peer_hello.machine_id.clone();

    // Gate on trust: only serve paired peers.
    if !trusted.contains(&peer_id) {
        tracing::info!(peer = %peer_id, "rejecting unpaired peer");
        let _ = session.send(&Message::Error { msg: "not paired".into() }).await;
        return;
    }

    // Per-session outbound queue.
    let (out_tx, mut out_rx) = mpsc::channel::<Message>(SESSION_OUT_CAP);
    if sess_tx
        .send(SessionEvent::Up {
            machine_id: peer_id.clone(),
            out_tx,
        })
        .await
        .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            // Outbound: send queued messages.
            out = out_rx.recv() => {
                match out {
                    Some(msg) => {
                        if let Err(e) = session.send(&msg).await {
                            tracing::debug!(peer = %peer_id, "session send error: {e}");
                            break;
                        }
                    }
                    None => break, // worker dropped our sender (unpaired / shutdown)
                }
            }
            // Inbound: receive and route.
            inbound = session.recv() => {
                match inbound {
                    Ok(msg) => {
                        if sess_tx
                            .send(SessionEvent::Message { from: peer_id.clone(), msg })
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(e) => {
                        tracing::debug!(peer = %peer_id, "session recv error: {e}");
                        break;
                    }
                }
            }
        }
    }

    let _ = sess_tx
        .send(SessionEvent::Down { machine_id: peer_id })
        .await;
}

// ===========================================================================
// Clipboard thread
// ===========================================================================

/// Spawn the dedicated clipboard thread. It polls the local clipboard for
/// genuine changes (emitting them on `out_tx`) and applies inbound payloads from
/// `in_rx`. Owning one [`clipboard::ClipboardSync`] on a single thread satisfies
/// the crate's thread-affinity requirement.
fn spawn_clipboard_thread(
    out_tx: mpsc::Sender<protocol::ClipboardPayload>,
    mut in_rx: mpsc::Receiver<protocol::ClipboardPayload>,
) -> ClipboardHandle {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let join = std::thread::Builder::new()
        .name("clipboard".into())
        .spawn(move || {
            let mut sync = match clipboard::ClipboardSync::new() {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("clipboard unavailable: {e}");
                    return;
                }
            };
            while !stop_thread.load(Ordering::Relaxed) {
                // Apply any inbound payloads first (drain without blocking).
                while let Ok(payload) = in_rx.try_recv() {
                    if let Err(e) = sync.apply(&payload) {
                        tracing::debug!("clipboard apply failed: {e}");
                    }
                }
                // Poll for a local change.
                match sync.poll_local_change() {
                    Ok(Some(payload)) => {
                        if out_tx.blocking_send(payload).is_err() {
                            break; // worker gone
                        }
                    }
                    Ok(None) => {}
                    Err(e) => tracing::debug!("clipboard poll failed: {e}"),
                }
                std::thread::sleep(CLIPBOARD_POLL);
            }
        })
        .ok();

    ClipboardHandle {
        _stop: stop,
        join,
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use layout::default_layout;

    fn mid(s: &str) -> MachineId {
        MachineId::new(s)
    }

    fn topo(w: i32, h: i32) -> protocol::LocalTopology {
        protocol::LocalTopology {
            monitors: vec![],
            virtual_bounds: (0, 0, w, h),
        }
    }

    #[test]
    fn engine_config_default_is_sane() {
        let cfg = EngineConfig::default();
        assert!(cfg.paired.is_empty());
        assert!(cfg.manual_peers.is_empty());
        assert_eq!(cfg.layout, Layout::default());
        assert!(cfg.secret.is_empty());
    }

    #[test]
    fn detect_crossing_requires_eligible_peer() {
        let layout = default_layout(&topo(1920, 1080), &mid("me"), "Me", &[(
            mid("peer"),
            "Peer".to_string(),
            1920,
            1080,
        )]);
        // Cursor on the right edge of "me" maps to "peer".
        let pos = (1919, 540);

        // Ineligible (not trusted/connected) -> no crossing.
        assert!(detect_crossing(&layout, &mid("me"), pos, Edge::Right, |_| false).is_none());

        // Eligible -> crossing into "peer".
        let c = detect_crossing(&layout, &mid("me"), pos, Edge::Right, |id| id == &mid("peer"))
            .expect("eligible peer should yield a crossing");
        assert_eq!(c.target, mid("peer"));
        assert_eq!(c.entry_edge, Edge::Left);
    }

    #[test]
    fn detect_crossing_none_when_no_neighbour() {
        // Single machine: nothing across the right edge.
        let layout = default_layout(&topo(1920, 1080), &mid("me"), "Me", &[]);
        assert!(
            detect_crossing(&layout, &mid("me"), (1919, 540), Edge::Right, |_| true).is_none()
        );
    }

    #[test]
    fn detect_crossing_eligibility_predicate_sees_target_id() {
        // Two peers to the right; the eligible one is the abutting neighbour.
        let layout = default_layout(
            &topo(800, 600),
            &mid("me"),
            "Me",
            &[
                (mid("p1"), "P1".to_string(), 800, 600),
                (mid("p2"), "P2".to_string(), 800, 600),
            ],
        );
        // Right edge of "me" abuts p1 (not p2).
        let c = detect_crossing(&layout, &mid("me"), (799, 300), Edge::Right, |id| {
            id == &mid("p1")
        });
        assert_eq!(c.map(|c| c.target), Some(mid("p1")));

        // If only p2 is eligible, the abutting neighbour p1 is rejected -> None.
        assert!(detect_crossing(&layout, &mid("me"), (799, 300), Edge::Right, |id| id
            == &mid("p2"))
        .is_none());
    }
}
