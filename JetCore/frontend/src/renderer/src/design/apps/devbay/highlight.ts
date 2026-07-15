/* Dependency-free syntax highlighter for the DevBay code viewer.
 *
 * A small stateful tokenizer — NOT a full parser — that colors comments, strings,
 * numbers, keywords, functions, types, and markup tags across the common languages.
 * It returns tokens grouped per line so the line-numbered viewer stays aligned:
 * multi-line constructs (block comments, template/triple strings) carry their type
 * across the lines they span. Self-contained on purpose (matches the file's hand-
 * rolled Markdown renderer) — no 200 KB highlighter dependency in the bundle. */

export type TokType = 'com' | 'str' | 'num' | 'kw' | 'type' | 'fn' | 'tag' | 'attr' | 'punct' | 'plain'
export interface Tok {
  t: TokType
  v: string
}

/** Token type → CSS variable (defined in tokens.css, theme-aware). */
export const TOK_COLOR: Record<TokType, string> = {
  com: 'var(--code-com)',
  str: 'var(--code-str)',
  num: 'var(--code-num)',
  kw: 'var(--code-kw)',
  type: 'var(--code-type)',
  fn: 'var(--code-fn)',
  tag: 'var(--code-tag)',
  attr: 'var(--code-attr)',
  punct: 'var(--code-punct)',
  plain: 'var(--code-plain)'
}

/* Keyword sets are intentionally broad unions across a language family — over-
   coloring a keyword is harmless, missing one looks worse. */
const KW_C = new Set(
  (
    'abstract as async await break case catch class const continue debugger default delete do else enum export ' +
    'extends false finally for from function get if implements import in instanceof interface is keyof let new null ' +
    'of package private protected public readonly return satisfies set static super switch this throw true try type ' +
    'typeof undefined var void while with yield namespace declare module ' +
    'fn impl pub mut struct trait use match move ref where unsafe dyn crate mod self Self loop ' +
    'func defer go chan select map range nil iota ' +
    'val fun when object companion override suspend data sealed lateinit init constructor operator inline reified vararg internal ' +
    'guard repeat associatedtype protocol extension subscript inout some any ' +
    'int float double bool boolean char long short byte unsigned signed sizeof union typedef extern volatile register goto ' +
    'nullptr using template virtual friend explicit noexcept constexpr decltype final string size_t'
  ).split(/\s+/).filter(Boolean)
)
const KW_PY = new Set(
  'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self cls'.split(
    ' '
  )
)
const KW_SHELL = new Set(
  'if then else elif fi for while do done case esac function in select until time coproc echo export local return source alias set unset read test'.split(
    ' '
  )
)
const KW_SQL = new Set(
  'select from where insert update delete into values create table drop alter add column primary key foreign references index view join inner left right outer full on group by order having limit offset union all distinct as and or not null is in like between exists count sum avg min max case when then else end begin commit rollback transaction default constraint unique check cascade set returning with'.split(
    ' '
  )
)

interface Cfg {
  kw: Set<string>
  line: string[]
  block?: [string, string]
  quotes: string[]
  triple?: boolean
  ci?: boolean // case-insensitive keyword match (SQL)
}

