//! Thin wrappers over the OS cursor position calls used by the engine's `Local`
//! and `Controlling` states.
//!
//! On `Local` we poll [`get_cursor_pos`] to sense edge crossings; while
//! `Controlling` a remote peer we [`set_cursor_pos`] every tick to *park* the
//! local cursor so it can't drift into other local applications, and we restore
//! it near the origin edge when control returns.

/// Get the current OS cursor position in virtual-screen coordinates.
///
/// Returns `None` if the position could not be read (the engine simply skips the
/// poll tick in that case).
#[cfg(windows)]
pub fn get_cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut pt = POINT::default();
    // SAFETY: `GetCursorPos` writes into the provided POINT; no preconditions.
    let ok = unsafe { GetCursorPos(&mut pt) };
    if ok.is_ok() {
        Some((pt.x, pt.y))
    } else {
        None
    }
}

/// Move the OS cursor to `(x, y)` in virtual-screen coordinates.
///
/// Best-effort: errors (e.g. UIPI on a higher-integrity foreground window) are
/// swallowed; the caller re-issues this every parking tick anyway.
#[cfg(windows)]
pub fn set_cursor_pos(x: i32, y: i32) {
    use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;
    // SAFETY: `SetCursorPos` takes plain integer coordinates.
    let _ = unsafe { SetCursorPos(x, y) };
}

#[cfg(not(windows))]
pub fn get_cursor_pos() -> Option<(i32, i32)> {
    None
}

#[cfg(not(windows))]
pub fn set_cursor_pos(_x: i32, _y: i32) {}
