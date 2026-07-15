//! # JetCore Borderless — frozen protocol
//!
//! This crate is **THE contract** every other crate in the workspace imports.
//! It defines machine/monitor identity, the cross-machine layout model, input
//! events, the session wire `Message` enum with length-prefixed framing, and the
//! JSON control-socket API the GUI (JetCore) uses to drive the daemon.
//!
//! Stability rules:
//! - Anything `pub` here is a frozen interface. Change it only by bumping
//!   [`PROTOCOL_VERSION`].
//! - Wire messages ([`Message`]) are serialized with `postcard` (compact, no
//!   self-description) and framed length-prefixed; see [`encode_frame`] /
//!   [`decode_frame`].
//! - Control-socket types ([`ControlRequest`] / [`ControlEvent`]) are serialized
//!   with `serde_json` (human-readable, tagged) for the GUI <-> daemon socket.

use serde::{Deserialize, Serialize};

/// Protocol contract version. Bump on ANY breaking change to the public surface,
/// wire framing, or message semantics. Peers MUST refuse to pair across a
/// mismatch (see [`Hello`] / [`Message::Hello`]).
pub const PROTOCOL_VERSION: u32 = 1;

/// The single `windows` crate version pinned across the entire workspace
/// (see root `Cargo.toml` `[workspace.dependencies]`). Recorded here so the
/// frozen contract documents the Win32 ABI surface every native crate links
/// against. **Keep this string in sync with the workspace pin.**
pub const PINNED_WINDOWS_VERSION: &str = "0.59";

/// Default TCP port the daemon listens on for peer sessions.
pub const DEFAULT_SESSION_PORT: u16 = 24800;

/// Default UDP port used for LAN discovery beacons.
pub const DEFAULT_DISCOVERY_PORT: u16 = 24801;

// ===========================================================================
// Errors
// ===========================================================================

/// Errors produced by protocol-level operations (framing / (de)serialization).
#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    /// A wire value failed to serialize to `postcard` bytes.
    #[error("serialize failed: {0}")]
    Serialize(String),
    /// A wire value failed to deserialize from `postcard` bytes.
    #[error("deserialize failed: {0}")]
    Deserialize(String),
    /// The 4-byte length prefix was absent or the buffer was shorter than the
    /// advertised frame length (i.e. need more bytes).
    #[error("incomplete frame: need {needed} bytes, have {have}")]
    Incomplete { needed: usize, have: usize },
    /// The advertised frame length exceeds [`MAX_FRAME_LEN`].
    #[error("frame too large: {len} bytes (max {max})")]
    FrameTooLarge { len: usize, max: usize },
}

/// Hard upper bound on a single decoded frame's payload, to bound memory use
/// when reading from an untrusted socket. Clipboard payloads larger than this
/// must be chunked by a higher layer.
pub const MAX_FRAME_LEN: usize = 64 * 1024 * 1024; // 64 MiB

// ===========================================================================
// Identity
// ===========================================================================

/// Stable identifier for a physical machine participating in the KVM mesh.
///
/// Generated once per install and persisted; survives renames and IP changes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct MachineId(pub String);

impl MachineId {
    /// Construct from any string-like value.
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
    /// Borrow the underlying id string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for MachineId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Identifier for a peer connection/endpoint as seen by the local daemon.
///
/// Distinct from [`MachineId`]: a `PeerId` is the local handle for a remote
/// participant (one per configured/discovered peer), whereas `MachineId` is the
/// remote's self-asserted stable identity learned via [`Hello`].
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PeerId(pub String);

impl PeerId {
    /// Construct from any string-like value.
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
    /// Borrow the underlying id string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for PeerId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

// ===========================================================================
// Monitor / local topology model
// ===========================================================================

/// A single monitor's placement within a machine's local virtual desktop.
///
/// Coordinates are in the OS virtual-screen coordinate space (pixels). On
/// Windows this matches `GetSystemMetrics(SM_XVIRTUALSCREEN, ...)` space, where
/// the primary monitor's top-left is the origin and secondary monitors may have
/// negative coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MonitorRect {
    /// Local, per-machine monitor index/handle id (0-based, stable within a
    /// topology snapshot).
    pub id: u32,
    /// Left edge (virtual-screen x).
    pub x: i32,
    /// Top edge (virtual-screen y).
    pub y: i32,
    /// Width in pixels.
    pub w: i32,
    /// Height in pixels.
    pub h: i32,
    /// DPI scale factor (1.0 == 96 DPI). 1.25 == 125%, etc.
    pub scale: f32,
    /// Whether this is the OS primary monitor.
    pub primary: bool,
}

impl MonitorRect {
    /// Right edge (exclusive): `x + w`.
    pub fn right(&self) -> i32 {
        self.x + self.w
    }
    /// Bottom edge (exclusive): `y + h`.
    pub fn bottom(&self) -> i32 {
        self.y + self.h
    }
    /// Whether the point `(px, py)` lies within this monitor.
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.right() && py >= self.y && py < self.bottom()
    }
}

