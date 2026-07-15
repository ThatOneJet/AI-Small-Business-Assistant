//! Encrypted peer session transport.
//!
//! Establishes a [Noise](https://noiseprotocol.org/)-encrypted TCP session
//! between two peers and ferries length-prefixed [`protocol::Message`] frames
//! (via [`protocol::encode_frame`] / [`protocol::decode_frame`]) over it.
//!
//! # Layering
//!
//! Two independent framings stack here:
//!
//! 1. **Plaintext frame** — [`protocol::encode_frame`] produces a
//!    length-prefixed `postcard` payload for a [`protocol::Message`]. That whole
//!    blob is treated as opaque plaintext by this crate.
//! 2. **Ciphertext frame** — the plaintext is encrypted with the Noise
//!    transport state and written on the wire as `[u32 BE ciphertext len][Noise
//!    ciphertext...]`. On receive we read the length prefix, read that many
//!    bytes, decrypt, then hand the recovered plaintext to
//!    [`protocol::decode_frame`].
//!
//! Because a single Noise message is capped at 65535 bytes
//! ([`NOISE_MAX_MESSAGE_LEN`]), large plaintexts are split into Noise-sized
//! chunks before encryption and reassembled after decryption. Each on-the-wire
//! ciphertext frame therefore carries one whole [`protocol::Message`]'s
//! plaintext, possibly across several internal Noise chunks.
//!
//! # Security
//!
//! The handshake uses `Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s`: mutual static-key
//! authentication (`XX`) hardened with a pre-shared key mixed in at the final
//! handshake message (`psk3`). A wrong PSK or wrong static key causes the Noise
//! `read_message` MAC check to fail, so the handshake returns `Err` and **no
//! plaintext path is ever established**.
//!
//! Key material ([`HandshakeKeys`]) is an *input* to this crate; generating,
//! persisting, and exchanging keys is the responsibility of the `pairing` crate.

use std::net::SocketAddr;

use anyhow::{anyhow, Context};
use protocol::Message;
use snow::{Builder, HandshakeState, TransportState};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// The Noise handshake + cipher suite this transport speaks.
///
/// `XX` provides mutual authentication of the static keys; `psk3` mixes the
/// pre-shared key into the third (final) handshake message so an attacker
/// without the PSK cannot complete the handshake even if they somehow obtained a
/// valid static key.
pub const NOISE_PARAMS: &str = "Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s";

/// The PSK location index for the `psk3` modifier (mixed in at handshake
/// message 3).
const PSK_LOCATION: u8 = 3;

/// Maximum size of a single Noise message (handshake or transport), per the
/// Noise spec. Plaintext payloads larger than this (minus the auth tag) are
/// split into multiple Noise messages.
pub const NOISE_MAX_MESSAGE_LEN: usize = 65535;

/// ChaChaPoly authentication tag length appended to every Noise transport
/// message.
const NOISE_TAG_LEN: usize = 16;

/// Largest plaintext we put into a single Noise transport message, leaving room
/// for the auth tag inside [`NOISE_MAX_MESSAGE_LEN`].
const MAX_CHUNK_PLAINTEXT: usize = NOISE_MAX_MESSAGE_LEN - NOISE_TAG_LEN;

/// Hard cap on an inbound ciphertext frame, mirroring
/// [`protocol::MAX_FRAME_LEN`] plus per-chunk Noise tag overhead. Bounds memory
/// when reading from an untrusted socket.
///
/// One ciphertext frame holds a [`protocol::MAX_FRAME_LEN`]-sized plaintext at
/// most, split across `ceil(MAX_FRAME_LEN / MAX_CHUNK_PLAINTEXT)` Noise chunks,
/// each adding [`NOISE_TAG_LEN`] bytes.
pub const MAX_CIPHERTEXT_FRAME_LEN: usize = {
    let chunks = protocol::MAX_FRAME_LEN.div_ceil(MAX_CHUNK_PLAINTEXT);
    protocol::MAX_FRAME_LEN + chunks * NOISE_TAG_LEN
};

