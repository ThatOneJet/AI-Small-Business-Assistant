/**
 * JetCore — DevBay repo browser. The repo-detail view that lives INSIDE
 * DevBayScreen (portfolio ⇄ browser, via a view-state switch with a back button).
 *
 * Everything here goes through window.decks.devbay.api — the authenticated GitHub
 * proxy in main (the token never reaches the renderer). We:
 *  - build a nested folder tree from GET …/git/trees/:branch?recursive=1 (falling
 *    back to lazy per-directory GET …/contents/:dir when GitHub truncates),
 *  - read a blob with raw:true and show it in a line-numbered, monospace viewer
 *    (with a tiny dependency-free Markdown renderer for .md files),
 *  - list branches (re-roots the tree) and recent commits.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode
} from 'react'
import type { DevBayApiResult, DevBayRepo } from '@shared/ipc'
import { Badge, Button, Card, Skeleton, Spinner } from '../../ui'
import { Reveal } from '../../motion'
import { Icon } from '../../icons'
import { tokenizeLines, TOK_COLOR } from './highlight'

/* ── typed GitHub responses (cast `data` once, no scattered any) ──────── */

interface GitTreeEntry {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
  url?: string
}
interface GitTreeResponse {
  sha: string
  url: string
  tree: GitTreeEntry[]
  truncated: boolean
}
/** A single entry from GET /repos/:o/:n/contents/:dir (directory listing). */
interface ContentsEntry {
  name: string
  path: string
  sha: string
  size: number
  type: 'file' | 'dir' | 'symlink' | 'submodule'
  html_url: string | null
  download_url: string | null
}
/** GET /repos/:o/:n/contents/:path on a single file (metadata, no raw text). */
interface ContentFileMeta {
  name: string
  path: string
  sha: string
  size: number
  type: 'file'
  html_url: string | null
  download_url: string | null
}
interface GitHubBranch {
  name: string
  commit: { sha: string }
  protected: boolean
}
interface GitHubCommitListItem {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; email: string; date: string } | null
  }
  author: { login: string; avatar_url: string } | null
}
interface GitHubRepoDetail {
  description: string | null
  default_branch: string
  language: string | null
  stargazers_count: number
  open_issues_count: number
  pushed_at: string
  html_url: string
  size: number
}

/* ── nested tree model built from the flat path list ─────────────────── */

interface TreeNode {
  name: string
  path: string
  type: 'blob' | 'tree'
  sha: string
  size?: number
  children?: TreeNode[]
  /** Lazily-loaded folders (truncated-repo fallback) start unloaded. */
  loaded?: boolean
}

/** Build a nested tree from GitHub's flat recursive path list. */
function buildTree(entries: GitTreeEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'tree', sha: '', children: [], loaded: true }
  const dirMap = new Map<string, TreeNode>()
  dirMap.set('', root)

  const ensureDir = (path: string): TreeNode => {
    const existing = dirMap.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const parentPath = slash === -1 ? '' : path.slice(0, slash)
    const name = slash === -1 ? path : path.slice(slash + 1)
    const parent = ensureDir(parentPath)
    const node: TreeNode = { name, path, type: 'tree', sha: '', children: [], loaded: true }
    parent.children = parent.children ?? []
    parent.children.push(node)
    dirMap.set(path, node)
    return node
  }

  for (const e of entries) {
    if (e.type === 'commit') continue // submodule — skip
    const slash = e.path.lastIndexOf('/')
    const parentPath = slash === -1 ? '' : e.path.slice(0, slash)
    const name = slash === -1 ? e.path : e.path.slice(slash + 1)
    if (e.type === 'tree') {
      const node = ensureDir(e.path)
      node.sha = e.sha
    } else {
      const parent = ensureDir(parentPath)
      parent.children = parent.children ?? []
      parent.children.push({ name, path: e.path, type: 'blob', sha: e.sha, size: e.size })
    }
  }
  sortTree(root)
  return root.children ?? []
}

/** Folders first, then files; each alphabetical (case-insensitive). */
function sortTree(node: TreeNode): void {
  if (!node.children) return
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const c of node.children) sortTree(c)
}

/* ── language → dot color (kept local so the browser is self-contained) ── */

const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
  Java: '#b07219',
  Swift: '#F05138',
  'C++': '#f34b7d',
  C: '#555555',
  Ruby: '#701516',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Kotlin: '#A97BFF'
}
const langColor = (lang: string | null): string => (lang ? LANG_COLORS[lang] ?? '#888888' : '#888888')

