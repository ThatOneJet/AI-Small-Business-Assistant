//! Pure geometry for the `Controlling` state: tracking a virtual remote cursor
//! and detecting when it crosses back over a seam onto a local edge.
//!
//! While this machine is *controlling* a remote peer, the local cursor is parked
//! and local input is suppressed. We instead maintain a **virtual** cursor
//! position inside the remote peer's screen, advanced by the same mouse deltas we
//! forward to the peer. When that virtual cursor runs off an edge of the remote
//! screen, control should hand back (`Leave`) to this machine.
//!
//! This module is deliberately free of any OS / async dependency so the
//! accumulation + edge-detection logic can be unit-tested in isolation.

use protocol::Edge;

/// A virtual cursor tracked inside a remote peer's screen while we control it.
///
/// Coordinates are in the remote machine's **local** virtual-screen space,
/// nominally `0..width` by `0..height`. Mouse deltas captured locally are applied
/// here so we know, without any feedback from the peer, where the remote cursor
/// is and when it has reached an edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemoteCursor {
    /// Current virtual x (clamped into `0..=width-1`).
    pub x: i32,
    /// Current virtual y (clamped into `0..=height-1`).
    pub y: i32,
    /// Remote screen width in pixels.
    pub width: i32,
    /// Remote screen height in pixels.
    pub height: i32,
}

impl RemoteCursor {
    /// Create a virtual cursor at remote-local `(x, y)` on a `width`x`height`
    /// screen. The position is clamped onto the screen.
    pub fn new(x: i32, y: i32, width: i32, height: i32) -> Self {
        let mut c = Self {
            x: 0,
            y: 0,
            width: width.max(1),
            height: height.max(1),
        };
        c.set(x, y);
        c
    }

    /// Clamp + set the absolute position.
    fn set(&mut self, x: i32, y: i32) {
        self.x = x.clamp(0, self.width - 1);
        self.y = y.clamp(0, self.height - 1);
    }

    /// Apply a mouse delta and report which local edge (if any) the cursor has
    /// run **past** as a result.
    ///
    /// The returned [`Edge`] is the edge of the *remote* screen the cursor pushed
    /// against — i.e. the direction control wants to leave in. `None` means the
    /// cursor stayed within the remote screen. The position is always clamped
    /// back onto the screen so a subsequent `Leave` restores cleanly.
    pub fn apply_delta(&mut self, dx: i32, dy: i32) -> Option<Edge> {
        let nx = self.x + dx;
        let ny = self.y + dy;

        // Detect overflow against the screen bounds. Horizontal takes precedence
        // over vertical to mirror `topology::edge_at`, since horizontal hand-off
        // is the common KVM arrangement.
        let edge = if nx < 0 {
            Some(Edge::Left)
        } else if nx > self.width - 1 {
            Some(Edge::Right)
        } else if ny < 0 {
            Some(Edge::Top)
        } else if ny > self.height - 1 {
            Some(Edge::Bottom)
        } else {
            None
        };

        self.set(nx, ny);
        edge
    }

    /// Current position as a tuple.
    pub fn pos(&self) -> (i32, i32) {
        (self.x, self.y)
    }
}

