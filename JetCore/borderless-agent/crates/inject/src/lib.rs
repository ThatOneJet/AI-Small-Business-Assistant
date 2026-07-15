//! Synthetic input injection.
//!
//! Replays remote [`protocol::InputEvent`]s on this machine via `SendInput`,
//! mapping relative/absolute moves, buttons, wheel, and keys (incl. Unicode).
//!
//! The crate exposes two entry points:
//! - [`inject`] — a free function translating one [`InputEvent`] into one (or
//!   two, for surrogate-pair Unicode) `SendInput` calls. Absolute-move events
//!   are normalized against the virtual-desktop metrics queried fresh on each
//!   call (`GetSystemMetrics`), so this works correctly without any cached
//!   state.
//! - [`Injector`] — an optional handle that caches the virtual-screen metrics
//!   so absolute moves don't re-query `GetSystemMetrics` every event.
//!
//! [`release_all_modifiers`] is a safety helper that synthesizes key-up for the
//! common modifier keys and button-up for every mouse button; it is meant to be
//! called on session teardown / `Leave` so a dropped peer can never leave a
//! modifier or button stuck down on the local machine.

use anyhow::{bail, Result};
use protocol::{InputEvent, MouseButton};

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE, KEYEVENTF_UNICODE, MOUSEINPUT,
    MOUSE_EVENT_FLAGS, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE,
    MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL,
    MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, VIRTUAL_KEY, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_LWIN,
    VK_RCONTROL, VK_RMENU, VK_RSHIFT, VK_RWIN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    WHEEL_DELTA, XBUTTON1, XBUTTON2,
};

/// Size of one `INPUT` structure, the `cbSize` argument `SendInput` expects.
const INPUT_SIZE: i32 = std::mem::size_of::<INPUT>() as i32;

// ===========================================================================
// Virtual-screen geometry
// ===========================================================================

/// The virtual-desktop bounding box, in physical pixels, used to normalize
/// absolute mouse coordinates into the `0..=65535` range `SendInput` wants when
/// `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK` is set.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VirtualScreen {
    /// Left edge of the virtual desktop (`SM_XVIRTUALSCREEN`). May be negative.
    pub origin_x: i32,
    /// Top edge of the virtual desktop (`SM_YVIRTUALSCREEN`). May be negative.
    pub origin_y: i32,
    /// Total width spanning all monitors (`SM_CXVIRTUALSCREEN`).
    pub width: i32,
    /// Total height spanning all monitors (`SM_CYVIRTUALSCREEN`).
    pub height: i32,
}

impl VirtualScreen {
    /// Query the current virtual-desktop metrics from the OS.
    pub fn query() -> Self {
        // SAFETY: `GetSystemMetrics` reads a global system value and has no
        // failure mode beyond returning 0 for an unsupported index.
        unsafe {
            VirtualScreen {
                origin_x: GetSystemMetrics(SM_XVIRTUALSCREEN),
                origin_y: GetSystemMetrics(SM_YVIRTUALSCREEN),
                width: GetSystemMetrics(SM_CXVIRTUALSCREEN),
                height: GetSystemMetrics(SM_CYVIRTUALSCREEN),
            }
        }
    }

    /// Normalize an absolute virtual-screen pixel coordinate `(x, y)` into the
    /// `0..=65535` fixed-point range expected by `MOUSEEVENTF_ABSOLUTE |
    /// MOUSEEVENTF_VIRTUALDESK`.
    ///
    /// Per the Win32 contract the normalized value is
    /// `(coord - origin) * 65535 / (extent - 1)`, rounded to nearest, then
    /// clamped to `0..=65535`. Pure function: no syscalls, unit-tested.
    pub fn normalize(&self, x: i32, y: i32) -> (i32, i32) {
        (
            normalize_axis(x, self.origin_x, self.width),
            normalize_axis(y, self.origin_y, self.height),
        )
    }
}

