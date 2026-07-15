//! Local input capture.
//!
//! Installs low-level keyboard/mouse hooks (`WH_KEYBOARD_LL` / `WH_MOUSE_LL`)
//! on a dedicated message-pump thread and surfaces each raw event as a
//! [`protocol::InputEvent`] on an [`mpsc::Sender`].
//!
//! # Why a dedicated thread
//!
//! A low-level hook installed with `SetWindowsHookExW` runs its callback **on
//! the thread that installed it**, and that thread must run a Windows message
//! loop (`GetMessageW` / `TranslateMessageW` / `DispatchMessageW`) for the
//! callback to ever fire. [`Capture::start`] therefore spawns a dedicated
//! [`std::thread`] that installs both hooks, pumps messages, and tears the hooks
//! down on quit. Stopping posts `WM_QUIT` to that thread via
//! `PostThreadMessageW`.
//!
//! # Suppression
//!
//! While the supplied `suppress` flag is `true` the callbacks return
//! `LRESULT(1)` to **swallow** the event so it never reaches the local OS (used
//! while a remote screen owns the cursor). When `false` the callbacks chain via
//! `CallNextHookEx` so input behaves normally.
//!
//! Hook callbacks are `extern "system"` functions with no user-data parameter,
//! so the shared sink (`Sender` + suppress flag + last cursor point) lives in a
//! process-global [`OnceLock`].

use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, OnceLock};
use std::thread::JoinHandle;

use anyhow::{anyhow, Context};
use protocol::{InputEvent, MouseButton};

use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG, MSLLHOOKSTRUCT,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN,
    WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEWHEEL, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP,
    WM_SYSKEYDOWN, WM_XBUTTONDOWN, WM_XBUTTONUP, XBUTTON1, XBUTTON2,
};

/// Process-global hook sink. Hook callbacks are bare `extern "system"` fns with
/// no user parameter, so they read shared state from here.
static SINK: OnceLock<Sink> = OnceLock::new();

struct Sink {
    /// Where decoded events are delivered.
    tx: Sender<InputEvent>,
    /// While `true`, swallow events locally (return `LRESULT(1)`).
    suppress: Arc<AtomicBool>,
    /// Last absolute mouse position, used to compute relative `MouseMove` deltas.
    /// `i32::MIN` in `x` means "unset" (first sample establishes the origin).
    last_x: AtomicI32,
    last_y: AtomicI32,
    /// `true` once we have a valid last point.
    have_last: AtomicBool,
}

/// Sentinel meaning "no last cursor point recorded yet".
const NO_POINT: i32 = i32::MIN;

/// Handle to the running capture engine.
///
/// Dropping (or calling [`Capture::stop`]) posts `WM_QUIT` to the hook thread,
/// which unhooks both hooks and exits its message loop, then joins the thread.
pub struct Capture {
    /// OS thread id of the hook/message-pump thread (target of `PostThreadMessageW`).
    thread_id: u32,
    /// Join handle for the hook thread; `take`n on stop/drop to join exactly once.
    join: Option<JoinHandle<()>>,
}

impl Capture {
    /// Install the low-level keyboard + mouse hooks and begin emitting
    /// [`InputEvent`]s on `tx`.
    ///
    /// `suppress` is shared with the caller: set it to `true` to swallow local
    /// input (the cursor is owned by a remote screen), `false` to pass input
    /// through to the local OS.
    ///
    /// Spawns a dedicated message-pump thread that owns the hooks for their
    /// entire lifetime. Returns once the hooks are installed (or with an error if
    /// installation failed).
    ///
    /// # Errors
    ///
    /// Fails if a [`Capture`] sink is already installed in this process, or if
    /// either `SetWindowsHookExW` call fails.
    pub fn start(tx: Sender<InputEvent>, suppress: Arc<AtomicBool>) -> anyhow::Result<Capture> {
        SINK.set(Sink {
            tx,
            suppress,
            last_x: AtomicI32::new(NO_POINT),
            last_y: AtomicI32::new(NO_POINT),
            have_last: AtomicBool::new(false),
        })
        .map_err(|_| anyhow!("capture already started in this process"))?;

        // Channel used by the hook thread to report install success/failure and
        // its own thread id back to `start`.
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<u32>>();

        let join = std::thread::Builder::new()
            .name("capture-hooks".into())
            .spawn(move || hook_thread_main(ready_tx))
            .context("spawn capture hook thread")?;

        // Wait for the hook thread to install the hooks and report back.
        let thread_id = match ready_rx.recv() {
            Ok(Ok(id)) => id,
            Ok(Err(e)) => {
                // Install failed; thread is exiting on its own.
                let _ = join.join();
                return Err(e);
            }
            Err(_) => {
                let _ = join.join();
                return Err(anyhow!("capture hook thread exited before reporting ready"));
            }
        };

        Ok(Capture {
            thread_id,
            join: Some(join),
        })
    }

