/**
 * Decks — end-to-end-encryption primitives (MAIN PROCESS ONLY).
 *
 * SECURITY BOUNDARY: nothing in this file (the password, the Argon2id-derived
 * key, the data key, or any plaintext) ever crosses IPC to the renderer or is
 * sent to Supabase. This module only ever runs in the Electron main process.
 *
 * Crypto stack (chosen to avoid native build pain in Electron):
 *  - KDF: Argon2id from @noble/hashes (pure JS, no native module).
 *  - AEAD: AES-256-GCM from Node's built-in `crypto` (OpenSSL).
 *
 * NEVER log: the password, any derived key, the data key, or plaintext.
 */
// @noble/hashes v2 exports the Argon2 family under the `argon2.js` subpath.
// Pure JS — no native addon, so it ships cleanly inside an Electron bundle.
import { argon2id } from '@noble/hashes/argon2.js'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * Argon2id KDF parameters. Sane INTERACTIVE params (login-time, single device):
 *  - m = 65536 KiB  → 64 MiB memory cost (RFC 9106's recommended memory floor).
 *  - t = 3          → 3 iterations (time cost).
 *  - p = 1          → single lane (no parallelism; predictable across machines).
 * These are fixed so the SAME password + SAME salt derive the SAME 32-byte key
 * on every device (the salt is stored non-secret in the keyring, see vault.ts).
 */
const ARGON2_MEMORY_KIB = 65536 // 64 MiB
const ARGON2_TIME = 3
const ARGON2_PARALLELISM = 1

/** All keys in this module are 256-bit (AES-256 + a 256-bit DEK/recovery key). */
export const KEY_LEN = 32
/** GCM nonce length. 96 bits is the standard/optimal IV size for AES-GCM. */
const IV_LEN = 12
/** GCM authentication tag length (128 bits — full strength). */
const TAG_LEN = 16
/** Per-account KDF salt length. Non-secret; random per account. */
export const SALT_LEN = 16

/**
 * Derive a 32-byte key from the master password + a per-account salt via
 * Argon2id. The password is used ONLY here (and as the Supabase auth credential
 * elsewhere); the derived key NEVER leaves main. Returns raw key bytes.
 */
export function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  return argon2id(password, salt, {
    m: ARGON2_MEMORY_KIB,
    t: ARGON2_TIME,
    p: ARGON2_PARALLELISM,
    dkLen: KEY_LEN
  })
}

/** A cryptographically-random N-byte buffer (CSPRNG). */
export function randomKey(len: number = KEY_LEN): Buffer {
  return randomBytes(len)
}

/** A fresh random per-account KDF salt (non-secret). */
export function randomSalt(): Buffer {
  return randomBytes(SALT_LEN)
}

/**
 * Encrypt `plaintext` under `key` with AES-256-GCM.
 *
 * A FRESH RANDOM 12-byte IV (nonce) is generated for EVERY call. Reusing a
 * nonce with the same key catastrophically breaks GCM (it leaks the auth key
 * and XOR of plaintexts) — this is the #1 GCM footgun, so we NEVER derive or
 * reuse the nonce; it is always crypto.randomBytes(12) right here.
 *
 * Output layout: base64( iv || authTag || ciphertext ).
 */
export function encrypt(plaintext: string | Buffer, key: Uint8Array): string {
  if (key.length !== KEY_LEN) throw new Error('encrypt: key must be 32 bytes')
  // FRESH RANDOM NONCE PER ENCRYPTION — never reuse with the same key.
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const pt = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext
  const ciphertext = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag() // 16-byte GCM tag
  return Buffer.concat([iv, tag, ciphertext]).toString('base64')
}

/**
 * Decrypt a base64( iv || authTag || ciphertext ) blob under `key`.
 * GCM verifies the auth tag; if the key is wrong or the blob was tampered with,
 * `final()` throws — we let it throw LOUDLY (no silent fallback). Returns the
 * UTF-8 plaintext string.
 */
export function decrypt(blobB64: string, key: Uint8Array): string {
  if (key.length !== KEY_LEN) throw new Error('decrypt: key must be 32 bytes')
  const blob = Buffer.from(blobB64, 'base64')
  if (blob.length < IV_LEN + TAG_LEN) throw new Error('decrypt: blob too short')
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag) // GCM verifies this on final()
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Wrap (encrypt) a raw key (the DEK) under a wrapping key. Same AEAD as data
 * blobs — a fresh nonce, authenticated. Returns base64(iv||tag||wrappedKey).
 */
export function wrapKey(rawKey: Uint8Array, wrappingKey: Uint8Array): string {
  return encrypt(Buffer.from(rawKey), wrappingKey)
}

/**
 * Unwrap (decrypt) a wrapped key back to raw key bytes. Throws if the wrapping
 * key is wrong (GCM tag mismatch) — i.e. wrong password / wrong recovery key.
 */
export function unwrapKey(wrappedB64: string, wrappingKey: Uint8Array): Buffer {
  const blob = Buffer.from(wrappedB64, 'base64')
  if (blob.length < IV_LEN + TAG_LEN) throw new Error('unwrapKey: blob too short')
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/** base64 helpers for storing the non-secret salt in the keyring blob. */
export function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}
export function fromB64(b64: string): Buffer {
  return Buffer.from(b64, 'base64')
}

/**
 * Format a 32-byte recovery key as grouped, human-transcribable hex shown ONCE
 * at setup: 8 groups of 8 hex chars (e.g. `A1B2C3D4-...`). The user stores this
 * offline; it can later unwrap the DEK if the password is forgotten.
 */
export function formatRecoveryKey(raw: Uint8Array): string {
  const hex = Buffer.from(raw).toString('hex').toUpperCase()
  return (hex.match(/.{1,8}/g) ?? []).join('-')
}

/** Parse a grouped/spaced recovery-key string back into 32 raw bytes. */
export function parseRecoveryKey(formatted: string): Buffer {
  const hex = formatted.replace(/[^0-9a-fA-F]/g, '')
  if (hex.length !== KEY_LEN * 2) throw new Error('Recovery key must be 64 hex characters.')
  return Buffer.from(hex, 'hex')
}
