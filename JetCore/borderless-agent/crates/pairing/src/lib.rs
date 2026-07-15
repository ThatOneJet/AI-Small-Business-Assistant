//! Peer pairing, persistent identity, and trust store.
//!
//! This crate is the **producer** of the key material the [`transport`] crate
//! consumes. It is responsible for three things:
//!
//! 1. **Persistent identity** ([`Identity`] / [`load_or_create_identity`]) — on
//!    first run it generates this machine's static X25519 / Noise keypair the
//!    same way `snow` (and therefore `transport`) expects, and persists it (plus
//!    a freshly minted [`MachineId`]) to `identity.json`. Subsequent runs load
//!    it back.
//! 2. **PSK derivation** ([`derive_psk`]) — turns the human-entered pairing
//!    secret into the fixed 32-byte pre-shared key that hardens the Noise
//!    `XXpsk3` handshake. Derivation is **deterministic**: two machines that
//!    type the same secret derive the identical PSK, which is what lets the
//!    handshake succeed.
//! 3. **Paired-peer trust store** ([`PairingStore`]) — a persisted set of peers
//!    we trust, keyed by [`MachineId`], recording each peer's static public key.
//!    Trust is established on first use but **gated by the PSK**: a peer cannot
//!    complete the Noise handshake (and therefore cannot be recorded) without
//!    holding the right secret.
//!
//! # KDF choice — Argon2id
//!
//! The PSK is derived with **Argon2id** (memory-hard) using a fixed
//! application salt and fixed parameters, rather than a fast KDF like
//! HKDF-SHA256. The input is a *human-entered* secret, which may be
//! low-entropy; Argon2id's memory/time cost makes offline brute-forcing of a
//! captured handshake meaningfully expensive, whereas HKDF would offer no such
//! resistance. Determinism (required so both machines agree) is preserved by
//! pinning the salt and the cost parameters as constants — see
//! [`derive_psk`].
//!
//! # On-disk layout
//!
//! Both files live under a per-user data directory:
//!
//! - Normally `%APPDATA%\jetcore\borderless\` (the `APPDATA` env var).
//! - Overridable via the `JETCORE_BORDERLESS_DIR` env var (used by tests so they
//!   never touch the real `%APPDATA%`).
//!
//! Files:
//! - `identity.json` — [`Identity`] (machine id + keypair).
//! - `peers.json`    — the [`PairingStore`] contents.
//!
//! [`transport`]: https://docs.rs/transport

use std::collections::BTreeMap;
use std::path::PathBuf;

