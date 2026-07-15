//! Local monitor topology enumeration.
//!
//! Wraps Win32 monitor/DPI APIs to produce a [`protocol::LocalTopology`]
//! describing this machine's monitors and overall virtual-desktop bounds, plus
//! a small geometric helper, [`edge_at`], for deciding which outer edge of the
//! virtual desktop a cursor position lies on.
//!
//! Coordinates throughout are in the OS virtual-screen coordinate space (the
//! same space as `GetSystemMetrics(SM_XVIRTUALSCREEN, ...)`): the primary
//! monitor's top-left is the origin and monitors placed above/left of it have
//! negative coordinates.

use protocol::{Edge, LocalTopology, MonitorRect};

/// How close (in pixels) a point must be to a virtual-desktop outer edge for
/// [`edge_at`] to report that edge. A small slack absorbs the off-by-one of the
/// exclusive right/bottom bounds and lets a clamped cursor (one pixel shy of the
/// true edge) still register as "on the edge".
pub const EDGE_THRESHOLD: i32 = 2;

/// Enumerate this machine's monitors and compute the virtual-desktop bounds.
///
/// Builds a [`protocol::LocalTopology`] with one [`protocol::MonitorRect`] per
/// attached display, in OS virtual-screen coordinates. The OS primary monitor
/// is flagged via `MONITORINFOF_PRIMARY`, and each monitor's `scale` is its
/// effective DPI (`GetDpiForMonitor`, `MDT_EFFECTIVE_DPI`) divided by 96.
///
/// `virtual_bounds` is taken from `GetSystemMetrics` (`SM_*VIRTUALSCREEN`).
pub fn current_topology() -> anyhow::Result<LocalTopology> {
    sys::current_topology()
}

/// Backwards-compatible alias for [`current_topology`].
///
/// The crate scaffold exposed this name; it is retained so callers wired up
/// against the stub continue to compile.
pub fn enumerate() -> anyhow::Result<LocalTopology> {
    current_topology()
}

/// Determine which outer edge of the virtual desktop the point `(x, y)` lies on,
/// within [`EDGE_THRESHOLD`] pixels, if any.
///
/// The virtual desktop is `topo.virtual_bounds` (`x, y, w, h`). A point is "on"
/// an edge when it is within the threshold of that edge *and* within the
/// (threshold-expanded) span of the perpendicular axis, so points well outside
/// the desktop on a diagonal do not spuriously match.
///
/// When a point is within the threshold of two edges (e.g. a corner), the
/// horizontal edges (`Left`/`Right`) take precedence over the vertical ones, as
/// horizontal hand-off is the common KVM arrangement. Returns `None` if the
/// point is not near any edge.
pub fn edge_at(topo: &LocalTopology, x: i32, y: i32) -> Option<Edge> {
    let (vx, vy, vw, vh) = topo.virtual_bounds;
    if vw <= 0 || vh <= 0 {
        return None;
    }
    let left = vx;
    let top = vy;
    let right = vx + vw - 1; // inclusive right-most pixel
    let bottom = vy + vh - 1; // inclusive bottom-most pixel
    let t = EDGE_THRESHOLD;

    // Must be roughly inside the desktop span on the perpendicular axis,
    // allowing the same slack as the edge test itself.
    let within_y = y >= top - t && y <= bottom + t;
    let within_x = x >= left - t && x <= right + t;

    if within_y && (x - left).abs() <= t {
        return Some(Edge::Left);
    }
    if within_y && (x - right).abs() <= t {
        return Some(Edge::Right);
    }
    if within_x && (y - top).abs() <= t {
        return Some(Edge::Top);
    }
    if within_x && (y - bottom).abs() <= t {
        return Some(Edge::Bottom);
    }
    None
}

/// Compute the bounding box `(x, y, w, h)` enclosing every monitor.
///
/// Used as a fallback when the `SM_*VIRTUALSCREEN` metrics are unavailable, and
/// shared with tests. Returns `(0, 0, 0, 0)` for an empty monitor list.
fn bounds_of(monitors: &[MonitorRect]) -> (i32, i32, i32, i32) {
    let mut iter = monitors.iter();
    let Some(first) = iter.next() else {
        return (0, 0, 0, 0);
    };
    let mut min_x = first.x;
    let mut min_y = first.y;
    let mut max_x = first.right();
    let mut max_y = first.bottom();
    for m in iter {
        min_x = min_x.min(m.x);
        min_y = min_y.min(m.y);
        max_x = max_x.max(m.right());
        max_y = max_y.max(m.bottom());
    }
    (min_x, min_y, max_x - min_x, max_y - min_y)
}

