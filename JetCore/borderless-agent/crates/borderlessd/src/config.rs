//! Persistent daemon configuration (`config.json`).
//!
//! This is the daemon's own, GUI-editable configuration, distinct from the
//! cryptographic material the [`pairing`] crate owns (`identity.json` /
//! `peers.json`). It lives in the **same** data directory so an operator finds
//! everything in one place:
//!
//! - Normally `%APPDATA%\jetcore\borderless\config.json`.
//! - Overridable via the `JETCORE_BORDERLESS_DIR` env var (the same override the
//!   `pairing` crate honours, kept in lock-step here).
//!
//! # Why the paired set lives here
//!
//! [`core::EngineConfig::paired`] is the authoritative runtime trust set the
//! engine gates handshakes and edge-crossings on (`Worker::extra_paired`). The
//! [`pairing::PairingStore`] persists each peer's *static public key* (learned
//! during the PSK-gated handshake) but exposes no way to enumerate its members,
//! so it cannot, on its own, reconstruct the trust set on startup. We therefore
//! persist the list of paired [`MachineId`]s here and treat `config.json` as the
//! source of truth for `EngineConfig.paired`; the `PairingStore` remains the
//! source of truth for the pinned public keys. The two are kept consistent on
//! unpair (we drop the id here *and* call `PairingStore::unpair`).

use std::path::PathBuf;

use anyhow::{Context, Result};
use protocol::{Layout, MachineId};
use serde::{Deserialize, Serialize};

/// Environment variable that overrides the base data directory. Mirrors
/// [`pairing::DATA_DIR_ENV`] so the daemon and the pairing crate always agree on
/// where state lives.
pub const DATA_DIR_ENV: &str = pairing::DATA_DIR_ENV;

/// File name of the daemon config under the data directory.
const CONFIG_FILE: &str = "config.json";

/// Persistent daemon configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// This machine's human-friendly display name. Defaults to the host name.
    pub machine_name: String,
    /// Shared pairing secret; the Noise PSK is derived from this. Default empty.
    #[serde(default)]
    pub secret: String,
    /// Active cross-machine layout. Default empty.
    #[serde(default)]
    pub layout: Layout,
    /// Manually-entered peers (`host`, `port`) for LANs without UDP discovery.
    #[serde(default)]
    pub manual_peers: Vec<(String, u16)>,
    /// Machines this daemon trusts. Source of truth for
    /// [`core::EngineConfig::paired`] (see module docs).
    #[serde(default)]
    pub paired: Vec<MachineId>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            machine_name: default_machine_name(),
            secret: String::new(),
            layout: Layout::default(),
            manual_peers: Vec::new(),
            paired: Vec::new(),
        }
    }
}

/// Best-effort host name for the default machine name. Uses `COMPUTERNAME`
/// (always set on Windows), falling back to a constant.
fn default_machine_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "JetCore".to_string())
}

/// Compute the base data directory, honouring [`DATA_DIR_ENV`] then falling back
/// to `%APPDATA%\jetcore\borderless` — identical resolution to the `pairing`
/// crate so all daemon state co-locates.
pub fn data_dir() -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV) {
        return Ok(PathBuf::from(dir));
    }
    let appdata = std::env::var_os("APPDATA")
        .context("neither JETCORE_BORDERLESS_DIR nor APPDATA is set; cannot locate data dir")?;
    Ok(PathBuf::from(appdata).join("jetcore").join("borderless"))
}

/// Path to `config.json` under the resolved data directory.
fn config_path() -> Result<PathBuf> {
    Ok(data_dir()?.join(CONFIG_FILE))
}

impl Config {
    /// Load the config from `config.json`, or create + persist a default one on
    /// first run (or if the file is missing).
    pub fn load_or_create() -> Result<Self> {
        let path = config_path()?;
        if path.exists() {
            let bytes = std::fs::read(&path)
                .with_context(|| format!("reading config file {}", path.display()))?;
            let cfg: Config = serde_json::from_slice(&bytes)
                .with_context(|| format!("parsing config file {}", path.display()))?;
            return Ok(cfg);
        }
        let cfg = Config::default();
        cfg.save()?;
        Ok(cfg)
    }

    /// Persist the config to `config.json`, creating parent directories.
    pub fn save(&self) -> Result<()> {
        let path = config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating data dir {}", parent.display()))?;
        }
        let json = serde_json::to_vec_pretty(self).context("serializing config")?;
        std::fs::write(&path, &json)
            .with_context(|| format!("writing config file {}", path.display()))?;
        Ok(())
    }

    /// Build the [`core::EngineConfig`] this config maps to.
    pub fn to_engine_config(&self) -> core::EngineConfig {
        core::EngineConfig {
            machine_name: self.machine_name.clone(),
            secret: self.secret.clone(),
            layout: self.layout.clone(),
            paired: self.paired.clone(),
            manual_peers: self.manual_peers.clone(),
        }
    }
}