/// A machine's full local monitor arrangement plus the bounding box that
/// encloses all monitors (the local "virtual desktop").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LocalTopology {
    /// All monitors attached to this machine.
    pub monitors: Vec<MonitorRect>,
    /// Bounding rectangle enclosing every monitor, as `(x, y, w, h)` in
    /// virtual-screen coordinates.
    pub virtual_bounds: (i32, i32, i32, i32),
}

impl LocalTopology {
    /// The OS primary monitor, if any monitor is flagged primary.
    pub fn primary(&self) -> Option<&MonitorRect> {
        self.monitors.iter().find(|m| m.primary)
    }
    /// The monitor containing point `(x, y)`, if any.
    pub fn monitor_at(&self, x: i32, y: i32) -> Option<&MonitorRect> {
        self.monitors.iter().find(|m| m.contains(x, y))
    }
}

// ===========================================================================
// Cross-machine layout model
// ===========================================================================

/// The four edges of a machine's virtual desktop across which the cursor can
/// cross into a neighbouring machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Edge {
    /// Left edge (x == min).
    Left,
    /// Right edge (x == max).
    Right,
    /// Top edge (y == min).
    Top,
    /// Bottom edge (y == max).
    Bottom,
}

impl Edge {
    /// The opposing edge (the side of the neighbour the cursor enters on).
    pub fn opposite(self) -> Edge {
        match self {
            Edge::Left => Edge::Right,
            Edge::Right => Edge::Left,
            Edge::Top => Edge::Bottom,
            Edge::Bottom => Edge::Top,
        }
    }
}

/// A machine's placement within the shared cross-machine virtual plane.
///
/// Each placed machine occupies a rectangle (`x, y, w, h`) in a single global
/// coordinate plane shared by all machines. Machines are arranged edge-to-edge;
/// the cursor crosses between them where their rectangles abut.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlacedMachine {
    /// Which machine this placement describes.
    pub machine: MachineId,
    /// Human-friendly display name (mirrors [`DaemonState::machine_name`]).
    pub name: String,
    /// Left edge in the shared plane.
    pub x: i32,
    /// Top edge in the shared plane.
    pub y: i32,
    /// Width (typically the machine's `virtual_bounds` width).
    pub w: i32,
    /// Height (typically the machine's `virtual_bounds` height).
    pub h: i32,
}

impl PlacedMachine {
    /// Right edge (exclusive).
    pub fn right(&self) -> i32 {
        self.x + self.w
    }
    /// Bottom edge (exclusive).
    pub fn bottom(&self) -> i32 {
        self.y + self.h
    }
    /// Whether the point `(px, py)` lies within this machine's rectangle.
    pub fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.right() && py >= self.y && py < self.bottom()
    }
}

/// The complete cross-machine layout: every participating machine placed in the
/// shared virtual plane.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Layout {
    /// All machines placed edge-to-edge in the shared plane.
    pub machines: Vec<PlacedMachine>,
}

/// Result of resolving an edge crossing: the destination machine plus the
/// entry point, in that machine's **local** virtual-screen coordinates, and the
/// edge of the destination the cursor enters on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Crossing {
    /// Machine the cursor crosses into.
    pub target: MachineId,
    /// Entry point in the target machine's local virtual-screen coordinates.
    pub entry: (i32, i32),
    /// Edge of the target the cursor enters on.
    pub entry_edge: Edge,
}

impl Layout {
    /// Look up a placed machine by id.
    pub fn get(&self, id: &MachineId) -> Option<&PlacedMachine> {
        self.machines.iter().find(|p| &p.machine == id)
    }