use anyhow::{Context, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use protocol::MachineId;
use serde::{Deserialize, Serialize};

/// The Noise parameter string this workspace speaks. Must match
/// `transport::NOISE_PARAMS` so the keypair we generate is byte-compatible with
/// the handshake. (We deliberately re-declare the literal rather than depend on
/// `transport` — `pairing` sits *below* `transport` and must not import it.)
const NOISE_PARAMS: &str = "Noise_XXpsk3_25519_ChaChaPoly_BLAKE2s";

/// Environment variable that overrides the base data directory. When set, both
/// `identity.json` and `peers.json` live directly inside it. Primarily for
/// tests; also useful for portable installs.
pub const DATA_DIR_ENV: &str = "JETCORE_BORDERLESS_DIR";

/// File name for the persisted machine identity.
const IDENTITY_FILE: &str = "identity.json";

/// File name for the persisted paired-peers store.
const PEERS_FILE: &str = "peers.json";

// ---------------------------------------------------------------------------
// PSK derivation (Argon2id)
// ---------------------------------------------------------------------------

/// Fixed application salt for [`derive_psk`].
///
/// A static salt would normally be a smell for password *storage*, but here it
/// is required: the PSK must be reproducible across two independent machines
/// that share only the secret, so there is no per-machine random salt to store
/// or exchange. The salt domain-separates this derivation from any other use of
/// the same secret. Argon2 requires the salt be at least 8 bytes.
const PSK_SALT: &[u8] = b"jetcore-borderless::psk::v1";

/// Fixed Argon2id cost parameters (must be identical on every machine so the
/// derivation is deterministic across peers):
/// memory in KiB, iterations (time cost), parallelism (lanes).
const PSK_MEM_KIB: u32 = 64 * 1024; // 64 MiB
const PSK_ITERATIONS: u32 = 3;
const PSK_LANES: u32 = 1;

/// Derive the 32-byte Noise pre-shared key from the human-entered pairing
/// `secret`.
///
/// Deterministic: the same `secret` always yields the same PSK (so two machines
/// sharing the secret derive an identical PSK and the handshake succeeds), and
/// different secrets yield different PSKs with overwhelming probability.
///
/// Uses Argon2id with a fixed salt and fixed cost parameters (see module docs).
/// The chosen parameters are well within Argon2's valid range, so derivation
/// cannot fail for any UTF-8 secret — the `expect` below is unreachable in
/// practice and only guards a programmer error in the constants.
pub fn derive_psk(secret: &str) -> [u8; 32] {
    let params = Params::new(PSK_MEM_KIB, PSK_ITERATIONS, PSK_LANES, Some(32))
        .expect("Argon2 PSK params are valid constants");
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = [0u8; 32];
    argon2
        .hash_password_into(secret.as_bytes(), PSK_SALT, &mut out)
        .expect("Argon2id derivation with valid constants cannot fail");
    out
}

// ---------------------------------------------------------------------------
// Persistent identity
// ---------------------------------------------------------------------------

/// This machine's persistent cryptographic identity.
///
/// The keypair is an X25519 static keypair generated via `snow` so it is
/// byte-compatible with the `transport` crate's Noise handshake. Persisted to
/// `identity.json` on first run and reloaded thereafter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Identity {
    /// This machine's stable identity (minted once, persisted).
    pub machine_id: MachineId,
    /// X25519 static **private** key (32 bytes). Secret — never logged or sent.
    pub private: [u8; 32],
    /// X25519 static **public** key (32 bytes). Shared with peers during pairing.
    pub public: [u8; 32],
}

/// Compute the base data directory, honouring [`DATA_DIR_ENV`] then falling back
/// to `%APPDATA%\jetcore\borderless`.
fn data_dir() -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV) {
        return Ok(PathBuf::from(dir));
    }
    let appdata = std::env::var_os("APPDATA")
        .context("neither JETCORE_BORDERLESS_DIR nor APPDATA is set; cannot locate data dir")?;
    Ok(PathBuf::from(appdata).join("jetcore").join("borderless"))
}

/// Path to `identity.json` under the resolved data directory.
fn identity_path() -> Result<PathBuf> {
    Ok(data_dir()?.join(IDENTITY_FILE))
}

/// Path to `peers.json` under the resolved data directory.
fn peers_path() -> Result<PathBuf> {
    Ok(data_dir()?.join(PEERS_FILE))
}

/// Generate a fresh X25519 static keypair compatible with `snow` / `transport`.
fn generate_keypair() -> Result<([u8; 32], [u8; 32])> {
    let params = NOISE_PARAMS
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid noise params: {e}"))?;
    let kp = snow::Builder::new(params)
        .generate_keypair()
        .map_err(|e| anyhow::anyhow!("generate keypair: {e}"))?;
    let private: [u8; 32] = kp
        .private
        .as_slice()
        .try_into()
        .context("snow private key was not 32 bytes")?;
    let public: [u8; 32] = kp
        .public
        .as_slice()
        .try_into()
        .context("snow public key was not 32 bytes")?;
    Ok((private, public))
}

/// Mint a new random [`MachineId`] (hex-encoded 128-bit value).
fn new_machine_id() -> MachineId {
    use rand::Rng;
    let mut bytes = [0u8; 16];
    rand::rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    MachineId::new(hex)
}

/// Load this machine's persistent [`Identity`], creating and persisting a fresh
/// one on first run.
///
/// On first run: generates a `snow`-compatible static keypair and a random
/// [`MachineId`], writes them to `identity.json` (creating parent directories),
/// and returns them. On subsequent runs: reads and returns the persisted
/// identity.
pub fn load_or_create_identity() -> Result<Identity> {
    let path = identity_path()?;
    if path.exists() {
        let bytes = std::fs::read(&path)
            .with_context(|| format!("reading identity file {}", path.display()))?;
        let identity: Identity = serde_json::from_slice(&bytes)
            .with_context(|| format!("parsing identity file {}", path.display()))?;
        return Ok(identity);
    }

    let (private, public) = generate_keypair()?;
    let identity = Identity {
        machine_id: new_machine_id(),
        private,
        public,
    };

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating data dir {}", parent.display()))?;
    }
    let json = serde_json::to_vec_pretty(&identity).context("serializing identity")?;
    std::fs::write(&path, &json)
        .with_context(|| format!("writing identity file {}", path.display()))?;
    tracing::info!(machine_id = %identity.machine_id, "generated new machine identity");
    Ok(identity)
}

