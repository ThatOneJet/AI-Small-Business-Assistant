//! `borderlessd run`: wire the [`core::Engine`] to the control socket and run
//! until Ctrl-C, then shut down cleanly (releasing input suppression + stuck
//! modifiers via [`core::Engine::stop`]).
//!
//! ## Shared state
//!
//! [`Daemon`] holds the live engine (as `Option<Engine>` so it can be stopped /
//! started / replaced) and the persistent [`config::Config`], each behind an
//! async mutex. The control server ([`crate::control`]) calls into it to handle
//! requests. A single daemon-owned broadcast channel ([`crate::control`]'s
//! "fanout") is what every client subscribes to; a forwarder task re-publishes
//! the *current* engine's events into it so client subscriptions survive an
//! engine restart (triggered by `SetConfig`).

use std::sync::Arc;

use anyhow::{Context, Result};
use protocol::{ControlEvent, ControlRequest, DaemonState, MachineId, PeerId};
use tokio::sync::{broadcast, watch, Mutex};

use crate::config::Config;

/// Shared daemon state behind the control socket.
pub struct Daemon {
    /// The live engine, or `None` when stopped.
    engine: Mutex<Option<core::Engine>>,
    /// Persistent configuration (source of truth for the paired set + layout).
    config: Mutex<Config>,
    /// Fan-out channel every control client subscribes to. The forwarder task
    /// re-publishes engine events here.
    fanout: broadcast::Sender<ControlEvent>,
    /// Handle to the current event-forwarder task; aborted/replaced on restart.
    forwarder: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// This machine's stable id (from the identity file), known even when the
    /// engine is stopped so `Status` can still answer.
    machine_id: MachineId,
}

impl Daemon {
    /// Build the daemon: load config + identity and start the engine.
    pub async fn start(fanout: broadcast::Sender<ControlEvent>) -> Result<Arc<Self>> {
        let config = Config::load_or_create().context("loading config.json")?;
        let identity = pairing::load_or_create_identity().context("loading identity")?;
        let machine_id = identity.machine_id.clone();

        let engine = core::Engine::start(config.to_engine_config())
            .await
            .context("starting engine")?;

        let daemon = Arc::new(Daemon {
            engine: Mutex::new(Some(engine)),
            config: Mutex::new(config),
            fanout: fanout.clone(),
            forwarder: Mutex::new(None),
            machine_id,
        });
        daemon.spawn_forwarder().await;
        Ok(daemon)
    }