    /// Resolve "which machine + entry point is across edge `edge` of machine
    /// `from` at position `pos`".
    ///
    /// `pos` is the cursor position in `from`'s **local** virtual-screen
    /// coordinates at the moment it hits `edge`. Returns the neighbouring
    /// machine whose rectangle abuts `from` across that edge at the projected
    /// position, together with the entry point in the neighbour's local
    /// coordinates and the edge it enters on. Returns `None` if no machine is
    /// placed across that edge at that position (cursor should stay clamped).
    ///
    /// This is a pure geometric helper over the shared plane; transport/session
    /// layers call it to decide hand-off. Implementation lives in the `layout`
    /// crate via [`resolve_crossing`].
    pub fn resolve_across(
        &self,
        from: &MachineId,
        edge: Edge,
        pos: (i32, i32),
    ) -> Option<Crossing> {
        resolve_crossing(self, from, edge, pos)
    }
}

/// Pure geometric resolver: see [`Layout::resolve_across`]. Exposed as a free
/// function so the `layout` crate owns the implementation while the signature is
/// frozen here.
///
/// Contract:
/// - `pos` is in `from`'s local virtual-screen coordinates.
/// - The returned [`Crossing::entry`] is in the target's local coordinates.
/// - Returns `None` when no neighbour abuts `from` across `edge` at `pos`.
pub fn resolve_crossing(
    layout: &Layout,
    from: &MachineId,
    edge: Edge,
    pos: (i32, i32),
) -> Option<Crossing> {
    // The `layout` crate provides the real implementation. The signature is the
    // frozen contract; protocol ships a conservative default (no crossing) so
    // the contract is usable standalone.
    let _ = (layout, from, edge, pos);
    None
}

// ===========================================================================
// Input events
// ===========================================================================

/// A logical mouse button.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MouseButton {
    /// Primary (usually left) button.
    Left,
    /// Secondary (usually right) button.
    Right,
    /// Middle (wheel) button.
    Middle,
    /// Extended button 1 (XBUTTON1 / "back").
    X1,
    /// Extended button 2 (XBUTTON2 / "forward").
    X2,
}

/// A single captured/injected input event, transport-agnostic.
///
/// Mouse movement comes in two flavours: [`InputEvent::MouseMove`] carries a
/// relative delta (preferred while a remote screen "owns" the cursor), while
/// [`InputEvent::MouseAbs`] carries an absolute position in the *target*
/// machine's local virtual-screen coordinates (used for the entry warp).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum InputEvent {
    /// Relative mouse motion.
    MouseMove {
        /// Horizontal delta in pixels.
        dx: i32,
        /// Vertical delta in pixels.
        dy: i32,
    },
    /// Absolute mouse position in the target's local virtual-screen coords.
    MouseAbs {
        /// Absolute x.
        x: i32,
        /// Absolute y.
        y: i32,
    },
    /// Mouse button transition.
    MouseButton {
        /// Which button.
        button: MouseButton,
        /// `true` == press, `false` == release.
        down: bool,
    },
    /// Scroll wheel motion (horizontal + vertical). Units are wheel deltas
    /// (multiples of 120 == one notch on Windows).
    Wheel {
        /// Horizontal wheel delta.
        dx: i32,
        /// Vertical wheel delta.
        dy: i32,
    },
    /// Keyboard key transition by virtual-key + scancode.
    Key {
        /// Win32 virtual-key code (`VK_*`).
        vk: u16,
        /// Hardware scancode.
        scancode: u16,
        /// `true` == press, `false` == release.
        down: bool,
        /// Whether this is an extended key (E0 prefix).
        extended: bool,
    },
    /// Unicode character injection (for IME / non-VK text).
    KeyUnicode {
        /// The Unicode scalar value.
        ch: char,
        /// `true` == press, `false` == release.
        down: bool,
    },
}

// ===========================================================================
// Clipboard payload
// ===========================================================================

/// A clipboard payload offered/transferred between peers.
///
/// Kept small and explicit so the wire format is stable; richer formats can be
/// added as new variants behind a [`PROTOCOL_VERSION`] bump.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClipboardPayload {
    /// UTF-8 text.
    Text(String),
    /// Opaque bytes with a MIME-ish format tag (e.g. `"image/png"`).
    Bytes {
        /// Format tag describing `data`.
        format: String,
        /// Raw payload bytes.
        data: Vec<u8>,
    },
}