/// Key material required to perform the Noise handshake.
///
/// These are **inputs** supplied by the `pairing` crate; this transport crate
/// neither generates nor persists them.
#[derive(Clone)]
pub struct HandshakeKeys {
    /// This machine's X25519 static private key (32 bytes).
    pub local_private: [u8; 32],
    /// The pre-shared key mixed into the handshake (32 bytes). Both peers must
    /// hold the same PSK or the handshake fails.
    pub psk: [u8; 32],
    /// The peer's expected X25519 static public key, if known ahead of time.
    ///
    /// With the `XX` pattern the remote static key is *transmitted* during the
    /// handshake, so it need not be supplied in advance. When provided it is
    /// ignored by the handshake itself (XX does not pin it), but callers may use
    /// [`Session::remote_static`] afterwards to verify it matches.
    pub remote_public: Option<[u8; 32]>,
}

impl std::fmt::Debug for HandshakeKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never print secret key material.
        f.debug_struct("HandshakeKeys")
            .field("local_private", &"[redacted]")
            .field("psk", &"[redacted]")
            .field("remote_public", &self.remote_public.map(|_| "[present]"))
            .finish()
    }
}

/// A live, encrypted session to a single peer.
///
/// Cheap to move; not `Clone` (the Noise transport state holds per-direction
/// nonces that must not be duplicated). Use the owned `&mut self` [`send`] /
/// [`recv`] methods; for concurrent send+recv, split the underlying stream at a
/// higher layer or wrap in an actor.
///
/// [`send`]: Session::send
/// [`recv`]: Session::recv
pub struct Session {
    stream: TcpStream,
    transport: TransportState,
    remote_static: Option<[u8; 32]>,
}

impl Session {
    /// Dial `addr` and complete the Noise handshake as the **initiator**.
    pub async fn connect(addr: SocketAddr, keys: HandshakeKeys) -> anyhow::Result<Session> {
        let stream = TcpStream::connect(addr)
            .await
            .with_context(|| format!("connecting to {addr}"))?;
        stream.set_nodelay(true).ok();
        handshake(stream, keys, Role::Initiator).await
    }

    /// Complete the Noise handshake as the **responder** over an already
    /// accepted [`TcpStream`].
    pub async fn accept(stream: TcpStream, keys: HandshakeKeys) -> anyhow::Result<Session> {
        stream.set_nodelay(true).ok();
        handshake(stream, keys, Role::Responder).await
    }

    /// The peer's negotiated X25519 static public key, if the pattern exposed
    /// one (it does for `XX`). `None` only if the handshake somehow completed
    /// without a remote static key.
    pub fn remote_static(&self) -> Option<[u8; 32]> {
        self.remote_static
    }

    /// Encrypt and send one [`protocol::Message`].
    ///
    /// The message is `postcard`-framed by [`protocol::encode_frame`], the
    /// resulting bytes are encrypted with the Noise transport state (chunked if
    /// larger than a single Noise message), and the ciphertext is written
    /// length-prefixed.
    pub async fn send(&mut self, msg: &Message) -> anyhow::Result<()> {
        let plaintext = protocol::encode_frame(msg).context("encoding protocol frame")?;
        let ciphertext = self.seal(&plaintext)?;

        let len: u32 = ciphertext
            .len()
            .try_into()
            .map_err(|_| anyhow!("ciphertext frame too large: {} bytes", ciphertext.len()))?;
        self.stream
            .write_all(&len.to_be_bytes())
            .await
            .context("writing ciphertext length prefix")?;
        self.stream
            .write_all(&ciphertext)
            .await
            .context("writing ciphertext")?;
        self.stream.flush().await.context("flushing stream")?;
        Ok(())
    }