/* ── helpers ─────────────────────────────────────────────────────────── */

const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const fmtAgo = (iso: string): string => {
  const d = (Date.now() - new Date(iso).getTime()) / 86400000
  if (d < 1) return 'today'
  if (d < 30) return `${Math.round(d)}d ago`
  if (d < 365) return `${Math.round(d / 30)}mo ago`
  return `${Math.round(d / 365)}y ago`
}

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sass', 'less', 'html', 'htm',
  'xml', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'sql',
  'graphql', 'gql', 'vue', 'svelte', 'astro', 'lua', 'r', 'pl', 'dart', 'ex', 'exs', 'erl', 'clj', 'scala',
  'gradle', 'properties', 'gitignore', 'dockerignore', 'editorconfig', 'lock', 'log', 'csv', 'tsv', 'svg',
  'm', 'mm', 'makefile', 'cmake', 'vim', 'el', 'tf', 'hcl', 'proto', 'nix'
])
const NO_EXT_TEXT = new Set(['dockerfile', 'makefile', 'license', 'readme', 'changelog', 'authors', 'gitignore'])

const ext = (path: string): string => {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
}
const isMarkdown = (path: string): boolean => ['md', 'markdown'].includes(ext(path))
const looksTextual = (path: string): boolean => {
  const e = ext(path)
  if (e) return TEXT_EXT.has(e)
  return NO_EXT_TEXT.has(path.slice(path.lastIndexOf('/') + 1).toLowerCase())
}
/** Files larger than this we don't auto-load (offer "Open on GitHub" instead). */
const MAX_VIEW_BYTES = 600 * 1024

const fileIcon = (path: string): string => {
  if (isMarkdown(path)) return 'book'
  const e = ext(path)
  if (e === 'json' || e === 'yml' || e === 'yaml' || e === 'toml') return 'sliders'
  if (e === 'lock') return 'lock'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(e)) return 'eye'
  return 'repo'
}

/* ── a single API call, narrowed ─────────────────────────────────────── */

async function ghJson<T>(path: string): Promise<{ data: T; res: DevBayApiResult }> {
  const res = await window.decks.devbay.api({ path })
  if (!res.ok) throw new Error(res.error ?? `GitHub returned ${res.status}.`)
  return { data: res.data as T, res }
}

/* ── tiny dependency-free Markdown → JSX renderer ────────────────────── */

