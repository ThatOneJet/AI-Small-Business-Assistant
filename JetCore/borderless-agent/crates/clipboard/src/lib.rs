//! Cross-machine clipboard synchronization for JetCore Borderless.
//!
//! This crate watches the **local** OS clipboard for changes (via [`arboard`])
//! and converts content to/from the frozen [`protocol::ClipboardPayload`] wire
//! type. The engine drives it in two directions:
//!
//! - **Outbound:** poll [`ClipboardSync::poll_local_change`] on an interval
//!   (see [`POLL_INTERVAL`]). It returns `Some(payload)` only when the local
//!   clipboard has genuinely changed to something new, which the engine then
//!   broadcasts to peers as [`protocol::Message::ClipboardData`].
//! - **Inbound:** when a peer's clipboard arrives, call
//!   [`ClipboardSync::apply`] to write it to the local clipboard.
//!
//! ## Feedback-loop guard
//!
//! Without care, applying a remote payload would be observed by the next local
//! poll and re-broadcast, ping-ponging forever. [`ClipboardSync`] remembers a
//! hash of the most recently *seen* content (whether it was applied from a
//! remote peer or read from a genuine local change) and suppresses re-emitting
//! identical content. See [`content_hash`] / [`DedupGuard`] for the pure logic,
//! which is unit-tested without touching a real clipboard.
//!
//! ## Threading
//!
//! `arboard`'s `Clipboard` opens the platform clipboard per operation and, on
//! Windows, the clipboard is a global object that may only be opened on one
//! thread at a time. Keep a single [`ClipboardSync`] owned by **one** dedicated
//! polling thread/task; do not share it across threads. Each operation is
//! short-lived, so a dedicated task that polls every [`POLL_INTERVAL`] and also
//! services apply requests (e.g. over a channel) is the recommended pattern.

use std::hash::{Hash, Hasher};
use std::time::Duration;

use protocol::ClipboardPayload;

/// Recommended interval between [`ClipboardSync::poll_local_change`] calls.
///
/// The OS exposes no cheap "clipboard changed" signal that is portable, so the
/// engine polls. 500ms is responsive enough for copy/paste hand-off while
/// keeping wakeups negligible.
pub const POLL_INTERVAL: Duration = Duration::from_millis(500);

/// Format tag used for raw RGBA image payloads produced/consumed by this crate.
///
/// The accompanying [`ClipboardPayload::Bytes::data`] is laid out as
/// `[width: u32 LE][height: u32 LE][rgba bytes...]` so the image can be
/// reconstructed on the receiving side (the wire type itself carries no
/// dimensions). See [`encode_rgba`] / [`decode_rgba`].
pub const IMAGE_RGBA_FORMAT: &str = "image/rgba";

/// Number of header bytes (two `u32` LE: width then height) prefixed to the raw
/// RGBA pixel data inside an [`IMAGE_RGBA_FORMAT`] payload.
const RGBA_HEADER_LEN: usize = 8;

/// Stable 64-bit content hash used to dedup clipboard payloads.
///
/// Distinguishes text from image bytes (so identical-looking byte sequences in
/// different formats never collide) and is independent of clipboard handles, so
/// it can be unit-tested directly.
pub fn content_hash(payload: &ClipboardPayload) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    match payload {
        ClipboardPayload::Text(s) => {
            0u8.hash(&mut h);
            s.hash(&mut h);
        }
        ClipboardPayload::Bytes { format, data } => {
            1u8.hash(&mut h);
            format.hash(&mut h);
            data.hash(&mut h);
        }
    }
    h.finish()
}

/// Pure feedback-loop guard: remembers the hash of the last content that was
/// either applied from a remote peer or emitted as a local change, and reports
/// whether freshly observed content is genuinely new.
///
/// Kept free of any clipboard dependency so the dedup logic is unit-testable in
/// isolation (the real clipboard is unavailable in many CI environments).
#[derive(Debug, Default, Clone)]
pub struct DedupGuard {
    last: Option<u64>,
}

impl DedupGuard {
    /// A fresh guard that has seen nothing yet.
    pub fn new() -> Self {
        Self { last: None }
    }

    /// Record `payload` as the most recently seen content without treating it as
    /// a change. Use this right after [`ClipboardSync::apply`] so the next local
    /// poll does not re-broadcast remote content.
    pub fn remember(&mut self, payload: &ClipboardPayload) {
        self.last = Some(content_hash(payload));
    }

    /// Record an already-computed hash as the most recently seen content.
    pub fn remember_hash(&mut self, hash: u64) {
        self.last = Some(hash);
    }

    /// The currently remembered content hash, if any.
    pub fn last(&self) -> Option<u64> {
        self.last
    }

