//! JetCore Borderless orchestration core.
//!
//! Wires together topology, capture, inject, transport, discovery, pairing,
//! layout, and clipboard into the running software-KVM session loop, and exposes
//! an async [`Engine`] the daemon drives.
//!
//! See [`engine`] for the full state-machine and safety documentation. The public
//! surface is intentionally small:
//!
//! - [`EngineConfig`] — machine name, pairing secret, layout, paired ids, manual
//!   peers.
//! - [`Engine`] — `start` / `stop`, `state` / `peers` snapshots, a broadcast of
//!   [`protocol::ControlEvent`]s ([`Engine::subscribe_events`]), and runtime
//!   control (`set_config` / `pair` / `unpair`).

mod cursor;
mod engine;
mod seam;

pub use engine::{Engine, EngineConfig};

// Pure logic re-exported for testing / reuse by the daemon if needed.
pub use seam::{restore_point, RemoteCursor};
