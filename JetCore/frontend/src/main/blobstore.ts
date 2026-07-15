/**
 * Decks — swappable blob store (MAIN PROCESS ONLY).
 *
 * A `BlobStore` is a dumb key → ciphertext map. It ONLY ever sees opaque
 * ciphertext strings: the encrypt→store / fetch→decrypt wrapper (vault.ts) sits
 * ABOVE this interface, so the store never touches keys or plaintext. App/sync
 * code talks to this interface — never to Supabase directly — so the backend can
 * be swapped without touching the crypto layer.
 *
 * `SupabaseBlobStore` persists blobs in the Supabase `vault` table. Row shape:
 *   vault(user_id uuid, key text, value text, updated_at timestamptz)
 *   primary key (user_id, key); RLS restricts rows to auth.uid() = user_id.
 * The authenticated user id is stamped on writes so RLS is satisfied.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { withColdStartRetry } from './supabase'

export interface BlobStore {
  /** Return the ciphertext at `key`, or null if absent. */
  get(key: string): Promise<string | null>
  /** Store ciphertext at `key` (insert or overwrite). */
  set(key: string, ciphertext: string): Promise<void>
  /** List keys beginning with `prefix`. */
  list(prefix: string): Promise<string[]>
  /** Forget `key`. */
  delete(key: string): Promise<void>
}

const TABLE = 'vault'

export class SupabaseBlobStore implements BlobStore {
  constructor(
    private readonly client: SupabaseClient,
    /** The authenticated Supabase user id; stamped on every row for RLS. */
    private readonly userId: string
  ) {}

  async get(key: string): Promise<string | null> {
    return withColdStartRetry(async () => {
      const { data, error } = await this.client
        .from(TABLE)
        .select('value')
        .eq('user_id', this.userId)
        .eq('key', key)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data?.value as string | undefined) ?? null
    })
  }

  async set(key: string, ciphertext: string): Promise<void> {
    return withColdStartRetry(async () => {
      const { error } = await this.client
        .from(TABLE)
        .upsert(
          { user_id: this.userId, key, value: ciphertext, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,key' }
        )
      if (error) throw new Error(error.message)
    })
  }

  async list(prefix: string): Promise<string[]> {
    return withColdStartRetry(async () => {
      const { data, error } = await this.client
        .from(TABLE)
        .select('key')
        .eq('user_id', this.userId)
        .like('key', `${prefix}%`)
      if (error) throw new Error(error.message)
      return (data ?? []).map((r) => r.key as string)
    })
  }

  async delete(key: string): Promise<void> {
    return withColdStartRetry(async () => {
      const { error } = await this.client
        .from(TABLE)
        .delete()
        .eq('user_id', this.userId)
        .eq('key', key)
      if (error) throw new Error(error.message)
    })
  }
}