/** Inline emphasis (bold / italic), inline code, and links. Escapes nothing
 *  beyond what React already does (text nodes are safe by default). */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // Order matters: code first (so we don't format inside it), then links, then emphasis.
  const re =
    /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('`')) {
      out.push(
        <code
          key={key}
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.88em',
            padding: '1px 6px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)'
          }}
        >
          {tok.slice(1, -1)}
        </code>
      )
    } else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)
      if (mm) {
        out.push(
          <a
            key={key}
            onClick={() => window.open(mm[2], '_blank')}
            style={{ color: 'var(--accent-h)', fontWeight: 600, cursor: 'pointer' }}
          >
            {mm[1]}
          </a>
        )
      } else out.push(tok)
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      out.push(
        <strong key={key} style={{ fontWeight: 700, color: 'var(--text)' }}>
          {tok.slice(2, -2)}
        </strong>
      )
    } else {
      out.push(
        <em key={key} style={{ fontStyle: 'italic' }}>
          {tok.slice(1, -1)}
        </em>
      )
    }
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Markdown({ source }: { source: string }): JSX.Element {
  const blocks: JSX.Element[] = []
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  let key = 0
  const nk = (): string => `md-${key++}`

  while (i < lines.length) {
    const line = lines[i]

    // fenced code block ```lang … ```
    if (/^\s*```/.test(line)) {
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i])
        i++
      }
      i++ // closing fence
      blocks.push(
        <pre
          key={nk()}
          style={{
            margin: '14px 0',
            padding: 14,
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            overflowX: 'auto',
            fontFamily: 'var(--mono)',
            fontSize: 12.5,
            lineHeight: 1.6,
            color: 'var(--text-2)'
          }}
        >
          {code.join('\n')}
        </pre>
      )
      continue
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length
      const sizes = [26, 22, 18.5, 16, 14.5, 13.5]
      blocks.push(
        <div
          key={nk()}
          style={{
            fontSize: sizes[level - 1],
            fontWeight: level <= 2 ? 800 : 700,
            letterSpacing: '-0.02em',
            color: 'var(--text)',
            margin: blocks.length ? '22px 0 10px' : '0 0 10px',
            paddingBottom: level <= 2 ? 8 : 0,
            borderBottom: level <= 2 ? '1px solid var(--border)' : 'none'
          }}
        >
          {renderInline(h[2], nk())}
        </div>
      )
      i++
      continue
    }

    // horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<div key={nk()} style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />)
      i++
      continue
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push(
        <blockquote
          key={nk()}
          style={{
            margin: '14px 0',
            padding: '6px 16px',
            borderLeft: '3px solid var(--accent-line)',
            color: 'var(--text-3)',
            fontSize: 14,
            lineHeight: 1.65
          }}
        >
          {renderInline(quote.join(' '), nk())}
        </blockquote>
      )
      continue
    }

    // list (unordered or ordered) — flat, with simple nesting indent
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const items: { text: string; ordered: boolean; indent: number }[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const mm = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i])
        if (mm) items.push({ text: mm[3], ordered: /\d/.test(mm[2]), indent: Math.floor(mm[1].length / 2) })
        i++
      }
      const ordered = items[0]?.ordered ?? false
      blocks.push(
        ordered ? (
          <ol key={nk()} style={{ margin: '10px 0', paddingLeft: 24, fontSize: 14, lineHeight: 1.7, color: 'var(--text-2)' }}>
            {items.map((it, idx) => (
              <li key={idx} style={{ marginLeft: it.indent * 16 }}>
                {renderInline(it.text, `${nk()}-${idx}`)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={nk()} style={{ margin: '10px 0', paddingLeft: 24, fontSize: 14, lineHeight: 1.7, color: 'var(--text-2)' }}>
            {items.map((it, idx) => (
              <li key={idx} style={{ marginLeft: it.indent * 16 }}>
                {renderInline(it.text, `${nk()}-${idx}`)}
              </li>
            ))}
          </ul>
        )
      )
      continue
    }

    // blank line
    if (/^\s*$/.test(line)) {
      i++
      continue
    }

    // paragraph (gather consecutive non-blank, non-special lines)
    const para: string[] = []
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^\s*```/.test(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push(
      <p key={nk()} style={{ margin: '10px 0', fontSize: 14, lineHeight: 1.7, color: 'var(--text-2)' }}>
        {renderInline(para.join(' '), nk())}
      </p>
    )
  }

  return <div>{blocks}</div>
}

/* ── file tree (recursive rows; lazy folders on truncated repos) ─────── */

interface TreeRowProps {
  node: TreeNode
  depth: number
  selectedPath: string | null
  expanded: Set<string>
  loadingDir: string | null
  onToggle: (node: TreeNode) => void
  onOpenFile: (node: TreeNode) => void
}

function TreeRow({
  node,
  depth,
  selectedPath,
  expanded,
  loadingDir,
  onToggle,
  onOpenFile
}: TreeRowProps): JSX.Element {
  const isDir = node.type === 'tree'
  const open = expanded.has(node.path)
  const selected = selectedPath === node.path
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    width: '100%',
    padding: '5px 10px',
    paddingLeft: 10 + depth * 15,
    borderRadius: 'var(--r-sm)',
    fontSize: 13,
    textAlign: 'left',
    color: selected ? 'var(--accent-h)' : isDir ? 'var(--text-2)' : 'var(--text-3)',
    background: selected ? 'var(--accent-soft)' : 'transparent',
    fontWeight: selected ? 600 : isDir ? 600 : 500
  }
  return (
    <>
      <button
        className="tap jc-tree-row"
        style={rowStyle}
        onClick={() => (isDir ? onToggle(node) : onOpenFile(node))}
      >
        {isDir ? (
          loadingDir === node.path ? (
            <Spinner size={13} />
          ) : (
            <Icon name="chevR" size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .18s var(--ease)', color: 'var(--text-3)' }} />
          )
        ) : (
          <span style={{ width: 13, flex: '0 0 auto' }} />
        )}
        <Icon
          name={isDir ? (open ? 'book' : 'repo') : fileIcon(node.path)}
          size={14}
          style={{ color: isDir ? 'var(--accent-h)' : 'var(--text-3)', flex: '0 0 auto' }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </button>
      {isDir && open && node.children && (
        <div>
          {node.children.length === 0 && node.loaded ? (
            <div style={{ paddingLeft: 10 + (depth + 1) * 15 + 20, fontSize: 12, color: 'var(--text-3)', padding: '4px 10px' }}>
              empty
            </div>
          ) : (
            node.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                selectedPath={selectedPath}
                expanded={expanded}
                loadingDir={loadingDir}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}

/* ── file viewer (line-numbered code / markdown / binary fallback) ───── */

interface ViewerState {
  loading: boolean
  text: string | null
  meta: ContentFileMeta | null
  error: string | null
  /** True for files we won't auto-load (too big or non-text). */
  unsupported: boolean
}

function FileViewer({
  path,
  state,
  defaultBranch
}: {
  path: string
  state: ViewerState
  defaultBranch: string
}): JSX.Element {
  void defaultBranch
  const [copied, setCopied] = useState(false)

  const copyPath = useCallback((): void => {
    void navigator.clipboard?.writeText(path).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      },
      () => undefined
    )
  }, [path])

  const lines = useMemo(() => (state.text == null ? [] : state.text.replace(/\n$/, '').split('\n')), [state.text])
  // Syntax-highlighted tokens per line (null = markdown, too big, or no text → render plain).
  const tokLines = useMemo(
    () => (state.text == null || isMarkdown(path) ? null : tokenizeLines(state.text.replace(/\n$/, ''), ext(path))),
    [state.text, path]
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {/* breadcrumb + actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
          borderTopLeftRadius: 'var(--r-lg)',
          borderTopRightRadius: 'var(--r-lg)',
          flexWrap: 'wrap'
        }}
      >
        <Icon name={fileIcon(path)} size={15} style={{ color: 'var(--accent-h)', flex: '0 0 auto' }} />
        <span
          className="mono"
          style={{ fontSize: 12.5, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 80 }}
          title={path}
        >
          {path.split('/').map((seg, i, arr) => (
            <span key={i}>
              <span style={{ color: i === arr.length - 1 ? 'var(--text)' : 'var(--text-3)' }}>{seg}</span>
              {i < arr.length - 1 && <span style={{ color: 'var(--text-3)', margin: '0 2px' }}>/</span>}
            </span>
          ))}
        </span>
        {state.meta && (
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-3)', flex: '0 0 auto' }}>
            {fmtBytes(state.meta.size)}
            {lines.length ? ` · ${lines.length} lines` : ''}
          </span>
        )}
        <button
          className="tap jc-iconbtn"
          onClick={copyPath}
          aria-label="Copy path"
          style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 'var(--r-sm)', color: copied ? 'var(--pos)' : 'var(--text-3)' }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={15} />
        </button>
        {state.meta?.html_url && (
          <button
            className="tap jc-iconbtn"
            onClick={() => state.meta?.html_url && window.open(state.meta.html_url, '_blank')}
            aria-label="Open on GitHub"
            style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 'var(--r-sm)', color: 'var(--text-3)' }}
          >
            <Icon name="external" size={15} />
          </button>
        )}
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {state.loading ? (
          <div style={{ padding: 18 }}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} w={`${50 + ((i * 37) % 45)}%`} h={12} style={{ marginBottom: 10 }} />
            ))}
          </div>
        ) : state.error ? (
          <div style={{ padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--text-3)' }}>
            <Icon name="alert" size={24} style={{ color: 'var(--neg)' }} />
            <span style={{ fontSize: 13.5 }}>{state.error}</span>
          </div>
        ) : state.unsupported ? (
          <div style={{ padding: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 'var(--r-md)', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--text-3)' }}>
              <Icon name="eye" size={26} />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>Can&rsquo;t preview this file</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', maxWidth: 320, lineHeight: 1.5 }}>
              {state.meta ? `${fmtBytes(state.meta.size)} — ` : ''}
              it&rsquo;s binary or too large to show inline.
            </div>
            {state.meta?.html_url && (
              <Button variant="surface" size="sm" iconRight="external" onClick={() => state.meta?.html_url && window.open(state.meta.html_url, '_blank')}>
                Open on GitHub
              </Button>
            )}
          </div>
        ) : isMarkdown(path) && state.text != null ? (
          <div style={{ padding: '24px 28px', maxWidth: 860 }}>
            <Markdown source={state.text} />
          </div>
        ) : (
          <div style={{ display: 'flex', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.65 }}>
            <div
              aria-hidden
              style={{
                flex: '0 0 auto',
                textAlign: 'right',
                padding: '14px 12px 14px 16px',
                color: 'var(--text-3)',
                userSelect: 'none',
                background: 'var(--surface-2)',
                borderRight: '1px solid var(--border)'
              }}
            >
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <pre
              style={{
                margin: 0,
                padding: '14px 18px',
                color: 'var(--code-plain)',
                whiteSpace: 'pre',
                overflowX: 'auto',
                flex: 1,
                tabSize: 2
              }}
            >
              {tokLines
                ? tokLines.map((toks, i) => (
                    <div key={i} style={{ minHeight: '1.65em' }}>
                      {toks.length
                        ? toks.map((tk, j) => (
                            <span key={j} style={{ color: TOK_COLOR[tk.t] }}>
                              {tk.v}
                            </span>
                          ))
                        : ' '}
                    </div>
                  ))
                : lines.map((l, i) => (
                    <div key={i} style={{ minHeight: '1.65em' }}>
                      {l || ' '}
                    </div>
                  ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── commits tab ─────────────────────────────────────────────────────── */

function CommitsTab({ commits, loading }: { commits: GitHubCommitListItem[]; loading: boolean }): JSX.Element {
  if (loading) {
    return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <Skeleton w={34} h={34} r={99} />
            <div style={{ flex: 1 }}>
              <Skeleton w="55%" h={13} />
              <Skeleton w="30%" h={11} style={{ marginTop: 8 }} />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (commits.length === 0)
    return (
      <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-3)', fontSize: 13.5 }}>No commits found.</div>
    )
  return (
    <div style={{ padding: 8, overflow: 'auto', height: '100%' }}>
      {commits.map((c) => {
        const title = c.commit.message.split('\n')[0]
        const when = c.commit.author?.date
        return (
          <button
            key={c.sha}
            className="tap jc-tree-row"
            onClick={() => window.open(c.html_url, '_blank')}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              width: '100%',
              textAlign: 'left',
              padding: '11px 12px',
              borderRadius: 'var(--r-md)'
            }}
          >
            {c.author?.avatar_url ? (
              <img src={c.author.avatar_url} alt="" style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', flex: '0 0 auto' }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', color: 'var(--text-3)', flex: '0 0 auto' }}>
                <Icon name="user" size={16} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>{c.commit.author?.name ?? c.author?.login ?? 'unknown'}</span>
                {when && <span>· {fmtAgo(when)}</span>}
                <span className="mono" style={{ color: 'var(--text-3)' }}>· {c.sha.slice(0, 7)}</span>
              </div>
            </div>
            <Icon name="external" size={14} style={{ color: 'var(--text-3)', flex: '0 0 auto', marginTop: 3 }} />
          </button>
        )
      })}
    </div>
  )
}

/* ── branch picker ───────────────────────────────────────────────────── */

function BranchPicker({
  branches,
  current,
  onPick
}: {
  branches: GitHubBranch[]
  current: string
  onPick: (name: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])
  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        className="tap"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 12px',
          borderRadius: 'var(--r-sm)',
          fontSize: 12.5,
          fontWeight: 600,
          background: 'var(--surface-2)',
          color: 'var(--text-2)',
          border: '1px solid var(--border)'
        }}
      >
        <Icon name="branch" size={14} style={{ color: 'var(--accent-h)' }} />
        <span className="mono">{current}</span>
        <Icon name="chevD" size={13} style={{ color: 'var(--text-3)' }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            zIndex: 40,
            minWidth: 220,
            maxHeight: 320,
            overflow: 'auto',
            padding: 6,
            borderRadius: 'var(--r-md)',
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            boxShadow: '0 12px 36px -12px hsl(var(--shadow-c) / .5)'
          }}
        >
          {branches.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--text-3)' }}>No branches.</div>
          )}
          {branches.map((b) => {
            const on = b.name === current
            return (
              <button
                key={b.name}
                className="tap jc-tree-row"
                onClick={() => {
                  setOpen(false)
                  if (!on) onPick(b.name)
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  padding: '7px 10px',
                  borderRadius: 'var(--r-sm)',
                  fontSize: 12.5,
                  fontWeight: on ? 700 : 500,
                  color: on ? 'var(--accent-h)' : 'var(--text-2)'
                }}
              >
                <Icon name={on ? 'check' : 'branch'} size={14} style={{ color: on ? 'var(--accent-h)' : 'var(--text-3)' }} />
                <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </span>
                {b.protected && <Badge size="sm" tone="neutral" style={{ marginLeft: 'auto' }}>protected</Badge>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── the repo browser ────────────────────────────────────────────────── */

type Tab = 'files' | 'commits'

export function DevBayRepoBrowser({ repo, onBack }: { repo: DevBayRepo; onBack: () => void }): JSX.Element {
  const [owner, name] = useMemo(() => repo.fullName.split('/'), [repo.fullName])

  // repo header detail (lazy-enriched on top of the portfolio data we already have)
  const [detail, setDetail] = useState<GitHubRepoDetail | null>(null)

  // branch + tree
  const [branch, setBranch] = useState(repo.defaultBranch)
  const [branches, setBranches] = useState<GitHubBranch[]>([])
  const [tree, setTree] = useState<TreeNode[]>([])
  const [truncated, setTruncated] = useState(false)
  const [treeLoading, setTreeLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [emptyRepo, setEmptyRepo] = useState(false)

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadingDir, setLoadingDir] = useState<string | null>(null)

  // tabs + viewer + commits
  const [tab, setTab] = useState<Tab>('files')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [commits, setCommits] = useState<GitHubCommitListItem[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)
  const [commitsLoaded, setCommitsLoaded] = useState(false)

  /* enrich header + load branches once */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { data } = await ghJson<GitHubRepoDetail>(`/repos/${owner}/${name}`)
        if (alive) setDetail(data)
      } catch {
        /* keep the portfolio data we already have */
      }
    })()
    void (async () => {
      try {
        const { data } = await ghJson<GitHubBranch[]>(`/repos/${owner}/${name}/branches?per_page=100`)
        if (alive) setBranches(data)
      } catch {
        if (alive) setBranches([])
      }
    })()
    return () => {
      alive = false
    }
  }, [owner, name])

  /* load the (recursive) tree whenever the branch changes */
  const loadTree = useCallback(
    async (br: string): Promise<void> => {
      setTreeLoading(true)
      setTreeError(null)
      setEmptyRepo(false)
      setTruncated(false)
      setExpanded(new Set())
      try {
        const { data } = await ghJson<GitTreeResponse>(
          `/repos/${owner}/${name}/git/trees/${encodeURIComponent(br)}?recursive=1`
        )
        if (!data.tree || data.tree.length === 0) {
          setTree([])
          setEmptyRepo(true)
        } else if (data.truncated) {
          // Huge repo: fall back to a lazy, root-only tree (folders fetched on expand).
          setTruncated(true)
          await loadDirShallow('', br, true)
        } else {
          setTree(buildTree(data.tree))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not load the file tree.'
        // A brand-new repo with no commits returns 404/409 on the tree.
        if (/40[49]/.test(msg) || /empty/i.test(msg)) {
          setTree([])
          setEmptyRepo(true)
        } else setTreeError(msg)
      }
      setTreeLoading(false)
    },
    // loadDirShallow is stable for the current owner/name; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [owner, name]
  )

  /** Truncated-repo fallback: list one directory and merge it into the tree. */
  const loadDirShallow = useCallback(
    async (dir: string, br: string, isRoot = false): Promise<TreeNode[]> => {
      const path = dir
        ? `/repos/${owner}/${name}/contents/${encodeURIComponent(dir).replace(/%2F/g, '/')}?ref=${encodeURIComponent(br)}`
        : `/repos/${owner}/${name}/contents?ref=${encodeURIComponent(br)}`
      const { data } = await ghJson<ContentsEntry[]>(path)
      const nodes: TreeNode[] = data
        .filter((e) => e.type === 'dir' || e.type === 'file')
        .map(
          (e): TreeNode => ({
            name: e.name,
            path: e.path,
            type: e.type === 'dir' ? 'tree' : 'blob',
            sha: e.sha,
            size: e.size,
            children: e.type === 'dir' ? [] : undefined,
            loaded: e.type === 'dir' ? false : undefined
          })
        )
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })
      if (isRoot) setTree(nodes)
      return nodes
    },
    [owner, name]
  )

  useEffect(() => {
    void loadTree(branch)
  }, [branch, loadTree])

  /* expand/collapse a folder (lazy-fetch children on truncated repos) */
  const toggleDir = useCallback(
    (node: TreeNode): void => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(node.path)) {
          next.delete(node.path)
          return next
        }
        next.add(node.path)
        // Lazy load for truncated repos (children present but not loaded).
        if (truncated && node.loaded === false) {
          setLoadingDir(node.path)
          void loadDirShallow(node.path, branch)
            .then((kids) => {
              setTree((roots) => attachChildren(roots, node.path, kids))
            })
            .catch(() => {
              setTree((roots) => attachChildren(roots, node.path, []))
            })
            .finally(() => setLoadingDir(null))
        }
        return next
      })
    },
    [truncated, branch, loadDirShallow]
  )

  /* open a file → read raw text (with size/type guards) */
  const openFile = useCallback(
    (node: TreeNode): void => {
      setSelectedPath(node.path)
      setTab('files')
      const size = node.size ?? 0
      const textual = looksTextual(node.path)
      if (!textual || size > MAX_VIEW_BYTES) {
        // Fetch metadata so we can show size + a real Open-on-GitHub link.
        setViewer({ loading: true, text: null, meta: null, error: null, unsupported: false })
        void (async () => {
          try {
            const { data } = await ghJson<ContentFileMeta>(
              `/repos/${owner}/${name}/contents/${encodeURIComponent(node.path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`
            )
            setViewer({ loading: false, text: null, meta: data, error: null, unsupported: true })
          } catch (err) {
            setViewer({
              loading: false,
              text: null,
              meta: null,
              error: err instanceof Error ? err.message : 'Could not read this file.',
              unsupported: true
            })
          }
        })()
        return
      }
      setViewer({ loading: true, text: null, meta: null, error: null, unsupported: false })
      void (async () => {
        try {
          const res = await window.decks.devbay.api({
            path: `/repos/${owner}/${name}/contents/${encodeURIComponent(node.path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`,
            raw: true
          })
          if (!res.ok) throw new Error(res.error ?? `GitHub returned ${res.status}.`)
          const text = typeof res.data === 'string' ? res.data : String(res.data ?? '')
          setViewer({
            loading: false,
            text,
            meta: { name: node.name, path: node.path, sha: node.sha, size, type: 'file', html_url: `${repo.url}/blob/${branch}/${node.path}`, download_url: null },
            error: null,
            unsupported: false
          })
        } catch (err) {
          setViewer({
            loading: false,
            text: null,
            meta: null,
            error: err instanceof Error ? err.message : 'Could not read this file.',
            unsupported: false
          })
        }
      })()
    },
    [owner, name, branch, repo.url]
  )

  /* commits (lazy: only when the tab is first opened, re-fetched per branch) */
  useEffect(() => {
    setCommitsLoaded(false)
  }, [branch])

  useEffect(() => {
    if (tab !== 'commits' || commitsLoaded) return
    let alive = true
    setCommitsLoading(true)
    void (async () => {
      try {
        const { data } = await ghJson<GitHubCommitListItem[]>(
          `/repos/${owner}/${name}/commits?sha=${encodeURIComponent(branch)}&per_page=30`
        )
        if (alive) {
          setCommits(data)
          setCommitsLoaded(true)
        }
      } catch {
        if (alive) {
          setCommits([])
          setCommitsLoaded(true)
        }
      }
      if (alive) setCommitsLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [tab, commitsLoaded, owner, name, branch])

  /* header values prefer fresh detail, fall back to portfolio data */
  const description = detail?.description ?? repo.description
  const language = detail?.language ?? repo.language
  const stars = detail?.stargazers_count ?? repo.stars
  const issues = detail?.open_issues_count ?? repo.openIssues
  const pushedAt = detail?.pushed_at ?? repo.pushedAt
  const htmlUrl = detail?.html_url ?? repo.url

  return (
    <div style={{ maxWidth: 1240, margin: '0 auto', padding: '22px 40px 48px' }}>
      <style>{'.jc-tree-row:hover{background:var(--surface-2);}'}</style>

      {/* back + header */}
      <Reveal>
        <button
          className="tap"
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-3)',
            marginBottom: 16
          }}
        >
          <Icon name="chevL" size={16} /> Portfolio
        </button>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)', flex: '0 0 auto' }}>
                <Icon name={repo.private ? 'lock' : 'repo'} size={20} />
              </div>
              <div style={{ minWidth: 0 }}>
                <h1 style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.025em', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <span className="mono" style={{ color: 'var(--text-3)', fontSize: 16, fontWeight: 600 }}>{owner}/</span>
                  {repo.name}
                  {repo.private && <Badge size="sm" icon="lock">private</Badge>}
                  {repo.fork && <Badge size="sm" icon="branch">fork</Badge>}
                </h1>
                {description && <p style={{ fontSize: 13.5, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>{description}</p>}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-2)' }}>
              {language && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 99, background: langColor(language) }} />
                  {language}
                </span>
              )}
              <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="star" size={13} style={{ color: 'var(--text-3)' }} /> {stars}
              </span>
              <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="alert" size={13} style={{ color: 'var(--text-3)' }} /> {issues} issues
              </span>
              <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="clock" size={13} style={{ color: 'var(--text-3)' }} /> updated {fmtAgo(pushedAt)}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BranchPicker branches={branches} current={branch} onPick={setBranch} />
            <Button variant="surface" size="sm" iconRight="external" onClick={() => window.open(htmlUrl, '_blank')}>
              Open on GitHub
            </Button>
          </div>
        </div>
      </Reveal>

      {/* tabs */}
      <div style={{ display: 'flex', gap: 4, margin: '20px 0 14px', borderBottom: '1px solid var(--border)' }}>
        {([['files', 'Files', 'layers'], ['commits', 'Commits', 'branch']] as [Tab, string, string][]).map(([t, label, icon]) => {
          const on = tab === t
          return (
            <button
              key={t}
              className="tap"
              onClick={() => setTab(t)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '9px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: on ? 'var(--accent-h)' : 'var(--text-3)',
                borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                marginBottom: -1
              }}
            >
              <Icon name={icon} size={15} /> {label}
            </button>
          )
        })}
        {truncated && (
          <span style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 11.5, color: 'var(--warn)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="info" size={13} /> Large repo — folders load on expand
          </span>
        )}
      </div>

      {tab === 'commits' ? (
        <Card pad={0} style={{ height: 'min(620px, 70vh)', overflow: 'hidden' }}>
          <CommitsTab commits={commits} loading={commitsLoading} />
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'start', minHeight: 0 }}>
          {/* file tree */}
          <Card pad={0} style={{ height: 'min(620px, 70vh)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Icon name="layers" size={14} /> Files
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
              {treeLoading ? (
                <div style={{ padding: 8 }}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <Skeleton key={i} w={`${55 + ((i * 31) % 40)}%`} h={14} style={{ marginBottom: 11, marginLeft: (i % 3) * 14 }} />
                  ))}
                </div>
              ) : treeError ? (
                <div style={{ padding: 24, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                  <Icon name="alert" size={22} style={{ color: 'var(--neg)' }} />
                  <span style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>{treeError}</span>
                  <Button variant="surface" size="sm" icon="refresh" onClick={() => void loadTree(branch)}>
                    Retry
                  </Button>
                </div>
              ) : emptyRepo ? (
                <div style={{ padding: 28, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', color: 'var(--text-3)' }}>
                  <Icon name="repo" size={22} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-2)' }}>This repo is empty</span>
                  <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>No files on this branch yet.</span>
                </div>
              ) : (
                tree.map((n) => (
                  <TreeRow
                    key={n.path}
                    node={n}
                    depth={0}
                    selectedPath={selectedPath}
                    expanded={expanded}
                    loadingDir={loadingDir}
                    onToggle={toggleDir}
                    onOpenFile={openFile}
                  />
                ))
              )}
            </div>
          </Card>

          {/* file viewer */}
          <Card pad={0} style={{ height: 'min(620px, 70vh)', overflow: 'hidden' }}>
            {selectedPath && viewer ? (
              <FileViewer path={selectedPath} state={viewer} defaultBranch={branch} />
            ) : (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, color: 'var(--text-3)', textAlign: 'center', padding: 40 }}>
                <div style={{ width: 60, height: 60, borderRadius: 'var(--r-lg)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
                  <Icon name="eye" size={28} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)' }}>Pick a file to read</div>
                <div style={{ fontSize: 13, maxWidth: 280, lineHeight: 1.55 }}>
                  Browse the tree on the left. Code shows line-numbered, Markdown renders, and big files link out to GitHub.
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

/* ── merge lazily-loaded children into the existing tree (immutable) ──── */

function attachChildren(roots: TreeNode[], path: string, kids: TreeNode[]): TreeNode[] {
  return roots.map((n) => {
    if (n.path === path) return { ...n, children: kids, loaded: true }
    if (n.children && n.type === 'tree' && path.startsWith(n.path + '/')) {
      return { ...n, children: attachChildren(n.children, path, kids) }
    }
    return n
  })
}
