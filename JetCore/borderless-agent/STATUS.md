# Borderless native agent — honest status

Built end-to-end as a Rust/Win32 cargo workspace. **Everything compiles (debug + release) and the
full test suite is green** (~90 unit/integration tests across the 11 crates; only the real-OS-clipboard
round-trip is `#[ignore]`d). What that does and does NOT yet prove is below — read this before trusting it.

## ✅ Implemented + compiles + unit/integration-tested

- **Protocol** — wire framing round-trips, control JSON round-trips, input-event round-trips (7 tests).
- **Topology** — monitor enumeration (Win32) + edge math (10 tests on the pure edge logic).
- **Capture** — LL keyboard+mouse hooks on a message-pump thread, event mapping, and the suppress flag
  (compiles clean; hooks can't be exercised headlessly).
- **Inject** — `SendInput` for every event kind + absolute-coordinate normalization (5 tests on the math).
- **Transport** — Noise-encrypted TCP: real handshake, **wrong-PSK rejection**, and a large multi-chunk
  payload all verified over loopback (3 tests).
- **Discovery** — beacon serialize + staleness/prune logic (8 tests).
- **Pairing** — Argon2id PSK determinism, identity persistence, snow-key compatibility, peer store (8 tests).
- **Layout** — proportional edge-crossing across equal/taller/shorter/wider neighbours, round-trips, gaps
  → `None` (**26 tests** — the geometry is the most rigorously covered part).
- **Clipboard** — feedback-loop guard + RGBA encode/decode (7 tests).
- **Core engine** — state machine (Local/Controlling/Controlled), seam-crossing delta math, crossing
  eligibility (16 tests).
- **borderlessd** — builds; `version`, the control socket (`Status` round-trip), and `pair` persistence
  were smoke-tested live on one machine.

## ⚠️ NOT yet proven — needs real TWO-MACHINE runtime testing

Unit tests verify the *pieces*; only running it on two real PCs verifies the *system*. Outstanding:

1. **End-to-end edge crossing** — does the cursor actually hand off at the seam with acceptable latency/feel.
2. **Capture suppression** — confirm local input is truly blocked on the controlling machine while driving a peer (and that nothing leaks through).
3. **Injection fidelity** — keys (incl. extended keys, unicode, modifiers), mouse, wheel land correctly on the controlled machine; no stuck keys.
4. **Cursor parking/restore** — the controlling machine's cursor stays parked and returns cleanly.
5. **Safety under failure** — kill a peer mid-control and verify suppression + all modifiers are released (the code does this; it must be observed).
6. **Reconnect/backoff** — real Wi-Fi drops, sleep/wake, IP changes.
7. **Discovery across the real network** — broadcast reaching the peer; Windows Firewall prompts; manual connect-by-IP fallback.
8. **DPI / multi-monitor** — correct mapping with mixed-DPI and multi-monitor topologies on both ends.
9. **Clipboard** — text (and image) actually syncing both directions.

## 🔌 Not built yet (next steps)

- **JetCore integration** — wire the Electron main process to spawn `borderlessd.exe run` and talk to
  the control socket (`127.0.0.1:52008`), replacing the in-app Node engine. Note the `ControlEvent`
  JSON is adjacently tagged (`{"type":…,"data":…}`).
- **Layout editor → agent** — push the cross-machine layout from JetCore's desk-layout UI into `SetLayout`.
- **Windows service** — currently a console app (`borderlessd run`); a `windows-service` wrapper +
  autostart is sketched in a comment but not implemented.
- **Packaging/signing** — no installer or code signing for the agent yet.

## One protocol change made during the build

`protocol::ControlEvent` switched from internal tagging (`tag="type"`) to adjacent tagging
(`tag="type", content="data"`) — the `Peers(Vec<…>)` newtype variant cannot serialize under internal
tagging. Rust enum shape unchanged; JSON gains a `"data"` field. Covered by a regression test.