/// Normalize a single axis coordinate to `0..=65535` across `[origin, origin+extent)`.
///
/// Mirrors the documented `SendInput` absolute-coordinate formula
/// `(coord - origin) * 65535 / (extent - 1)` with round-to-nearest and a clamp
/// to the valid output range. A degenerate `extent <= 1` maps everything to 0.
fn normalize_axis(coord: i32, origin: i32, extent: i32) -> i32 {
    if extent <= 1 {
        return 0;
    }
    // Work in i64 to avoid overflow: 65535 * extent can exceed i32 range.
    let rel = (coord - origin) as i64;
    let denom = (extent - 1) as i64;
    // Round-to-nearest: add half the denominator before integer division.
    // Guard against negative `rel` so rounding goes the right way; the clamp
    // below makes out-of-range inputs harmless regardless.
    let scaled = rel * 65535;
    let rounded = if scaled >= 0 {
        (scaled + denom / 2) / denom
    } else {
        (scaled - denom / 2) / denom
    };
    rounded.clamp(0, 65535) as i32
}

// ===========================================================================
// Injector (caches metrics)
// ===========================================================================

/// Injects remote input events into the local OS input stream.
///
/// Caches the virtual-screen metrics captured at construction so absolute moves
/// avoid a `GetSystemMetrics` round-trip per event. If monitors are
/// hot-plugged, call [`Injector::refresh_metrics`] to re-query.
pub struct Injector {
    screen: VirtualScreen,
}

impl Injector {
    /// Create an injector bound to the current virtual-screen metrics.
    pub fn new() -> Result<Self> {
        Ok(Self {
            screen: VirtualScreen::query(),
        })
    }

    /// Re-query and cache the virtual-desktop metrics (e.g. after a display
    /// configuration change).
    pub fn refresh_metrics(&mut self) {
        self.screen = VirtualScreen::query();
    }

    /// The cached virtual-screen metrics.
    pub fn screen(&self) -> VirtualScreen {
        self.screen
    }

    /// Inject a single event via `SendInput`, using cached metrics for absolute
    /// moves.
    pub fn inject(&self, event: &InputEvent) -> Result<()> {
        inject_with_screen(event, &self.screen)
    }

    /// Release all currently-held modifier keys and mouse buttons (called on
    /// `Leave`/disconnect). Delegates to [`release_all_modifiers`].
    pub fn release_all(&self) -> Result<()> {
        release_all_modifiers()
    }
}

// ===========================================================================
// Free-function API
// ===========================================================================

/// Inject a single [`InputEvent`] into the local OS via `SendInput`.
///
/// For [`InputEvent::MouseAbs`] this queries `GetSystemMetrics` for the
/// current virtual-desktop bounds on every call. To avoid that per-event
/// syscall, construct an [`Injector`] and use [`Injector::inject`].
pub fn inject(ev: &InputEvent) -> Result<()> {
    // Only absolute moves need the metrics; query lazily so the hot path
    // (relative moves / keys) pays nothing.
    match ev {
        InputEvent::MouseAbs { .. } => inject_with_screen(ev, &VirtualScreen::query()),
        other => inject_with_screen(other, &VIRTUAL_SCREEN_UNUSED),
    }
}

/// A placeholder used for events that never read the metrics. Keeps the
/// internal dispatcher uniform without an `Option`.
const VIRTUAL_SCREEN_UNUSED: VirtualScreen = VirtualScreen {
    origin_x: 0,
    origin_y: 0,
    width: 0,
    height: 0,
};

/// Core dispatcher: translate one [`InputEvent`] into one or more `INPUT`
/// structs and submit them via `SendInput`. `screen` is consulted only for
/// [`InputEvent::MouseAbs`].
fn inject_with_screen(ev: &InputEvent, screen: &VirtualScreen) -> Result<()> {
    match *ev {
        InputEvent::MouseMove { dx, dy } => {
            send_inputs(&[mouse_input(dx, dy, 0, MOUSEEVENTF_MOVE)])
        }
        InputEvent::MouseAbs { x, y } => {
            let (nx, ny) = screen.normalize(x, y);
            send_inputs(&[mouse_input(
                nx,
                ny,
                0,
                MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
            )])
        }
        InputEvent::MouseButton { button, down } => {
            let (flags, mouse_data) = button_flags(button, down);
            send_inputs(&[mouse_input(0, 0, mouse_data, flags)])
        }
        InputEvent::Wheel { dx, dy } => {
            let mut inputs: Vec<INPUT> = Vec::with_capacity(2);
            // mouseData for wheel events is a *signed* delta carried in the
            // high word of the u32, in multiples of WHEEL_DELTA (120).
            if dy != 0 {
                inputs.push(mouse_input(0, 0, dy as u32, MOUSEEVENTF_WHEEL));
            }
            if dx != 0 {
                inputs.push(mouse_input(0, 0, dx as u32, MOUSEEVENTF_HWHEEL));
            }
            if inputs.is_empty() {
                return Ok(());
            }
            send_inputs(&inputs)
        }
        InputEvent::Key {
            vk,
            scancode,
            down,
            extended,
        } => {
            let mut flags = KEYEVENTF_SCANCODE;
            if extended {
                flags |= KEYEVENTF_EXTENDEDKEY;
            }
            if !down {
                flags |= KEYEVENTF_KEYUP;
            }
            send_inputs(&[key_input(vk, scancode, flags)])
        }
        InputEvent::KeyUnicode { ch, down } => {
            let mut units = [0u16; 2];
            let encoded = ch.encode_utf16(&mut units);
            let mut inputs: Vec<INPUT> = Vec::with_capacity(encoded.len());
            let mut flags = KEYEVENTF_UNICODE;
            if !down {
                flags |= KEYEVENTF_KEYUP;
            }
            // For UNICODE the wVk MUST be 0 and the UTF-16 unit goes in wScan.
            // Surrogate pairs are sent as two consecutive inputs.
            for &unit in encoded.iter() {
                inputs.push(key_input(0, unit, flags));
            }
            if inputs.is_empty() {
                return Ok(());
            }
            send_inputs(&inputs)
        }
    }
}

