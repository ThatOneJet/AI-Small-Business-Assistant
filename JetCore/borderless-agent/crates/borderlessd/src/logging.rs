//! Tracing setup: log to stderr **and** an appended log file under the data dir.
//!
//! The file lives at `<data dir>\borderlessd.log` (same data dir as the config /
//! identity). We append rather than truncate so a service restart preserves
//! history; rotation can be layered on later if needed.

use std::fs::OpenOptions;
use std::sync::OnceLock;

use anyhow::{Context, Result};
use tracing_subscriber::fmt;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::EnvFilter;

/// File name of the daemon log under the data directory.
const LOG_FILE: &str = "borderlessd.log";

/// Keep the open log file handle alive for the process lifetime. The non-blocking
/// writer's worker guard (if we later switch to one) would live here too.
static LOG_FILE_HANDLE: OnceLock<std::fs::File> = OnceLock::new();

/// Initialize tracing to stderr and an appended `<data dir>\borderlessd.log`.
///
/// Honours `RUST_LOG`; defaults to `info` for everything. Safe to call once at
/// startup. If the log file cannot be opened we still install the stderr layer
/// (logging to a file is best-effort, never fatal to the daemon).
pub fn init() -> Result<()> {
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    // stderr layer (human-readable, with target + level).
    let stderr_layer = fmt::layer().with_writer(std::io::stderr).with_target(true);

    let file = open_log_file();

    let registry = tracing_subscriber::registry().with(env_filter).with(stderr_layer);

    match file {
        Some(f) => {
            // Clone the handle for the writer; stash one to keep it alive.
            let writer = f.try_clone().context("cloning log file handle")?;
            let _ = LOG_FILE_HANDLE.set(f);
            let file_layer = fmt::layer()
                .with_writer(move || writer.try_clone().expect("clone log writer"))
                .with_ansi(false)
                .with_target(true);
            registry.with(file_layer).init();
            tracing::info!(log = %LOG_FILE, "logging to stderr + data-dir log file");
        }
        None => {
            registry.init();
            tracing::warn!("could not open data-dir log file; logging to stderr only");
        }
    }
    Ok(())
}

/// Open (creating + appending) the log file under the data dir. Best-effort:
/// returns `None` on any failure so logging falls back to stderr only.
fn open_log_file() -> Option<std::fs::File> {
    let dir = crate::config::data_dir().ok()?;
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(LOG_FILE))
        .ok()
}
