# JetCore Borderless — native agent (`borderlessd`)

A native Windows **software KVM**: one keyboard & mouse drives multiple LAN machines, with the
cursor crossing screen edges between separate computers (like Synergy / Barrier / Deskflow / InputLeap).

This is the **native agent** that does the part the Electron/JetCore app cannot: capture **and
suppress** local input via low-level OS hooks, and **inject** input on the remote machine via
`SendInput`. JetCore is the GUI; this daemon is the engine it drives over a localhost socket.

## Architecture (cargo workspace, 11 crates)

| Crate | Role |
|---|---|
| `protocol` | **Frozen contract** — wire messages (postcard framing), input events, layout/topology model, control-socket JSON API, IDs, versioning. Everything depends on this. |
| `topology` | Enumerates this machine's monitors (Win32 `EnumDisplayMonitors`/DPI) → `LocalTopology`; edge detection. |
| `capture` | Global low-level hooks (`WH_MOUSE_LL`/`WH_KEYBOARD_LL`) on a dedicated message-pump thread → `InputEvent`s, with a shared **suppress** flag (returns `1` to swallow local input). |
| `inject` | `SendInput` injection (relative/absolute mouse, buttons, wheel, scancode + unicode keys) + `release_all_modifiers()` safety helper. |
| `transport` | Authenticated **encrypted** TCP channel — Noise `XXpsk3_25519_ChaChaPoly_BLAKE2s` (snow), length-prefixed encrypted frames. Wrong key ⇒ handshake fails. |
| `discovery` | Zero-config LAN discovery via UDP broadcast beacons (+ manual connect-by-IP for broadcast-blocked nets). |
| `pairing` | Persistent machine identity (X25519), **Argon2id** PSK derivation from the human secret, paired-peer store (TOFU gated by the PSK). |
| `layout` | Cross-machine geometry — proportional **edge-crossing** math (which machine + entry point across an edge). |
| `clipboard` | Clipboard sync (`arboard`) with feedback-loop guard. |
| `core` | The **Engine**: async hot loop + state machine (Local / Controlling / Controlled), heartbeat, and the safety guarantees. |
| `borderlessd` | The runnable binary: config, CLI, and the **localhost control socket** JetCore drives. |

## Build

Rust stable (msvc) + the MSVC build tools are required.

```powershell
# cargo may be off-PATH in a fresh shell:
& "$env:USERPROFILE\.cargo\bin\cargo.exe" build --release
# → target\release\borderlessd.exe
```

## Run it on two machines (test)

1. Put `borderlessd.exe` on both PCs (same LAN).
2. On each: `borderlessd run` (keeps running; Ctrl-C stops cleanly and releases input).
3. Set the **same pairing secret** on both, and **pair** them — via JetCore's Borderless screen
   (which talks to the control socket) or `borderlessd pair <peerId|ip>`.
4. Configure the cross-machine **layout** (which machine sits left/right/etc.) — JetCore's desk-layout
   editor, or the default contiguous layout.
5. Move the mouse to the shared screen edge → control crosses to the other machine.

> ⚠️ This actually takes over input. The controlling machine's local keyboard/mouse are **suppressed**
> while it's driving a peer; on any disconnect/heartbeat-loss the engine releases suppression and all
> modifier keys so you're never locked out. See `STATUS.md` for what still needs real runtime testing.

## Control socket (JetCore integration surface)

- **TCP `127.0.0.1:52008`**, loopback only, **newline-delimited JSON**.
- Inbound line = `protocol::ControlRequest`; outbound line = `protocol::ControlEvent`
  (adjacently tagged: `{"type":"State","data":{…}}`, `{"type":"Peers","data":[…]}`,
  `{"type":"Cursor","data":{…}}`).
- On connect a client immediately receives `State` + `Peers`; all engine events fan out to every client.
- Requests: `Start`, `Stop`, `Status`, `SetConfig{name,secret,layout}`, `SetLayout`, `Pair{peer}`, `Unpair{peer}`.
- JetCore's main process spawns `borderlessd.exe run`, connects to this socket, writes request lines,
  and renders the `State`/`Peers`/`Cursor` events (the same data the in-app engine currently shows).

## Ports / firewall

| Port | Proto | Purpose |
|---|---|---|
| 24800 | TCP | Encrypted session transport (peer ↔ peer) |
| 24801 | UDP | LAN discovery beacons (broadcast) |
| 52008 | TCP | Local control socket (loopback only — not exposed to the LAN) |

## Data / config

Under `%APPDATA%\jetcore\borderless\` (override with `JETCORE_BORDERLESS_DIR`):
`identity.json` (machine keypair), `peers.json` (paired peers + pinned keys), `config.json`
(name/secret/layout/manual peers), `borderlessd.log`.