/// Safety helper: synthesize key-up for the common modifier keys (both Ctrl,
/// both Alt, both Shift, both Win) and button-up for every mouse button.
///
/// Intended to run on session teardown / `Leave` so a dropped or
/// mis-sequenced peer can never strand a held modifier or button on the local
/// machine. Sending a key-up for a key that wasn't down is harmless.
pub fn release_all_modifiers() -> Result<()> {
    let modifiers = [
        VK_LCONTROL,
        VK_RCONTROL,
        VK_LMENU,
        VK_RMENU,
        VK_LSHIFT,
        VK_RSHIFT,
        VK_LWIN,
        VK_RWIN,
    ];

    let mut inputs: Vec<INPUT> = Vec::with_capacity(modifiers.len() + 5);

    // Modifier key-ups, by virtual key (so this works regardless of the layout
    // the original press used). VK is enough for a reliable release.
    for vk in modifiers {
        inputs.push(key_input_vk(vk, KEYEVENTF_KEYUP));
    }

    // Mouse button-ups for every button.
    inputs.push(mouse_input(0, 0, 0, MOUSEEVENTF_LEFTUP));
    inputs.push(mouse_input(0, 0, 0, MOUSEEVENTF_RIGHTUP));
    inputs.push(mouse_input(0, 0, 0, MOUSEEVENTF_MIDDLEUP));
    inputs.push(mouse_input(0, 0, XBUTTON1 as u32, MOUSEEVENTF_XUP));
    inputs.push(mouse_input(0, 0, XBUTTON2 as u32, MOUSEEVENTF_XUP));

    send_inputs(&inputs)
}

// ===========================================================================
// INPUT builders
// ===========================================================================