    /// Receive and decrypt the next [`protocol::Message`].
    ///
    /// Reads one length-prefixed ciphertext frame, decrypts it (reassembling
    /// Noise chunks), and decodes the recovered plaintext with
    /// [`protocol::decode_frame`].
    pub async fn recv(&mut self) -> anyhow::Result<Message> {
        let mut len_buf = [0u8; 4];
        self.stream
            .read_exact(&mut len_buf)
            .await
            .context("reading ciphertext length prefix")?;
        let len = u32::from_be_bytes(len_buf) as usize;
        if len > MAX_CIPHERTEXT_FRAME_LEN {
            return Err(anyhow!(
                "ciphertext frame too large: {len} bytes (max {MAX_CIPHERTEXT_FRAME_LEN})"
            ));
        }

        let mut ciphertext = vec![0u8; len];
        self.stream
            .read_exact(&mut ciphertext)
            .await
            .context("reading ciphertext")?;

        let plaintext = self.open(&ciphertext)?;
        let (msg, consumed) =
            protocol::decode_frame(&plaintext).context("decoding protocol frame")?;
        if consumed != plaintext.len() {
            return Err(anyhow!(
                "decrypted frame had {} trailing bytes after one message",
                plaintext.len() - consumed
            ));
        }
        Ok(msg)
    }

    /// Encrypt a whole plaintext payload, chunked into Noise-sized messages.
    ///
    /// Layout of the returned buffer: a sequence of
    /// `[u32 BE chunk-ciphertext len][Noise chunk ciphertext]`. The outer frame
    /// length prefix (added by the caller) delimits the whole sequence; these
    /// inner prefixes delimit chunks so the receiver knows how to feed
    /// `read_message`.
    fn seal(&mut self, plaintext: &[u8]) -> anyhow::Result<Vec<u8>> {
        let mut out = Vec::with_capacity(plaintext.len() + NOISE_TAG_LEN + 4);
        // Always emit at least one chunk, even for an empty plaintext, so the
        // receiver can distinguish "empty message" from "no data".
        let chunks = plaintext.chunks(MAX_CHUNK_PLAINTEXT);
        let mut wrote_any = false;
        let mut scratch = vec![0u8; NOISE_MAX_MESSAGE_LEN];
        for chunk in chunks {
            wrote_any = true;
            let n = self
                .transport
                .write_message(chunk, &mut scratch)
                .map_err(|e| anyhow!("noise encrypt: {e}"))?;
            out.extend_from_slice(&(n as u32).to_be_bytes());
            out.extend_from_slice(&scratch[..n]);
        }
        if !wrote_any {
            let n = self
                .transport
                .write_message(&[], &mut scratch)
                .map_err(|e| anyhow!("noise encrypt (empty): {e}"))?;
            out.extend_from_slice(&(n as u32).to_be_bytes());
            out.extend_from_slice(&scratch[..n]);
        }
        Ok(out)
    }

    /// Reverse of [`seal`]: decrypt every chunk in `ciphertext` and concatenate
    /// the recovered plaintext.
    ///
    /// [`seal`]: Session::seal
    fn open(&mut self, ciphertext: &[u8]) -> anyhow::Result<Vec<u8>> {
        let mut out = Vec::with_capacity(ciphertext.len());
        let mut scratch = vec![0u8; NOISE_MAX_MESSAGE_LEN];
        let mut pos = 0usize;
        while pos < ciphertext.len() {
            if pos + 4 > ciphertext.len() {
                return Err(anyhow!("truncated chunk length prefix"));
            }
            let mut len_buf = [0u8; 4];
            len_buf.copy_from_slice(&ciphertext[pos..pos + 4]);
            pos += 4;
            let chunk_len = u32::from_be_bytes(len_buf) as usize;
            if chunk_len > NOISE_MAX_MESSAGE_LEN {
                return Err(anyhow!("chunk ciphertext too large: {chunk_len} bytes"));
            }
            if pos + chunk_len > ciphertext.len() {
                return Err(anyhow!("truncated chunk body"));
            }
            let n = self
                .transport
                .read_message(&ciphertext[pos..pos + chunk_len], &mut scratch)
                .map_err(|e| anyhow!("noise decrypt: {e}"))?;
            out.extend_from_slice(&scratch[..n]);
            pos += chunk_len;
        }
        Ok(out)
    }
}

/// Bind a [`TcpListener`] for inbound peer sessions.
///
/// Convenience wrapper; callers may equally use [`tokio::net::TcpListener`]
/// directly and feed accepted streams to [`Session::accept`]. After
/// `listener.accept().await`, pass the [`TcpStream`] to [`Session::accept`] with
/// this machine's [`HandshakeKeys`].
pub async fn listen(addr: SocketAddr) -> anyhow::Result<TcpListener> {
    TcpListener::bind(addr)
        .await
        .with_context(|| format!("binding session listener on {addr}"))
}