    /// Observe freshly read content: returns `true` and updates the remembered
    /// hash when it differs from the last seen content; returns `false` (without
    /// changing state beyond what is already remembered) when it is identical to
    /// the last seen content and should therefore be suppressed.
    pub fn observe(&mut self, payload: &ClipboardPayload) -> bool {
        let hash = content_hash(payload);
        if self.last == Some(hash) {
            false
        } else {
            self.last = Some(hash);
            true
        }
    }
}

/// Encode raw RGBA pixels + dimensions into an [`IMAGE_RGBA_FORMAT`] payload
/// body (`[width LE][height LE][rgba...]`).
fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(RGBA_HEADER_LEN + rgba.len());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.extend_from_slice(rgba);
    out
}

/// Decode an [`IMAGE_RGBA_FORMAT`] payload body into `(width, height, rgba)`.
///
/// Returns an error if the buffer is shorter than the header or the pixel data
/// length does not match `width * height * 4`.
fn decode_rgba(data: &[u8]) -> anyhow::Result<(u32, u32, &[u8])> {
    if data.len() < RGBA_HEADER_LEN {
        anyhow::bail!(
            "image/rgba payload too short: {} bytes (need at least {})",
            data.len(),
            RGBA_HEADER_LEN
        );
    }
    let width = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let height = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
    let pixels = &data[RGBA_HEADER_LEN..];
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|p| p.checked_mul(4))
        .ok_or_else(|| anyhow::anyhow!("image/rgba dimensions overflow"))?;
    if pixels.len() != expected {
        anyhow::bail!(
            "image/rgba pixel length mismatch: have {}, expected {} ({}x{})",
            pixels.len(),
            expected,
            width,
            height
        );
    }
    Ok((width, height, pixels))
}

/// Owns a single OS clipboard handle and the feedback-loop guard.
///
/// Not `Send`/`Sync` in spirit (and on some platforms the underlying handle is
/// genuinely thread-affine) — keep it on one dedicated polling thread. See the
/// crate-level docs.
pub struct ClipboardSync {
    clipboard: arboard::Clipboard,
    guard: DedupGuard,
}

impl ClipboardSync {
    /// Open a handle to the local clipboard.
    ///
    /// # Errors
    /// Fails if the platform clipboard cannot be opened (e.g. no display server
    /// / headless CI without a clipboard).
    pub fn new() -> anyhow::Result<Self> {
        let clipboard = arboard::Clipboard::new()
            .map_err(|e| anyhow::anyhow!("failed to open clipboard: {e}"))?;
        Ok(Self {
            clipboard,
            guard: DedupGuard::new(),
        })
    }

    /// Read the current local clipboard content, prioritising text and falling
    /// back to image data (best-effort). Returns `None` when the clipboard is
    /// empty or holds no format we understand.
    ///
    /// This is the raw read with **no** dedup applied; most callers want
    /// [`ClipboardSync::poll_local_change`] instead.
    pub fn read_local(&mut self) -> anyhow::Result<Option<ClipboardPayload>> {
        match self.clipboard.get_text() {
            Ok(text) if !text.is_empty() => return Ok(Some(ClipboardPayload::Text(text))),
            // Empty text or no text available: fall through to try an image.
            Ok(_) => {}
            Err(arboard::Error::ContentNotAvailable) => {}
            Err(e) => return Err(anyhow::anyhow!("clipboard get_text failed: {e}")),
        }

        match self.clipboard.get_image() {
            Ok(img) => {
                let data = encode_rgba(img.width as u32, img.height as u32, img.bytes.as_ref());
                Ok(Some(ClipboardPayload::Bytes {
                    format: IMAGE_RGBA_FORMAT.to_string(),
                    data,
                }))
            }
            Err(arboard::Error::ContentNotAvailable) => Ok(None),
            Err(e) => Err(anyhow::anyhow!("clipboard get_image failed: {e}")),
        }
    }

    /// Poll the local clipboard for a *genuine new* change.
    ///
    /// Returns `Some(payload)` only when the current local content differs from
    /// the last content this `ClipboardSync` saw — whether that prior content
    /// was read from a previous local change or written via
    /// [`ClipboardSync::apply`]. This is what prevents an applied remote payload
    /// from being re-broadcast (the feedback-loop guard).
    ///
    /// Returns `None` when the clipboard is empty, unreadable in a known format,
    /// or unchanged since the last observation.
    pub fn poll_local_change(&mut self) -> anyhow::Result<Option<ClipboardPayload>> {
        let Some(payload) = self.read_local()? else {
            return Ok(None);
        };
        if self.guard.observe(&payload) {
            Ok(Some(payload))
        } else {
            Ok(None)
        }
    }

