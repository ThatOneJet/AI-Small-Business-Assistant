/**
 * Auto-update token — DO NOT COMMIT A REAL TOKEN.
 *
 * The JetCore repo (ThatOneJet/JetCore) is PRIVATE, so electron-updater needs a
 * token to read the release feed (latest.yml) and download the installer. Paste a
 * GitHub fine-grained PAT here LOCALLY, scoped to ONLY ThatOneJet/JetCore with
 * permission: Contents = Read-only (covers Releases read). Use a READ-ONLY token —
 * it ships inside the distributed binary and is therefore extractable. Worst case
 * if extracted: someone can read this one private repo's code/releases. NEVER put
 * the write/publish token here.
 *
 * This file is committed with an EMPTY placeholder and marked `skip-worktree`
 * (`git update-index --skip-worktree src/main/update-token.ts`) so your local
 * token edit is never staged/committed. The token is baked into the binary you
 * build + distribute; the public source stays clean. You can also override at
 * build time with the JETCORE_UPDATE_TOKEN env var (takes precedence).
 *
 * Client-side secrets are never truly private — this only bounds the blast radius.
 */
export const UPDATE_TOKEN = ''

/** The private repo that serves releases (owner/repo). */
export const UPDATE_OWNER = 'ThatOneJet'
export const UPDATE_REPO = 'JetCore'