/// Which side of the handshake we are driving.
#[derive(Clone, Copy)]
enum Role {
    Initiator,
    Responder,
}

/// Drive the Noise `XXpsk3` handshake to completion over `stream`, then return
/// the established [`Session`].
///
/// `XX` is a three-message pattern:
/// - msg1: initiator -> responder
/// - msg2: responder -> initiator
/// - msg3: initiator -> responder
///
/// We loop on `is_my_turn` so the same code drives either role: writing when it
/// is our turn and reading otherwise, until the handshake is finished.
async fn handshake(
    mut stream: TcpStream,
    keys: HandshakeKeys,
    role: Role,
) -> anyhow::Result<Session> {
    let params = NOISE_PARAMS
        .parse()
        .map_err(|e| anyhow!("invalid noise params: {e}"))?;
    let mut builder = Builder::new(params)
        .local_private_key(&keys.local_private)
        .map_err(|e| anyhow!("set local private key: {e}"))?
        .psk(PSK_LOCATION, &keys.psk)
        .map_err(|e| anyhow!("set psk: {e}"))?;
    if let Some(remote) = keys.remote_public.as_ref() {
        builder = builder
            .remote_public_key(remote)
            .map_err(|e| anyhow!("set remote public key: {e}"))?;
    }

    let mut hs: HandshakeState = match role {
        Role::Initiator => builder
            .build_initiator()
            .map_err(|e| anyhow!("build initiator: {e}"))?,
        Role::Responder => builder
            .build_responder()
            .map_err(|e| anyhow!("build responder: {e}"))?,
    };

    let mut write_buf = vec![0u8; NOISE_MAX_MESSAGE_LEN];
    let mut read_buf = vec![0u8; NOISE_MAX_MESSAGE_LEN];

    while !hs.is_handshake_finished() {
        if hs.is_my_turn() {
            let n = hs
                .write_message(&[], &mut write_buf)
                .map_err(|e| anyhow!("handshake write: {e}"))?;
            let len: u32 = n
                .try_into()
                .map_err(|_| anyhow!("handshake message too large"))?;
            stream
                .write_all(&len.to_be_bytes())
                .await
                .context("writing handshake length prefix")?;
            stream
                .write_all(&write_buf[..n])
                .await
                .context("writing handshake message")?;
            stream.flush().await.context("flushing handshake message")?;
        } else {
            let mut len_buf = [0u8; 4];
            stream
                .read_exact(&mut len_buf)
                .await
                .context("reading handshake length prefix")?;
            let len = u32::from_be_bytes(len_buf) as usize;
            if len > NOISE_MAX_MESSAGE_LEN {
                return Err(anyhow!("handshake message too large: {len} bytes"));
            }
            stream
                .read_exact(&mut read_buf[..len])
                .await
                .context("reading handshake message")?;
            // A MAC failure here (wrong PSK / wrong static key) surfaces as an
            // Err: there is no plaintext fallback path.
            hs.read_message(&read_buf[..len], &mut write_buf)
                .map_err(|e| anyhow!("handshake read (authentication failed?): {e}"))?;
        }
    }

    let remote_static = remote_static_array(hs.get_remote_static());

    let transport = hs
        .into_transport_mode()
        .map_err(|e| anyhow!("entering transport mode: {e}"))?;

    Ok(Session {
        stream,
        transport,
        remote_static,
    })
}