// ===========================================================================
// Session wire messages
// ===========================================================================

/// Handshake greeting sent first on a new session connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Hello {
    /// Sender's protocol version; receiver rejects on mismatch.
    pub protocol_version: u32,
    /// Sender's stable machine identity.
    pub machine_id: MachineId,
    /// Sender's display name.
    pub machine_name: String,
}

/// Messages exchanged over an established (encrypted) peer **session** socket.
///
/// Serialized with `postcard` and framed via [`encode_frame`] / [`decode_frame`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Message {
    /// Initial handshake.
    Hello(Hello),
    /// Liveness probe; expects a [`Message::Pong`].
    Ping,
    /// Liveness response to a [`Message::Ping`].
    Pong,
    /// The local machine is handing control TO the receiver: the cursor has
    /// entered the receiver's screen at `entry` (in the receiver's local
    /// virtual-screen coords) on screen `screen`.
    Enter {
        /// Entry point in the receiving machine's local coordinates.
        entry: (i32, i32),
        /// The receiving machine's id (sanity/routing check).
        screen: MachineId,
    },
    /// Control is leaving the receiver (cursor crossed back out); the receiver
    /// should stop injecting and release any held keys/buttons.
    Leave,
    /// An input event to inject on the receiver while it owns the cursor.
    Input(InputEvent),
    /// "I have clipboard content available" advertisement.
    ClipboardOffer,
    /// Actual clipboard content transfer.
    ClipboardData(ClipboardPayload),
    /// Push an updated cross-machine layout to the peer.
    LayoutSync(Layout),
    /// Protocol-level error notification.
    Error {
        /// Human-readable error detail.
        msg: String,
    },
}

// ===========================================================================
// Framing (length-prefixed postcard)
// ===========================================================================

/// Number of bytes in the big-endian `u32` length prefix.
pub const FRAME_HEADER_LEN: usize = 4;

/// Encode a [`Message`] as a length-prefixed `postcard` frame:
/// `[u32 big-endian payload length][postcard payload]`.
pub fn encode_frame(msg: &Message) -> Result<Vec<u8>, ProtocolError> {
    let payload =
        postcard::to_allocvec(msg).map_err(|e| ProtocolError::Serialize(e.to_string()))?;
    if payload.len() > MAX_FRAME_LEN {
        return Err(ProtocolError::FrameTooLarge {
            len: payload.len(),
            max: MAX_FRAME_LEN,
        });
    }
    let mut out = Vec::with_capacity(FRAME_HEADER_LEN + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(&payload);
    Ok(out)
}

/// Attempt to decode a single frame from the front of `buf`.
///
/// On success returns `(message, bytes_consumed)`; the caller should drain
/// `bytes_consumed` bytes from its read buffer. Returns
/// [`ProtocolError::Incomplete`] when more bytes are needed (the caller should
/// read more and retry without discarding `buf`).
pub fn decode_frame(buf: &[u8]) -> Result<(Message, usize), ProtocolError> {
    if buf.len() < FRAME_HEADER_LEN {
        return Err(ProtocolError::Incomplete {
            needed: FRAME_HEADER_LEN,
            have: buf.len(),
        });
    }
    let mut len_bytes = [0u8; FRAME_HEADER_LEN];
    len_bytes.copy_from_slice(&buf[..FRAME_HEADER_LEN]);
    let payload_len = u32::from_be_bytes(len_bytes) as usize;
    if payload_len > MAX_FRAME_LEN {
        return Err(ProtocolError::FrameTooLarge {
            len: payload_len,
            max: MAX_FRAME_LEN,
        });
    }
    let total = FRAME_HEADER_LEN + payload_len;
    if buf.len() < total {
        return Err(ProtocolError::Incomplete {
            needed: total,
            have: buf.len(),
        });
    }
    let msg = postcard::from_bytes(&buf[FRAME_HEADER_LEN..total])
        .map_err(|e| ProtocolError::Deserialize(e.to_string()))?;
    Ok((msg, total))
}

// ===========================================================================
// Control-socket API (GUI <-> daemon, JSON)
// ===========================================================================

/// Lifecycle state of the daemon's control plane.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ControlState {
    /// Idle, not serving/connecting.
    Stopped,
    /// In the process of starting.
    Starting,
    /// Up and serving/connected.
    Running,
    /// In the process of stopping.
    Stopping,
    /// Halted due to an error (see accompanying messages/logs).
    Errored,
}

