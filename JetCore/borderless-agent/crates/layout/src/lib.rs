//! Cross-machine layout geometry.
//!
//! Owns the real implementation of edge-crossing resolution whose signature is
//! frozen in [`protocol::resolve_crossing`] / [`protocol::Layout::resolve_across`].
//!
//! # Coordinate spaces
//!
//! Two coordinate spaces are in play:
//!
//! - **Shared plane**: a single global plane shared by every machine. Each
//!   [`protocol::PlacedMachine`] occupies the rectangle `x..x+w` by `y..y+h`
//!   there. Machines are arranged edge-to-edge; the cursor crosses where their
//!   rectangles abut.
//! - **Machine-local**: each machine's own virtual-screen coordinates. By the
//!   convention of this crate a machine's local virtual desktop spans
//!   `0..w` by `0..h` and maps **directly onto** its placed rectangle in the
//!   shared plane (local `(lx, ly)` <-> shared `(placed.x + lx, placed.y + ly)`).
//!   [`Crossing::entry`] is always returned in the **target** machine's local
//!   space, i.e. clamped into `0..w` by `0..h`.
//!
//! The heart of this crate is the proportional projection along an abutting
//! edge: when the cursor leaves machine `A` across an edge at some fraction `f`
//! along that edge, it enters machine `B` at the same fraction `f` along the
//! opposite (shared) edge — so two machines of *different* sizes still feel
//! continuous.

use protocol::{Crossing, Edge, Layout, LocalTopology, MachineId, PlacedMachine};

/// Convert a machine-local point into the shared plane.
///
/// Local `(lx, ly)` (in `0..w`, `0..h`) maps to shared
/// `(placed.x + lx, placed.y + ly)`.
pub fn local_to_shared(placed: &PlacedMachine, local: (i32, i32)) -> (i32, i32) {
    (placed.x + local.0, placed.y + local.1)
}

/// Convert a shared-plane point into a machine's local coordinates.
///
/// The inverse of [`local_to_shared`]. The result is **not** clamped to the
/// machine's bounds; callers that need an on-screen point should clamp with
/// [`clamp_local`].
pub fn shared_to_local(placed: &PlacedMachine, shared: (i32, i32)) -> (i32, i32) {
    (shared.0 - placed.x, shared.1 - placed.y)
}

/// Clamp a local point into the on-screen range `0..=w-1`, `0..=h-1` of `placed`.
///
/// Width/height of zero collapse the corresponding axis to `0`.
pub fn clamp_local(placed: &PlacedMachine, local: (i32, i32)) -> (i32, i32) {
    let cx = if placed.w > 0 {
        local.0.clamp(0, placed.w - 1)
    } else {
        0
    };
    let cy = if placed.h > 0 {
        local.1.clamp(0, placed.h - 1)
    } else {
        0
    };
    (cx, cy)
}

/// Find the placed machine whose shared-plane rectangle contains `point`.
pub fn machine_at_shared<'a>(layout: &'a Layout, point: (i32, i32)) -> Option<&'a PlacedMachine> {
    layout.machines.iter().find(|m| m.contains(point.0, point.1))
}