function cfgFor(ext: string): { markup: boolean; cfg: Cfg } {
  if (['html', 'htm', 'xml', 'svg', 'vue', 'svelte', 'astro'].includes(ext))
    return { markup: true, cfg: { kw: new Set(), line: [], quotes: ['"', "'"] } }
  if (['py', 'rb'].includes(ext))
    return { markup: false, cfg: { kw: KW_PY, line: ['#'], quotes: ['"', "'"], triple: true } }
  if (
    ['sh', 'bash', 'zsh', 'fish', 'ps1', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env', 'r', 'pl', 'tf', 'hcl', 'properties', 'dockerfile', 'makefile', 'cmake', 'gitignore'].includes(
      ext
    )
  )
    return { markup: false, cfg: { kw: KW_SHELL, line: ['#'], quotes: ['"', "'"] } }
  if (ext === 'sql')
    return { markup: false, cfg: { kw: KW_SQL, line: ['--'], block: ['/*', '*/'], quotes: ['"', "'"], ci: true } }
  if (ext === 'lua') return { markup: false, cfg: { kw: KW_C, line: ['--'], quotes: ['"', "'"] } }
  // default: C-family (js/ts/tsx/json/go/rust/java/c/cpp/cs/css/scss/php/dart/…)
  return { markup: false, cfg: { kw: KW_C, line: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'] } }
}

const isWS = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r'

function scanCode(src: string, cfg: Cfg): Tok[] {
  const toks: Tok[] = []
  const n = src.length
  let i = 0
  while (i < n) {
    const c = src[i]
    if (isWS(c)) {
      let j = i + 1
      while (j < n && isWS(src[j])) j++
      toks.push({ t: 'plain', v: src.slice(i, j) })
      i = j
      continue
    }
    // line comment
    let lc = false
    for (const p of cfg.line) {
      if (src.startsWith(p, i)) {
        let j = i
        while (j < n && src[j] !== '\n') j++
        toks.push({ t: 'com', v: src.slice(i, j) })
        i = j
        lc = true
        break
      }
    }
    if (lc) continue
    // block comment
    if (cfg.block && src.startsWith(cfg.block[0], i)) {
      const e = src.indexOf(cfg.block[1], i + cfg.block[0].length)
      const j = e === -1 ? n : e + cfg.block[1].length
      toks.push({ t: 'com', v: src.slice(i, j) })
      i = j
      continue
    }
    // string (single-line, template, or python triple)
    if (cfg.quotes.includes(c)) {
      if (cfg.triple && src.startsWith(c + c + c, i)) {
        const e = src.indexOf(c + c + c, i + 3)
        const j = e === -1 ? n : e + 3
        toks.push({ t: 'str', v: src.slice(i, j) })
        i = j
        continue
      }
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === c) {
          j++
          break
        }
        if (src[j] === '\n' && c !== '`') break
        j++
      }
      toks.push({ t: 'str', v: src.slice(i, j) })
      i = j
      continue
    }
    // number
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i + 1
      while (j < n) {
        const d = src[j]
        if (/[0-9a-fA-F._xXoObB]/.test(d)) {
          j++
          continue
        }
        if ((d === 'e' || d === 'E') && /[0-9]/.test(src[j + 1] ?? '')) {
          j++
          continue
        }
        if ((d === '+' || d === '-') && /[eE]/.test(src[j - 1] ?? '')) {
          j++
          continue
        }
        break
      }
      toks.push({ t: 'num', v: src.slice(i, j) })
      i = j
      continue
    }
    // identifier → keyword / function / Type / plain
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1
      while (j < n && /[\w$]/.test(src[j])) j++
      const w = src.slice(i, j)
      let k = j
      while (k < n && (src[k] === ' ' || src[k] === '\t')) k++
      if (cfg.ci ? cfg.kw.has(w.toLowerCase()) : cfg.kw.has(w)) toks.push({ t: 'kw', v: w })
      else if (src[k] === '(') toks.push({ t: 'fn', v: w })
      else if (/^[A-Z]/.test(w) && w.length > 1) toks.push({ t: 'type', v: w })
      else toks.push({ t: 'plain', v: w })
      i = j
      continue
    }
    toks.push({ t: 'punct', v: c })
    i++
  }
  return toks
}

function scanMarkup(src: string): Tok[] {
  const toks: Tok[] = []
  const n = src.length
  let i = 0
  while (i < n) {
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4)
      const j = e === -1 ? n : e + 3
      toks.push({ t: 'com', v: src.slice(i, j) })
      i = j
      continue
    }
    if (src[i] === '<') {
      toks.push({ t: 'punct', v: '<' })
      i++
      if (src[i] === '/') {
        toks.push({ t: 'punct', v: '/' })
        i++
      }
      let j = i
      while (j < n && /[\w:.-]/.test(src[j])) j++
      if (j > i) {
        toks.push({ t: 'tag', v: src.slice(i, j) })
        i = j
      }
      while (i < n && src[i] !== '>') {
        const c = src[i]
        if (isWS(c)) {
          let k = i + 1
          while (k < n && isWS(src[k])) k++
          toks.push({ t: 'plain', v: src.slice(i, k) })
          i = k
          continue
        }
        if (c === '/' || c === '=') {
          toks.push({ t: 'punct', v: c })
          i++
          continue
        }
        if (c === '"' || c === "'") {
          let k = i + 1
          while (k < n && src[k] !== c) k++
          k = Math.min(k + 1, n)
          toks.push({ t: 'str', v: src.slice(i, k) })
          i = k
          continue
        }
        let k = i
        while (k < n && /[\w:.-]/.test(src[k])) k++
        if (k > i) {
          toks.push({ t: 'attr', v: src.slice(i, k) })
          i = k
          continue
        }
        toks.push({ t: 'punct', v: c })
        i++
      }
      if (i < n && src[i] === '>') {
        toks.push({ t: 'punct', v: '>' })
        i++
      }
      continue
    }
    let j = i
    while (j < n && src[j] !== '<') j++
    toks.push({ t: 'plain', v: src.slice(i, j) })
    i = j
  }
  return toks
}

/** Split tokens (whose values may contain newlines) into one bucket per line. */
function splitLines(toks: Tok[]): Tok[][] {
  const lines: Tok[][] = [[]]
  for (const tok of toks) {
    const segs = tok.v.split('\n')
    for (let k = 0; k < segs.length; k++) {
      if (k > 0) lines.push([])
      if (segs[k]) lines[lines.length - 1].push({ t: tok.t, v: segs[k] })
    }
  }
  return lines
}

/* Caps so a giant file can't lock the UI tokenizing/rendering thousands of spans. */
const MAX_HL_CHARS = 220 * 1024
const MAX_HL_LINES = 6000

/**
 * Tokenize `text` for file extension `ext`, returning tokens grouped per line.
 * Returns null when the file is too large to highlight cheaply — the caller then
 * renders it as plain monospace text.
 */
export function tokenizeLines(text: string, ext: string): Tok[][] | null {
  if (text.length > MAX_HL_CHARS) return null
  const { markup, cfg } = cfgFor(ext)
  const lines = splitLines(markup ? scanMarkup(text) : scanCode(text, cfg))
  return lines.length > MAX_HL_LINES ? null : lines
}