/// Build a mouse `INPUT`. `dx`/`dy` are relative pixels or normalized absolute
/// coords depending on `flags`; `mouse_data` carries wheel deltas / XBUTTON ids.
fn mouse_input(dx: i32, dy: i32, mouse_data: u32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: mouse_data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Build a keyboard `INPUT` by scancode (the UNICODE/scancode path). `vk` is the
/// virtual key (0 for UNICODE), `scan` the scancode or UTF-16 unit.
fn key_input(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(vk),
                wScan: scan,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Build a keyboard `INPUT` driven by virtual key only (no scancode flag); used
/// for the modifier release helper.
fn key_input_vk(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Map a [`MouseButton`] + press/release to the `(dwFlags, mouseData)` pair a
/// mouse `INPUT` needs. X buttons encode the button id in `mouseData`.
fn button_flags(button: MouseButton, down: bool) -> (MOUSE_EVENT_FLAGS, u32) {
    match button {
        MouseButton::Left => (
            if down { MOUSEEVENTF_LEFTDOWN } else { MOUSEEVENTF_LEFTUP },
            0,
        ),
        MouseButton::Right => (
            if down { MOUSEEVENTF_RIGHTDOWN } else { MOUSEEVENTF_RIGHTUP },
            0,
        ),
        MouseButton::Middle => (
            if down { MOUSEEVENTF_MIDDLEDOWN } else { MOUSEEVENTF_MIDDLEUP },
            0,
        ),
        MouseButton::X1 => (
            if down { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP },
            XBUTTON1 as u32,
        ),
        MouseButton::X2 => (
            if down { MOUSEEVENTF_XDOWN } else { MOUSEEVENTF_XUP },
            XBUTTON2 as u32,
        ),
    }
}

/// Submit a batch of `INPUT` structs atomically via `SendInput`, erroring if
/// the OS swallowed any (typically because UIPI blocked injection into a
/// higher-integrity foreground window).
fn send_inputs(inputs: &[INPUT]) -> Result<()> {
    if inputs.is_empty() {
        return Ok(());
    }
    // SAFETY: `inputs` is a valid, correctly-sized slice of `INPUT` and
    // `INPUT_SIZE` is `size_of::<INPUT>()`, matching the ABI contract.
    let sent = unsafe { SendInput(inputs, INPUT_SIZE) };
    if sent as usize != inputs.len() {
        bail!(
            "SendInput injected {sent}/{} events (input may be blocked, e.g. by UIPI)",
            inputs.len()
        );
    }
    Ok(())
}

// Reference WHEEL_DELTA so the import documents the unit even though wheel
// deltas arrive pre-scaled from the protocol layer.
const _: u32 = WHEEL_DELTA;

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_endpoints_and_midpoint() {
        // Single 1920x1080 monitor at the origin.
        let s = VirtualScreen {
            origin_x: 0,
            origin_y: 0,
            width: 1920,
            height: 1080,
        };

        // Top-left maps to 0.
        assert_eq!(s.normalize(0, 0), (0, 0));

        // Bottom-right-most pixel (extent-1) maps to the full-scale 65535.
        assert_eq!(s.normalize(1919, 1079), (65535, 65535));

        // Midpoint pixel ~ midway through the range (round-to-nearest).
        let (mx, my) = s.normalize(960, 540);
        // 960 * 65535 / 1919 = 32785.4 -> 32785
        assert_eq!(mx, 32785);
        // 540 * 65535 / 1079 = 32798.0 -> 32798
        assert_eq!(my, 32798);
    }

    #[test]
    fn normalize_handles_negative_origin() {
        // A second monitor to the left puts the virtual origin negative.
        // Virtual desktop spans x in [-1920, 1920) -> width 3840.
        let s = VirtualScreen {
            origin_x: -1920,
            origin_y: 0,
            width: 3840,
            height: 1080,
        };

        // The virtual origin (leftmost pixel) maps to 0.
        assert_eq!(s.normalize(-1920, 0).0, 0);
        // The rightmost pixel (extent-1) maps to 65535.
        assert_eq!(s.normalize(1919, 0).0, 65535);
        // x == 0 (start of the primary monitor) sits just past the midpoint.
        // (0 - (-1920)) * 65535 / 3839 = 1920*65535/3839 = 32775.5 -> 32776
        assert_eq!(s.normalize(0, 0).0, 32776);
    }

    #[test]
    fn normalize_clamps_out_of_range() {
        let s = VirtualScreen {
            origin_x: 0,
            origin_y: 0,
            width: 1000,
            height: 1000,
        };
        // Below origin clamps to 0.
        assert_eq!(s.normalize(-50, -50), (0, 0));
        // Past the far edge clamps to 65535.
        assert_eq!(s.normalize(5000, 5000), (65535, 65535));
    }

    #[test]
    fn normalize_degenerate_extent_is_zero() {
        let s = VirtualScreen {
            origin_x: 100,
            origin_y: 100,
            width: 1,
            height: 0,
        };
        assert_eq!(s.normalize(123, 456), (0, 0));
    }

    #[test]
    fn button_flags_set_xbutton_data() {
        let (f1, d1) = button_flags(MouseButton::X1, true);
        assert_eq!(f1, MOUSEEVENTF_XDOWN);
        assert_eq!(d1, XBUTTON1 as u32);

        let (f2, d2) = button_flags(MouseButton::X2, false);
        assert_eq!(f2, MOUSEEVENTF_XUP);
        assert_eq!(d2, XBUTTON2 as u32);

        let (fl, dl) = button_flags(MouseButton::Left, true);
        assert_eq!(fl, MOUSEEVENTF_LEFTDOWN);
        assert_eq!(dl, 0);
    }
}