// ---------------------------------------------------------------------------
// Paired-peer trust store
// ---------------------------------------------------------------------------

/// Persisted set of paired (trusted) peers, keyed by [`MachineId`].
///
/// Each entry records the peer's static X25519 public key, learned during the
/// (PSK-gated) Noise handshake. Membership is what the session layer consults to
/// decide whether a connecting peer is trusted, and the stored public key lets
/// callers pin / verify the remote static key after a handshake.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PairingStore {
    /// machine id -> peer static public key (32 bytes).
    peers: BTreeMap<MachineId, [u8; 32]>,
}

impl PairingStore {
    /// Load the store from `peers.json`. A missing file yields an empty store
    /// (no peers paired yet) rather than an error.
    pub fn load() -> Result<Self> {
        let path = peers_path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let bytes = std::fs::read(&path)
            .with_context(|| format!("reading peers file {}", path.display()))?;
        let store: PairingStore = serde_json::from_slice(&bytes)
            .with_context(|| format!("parsing peers file {}", path.display()))?;
        Ok(store)
    }

    /// Record `peer` (with its static public key) as paired/trusted and persist.
    ///
    /// Idempotent: re-pairing an existing peer updates its stored public key.
    pub fn pair(&mut self, peer: MachineId, remote_public: [u8; 32]) -> Result<()> {
        self.peers.insert(peer, remote_public);
        self.save()
    }

    /// Remove `peer` from the trust store and persist. No-op if not present.
    pub fn unpair(&mut self, peer: &MachineId) -> Result<()> {
        self.peers.remove(peer);
        self.save()
    }

    /// Whether `peer` is currently paired (trusted).
    pub fn is_paired(&self, peer: &MachineId) -> bool {
        self.peers.contains_key(peer)
    }

    /// The stored static public key for `peer`, if paired.
    pub fn remote_public(&self, peer: &MachineId) -> Option<[u8; 32]> {
        self.peers.get(peer).copied()
    }

    /// Persist the store to `peers.json`, creating parent directories.
    pub fn save(&self) -> Result<()> {
        let path = peers_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("creating data dir {}", parent.display()))?;
        }
        let json = serde_json::to_vec_pretty(self).context("serializing peers store")?;
        std::fs::write(&path, &json)
            .with_context(|| format!("writing peers file {}", path.display()))?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Handshake material bridge
// ---------------------------------------------------------------------------