/// Watches for display configuration changes (resolution/arrangement/DPI) and
/// invokes the callback with a fresh [`LocalTopology`].
///
/// Not yet implemented; the message-only window hooking `WM_DISPLAYCHANGE` /
/// `WM_DPICHANGED` lands in a later wave. Callers can poll [`current_topology`]
/// in the meantime.
pub struct TopologyWatcher;

impl TopologyWatcher {
    /// Start watching; `on_change` is called whenever the layout changes.
    pub fn start<F>(_on_change: F) -> anyhow::Result<Self>
    where
        F: FnMut(LocalTopology) + Send + 'static,
    {
        anyhow::bail!("TopologyWatcher is not yet implemented")
    }
}

#[cfg(windows)]
mod sys {
    use super::bounds_of;
    use protocol::{LocalTopology, MonitorRect};
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT, TRUE};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, MONITORINFOF_PRIMARY, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
        SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    };

    /// Accumulator threaded through the `EnumDisplayMonitors` callback.
    struct Collector {
        monitors: Vec<MonitorRect>,
        next_id: u32,
    }

    /// `EnumDisplayMonitors` callback: records one monitor per invocation.
    unsafe extern "system" fn enum_proc(
        hmonitor: HMONITOR,
        _hdc: HDC,
        _rect: *mut RECT,
        lparam: LPARAM,
    ) -> BOOL {
        let collector = &mut *(lparam.0 as *mut Collector);

        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };

        // If GetMonitorInfoW fails, skip this monitor but keep enumerating.
        if !GetMonitorInfoW(hmonitor, &mut info).as_bool() {
            return TRUE;
        }

        let r = info.rcMonitor;
        let primary = (info.dwFlags & MONITORINFOF_PRIMARY) != 0;

        // Per-monitor effective DPI; fall back to 96 (scale 1.0) on failure.
        let mut dpi_x: u32 = 96;
        let mut dpi_y: u32 = 96;
        let _ = GetDpiForMonitor(hmonitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y);
        let scale = dpi_x as f32 / 96.0;

        let id = collector.next_id;
        collector.next_id += 1;
        collector.monitors.push(MonitorRect {
            id,
            x: r.left,
            y: r.top,
            w: r.right - r.left,
            h: r.bottom - r.top,
            scale,
            primary,
        });

        TRUE
    }

    pub fn current_topology() -> anyhow::Result<LocalTopology> {
        let mut collector = Collector {
            monitors: Vec::new(),
            next_id: 0,
        };

        // SAFETY: passing a valid &mut Collector via LPARAM; `enum_proc`
        // reconstructs it for the duration of the (synchronous) enumeration.
        let ok = unsafe {
            EnumDisplayMonitors(
                None,
                None,
                Some(enum_proc),
                LPARAM(&mut collector as *mut Collector as isize),
            )
        };
        if !ok.as_bool() {
            anyhow::bail!("EnumDisplayMonitors failed");
        }

        if collector.monitors.is_empty() {
            anyhow::bail!("no monitors enumerated");
        }

        // Virtual-desktop bounds from system metrics; fall back to the computed
        // bounding box of the enumerated monitors if the metrics are degenerate.
        // SAFETY: GetSystemMetrics has no preconditions.
        let (vx, vy, vw, vh) = unsafe {
            (
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        };
        let virtual_bounds = if vw > 0 && vh > 0 {
            (vx, vy, vw, vh)
        } else {
            bounds_of(&collector.monitors)
        };

        Ok(LocalTopology {
            monitors: collector.monitors,
            virtual_bounds,
        })
    }
}

#[cfg(not(windows))]
mod sys {
    use protocol::LocalTopology;