    /// (Re)spawn the task that pumps the current engine's broadcast events into
    /// the daemon-wide fan-out. Aborts any previous forwarder first.
    async fn spawn_forwarder(&self) {
        let mut slot = self.forwarder.lock().await;
        if let Some(prev) = slot.take() {
            prev.abort();
        }
        let mut src = {
            let engine = self.engine.lock().await;
            match engine.as_ref() {
                Some(e) => e.subscribe_events(),
                None => return,
            }
        };
        let out = self.fanout.clone();
        let handle = tokio::spawn(async move {
            loop {
                match src.recv().await {
                    Ok(ev) => {
                        // Ignore "no subscribers"; clients come and go.
                        let _ = out.send(ev);
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        *slot = Some(handle);
    }

    /// Current `State` + `Peers` snapshot for a freshly-connected client.
    pub async fn snapshot(&self) -> Vec<ControlEvent> {
        let engine = self.engine.lock().await;
        match engine.as_ref() {
            Some(e) => vec![
                ControlEvent::State(e.state()),
                ControlEvent::Peers(e.peers()),
            ],
            None => vec![
                ControlEvent::State(self.stopped_state().await),
                ControlEvent::Peers(Vec::new()),
            ],
        }
    }

    /// Synthesize a stopped `DaemonState` (engine not running).
    async fn stopped_state(&self) -> DaemonState {
        let cfg = self.config.lock().await;
        DaemonState {
            running: false,
            machine_id: self.machine_id.clone(),
            machine_name: cfg.machine_name.clone(),
            control_state: protocol::ControlState::Stopped,
        }
    }

    /// Handle one control request. Returns any events to send **directly** to the
    /// requesting client (e.g. the `Status` reply); broadcast side effects flow
    /// through the fan-out separately.
    pub async fn handle_request(&self, req: ControlRequest) -> Vec<ControlEvent> {
        match req {
            ControlRequest::Status => self.snapshot().await,

            ControlRequest::Start => {
                if let Err(e) = self.ensure_running().await {
                    tracing::error!("start failed: {e:#}");
                }
                self.snapshot().await
            }

            ControlRequest::Stop => {
                self.stop_engine().await;
                // Broadcast the stopped state to everyone.
                let st = self.stopped_state().await;
                let _ = self.fanout.send(ControlEvent::State(st.clone()));
                let _ = self.fanout.send(ControlEvent::Peers(Vec::new()));
                vec![ControlEvent::State(st), ControlEvent::Peers(Vec::new())]
            }

            ControlRequest::SetConfig { name, secret, layout } => {
                {
                    let mut cfg = self.config.lock().await;
                    cfg.machine_name = name;
                    cfg.secret = secret;
                    if let Some(layout) = layout {
                        cfg.layout = layout;
                    }
                    if let Err(e) = cfg.save() {
                        tracing::error!("saving config failed: {e:#}");
                    }
                }
                self.apply_config_to_engine().await;
                self.snapshot().await
            }

            ControlRequest::SetLayout(layout) => {
                {
                    let mut cfg = self.config.lock().await;
                    cfg.layout = layout;
                    if let Err(e) = cfg.save() {
                        tracing::error!("saving config failed: {e:#}");
                    }
                }
                self.apply_config_to_engine().await;
                self.snapshot().await
            }

            ControlRequest::Pair { peer } => {
                self.do_pair(peer).await;
                self.snapshot().await
            }

            ControlRequest::Unpair { peer } => {
                self.do_unpair(peer).await;
                self.snapshot().await
            }
        }
    }

    /// Ensure the engine is running, starting it from the persisted config if not.
    async fn ensure_running(&self) -> Result<()> {
        let mut slot = self.engine.lock().await;
        if slot.is_some() {
            return Ok(());
        }
        let cfg = self.config.lock().await.clone();
        let engine = core::Engine::start(cfg.to_engine_config())
            .await
            .context("starting engine")?;
        *slot = Some(engine);
        drop(slot);
        self.spawn_forwarder().await;
        Ok(())
    }

    /// Stop the engine if running (clean teardown releases suppression/modifiers).
    async fn stop_engine(&self) {
        let engine = { self.engine.lock().await.take() };
        if let Some(engine) = engine {
            engine.stop().await;
        }
        // Drop the forwarder; the closed engine broadcast would end it anyway.
        if let Some(h) = self.forwarder.lock().await.take() {
            h.abort();
        }
    }

    /// Apply the current persisted config to the running engine, or start it if
    /// it was stopped. `set_config` is a live update; no restart is required.
    async fn apply_config_to_engine(&self) {
        let cfg = self.config.lock().await.clone();
        let engine = self.engine.lock().await;
        match engine.as_ref() {
            Some(e) => {
                if let Err(e) = e.set_config(cfg.to_engine_config()).await {
                    tracing::error!("set_config failed: {e:#}");
                }
            }
            None => {
                drop(engine);
                if let Err(e) = self.ensure_running().await {
                    tracing::error!("starting engine for config apply failed: {e:#}");
                }
            }
        }
    }

    /// Pair with `peer`: record the machine id in `config.json` and tell the
    /// engine to trust it. The peer's static public key is recorded in
    /// [`pairing::PairingStore`] by the engine during the next handshake.
    async fn do_pair(&self, peer: PeerId) {
        let mid = crate::control::peer_to_machine_id(&peer);
        {
            let mut cfg = self.config.lock().await;
            if !cfg.paired.iter().any(|m| m == &mid) {
                cfg.paired.push(mid.clone());
            }
            if let Err(e) = cfg.save() {
                tracing::error!("saving config after pair failed: {e:#}");
            }
        }
        let engine = self.engine.lock().await;
        if let Some(e) = engine.as_ref() {
            if let Err(e) = e.pair(peer).await {
                tracing::error!("engine pair failed: {e:#}");
            }
        }
        tracing::info!(peer = %mid, "paired");
    }

    /// Unpair `peer`: drop it from `config.json`, the persisted
    /// [`pairing::PairingStore`], and the engine's trust set.
    async fn do_unpair(&self, peer: PeerId) {
        let mid = crate::control::peer_to_machine_id(&peer);
        {
            let mut cfg = self.config.lock().await;
            cfg.paired.retain(|m| m != &mid);
            if let Err(e) = cfg.save() {
                tracing::error!("saving config after unpair failed: {e:#}");
            }
        }
        // Keep the persisted pinned-key store consistent.
        if let Ok(mut store) = pairing::PairingStore::load() {
            let _ = store.unpair(&mid);
        }
        let engine = self.engine.lock().await;
        if let Some(e) = engine.as_ref() {
            if let Err(e) = e.unpair(peer).await {
                tracing::error!("engine unpair failed: {e:#}");
            }
        }
        tracing::info!(peer = %mid, "unpaired");
    }

    /// Stop the engine on process shutdown (Ctrl-C). Idempotent.
    pub async fn shutdown(&self) {
        self.stop_engine().await;
    }
}

/// Entry point for `borderlessd run`.
pub async fn run() -> Result<()> {
    crate::logging::init().context("initializing logging")?;

    tracing::info!(
        "{} {} (protocol v{}) starting",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        protocol::PROTOCOL_VERSION,
    );

    let fanout = crate::control::fanout_channel();
    let daemon = Daemon::start(fanout.clone())
        .await
        .context("starting daemon")?;

    // Shutdown signal shared by the control server + its client tasks.
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    // Run the control server in the background.
    let server = {
        let daemon = daemon.clone();
        let fanout = fanout.clone();
        let shutdown_rx = shutdown_rx.clone();
        tokio::spawn(async move {
            if let Err(e) = crate::control::serve(daemon, fanout, shutdown_rx).await {
                tracing::error!("control server error: {e:#}");
            }
        })
    };

    // Wait for Ctrl-C.
    match tokio::signal::ctrl_c().await {
        Ok(()) => tracing::info!("Ctrl-C received; shutting down"),
        Err(e) => tracing::error!("failed to listen for Ctrl-C: {e}; shutting down"),
    }

    // Tell the control server (and its client tasks) to stop, then tear down the
    // engine so input suppression + held modifiers are released.
    let _ = shutdown_tx.send(true);
    daemon.shutdown().await;
    let _ = server.await;

    tracing::info!("borderlessd stopped");
    Ok(())
}
