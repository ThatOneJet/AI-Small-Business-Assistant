//! JetCore Borderless daemon (`borderlessd`).
//!
//! The runnable software-KVM agent. It drives [`core::Engine`] (the full KVM
//! state machine) and exposes a line-delimited JSON **control socket** on
//! `127.0.0.1:52008` that the JetCore GUI uses to observe and steer the daemon.
//!
//! ## CLI
//!
//! - `borderlessd run`                 — start the engine + control socket; run
//!                                        until Ctrl-C.
//! - `borderlessd status`              — query a running daemon and print its
//!                                        state + peers.
//! - `borderlessd pair <ip[:port]|peerId>`
//!                                      — ask a running daemon to pair with a
//!                                        peer (by machine id) or to add an
//!                                        IP/host as a manual peer and pair it.
//! - `borderlessd version`             — print name, version, protocol version.
//!
//! ## Control socket (the JetCore integration surface)
//!
//! See [`control`]. TCP `127.0.0.1:52008`, newline-delimited JSON: each inbound
//! line is a [`protocol::ControlRequest`], each outbound line a
//! [`protocol::ControlEvent`]. Multiple clients are supported; every engine
//! event is fanned out to all of them, and each client gets the current
//! `State` + `Peers` immediately on connect.
//!
//! ---
//!
//! ## Running as a Windows Service (future work — NOT implemented here)
//!
//! Today `borderlessd run` is a foreground console process terminated by Ctrl-C.
//! To ship it as an always-on background agent it should be wrapped as a Windows
//! service. Sketch of the intended wiring (using the `windows-service` crate):
//!
//! 1. Add `windows-service = "0.7"` and define the service entry with
//!    `windows_service::define_windows_service!(ffi_service_main, service_main)`.
//!    `main` would branch: if launched by the SCM, call
//!    `service_dispatcher::start("BorderlessD", ffi_service_main)`; otherwise run
//!    the existing CLI (so `run`/`status`/`pair`/`version` still work from a
//!    console for debugging and install tooling).
//! 2. In `service_main`, register a control handler via
//!    `service_control_handler::register` that accepts `Stop` / `Shutdown` (and
//!    optionally `SessionChange` for logon/logoff). The handler converts an
//!    incoming `Stop` into the same cancellation we drive from Ctrl-C below.
//! 3. Report `ServiceState::StartPending` → `Running` (with the accepted
//!    controls) via `set_service_status`, then run the *same* async
//!    [`run::run`] body on a Tokio runtime, replacing the `tokio::signal::ctrl_c`
//!    wait with a future resolved by the SCM stop signal. On stop, drive the
//!    identical clean-shutdown path (`Engine::stop`, which releases input
//!    suppression and stuck modifiers) and report `Stopped`.
//! 4. Install/uninstall (one-time, elevated) via the `windows-service`
//!    `service_manager` API, or out-of-band with `sc.exe create BorderlessD
//!    binPath= "...\\borderlessd.exe --service" start= auto`. The interactive
//!    input hooks ([`capture`]) require the service to run in the user's
//!    interactive session (a plain `LocalSystem` session-0 service cannot inject
//!    into the desktop), so the production design likely combines a lightweight
//!    service with a per-session helper, or runs the agent under the logged-in
//!    user via Task Scheduler "at logon". That trade-off is deferred.
//!
//! None of the above is built yet; this binary is intentionally a console app.

mod config;
mod control;
mod logging;
mod run;

use std::process::ExitCode;

/// TCP port the control socket listens on (loopback only). Frozen integration
/// point for JetCore.
pub const CONTROL_PORT: u16 = 52008;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str);

    match cmd {
        Some("run") => run_command(),
        Some("status") => status_command(),
        Some("pair") => pair_command(args.get(1).map(String::as_str)),
        Some("version") | Some("--version") | Some("-V") => {
            print_version();
            ExitCode::SUCCESS
        }
        Some("help") | Some("--help") | Some("-h") | None => {
            print_usage();
            // No subcommand is a usage error; explicit `help` is success.
            if matches!(cmd, Some("help") | Some("--help") | Some("-h")) {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Some(other) => {
            eprintln!("borderlessd: unknown command '{other}'\n");
            print_usage();
            ExitCode::FAILURE
        }
    }
}

/// `borderlessd run` — build a Tokio runtime and run the engine + control socket.
fn run_command() -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("borderlessd: failed to build async runtime: {e}");
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(run::run()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("borderlessd: {e:#}");
            ExitCode::FAILURE
        }
    }
}

/// `borderlessd status` — connect to a running daemon and print its state.
fn status_command() -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("borderlessd: failed to build async runtime: {e}");
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(control::client_status(CONTROL_PORT)) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => {
            println!("borderlessd is not running (no daemon on 127.0.0.1:{CONTROL_PORT}).");
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("borderlessd: status failed: {e:#}");
            ExitCode::FAILURE
        }
    }
}

/// `borderlessd pair <ip[:port]|peerId>` — ask a running daemon to pair.
fn pair_command(target: Option<&str>) -> ExitCode {
    let Some(target) = target else {
        eprintln!("borderlessd: pair requires a <ip[:port]|peerId> argument\n");
        print_usage();
        return ExitCode::FAILURE;
    };
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("borderlessd: failed to build async runtime: {e}");
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(control::client_pair(CONTROL_PORT, target)) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => {
            println!("borderlessd is not running (no daemon on 127.0.0.1:{CONTROL_PORT}).");
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("borderlessd: pair failed: {e:#}");
            ExitCode::FAILURE
        }
    }
}

/// `borderlessd version`.
fn print_version() {
    println!(
        "{} {} (protocol v{})",
        env!("CARGO_PKG_NAME"),
        env!("CARGO_PKG_VERSION"),
        protocol::PROTOCOL_VERSION,
    );
}

fn print_usage() {
    eprintln!(
        "borderlessd {} — JetCore Borderless software-KVM agent

USAGE:
    borderlessd <COMMAND>

COMMANDS:
    run                          Start the engine + control socket; run until Ctrl-C.
    status                       Print the running daemon's state and peers.
    pair <ip[:port]|peerId>      Pair with a peer (by machine id), or add an
                                 IP/host as a manual peer and pair it.
    version                      Print name, version, and protocol version.
    help                         Show this help.

CONTROL SOCKET:
    TCP 127.0.0.1:{port}, newline-delimited JSON.
    Inbound lines  = protocol::ControlRequest, outbound lines = protocol::ControlEvent.",
        env!("CARGO_PKG_VERSION"),
        port = CONTROL_PORT,
    );
}