    pub fn current_topology() -> anyhow::Result<LocalTopology> {
        anyhow::bail!("topology enumeration is only implemented on Windows")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::{Edge, LocalTopology, MonitorRect};

    fn mon(id: u32, x: i32, y: i32, w: i32, h: i32, primary: bool) -> MonitorRect {
        MonitorRect {
            id,
            x,
            y,
            w,
            h,
            scale: 1.0,
            primary,
        }
    }

    /// Single 1920x1080 monitor at the origin.
    fn single() -> LocalTopology {
        LocalTopology {
            monitors: vec![mon(0, 0, 0, 1920, 1080, true)],
            virtual_bounds: (0, 0, 1920, 1080),
        }
    }

    /// Two side-by-side 1920x1080 monitors; secondary to the right.
    fn dual_horizontal() -> LocalTopology {
        let monitors = vec![
            mon(0, 0, 0, 1920, 1080, true),
            mon(1, 1920, 0, 1920, 1080, false),
        ];
        let virtual_bounds = bounds_of(&monitors);
        LocalTopology {
            monitors,
            virtual_bounds,
        }
    }

    /// Secondary monitor to the LEFT of primary, producing negative coords.
    fn dual_negative() -> LocalTopology {
        let monitors = vec![
            mon(0, 0, 0, 1920, 1080, true),
            mon(1, -1280, 0, 1280, 720, false),
        ];
        let virtual_bounds = bounds_of(&monitors);
        LocalTopology {
            monitors,
            virtual_bounds,
        }
    }

    #[test]
    fn bounds_of_combines_rects() {
        assert_eq!(dual_horizontal().virtual_bounds, (0, 0, 3840, 1080));
        assert_eq!(dual_negative().virtual_bounds, (-1280, 0, 3200, 1080));
        assert_eq!(bounds_of(&[]), (0, 0, 0, 0));
    }

    #[test]
    fn left_edge_detected() {
        let t = single();
        assert_eq!(edge_at(&t, 0, 540), Some(Edge::Left));
        // One pixel shy (clamped cursor) still registers within threshold.
        assert_eq!(edge_at(&t, 1, 540), Some(Edge::Left));
    }

    #[test]
    fn right_edge_detected() {
        let t = single();
        // Inclusive right-most pixel is 1919.
        assert_eq!(edge_at(&t, 1919, 540), Some(Edge::Right));
        assert_eq!(edge_at(&t, 1918, 540), Some(Edge::Right));
    }

    #[test]
    fn top_and_bottom_edges_detected() {
        let t = single();
        assert_eq!(edge_at(&t, 960, 0), Some(Edge::Top));
        assert_eq!(edge_at(&t, 960, 1079), Some(Edge::Bottom));
    }

    #[test]
    fn interior_point_is_no_edge() {
        let t = single();
        assert_eq!(edge_at(&t, 960, 540), None);
    }

    #[test]
    fn far_diagonal_point_is_no_edge() {
        // Way off the bottom-right corner: near no single edge's span.
        let t = single();
        assert_eq!(edge_at(&t, 5000, 5000), None);
    }

    #[test]
    fn corner_prefers_horizontal_edge() {
        let t = single();
        // Top-left corner is within threshold of both Left and Top; Left wins.
        assert_eq!(edge_at(&t, 0, 0), Some(Edge::Left));
        // Bottom-right corner: Right wins over Bottom.
        assert_eq!(edge_at(&t, 1919, 1079), Some(Edge::Right));
    }

    #[test]
    fn right_edge_uses_outer_bound_of_combined_desktop() {
        let t = dual_horizontal();
        // The seam between the two monitors (x == 1920) is interior, not an edge.
        assert_eq!(edge_at(&t, 1920, 540), None);
        // The true outer right edge is 3839.
        assert_eq!(edge_at(&t, 3839, 540), Some(Edge::Right));
        assert_eq!(edge_at(&t, 0, 540), Some(Edge::Left));
    }

    #[test]
    fn negative_origin_left_edge() {
        let t = dual_negative();
        // Virtual desktop starts at x == -1280.
        assert_eq!(edge_at(&t, -1280, 360), Some(Edge::Left));
        assert_eq!(edge_at(&t, 1919, 540), Some(Edge::Right));
    }

    #[test]
    fn degenerate_bounds_yield_none() {
        let t = LocalTopology {
            monitors: vec![],
            virtual_bounds: (0, 0, 0, 0),
        };
        assert_eq!(edge_at(&t, 0, 0), None);
    }
}