    /// Write a remote payload to the local clipboard, and remember it so the
    /// next [`ClipboardSync::poll_local_change`] does not re-broadcast it.
    ///
    /// # Errors
    /// Fails if the clipboard write fails or an image payload is malformed.
    pub fn apply(&mut self, payload: &ClipboardPayload) -> anyhow::Result<()> {
        match payload {
            ClipboardPayload::Text(text) => {
                self.clipboard
                    .set_text(text.clone())
                    .map_err(|e| anyhow::anyhow!("clipboard set_text failed: {e}"))?;
            }
            ClipboardPayload::Bytes { format, data } => {
                if format == IMAGE_RGBA_FORMAT {
                    let (width, height, pixels) = decode_rgba(data)?;
                    let image = arboard::ImageData {
                        width: width as usize,
                        height: height as usize,
                        bytes: std::borrow::Cow::Borrowed(pixels),
                    };
                    self.clipboard
                        .set_image(image)
                        .map_err(|e| anyhow::anyhow!("clipboard set_image failed: {e}"))?;
                } else {
                    anyhow::bail!("unsupported clipboard payload format: {format:?}");
                }
            }
        }
        // Guard AFTER a successful write so a failed apply doesn't poison dedup.
        self.guard.remember(payload);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> ClipboardPayload {
        ClipboardPayload::Text(s.to_string())
    }

    fn bytes(format: &str, data: Vec<u8>) -> ClipboardPayload {
        ClipboardPayload::Bytes {
            format: format.to_string(),
            data,
        }
    }

    #[test]
    fn hash_is_stable_and_distinguishes_content() {
        assert_eq!(content_hash(&text("abc")), content_hash(&text("abc")));
        assert_ne!(content_hash(&text("abc")), content_hash(&text("abd")));
        // Same raw bytes but different format must not collide.
        assert_ne!(
            content_hash(&bytes("image/rgba", vec![1, 2, 3])),
            content_hash(&bytes("image/png", vec![1, 2, 3]))
        );
        // Text vs bytes must not collide even if the underlying bytes match.
        assert_ne!(
            content_hash(&text("a")),
            content_hash(&bytes("text", b"a".to_vec()))
        );
    }

    #[test]
    fn guard_emits_new_content_once() {
        let mut g = DedupGuard::new();
        // First observation of anything is a change.
        assert!(g.observe(&text("hello")));
        // Same content again is suppressed.
        assert!(!g.observe(&text("hello")));
        // Different content is a change.
        assert!(g.observe(&text("world")));
        assert!(!g.observe(&text("world")));
    }

    #[test]
    fn remember_suppresses_next_observation() {
        // Simulates apply(remote) then a local poll seeing the same content.
        let mut g = DedupGuard::new();
        let remote = text("from peer");
        g.remember(&remote);
        assert_eq!(g.last(), Some(content_hash(&remote)));
        // The next poll observing identical content must NOT re-broadcast.
        assert!(!g.observe(&remote));
        // But a subsequent genuine local change still fires.
        assert!(g.observe(&text("locally typed")));
    }

    #[test]
    fn guard_toggling_back_to_previous_is_still_a_change() {
        // A -> B -> A: returning to an earlier value is a genuine new change,
        // because only the immediately-previous value is remembered.
        let mut g = DedupGuard::new();
        assert!(g.observe(&text("A")));
        assert!(g.observe(&text("B")));
        assert!(g.observe(&text("A")));
    }

    #[test]
    fn rgba_roundtrip() {
        let pixels: Vec<u8> = (0..(2 * 3 * 4)).map(|i| i as u8).collect();
        let body = encode_rgba(2, 3, &pixels);
        assert_eq!(body.len(), RGBA_HEADER_LEN + pixels.len());
        let (w, h, got) = decode_rgba(&body).unwrap();
        assert_eq!((w, h), (2, 3));
        assert_eq!(got, pixels.as_slice());
    }

    #[test]
    fn rgba_decode_rejects_short_buffer() {
        assert!(decode_rgba(&[0, 0, 0]).is_err());
    }

    #[test]
    fn rgba_decode_rejects_length_mismatch() {
        // 2x2 => expects 16 bytes of pixels; provide 4.
        let mut body = Vec::new();
        body.extend_from_slice(&2u32.to_le_bytes());
        body.extend_from_slice(&2u32.to_le_bytes());
        body.extend_from_slice(&[0u8; 4]);
        assert!(decode_rgba(&body).is_err());
    }

    // Real-clipboard round-trip. Ignored by default because CI/headless
    // environments frequently have no clipboard; run with
    // `cargo test -p clipboard -- --ignored` on a desktop session.
    #[test]
    #[ignore = "requires a real OS clipboard"]
    fn real_clipboard_text_roundtrip_and_dedup() {
        let mut sync = ClipboardSync::new().expect("open clipboard");
        let payload = text("jetcore clipboard test");
        sync.apply(&payload).expect("apply");
        // After apply, the dedup guard must suppress re-broadcast.
        assert_eq!(sync.poll_local_change().unwrap(), None);
    }
}