    /// Stop capturing: tear down the hooks and join the hook thread.
    ///
    /// Equivalent to dropping the [`Capture`], but lets callers observe that the
    /// thread has fully wound down before returning.
    pub fn stop(mut self) {
        self.shutdown();
    }

    /// Post `WM_QUIT` to the hook thread and join it. Idempotent.
    fn shutdown(&mut self) {
        if let Some(join) = self.join.take() {
            // SAFETY: posting WM_QUIT to a valid thread id is sound; the hook
            // thread's GetMessageW loop returns 0 on WM_QUIT and exits.
            unsafe {
                let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            let _ = join.join();
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Body of the dedicated hook thread: install both hooks, report readiness, pump
/// messages until `WM_QUIT`, then unhook.
fn hook_thread_main(ready_tx: Sender<anyhow::Result<u32>>) {
    // Install both low-level hooks on THIS thread. `hmod` is None and
    // `thread_id` is 0 for global low-level hooks.
    let mouse_hook = unsafe {
        SetWindowsHookExW(WH_MOUSE_LL, Some(low_level_mouse_proc), None, 0)
    };
    let mouse_hook = match mouse_hook {
        Ok(h) => h,
        Err(e) => {
            let _ = ready_tx.send(Err(anyhow!("SetWindowsHookExW(WH_MOUSE_LL) failed: {e}")));
            return;
        }
    };

    let kbd_hook = unsafe {
        SetWindowsHookExW(WH_KEYBOARD_LL, Some(low_level_keyboard_proc), None, 0)
    };
    let kbd_hook = match kbd_hook {
        Ok(h) => h,
        Err(e) => {
            // Roll back the mouse hook we already installed.
            unsafe {
                let _ = UnhookWindowsHookEx(mouse_hook);
            }
            let _ = ready_tx.send(Err(anyhow!(
                "SetWindowsHookExW(WH_KEYBOARD_LL) failed: {e}"
            )));
            return;
        }
    };

    // Report our thread id so `start` can target us with PostThreadMessageW.
    let tid = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };
    if ready_tx.send(Ok(tid)).is_err() {
        // The owner went away before we reported; just tear down and exit.
        unsafe {
            let _ = UnhookWindowsHookEx(kbd_hook);
            let _ = UnhookWindowsHookEx(mouse_hook);
        }
        return;
    }

    // Pump messages. GetMessageW returns 0 on WM_QUIT, -1 on error.
    let mut msg = MSG::default();
    loop {
        let r = unsafe { GetMessageW(&mut msg, None, 0, 0) };
        if r.0 == 0 || r.0 == -1 {
            break;
        }
        unsafe {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }

    // Tear down hooks on the way out.
    unsafe {
        let _ = UnhookWindowsHookEx(kbd_hook);
        let _ = UnhookWindowsHookEx(mouse_hook);
    }
}

/// Decide whether to swallow the current event. Reads the shared suppress flag.
#[inline]
fn should_suppress() -> bool {
    SINK.get()
        .map(|s| s.suppress.load(Ordering::Relaxed))
        .unwrap_or(false)
}

/// Send a decoded event to the sink if one is installed. Kept tiny so the hook
/// callback stays well under the LL-hook system timeout.
#[inline]
fn emit(ev: InputEvent) {
    if let Some(sink) = SINK.get() {
        // A full/closed channel must not stall the hook; drop on failure.
        let _ = sink.tx.send(ev);
    }
}

/// Low-level mouse hook callback. Runs on the hook thread.
unsafe extern "system" fn low_level_mouse_proc(
    ncode: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // ncode < 0 means we must pass the event on without processing.
    if ncode < 0 {
        return CallNextHookEx(None, ncode, wparam, lparam);
    }

    // SAFETY: for WH_MOUSE_LL, lparam points to an MSLLHOOKSTRUCT.
    let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
    let msg = wparam.0 as u32;

    match msg {
        WM_MOUSEWHEEL => {
            // High word of mouseData is a signed wheel delta.
            let delta = ((info.mouseData >> 16) & 0xffff) as i16 as i32;
            emit(InputEvent::Wheel { dx: 0, dy: delta });
        }
        WM_MOUSEHWHEEL => {
            let delta = ((info.mouseData >> 16) & 0xffff) as i16 as i32;
            emit(InputEvent::Wheel { dx: delta, dy: 0 });
        }
        WM_LBUTTONDOWN => emit(button(MouseButton::Left, true)),
        WM_LBUTTONUP => emit(button(MouseButton::Left, false)),
        WM_RBUTTONDOWN => emit(button(MouseButton::Right, true)),
        WM_RBUTTONUP => emit(button(MouseButton::Right, false)),
        WM_MBUTTONDOWN => emit(button(MouseButton::Middle, true)),
        WM_MBUTTONUP => emit(button(MouseButton::Middle, false)),
        WM_XBUTTONDOWN => {
            if let Some(b) = xbutton(info.mouseData) {
                emit(button(b, true));
            }
        }
        WM_XBUTTONUP => {
            if let Some(b) = xbutton(info.mouseData) {
                emit(button(b, false));
            }
        }
        _ => {
            // Treat anything else (notably WM_MOUSEMOVE) as movement: compute a
            // relative delta from the last absolute point.
            if let Some(sink) = SINK.get() {
                let (x, y) = (info.pt.x, info.pt.y);
                if sink.have_last.load(Ordering::Relaxed) {
                    let lx = sink.last_x.load(Ordering::Relaxed);
                    let ly = sink.last_y.load(Ordering::Relaxed);
                    let dx = x - lx;
                    let dy = y - ly;
                    if dx != 0 || dy != 0 {
                        emit(InputEvent::MouseMove { dx, dy });
                    }
                } else {
                    sink.have_last.store(true, Ordering::Relaxed);
                }
                sink.last_x.store(x, Ordering::Relaxed);
                sink.last_y.store(y, Ordering::Relaxed);
            }
        }
    }

    if should_suppress() {
        // Swallow: do NOT chain to the next hook.
        LRESULT(1)
    } else {
        CallNextHookEx(None, ncode, wparam, lparam)
    }
}

/// Low-level keyboard hook callback. Runs on the hook thread.
unsafe extern "system" fn low_level_keyboard_proc(
    ncode: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if ncode < 0 {
        return CallNextHookEx(None, ncode, wparam, lparam);
    }

    // SAFETY: for WH_KEYBOARD_LL, lparam points to a KBDLLHOOKSTRUCT.
    let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
    let msg = wparam.0 as u32;
    let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
    let extended = (info.flags.0 & LLKHF_EXTENDED.0) != 0;

    emit(InputEvent::Key {
        vk: info.vkCode as u16,
        scancode: info.scanCode as u16,
        down,
        extended,
    });

    if should_suppress() {
        LRESULT(1)
    } else {
        CallNextHookEx(None, ncode, wparam, lparam)
    }
}

/// Build a `MouseButton` input event.
#[inline]
fn button(button: MouseButton, down: bool) -> InputEvent {
    InputEvent::MouseButton { button, down }
}

/// Map the high word of `mouseData` to the X button it represents.
#[inline]
fn xbutton(mouse_data: u32) -> Option<MouseButton> {
    match ((mouse_data >> 16) & 0xffff) as u16 {
        v if v == XBUTTON1 => Some(MouseButton::X1),
        v if v == XBUTTON2 => Some(MouseButton::X2),
        _ => None,
    }
}