/// Resolve which machine + entry point lies across `edge` of machine `from`
/// when the cursor is at local position `pos`.
///
/// See [`protocol::resolve_crossing`] for the frozen contract. This crate
/// supplies the geometric implementation:
///
/// 1. Map `pos` (in `from`'s local coords) to the shared plane.
/// 2. Step one unit past `from`'s `edge` into the shared plane.
/// 3. Find the machine (other than `from`) whose rectangle abuts there.
/// 4. Project the crossing point proportionally along the shared edge into the
///    neighbour's local coordinates.
///
/// Returns `None` when nothing is adjacent across that edge at that position.
pub fn resolve_crossing(
    layout: &Layout,
    from: &MachineId,
    edge: Edge,
    pos: (i32, i32),
) -> Option<Crossing> {
    let src = layout.get(from)?;
    if src.w <= 0 || src.h <= 0 {
        return None;
    }

    // Where in the shared plane does the cursor sit as it touches `edge`?
    //
    // We sample the crossing on the *boundary line* of the source edge so that
    // the perpendicular coordinate is exactly on the seam between the two
    // rectangles, and the parallel coordinate is taken from `pos`.
    let shared = local_to_shared(src, pos);

    // The probe point is the first cell *outside* `from` across `edge`, used to
    // find the abutting neighbour. `along_shared` is the cursor's position along
    // the edge (parallel to it) in the shared plane.
    let (probe, along_shared) = match edge {
        // Leaving on the left: x is one step left of src.x; travel along y.
        Edge::Left => ((src.x - 1, shared.1), shared.1),
        // Leaving on the right: x is at src.right() (first column outside); along y.
        Edge::Right => ((src.right(), shared.1), shared.1),
        // Leaving on the top: y is one step above src.y; along x.
        Edge::Top => ((shared.0, src.y - 1), shared.0),
        // Leaving on the bottom: y is at src.bottom(); along x.
        Edge::Bottom => ((shared.0, src.bottom()), shared.0),
    };

    // Find a different machine occupying the probe point.
    let target = layout
        .machines
        .iter()
        .find(|m| &m.machine != from && m.contains(probe.0, probe.1))?;

    if target.w <= 0 || target.h <= 0 {
        return None;
    }

    let entry_edge = edge.opposite();

    // Proportionally map the position *along* the shared edge into the target's
    // local span on the entry edge, then pin the perpendicular axis to the
    // target's entry boundary.
    let entry = match edge {
        // Crossing left/right: the shared edge runs vertically -> map y.
        Edge::Left | Edge::Right => {
            let local_y = project_along(along_shared, (src.y, src.h), (target.y, target.h));
            // Entering on the opposite (vertical) edge: x pinned.
            let local_x = match entry_edge {
                Edge::Left => 0,
                Edge::Right => target.w - 1,
                _ => unreachable!("left/right crossing enters a vertical edge"),
            };
            (local_x, local_y)
        }
        // Crossing top/bottom: the shared edge runs horizontally -> map x.
        Edge::Top | Edge::Bottom => {
            let local_x = project_along(along_shared, (src.x, src.w), (target.x, target.w));
            // Entering on the opposite (horizontal) edge: y pinned.
            let local_y = match entry_edge {
                Edge::Top => 0,
                Edge::Bottom => target.h - 1,
                _ => unreachable!("top/bottom crossing enters a horizontal edge"),
            };
            (local_x, local_y)
        }
    };

    let entry = clamp_local(target, entry);

    Some(Crossing {
        target: target.machine.clone(),
        entry,
        entry_edge,
    })
}

/// Project a shared-plane coordinate that lies on the seam between two machines
/// onto the destination machine's **local** span, preserving the proportional
/// fraction along the source edge.
///
/// `src_span` / `dst_span` are `(origin, length)` in the shared plane along the
/// edge axis. The fraction of `coord` within the source span is preserved and
/// mapped onto the destination span, yielding a destination-local offset
/// (`0..dst.len`). The coordinate is first clamped into the physical overlap of
/// the two spans so a crossing near a corner cannot project outside the
/// neighbour.
fn project_along(coord: i32, src_span: (i32, i32), dst_span: (i32, i32)) -> i32 {
    let (s0, s_len) = src_span;
    let (d0, d_len) = dst_span;

    if d_len <= 0 {
        return 0;
    }

    // The seam only physically exists over the overlap of the two spans.
    let lo = s0.max(d0);
    let hi = (s0 + s_len).min(d0 + d_len);
    let coord = coord.clamp(lo, hi.max(lo));

    if s_len <= 1 {
        // Degenerate source: everything maps to the start.
        return 0;
    }

    // Fraction along the SOURCE edge in [0, 1]. Using the source span keeps the
    // mapping symmetric with the geometric position the cursor actually left at.
    let frac = (coord - s0) as f64 / s_len as f64;
    // Map onto the destination span. Round to nearest to avoid systematic drift.
    let local = (frac * d_len as f64).round() as i32;
    local.clamp(0, d_len - 1)
}