/// Connection state of a single peer from the local daemon's perspective.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConnState {
    /// Not connected.
    Disconnected,
    /// Connecting / mid-handshake.
    Connecting,
    /// Handshake complete, encrypted session established.
    Connected,
    /// Connection attempt failed (see [`PeerInfo::error`]).
    Failed,
}

/// Overall daemon status reported to the GUI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DaemonState {
    /// Whether the daemon is actively running its session loop.
    pub running: bool,
    /// This machine's stable identity.
    pub machine_id: MachineId,
    /// This machine's display name.
    pub machine_name: String,
    /// Control-plane lifecycle state.
    pub control_state: ControlState,
}

/// Per-peer info reported to the GUI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeerInfo {
    /// Local handle for this peer.
    pub id: PeerId,
    /// Peer display name.
    pub name: String,
    /// Peer host/IP.
    pub host: String,
    /// Peer session port.
    pub port: u16,
    /// Whether the peer is currently reachable/seen on the LAN.
    pub online: bool,
    /// Whether the peer is paired (trusted) with this machine.
    pub paired: bool,
    /// Current connection state.
    pub conn_state: ConnState,
    /// Last error string, if the peer is in a failed state.
    pub error: Option<String>,
}

/// Configuration applied via [`ControlRequest::SetConfig`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConfigUpdate {
    /// This machine's display name.
    pub name: String,
    /// Shared pairing secret / pre-shared key material.
    pub secret: String,
}

/// Requests the GUI sends to the daemon over the JSON control socket.
///
/// Tagged via serde so the JSON is self-describing on the control channel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ControlRequest {
    /// Start the daemon's session loop.
    Start,
    /// Stop the daemon's session loop.
    Stop,
    /// Request a one-shot status report (answered with [`ControlEvent::State`]
    /// and [`ControlEvent::Peers`]).
    Status,
    /// Set machine config; optionally push an initial layout.
    SetConfig {
        /// Machine display name.
        name: String,
        /// Shared pairing secret.
        secret: String,
        /// Optional initial cross-machine layout.
        layout: Option<Layout>,
    },
    /// Begin pairing with a peer.
    Pair {
        /// Peer to pair with.
        peer: PeerId,
    },
    /// Remove an existing pairing.
    Unpair {
        /// Peer to unpair.
        peer: PeerId,
    },
    /// Replace the active cross-machine layout.
    SetLayout(Layout),
}

/// Events/responses the daemon emits to the GUI over the JSON control socket.
///
/// **Adjacently** tagged: the variant goes in `"type"` and its payload in
/// `"data"`, e.g. `{"type":"Peers","data":[...]}`. Adjacent (rather than
/// internal) tagging is required because [`ControlEvent::Peers`] is a newtype
/// variant wrapping a *sequence* (`Vec<PeerInfo>`), which serde cannot represent
/// under internal tagging (`#[serde(tag = "type")]`) — it errors at runtime with
/// "cannot serialize tagged newtype variant ... containing a sequence". Adjacent
/// tagging serializes every variant (unit, struct, and sequence-bearing newtype)
/// uniformly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ControlEvent {
    /// Current daemon state.
    State(DaemonState),
    /// Current peer list.
    Peers(Vec<PeerInfo>),
    /// Live cursor position + edge/crossing telemetry for the GUI overlay.
    Cursor {
        /// Cursor x in the shared virtual plane.
        x: i32,
        /// Cursor y in the shared virtual plane.
        y: i32,
        /// Name of the edge the cursor is touching, if any (`"Left"`, etc).
        edge: Option<String>,
        /// Machine the cursor is about to cross into, if a crossing is imminent.
        crossing_to: Option<MachineId>,
    },
}

/// Serialize a [`ControlRequest`] to a JSON line for the control socket.
pub fn encode_control_request(req: &ControlRequest) -> Result<String, ProtocolError> {
    serde_json::to_string(req).map_err(|e| ProtocolError::Serialize(e.to_string()))
}