/// Clamp a point one pixel inside the given virtual-desktop bounds
/// `(x, y, w, h)`, biased toward `edge`.
///
/// Used when control returns to the local machine: after a `Leave` we restore
/// the local cursor near the edge it conceptually re-enters on, a couple of
/// pixels inboard so it does not immediately re-trigger a crossing.
pub fn restore_point(bounds: (i32, i32, i32, i32), edge: Edge, along: (i32, i32)) -> (i32, i32) {
    let (bx, by, bw, bh) = bounds;
    if bw <= 0 || bh <= 0 {
        return (bx, by);
    }
    // A small inset so the restored cursor isn't sitting exactly on the seam.
    let inset = 4.min(bw - 1).min(bh - 1).max(0);
    let left = bx;
    let top = by;
    let right = bx + bw - 1;
    let bottom = by + bh - 1;

    let clamp_x = |v: i32| v.clamp(left, right);
    let clamp_y = |v: i32| v.clamp(top, bottom);

    match edge {
        // Re-entering from the remote across our right edge -> land just inside
        // the right edge.
        Edge::Right => (right - inset, clamp_y(along.1)),
        Edge::Left => (left + inset, clamp_y(along.1)),
        Edge::Bottom => (clamp_x(along.0), bottom - inset),
        Edge::Top => (clamp_x(along.0), top + inset),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delta_within_bounds_reports_no_edge() {
        let mut c = RemoteCursor::new(500, 500, 1920, 1080);
        assert_eq!(c.apply_delta(10, -10), None);
        assert_eq!(c.pos(), (510, 490));
    }

    #[test]
    fn delta_off_right_reports_right_and_clamps() {
        let mut c = RemoteCursor::new(1910, 540, 1920, 1080);
        let edge = c.apply_delta(50, 0);
        assert_eq!(edge, Some(Edge::Right));
        // Clamped to the last on-screen pixel.
        assert_eq!(c.x, 1919);
    }

    #[test]
    fn delta_off_left_reports_left_and_clamps() {
        let mut c = RemoteCursor::new(5, 540, 1920, 1080);
        assert_eq!(c.apply_delta(-50, 0), Some(Edge::Left));
        assert_eq!(c.x, 0);
    }

    #[test]
    fn delta_off_top_and_bottom() {
        let mut c = RemoteCursor::new(960, 5, 1920, 1080);
        assert_eq!(c.apply_delta(0, -50), Some(Edge::Top));
        assert_eq!(c.y, 0);

        let mut c2 = RemoteCursor::new(960, 1075, 1920, 1080);
        assert_eq!(c2.apply_delta(0, 50), Some(Edge::Bottom));
        assert_eq!(c2.y, 1079);
    }

    #[test]
    fn horizontal_takes_precedence_at_a_corner() {
        // Push diagonally off the top-right corner: Right should win.
        let mut c = RemoteCursor::new(1919, 0, 1920, 1080);
        assert_eq!(c.apply_delta(5, -5), Some(Edge::Right));
    }

    #[test]
    fn accumulates_across_multiple_deltas() {
        let mut c = RemoteCursor::new(0, 540, 1920, 1080);
        // Walk right in steps; only the step that crosses the far edge reports.
        assert_eq!(c.apply_delta(900, 0), None);
        assert_eq!(c.x, 900);
        assert_eq!(c.apply_delta(900, 0), None);
        assert_eq!(c.x, 1800);
        assert_eq!(c.apply_delta(900, 0), Some(Edge::Right));
        assert_eq!(c.x, 1919);
    }

    #[test]
    fn new_clamps_initial_position() {
        let c = RemoteCursor::new(-100, 99999, 800, 600);
        assert_eq!(c.pos(), (0, 599));
    }

    #[test]
    fn restore_point_insets_from_right_edge() {
        let p = restore_point((0, 0, 1920, 1080), Edge::Right, (0, 500));
        assert_eq!(p, (1915, 500));
    }

    #[test]
    fn restore_point_insets_from_left_edge() {
        let p = restore_point((0, 0, 1920, 1080), Edge::Left, (0, 500));
        assert_eq!(p, (4, 500));
    }

    #[test]
    fn restore_point_handles_negative_origin() {
        // Virtual desktop starting at negative x (monitor to the left).
        let p = restore_point((-1280, 0, 3200, 1080), Edge::Left, (0, 360));
        assert_eq!(p, (-1276, 360));
    }

    #[test]
    fn restore_point_clamps_along_axis() {
        let p = restore_point((0, 0, 1920, 1080), Edge::Right, (0, 99999));
        assert_eq!(p, (1915, 1079));
    }

    #[test]
    fn restore_point_degenerate_bounds() {
        assert_eq!(restore_point((10, 20, 0, 0), Edge::Right, (5, 5)), (10, 20));
    }
}