/// Build a simple default [`Layout`] placing the local machine at the origin and
/// each peer contiguously to its right so abutting edges line up exactly.
///
/// Placement strategy: peers are laid out to the **right** of the local machine
/// in order, each touching the previous one's right edge and sharing the top
/// (`y == 0`) so their left/right edges abut for clean horizontal crossings.
/// The local machine's size comes from `local.virtual_bounds` `(w, h)`; each
/// peer's size comes from its `(w, h)` entry.
///
/// `peers` carries `(id, name, w, h)`.
pub fn default_layout(
    local: &LocalTopology,
    local_id: &MachineId,
    local_name: &str,
    peers: &[(MachineId, String, i32, i32)],
) -> Layout {
    let (_lx, _ly, lw, lh) = local.virtual_bounds;

    let mut machines = Vec::with_capacity(1 + peers.len());

    // Local machine anchored at the shared-plane origin.
    machines.push(PlacedMachine {
        machine: local_id.clone(),
        name: local_name.to_string(),
        x: 0,
        y: 0,
        w: lw,
        h: lh,
    });

    // Lay peers out left-to-right, each abutting the previous right edge.
    let mut cursor_x = lw;
    for (id, name, w, h) in peers {
        machines.push(PlacedMachine {
            machine: id.clone(),
            name: name.clone(),
            x: cursor_x,
            y: 0,
            w: *w,
            h: *h,
        });
        cursor_x += *w;
    }

    Layout { machines }
}

/// Validate a [`Layout`]: every rectangle must be positive-sized, ids unique,
/// and no two machines may overlap in the shared plane. Returns the list of
/// problems found, empty if valid.
pub fn validate(layout: &Layout) -> Vec<String> {
    let mut problems = Vec::new();

    for m in &layout.machines {
        if m.w <= 0 || m.h <= 0 {
            problems.push(format!(
                "machine {} has non-positive size {}x{}",
                m.machine, m.w, m.h
            ));
        }
    }

    // Duplicate ids.
    for (i, a) in layout.machines.iter().enumerate() {
        for b in &layout.machines[i + 1..] {
            if a.machine == b.machine {
                problems.push(format!("duplicate machine id {}", a.machine));
            }
        }
    }

    // Pairwise overlap (only meaningful for positive-sized rects).
    for (i, a) in layout.machines.iter().enumerate() {
        if a.w <= 0 || a.h <= 0 {
            continue;
        }
        for b in &layout.machines[i + 1..] {
            if b.w <= 0 || b.h <= 0 {
                continue;
            }
            if rects_overlap(a, b) {
                problems.push(format!("machines {} and {} overlap", a.machine, b.machine));
            }
        }
    }

    problems
}