/// Copy snow's `&[u8]` remote static key into a fixed `[u8; 32]` if it is the
/// expected length.
fn remote_static_array(key: Option<&[u8]>) -> Option<[u8; 32]> {
    let key = key?;
    let arr: [u8; 32] = key.try_into().ok()?;
    Some(arr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::{Hello, MachineId, PROTOCOL_VERSION};

    /// Generate a fresh X25519 static keypair via snow, returning
    /// `(private, public)` both as `[u8; 32]`.
    fn gen_static() -> ([u8; 32], [u8; 32]) {
        let params = NOISE_PARAMS.parse().unwrap();
        let kp = Builder::new(params).generate_keypair().unwrap();
        let priv_k: [u8; 32] = kp.private.as_slice().try_into().unwrap();
        let pub_k: [u8; 32] = kp.public.as_slice().try_into().unwrap();
        (priv_k, pub_k)
    }

    fn shared_psk() -> [u8; 32] {
        [7u8; 32]
    }

    /// Bring up an initiator/responder pair over loopback with a shared PSK.
    /// Returns `(initiator_session, responder_session)`.
    async fn paired_sessions(
        initiator_keys: HandshakeKeys,
        responder_keys: HandshakeKeys,
    ) -> anyhow::Result<(Session, Session)> {
        let listener = listen("127.0.0.1:0".parse().unwrap()).await?;
        let addr = listener.local_addr()?;

        let accept_task = tokio::spawn(async move {
            let (stream, _peer) = listener.accept().await?;
            Session::accept(stream, responder_keys).await
        });

        let initiator = Session::connect(addr, initiator_keys).await?;
        let responder = accept_task.await??;
        Ok((initiator, responder))
    }

    #[tokio::test]
    async fn ping_pong_hello_roundtrip() {
        let (a_priv, a_pub) = gen_static();
        let (b_priv, b_pub) = gen_static();
        let psk = shared_psk();

        let initiator_keys = HandshakeKeys {
            local_private: a_priv,
            psk,
            remote_public: Some(b_pub),
        };
        let responder_keys = HandshakeKeys {
            local_private: b_priv,
            psk,
            remote_public: Some(a_pub),
        };

        let (mut initiator, mut responder) =
            paired_sessions(initiator_keys, responder_keys).await.unwrap();

        // Each side learns the other's static public key from the XX handshake.
        assert_eq!(initiator.remote_static(), Some(b_pub));
        assert_eq!(responder.remote_static(), Some(a_pub));

        // Ping -> Pong.
        initiator.send(&Message::Ping).await.unwrap();
        assert_eq!(responder.recv().await.unwrap(), Message::Ping);
        responder.send(&Message::Pong).await.unwrap();
        assert_eq!(initiator.recv().await.unwrap(), Message::Pong);

        // Hello round-trip the other direction.
        let hello = Message::Hello(Hello {
            protocol_version: PROTOCOL_VERSION,
            machine_id: MachineId::new("box-a"),
            machine_name: "Box A".into(),
        });
        initiator.send(&hello).await.unwrap();
        assert_eq!(responder.recv().await.unwrap(), hello);
    }

    #[tokio::test]
    async fn wrong_psk_fails_handshake() {
        let (a_priv, _a_pub) = gen_static();
        let (b_priv, _b_pub) = gen_static();

        let initiator_keys = HandshakeKeys {
            local_private: a_priv,
            psk: [1u8; 32],
            remote_public: None,
        };
        let responder_keys = HandshakeKeys {
            local_private: b_priv,
            psk: [2u8; 32], // mismatched PSK
            remote_public: None,
        };

        let result = paired_sessions(initiator_keys, responder_keys).await;
        assert!(
            result.is_err(),
            "handshake with mismatched PSK must fail, got Ok"
        );
    }

    #[tokio::test]
    async fn large_clipboard_payload_roundtrip() {
        use protocol::ClipboardPayload;

        let (a_priv, a_pub) = gen_static();
        let (b_priv, b_pub) = gen_static();
        let psk = shared_psk();

        let (mut initiator, mut responder) = paired_sessions(
            HandshakeKeys {
                local_private: a_priv,
                psk,
                remote_public: Some(b_pub),
            },
            HandshakeKeys {
                local_private: b_priv,
                psk,
                remote_public: Some(a_pub),
            },
        )
        .await
        .unwrap();

        // ~300 KiB forces multi-chunk Noise encryption (chunk size ~64 KiB).
        let data = vec![0xABu8; 300 * 1024];
        let msg = Message::ClipboardData(ClipboardPayload::Bytes {
            format: "application/octet-stream".into(),
            data: data.clone(),
        });
        initiator.send(&msg).await.unwrap();
        assert_eq!(responder.recv().await.unwrap(), msg);
    }
}