/// Deserialize a [`ControlRequest`] from a JSON line.
pub fn decode_control_request(s: &str) -> Result<ControlRequest, ProtocolError> {
    serde_json::from_str(s).map_err(|e| ProtocolError::Deserialize(e.to_string()))
}

/// Serialize a [`ControlEvent`] to a JSON line for the control socket.
pub fn encode_control_event(ev: &ControlEvent) -> Result<String, ProtocolError> {
    serde_json::to_string(ev).map_err(|e| ProtocolError::Serialize(e.to_string()))
}

/// Deserialize a [`ControlEvent`] from a JSON line.
pub fn decode_control_event(s: &str) -> Result<ControlEvent, ProtocolError> {
    serde_json::from_str(s).map_err(|e| ProtocolError::Deserialize(e.to_string()))
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip() {
        let msg = Message::Enter {
            entry: (10, 20),
            screen: MachineId::new("box-b"),
        };
        let bytes = encode_frame(&msg).unwrap();
        let (decoded, consumed) = decode_frame(&bytes).unwrap();
        assert_eq!(decoded, msg);
        assert_eq!(consumed, bytes.len());
    }

    #[test]
    fn frame_incomplete_is_reported() {
        let msg = Message::Ping;
        let bytes = encode_frame(&msg).unwrap();
        let err = decode_frame(&bytes[..2]).unwrap_err();
        assert!(matches!(err, ProtocolError::Incomplete { .. }));
    }

    #[test]
    fn frame_with_trailing_bytes_consumes_only_one() {
        let mut bytes = encode_frame(&Message::Ping).unwrap();
        bytes.extend_from_slice(&encode_frame(&Message::Pong).unwrap());
        let (m1, c1) = decode_frame(&bytes).unwrap();
        assert_eq!(m1, Message::Ping);
        let (m2, _c2) = decode_frame(&bytes[c1..]).unwrap();
        assert_eq!(m2, Message::Pong);
    }

    #[test]
    fn control_request_json_roundtrip() {
        let req = ControlRequest::SetConfig {
            name: "Desk".into(),
            secret: "s3cret".into(),
            layout: Some(Layout::default()),
        };
        let s = encode_control_request(&req).unwrap();
        assert_eq!(decode_control_request(&s).unwrap(), req);
    }

    #[test]
    fn control_event_json_roundtrip() {
        let ev = ControlEvent::Cursor {
            x: 1,
            y: 2,
            edge: Some("Left".into()),
            crossing_to: Some(MachineId::new("box-b")),
        };
        let s = encode_control_event(&ev).unwrap();
        assert_eq!(decode_control_event(&s).unwrap(), ev);
    }

    #[test]
    fn control_event_all_variants_roundtrip() {
        // Regression: under internal tagging the `Peers(Vec<_>)` newtype variant
        // failed to serialize ("cannot serialize tagged newtype variant ...
        // containing a sequence"). Adjacent tagging must round-trip every variant.
        let state = ControlEvent::State(DaemonState {
            running: true,
            machine_id: MachineId::new("m"),
            machine_name: "Desk".into(),
            control_state: ControlState::Running,
        });
        let peers = ControlEvent::Peers(vec![PeerInfo {
            id: PeerId::new("p"),
            name: "Peer".into(),
            host: "10.0.0.2".into(),
            port: DEFAULT_SESSION_PORT,
            online: true,
            paired: true,
            conn_state: ConnState::Connected,
            error: None,
        }]);
        for ev in [state, peers] {
            let s = encode_control_event(&ev).unwrap();
            assert_eq!(decode_control_event(&s).unwrap(), ev, "roundtrip: {s}");
        }
    }

    #[test]
    fn input_event_roundtrip() {
        for ev in [
            InputEvent::MouseMove { dx: -3, dy: 4 },
            InputEvent::MouseAbs { x: 100, y: 200 },
            InputEvent::MouseButton {
                button: MouseButton::Middle,
                down: true,
            },
            InputEvent::Wheel { dx: 0, dy: 120 },
            InputEvent::Key {
                vk: 0x41,
                scancode: 30,
                down: true,
                extended: false,
            },
            InputEvent::KeyUnicode { ch: 'é', down: true },
        ] {
            let m = Message::Input(ev);
            let bytes = encode_frame(&m).unwrap();
            let (decoded, _) = decode_frame(&bytes).unwrap();
            assert_eq!(decoded, m);
        }
    }
}