/// Whether two placed rectangles overlap (share interior area). Edge-to-edge
/// abutment is *not* an overlap.
fn rects_overlap(a: &PlacedMachine, b: &PlacedMachine) -> bool {
    a.x < b.right() && b.x < a.right() && a.y < b.bottom() && b.y < a.bottom()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pm(id: &str, x: i32, y: i32, w: i32, h: i32) -> PlacedMachine {
        PlacedMachine {
            machine: MachineId::new(id),
            name: id.to_string(),
            x,
            y,
            w,
            h,
        }
    }

    fn mid(s: &str) -> MachineId {
        MachineId::new(s)
    }

    // -------------------------------------------------------------------------
    // coordinate conversions
    // -------------------------------------------------------------------------

    #[test]
    fn local_shared_roundtrip() {
        let m = pm("a", 100, 50, 800, 600);
        let local = (10, 20);
        let shared = local_to_shared(&m, local);
        assert_eq!(shared, (110, 70));
        assert_eq!(shared_to_local(&m, shared), local);
    }

    #[test]
    fn clamp_keeps_inside_bounds() {
        let m = pm("a", 0, 0, 100, 200);
        assert_eq!(clamp_local(&m, (-5, -5)), (0, 0));
        assert_eq!(clamp_local(&m, (999, 999)), (99, 199));
        assert_eq!(clamp_local(&m, (50, 60)), (50, 60));
    }

    #[test]
    fn machine_at_shared_finds_box() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 100, 100), pm("b", 100, 0, 100, 100)],
        };
        assert_eq!(
            machine_at_shared(&layout, (150, 50)).unwrap().machine,
            mid("b")
        );
        assert_eq!(
            machine_at_shared(&layout, (50, 50)).unwrap().machine,
            mid("a")
        );
        assert!(machine_at_shared(&layout, (500, 500)).is_none());
    }

    // -------------------------------------------------------------------------
    // crossing: right / left between equal-size machines
    // -------------------------------------------------------------------------

    #[test]
    fn cross_right_equal_size() {
        // a: [0..800), b directly to the right [800..1600), same height.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 800, 0, 800, 600)],
        };
        // Cursor at right edge of a, mid-height.
        let c = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 300)).unwrap();
        assert_eq!(c.target, mid("b"));
        assert_eq!(c.entry_edge, Edge::Left);
        // Enters on b's left edge (x == 0), same proportional height.
        assert_eq!(c.entry.0, 0);
        assert_eq!(c.entry.1, 300);
    }

    #[test]
    fn cross_left_equal_size() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", -800, 0, 800, 600)],
        };
        let c = resolve_crossing(&layout, &mid("a"), Edge::Left, (0, 150)).unwrap();
        assert_eq!(c.target, mid("b"));
        assert_eq!(c.entry_edge, Edge::Right);
        // Enters on b's right edge (x == w-1).
        assert_eq!(c.entry.0, 799);
        assert_eq!(c.entry.1, 150);
    }

    // -------------------------------------------------------------------------
    // PROPORTIONAL vertical mapping: different heights side by side
    // -------------------------------------------------------------------------

    #[test]
    fn cross_right_proportional_taller_neighbour() {
        // a is 600 tall, b is 1200 tall (twice). A point halfway down a should
        // land halfway down b.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 800, 0, 800, 1200)],
        };
        // Halfway down a (y == 300 of 600 -> frac 0.5).
        let c = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 300)).unwrap();
        assert_eq!(c.target, mid("b"));
        // 0.5 * 1200 = 600.
        assert_eq!(c.entry, (0, 600));

        // Top of a -> top of b.
        let top = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 0)).unwrap();
        assert_eq!(top.entry, (0, 0));

        // Quarter down a (150/600 = 0.25) -> 0.25 * 1200 = 300.
        let q = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 150)).unwrap();
        assert_eq!(q.entry, (0, 300));
    }

    #[test]
    fn cross_right_proportional_shorter_neighbour() {
        // a is 1200 tall, b is 600 tall (half). The seam only exists over the
        // overlap y in [0, 600). A point a quarter down a (y == 300, frac 0.25)
        // maps to a quarter down b (0.25 * 600 == 150).
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 1200), pm("b", 800, 0, 800, 600)],
        };
        let c = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 300)).unwrap();
        // 300/1200 = 0.25 -> 0.25 * 600 = 150.
        assert_eq!(c.entry, (0, 150));
    }

    #[test]
    fn cross_right_below_shorter_neighbour_returns_none() {
        // a is 1200 tall, b is only 600 tall. Below b's bottom edge there is no
        // neighbour across the seam, so the cursor stays put.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 1200), pm("b", 800, 0, 800, 600)],
        };
        // y == 900 is below b's range [0, 600) -> None.
        assert!(resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 900)).is_none());
        // y == 600 is exactly b's exclusive bottom -> still no neighbour.
        assert!(resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 600)).is_none());
    }

    // -------------------------------------------------------------------------
    // top / bottom crossings (horizontal proportional mapping)
    // -------------------------------------------------------------------------

    #[test]
    fn cross_bottom_equal_size() {
        // a on top [y 0..600), b below [y 600..1200), same width.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 0, 600, 800, 600)],
        };
        let c = resolve_crossing(&layout, &mid("a"), Edge::Bottom, (400, 599)).unwrap();
        assert_eq!(c.target, mid("b"));
        assert_eq!(c.entry_edge, Edge::Top);
        // Enters top of b (y == 0), same x.
        assert_eq!(c.entry, (400, 0));
    }

    #[test]
    fn cross_top_equal_size() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 0, -600, 800, 600)],
        };
        let c = resolve_crossing(&layout, &mid("a"), Edge::Top, (200, 0)).unwrap();
        assert_eq!(c.target, mid("b"));
        assert_eq!(c.entry_edge, Edge::Bottom);
        // Enters bottom of b (y == h-1), same x.
        assert_eq!(c.entry, (200, 599));
    }

    #[test]
    fn cross_bottom_proportional_wider_neighbour() {
        // a is 800 wide, b is 1600 wide. Halfway across a -> halfway across b.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 0, 600, 1600, 600)],
        };
        let c = resolve_crossing(&layout, &mid("a"), Edge::Bottom, (400, 599)).unwrap();
        // 400/800 = 0.5 -> 0.5 * 1600 = 800.
        assert_eq!(c.entry, (800, 0));
    }

    // -------------------------------------------------------------------------
    // gaps / no neighbour -> None
    // -------------------------------------------------------------------------

    #[test]
    fn no_neighbour_returns_none() {
        // Only one machine: nothing across any edge.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600)],
        };
        assert!(resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 300)).is_none());
        assert!(resolve_crossing(&layout, &mid("a"), Edge::Left, (0, 300)).is_none());
        assert!(resolve_crossing(&layout, &mid("a"), Edge::Top, (400, 0)).is_none());
        assert!(resolve_crossing(&layout, &mid("a"), Edge::Bottom, (400, 599)).is_none());
    }

    #[test]
    fn gap_between_machines_returns_none() {
        // b sits to the right but NOT touching (gap from 800 to 900).
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 900, 0, 800, 600)],
        };
        assert!(resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 300)).is_none());
    }

    #[test]
    fn partial_vertical_overlap_outside_returns_none() {
        // b abuts a's right edge but is shifted down so it only overlaps the
        // lower portion. Crossing high up (y small) should miss b.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 800, 400, 800, 600)],
        };
        // y == 50 is above b's top (400) -> no neighbour.
        assert!(resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 50)).is_none());
        // y == 500 is within b's span -> crossing succeeds.
        let c = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 500)).unwrap();
        assert_eq!(c.target, mid("b"));
    }

    #[test]
    fn unknown_source_machine_returns_none() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600)],
        };
        assert!(resolve_crossing(&layout, &mid("ghost"), Edge::Right, (0, 0)).is_none());
    }

    // -------------------------------------------------------------------------
    // round trip: cross right then back left lands near the start
    // -------------------------------------------------------------------------

    #[test]
    fn round_trip_right_then_left_equal_size() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 800, 0, 800, 600)],
        };
        let start_y = 321;
        // a -> b across the right edge.
        let to_b = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, start_y)).unwrap();
        assert_eq!(to_b.target, mid("b"));
        // Now cross back from b across ITS left edge at the entry point.
        let back = resolve_crossing(&layout, &mid("b"), Edge::Left, to_b.entry).unwrap();
        assert_eq!(back.target, mid("a"));
        // Should land at a's right edge, very close to the original y.
        assert_eq!(back.entry.0, 799);
        assert!(
            (back.entry.1 - start_y).abs() <= 1,
            "round-trip y drifted: {} vs {}",
            back.entry.1,
            start_y
        );
    }

    #[test]
    fn round_trip_different_heights_stays_close() {
        // Different heights: round-trip should still land within a couple px
        // because of rounding through two proportional maps. We sample y values
        // within the overlap such that the forward entry in b (frac * 1000) maps
        // back to a y still inside a's range [0, 600) — i.e. avoid the extreme
        // bottom where b's larger span pushes the entry below a's seam overlap.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 800, 0, 800, 1000)],
        };
        for start_y in [0, 100, 200, 299, 300, 350] {
            let to_b = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, start_y)).unwrap();
            let back = resolve_crossing(&layout, &mid("b"), Edge::Left, to_b.entry)
                .unwrap_or_else(|| panic!("no return crossing for start_y {start_y} via {to_b:?}"));
            assert_eq!(back.target, mid("a"));
            assert!(
                (back.entry.1 - start_y).abs() <= 2,
                "round-trip y drifted too far: {} vs {} (via {:?})",
                back.entry.1,
                start_y,
                to_b.entry
            );
        }
    }

    #[test]
    fn round_trip_outside_overlap_has_no_return() {
        // a (600 tall) -> b (1000 tall): crossing near a's bottom lands deep in
        // b, beyond a's vertical overlap, so crossing back finds no neighbour.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 800, 0, 800, 1000)],
        };
        let to_b = resolve_crossing(&layout, &mid("a"), Edge::Right, (799, 599)).unwrap();
        // 599/600 * 1000 ~= 998, which is below a's [0, 600) overlap with b.
        assert!(to_b.entry.1 >= 600);
        assert!(resolve_crossing(&layout, &mid("b"), Edge::Left, to_b.entry).is_none());
    }

    #[test]
    fn round_trip_bottom_then_top() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 0, 600, 800, 600)],
        };
        let start_x = 271;
        let down = resolve_crossing(&layout, &mid("a"), Edge::Bottom, (start_x, 599)).unwrap();
        assert_eq!(down.target, mid("b"));
        let up = resolve_crossing(&layout, &mid("b"), Edge::Top, down.entry).unwrap();
        assert_eq!(up.target, mid("a"));
        assert_eq!(up.entry.1, 599);
        assert!((up.entry.0 - start_x).abs() <= 1);
    }

    // -------------------------------------------------------------------------
    // default_layout
    // -------------------------------------------------------------------------

    fn topo(w: i32, h: i32) -> LocalTopology {
        LocalTopology {
            monitors: vec![],
            virtual_bounds: (0, 0, w, h),
        }
    }

    #[test]
    fn default_layout_places_local_at_origin() {
        let layout = default_layout(&topo(1920, 1080), &mid("me"), "Me", &[]);
        assert_eq!(layout.machines.len(), 1);
        let me = layout.get(&mid("me")).unwrap();
        assert_eq!((me.x, me.y, me.w, me.h), (0, 0, 1920, 1080));
        assert_eq!(me.name, "Me");
    }

    #[test]
    fn default_layout_places_peers_contiguously() {
        let peers = vec![
            (mid("p1"), "Peer1".to_string(), 1280, 1024),
            (mid("p2"), "Peer2".to_string(), 1920, 1080),
        ];
        let layout = default_layout(&topo(1920, 1080), &mid("me"), "Me", &peers);
        assert_eq!(layout.machines.len(), 3);

        let me = layout.get(&mid("me")).unwrap();
        let p1 = layout.get(&mid("p1")).unwrap();
        let p2 = layout.get(&mid("p2")).unwrap();

        // p1 abuts me's right edge.
        assert_eq!(p1.x, me.right());
        // p2 abuts p1's right edge.
        assert_eq!(p2.x, p1.right());
        // All share the top.
        assert_eq!(me.y, 0);
        assert_eq!(p1.y, 0);
        assert_eq!(p2.y, 0);

        // No overlaps in the produced layout.
        assert!(validate(&layout).is_empty(), "{:?}", validate(&layout));
    }

    #[test]
    fn default_layout_crossing_works_end_to_end() {
        // Build a layout via default_layout, then exercise a real crossing.
        let peers = vec![(mid("p1"), "Peer1".to_string(), 1280, 1024)];
        let layout = default_layout(&topo(1920, 1080), &mid("me"), "Me", &peers);
        // Cross right off "me" into p1.
        let c = resolve_crossing(&layout, &mid("me"), Edge::Right, (1919, 540)).unwrap();
        assert_eq!(c.target, mid("p1"));
        assert_eq!(c.entry_edge, Edge::Left);
        assert_eq!(c.entry.0, 0);
        // 540/1080 = 0.5 -> 0.5 * 1024 = 512.
        assert_eq!(c.entry.1, 512);
    }

    // -------------------------------------------------------------------------
    // validate
    // -------------------------------------------------------------------------

    #[test]
    fn validate_clean_layout_ok() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 800, 0, 800, 600)],
        };
        assert!(validate(&layout).is_empty());
    }

    #[test]
    fn validate_detects_overlap() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 800, 600), pm("b", 400, 0, 800, 600)],
        };
        let problems = validate(&layout);
        assert!(
            problems.iter().any(|p| p.contains("overlap")),
            "{problems:?}"
        );
    }

    #[test]
    fn validate_detects_degenerate_and_duplicate() {
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 0, 600), pm("a", 800, 0, 800, 600)],
        };
        let problems = validate(&layout);
        assert!(
            problems.iter().any(|p| p.contains("non-positive")),
            "{problems:?}"
        );
        assert!(
            problems.iter().any(|p| p.contains("duplicate")),
            "{problems:?}"
        );
    }

    #[test]
    fn validate_abutting_is_not_overlap() {
        // Edge-to-edge sharing must NOT be flagged.
        let layout = Layout {
            machines: vec![pm("a", 0, 0, 100, 100), pm("b", 100, 0, 100, 100)],
        };
        assert!(validate(&layout).is_empty());
    }
}