/// Assemble the key material for a Noise handshake as a plain tuple
/// `(local_private, psk, remote_public)`.
///
/// The core engine feeds these into `transport`'s `HandshakeKeys` struct. We
/// return a bare tuple rather than that type so `pairing` need not depend on
/// `transport` (avoiding a dependency cycle and keeping layering clean).
///
/// `remote_public` is optional because the `XX` pattern transmits the remote
/// static key during the handshake; supply it (e.g. from
/// [`PairingStore::remote_public`]) when you want to pin/verify a known peer.
pub fn handshake_material(
    id: &Identity,
    psk: [u8; 32],
    remote_public: Option<[u8; 32]>,
) -> ([u8; 32], [u8; 32], Option<[u8; 32]>) {
    (id.private, psk, remote_public)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    /// `data_dir` reads a process-global env var; serialize the tests that mutate
    /// it so they don't race.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Point the data dir at `dir` for the duration of the returned guard, then
    /// restore the previous value. Holds [`ENV_LOCK`] so concurrent tests don't
    /// clobber each other's env.
    struct EnvGuard<'a> {
        _lock: MutexGuard<'a, ()>,
        prev: Option<std::ffi::OsString>,
    }

    impl<'a> EnvGuard<'a> {
        fn set(dir: &std::path::Path) -> Self {
            let lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
            let prev = std::env::var_os(DATA_DIR_ENV);
            std::env::set_var(DATA_DIR_ENV, dir);
            Self { _lock: lock, prev }
        }
    }

    impl Drop for EnvGuard<'_> {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var(DATA_DIR_ENV, v),
                None => std::env::remove_var(DATA_DIR_ENV),
            }
        }
    }

    #[test]
    fn derive_psk_is_deterministic() {
        let a = derive_psk("correct horse battery staple");
        let b = derive_psk("correct horse battery staple");
        assert_eq!(a, b, "same secret must derive the same PSK");
    }

    #[test]
    fn derive_psk_differs_for_different_secrets() {
        let a = derive_psk("secret-one");
        let b = derive_psk("secret-two");
        assert_ne!(a, b, "different secrets must derive different PSKs");
    }

    #[test]
    fn derive_psk_is_nonzero_and_32_bytes() {
        let psk = derive_psk("anything");
        assert_eq!(psk.len(), 32);
        assert_ne!(psk, [0u8; 32], "PSK should not be all zeros");
    }

    #[test]
    fn identity_persists_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let _env = EnvGuard::set(tmp.path());

        // First call creates + persists.
        let first = load_or_create_identity().unwrap();
        assert!(tmp.path().join(IDENTITY_FILE).exists());
        // Keys must be a valid 32-byte X25519 pair (non-zero).
        assert_ne!(first.private, [0u8; 32]);
        assert_ne!(first.public, [0u8; 32]);

        // Second call loads the SAME identity back.
        let second = load_or_create_identity().unwrap();
        assert_eq!(first, second, "reloaded identity must match the persisted one");
    }

    #[test]
    fn generated_keypair_is_snow_compatible() {
        // The private key we persist must drive a snow builder without error,
        // proving byte-compatibility with the transport handshake.
        let tmp = tempfile::tempdir().unwrap();
        let _env = EnvGuard::set(tmp.path());
        let id = load_or_create_identity().unwrap();

        let params = NOISE_PARAMS.parse().unwrap();
        let psk = derive_psk("x");
        let res = snow::Builder::new(params)
            .local_private_key(&id.private)
            .and_then(|b| b.psk(3, &psk))
            .and_then(|b| b.build_initiator());
        assert!(res.is_ok(), "persisted private key must be snow-compatible: {res:?}");
    }

    #[test]
    fn pairing_store_add_remove_is_paired() {
        let tmp = tempfile::tempdir().unwrap();
        let _env = EnvGuard::set(tmp.path());

        let peer = MachineId::new("peer-aaaa");
        let pubkey = [42u8; 32];

        let mut store = PairingStore::load().unwrap();
        assert!(!store.is_paired(&peer));
        assert_eq!(store.remote_public(&peer), None);

        store.pair(peer.clone(), pubkey).unwrap();
        assert!(store.is_paired(&peer));
        assert_eq!(store.remote_public(&peer), Some(pubkey));
        assert!(tmp.path().join(PEERS_FILE).exists());

        store.unpair(&peer).unwrap();
        assert!(!store.is_paired(&peer));
        assert_eq!(store.remote_public(&peer), None);
    }

    #[test]
    fn pairing_store_persists_across_loads() {
        let tmp = tempfile::tempdir().unwrap();
        let _env = EnvGuard::set(tmp.path());

        let peer = MachineId::new("peer-bbbb");
        let pubkey = [7u8; 32];
        {
            let mut store = PairingStore::load().unwrap();
            store.pair(peer.clone(), pubkey).unwrap();
        }
        // Fresh load sees the persisted pairing.
        let reloaded = PairingStore::load().unwrap();
        assert!(reloaded.is_paired(&peer));
        assert_eq!(reloaded.remote_public(&peer), Some(pubkey));
    }

    #[test]
    fn handshake_material_returns_fields() {
        let id = Identity {
            machine_id: MachineId::new("m"),
            private: [1u8; 32],
            public: [2u8; 32],
        };
        let psk = [3u8; 32];
        let remote = Some([4u8; 32]);
        let (lp, p, rp) = handshake_material(&id, psk, remote);
        assert_eq!(lp, id.private);
        assert_eq!(p, psk);
        assert_eq!(rp, remote);
    }
}
