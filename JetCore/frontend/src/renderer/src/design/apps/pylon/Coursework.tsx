/**
 * Pylon — Courses › Coursework (Modules · Pages · Files).
 *
 * Modules: the module/item tree (GET modules?include[]=items), with each item
 * typed by its kind. Pages: list + a reader that renders the page body HTML.
 * Files: a flat list (name / size / type) with an Open that hands the URL to
 * the OS via window.open.
 */
import { useState, type JSX } from 'react'
import { Badge, Button, Card, Segmented } from '../../ui'
import { AnimatedList, Reveal } from '../../motion'
import { Icon } from '../../icons'
import {
  fmtBytes,
  fmtDate,
  get,
  paginate,
  type CanvasFile,
  type CanvasModule,
  type CanvasModuleItem,
  type CanvasPage,
  type CanvasPageSummary
} from './canvas'
import {
  AreaHead,
  BackHeader,
  CanvasHtml,
  EmptyCard,
  ListRow,
  LoadError,
  MetaLine,
  ReaderSkeleton,
  RowSkeletons,
  StatusBadge,
  useAsync
} from './shared'

type Sub = 'modules' | 'pages' | 'files'
const SUBS: { value: Sub; label: string }[] = [
  { value: 'modules', label: 'Modules' },
  { value: 'pages', label: 'Pages' },
  { value: 'files', label: 'Files' }
]

export function CourseworkArea({ courseId, accent }: { courseId: number; accent: string }): JSX.Element {
  const [sub, setSub] = useState<Sub>('modules')
  return (
    <div>
      <AreaHead
        title="Coursework"
        sub="The structure of the course — its modules, pages, and files."
        action={<Segmented options={SUBS} value={sub} onChange={(v) => setSub(v as Sub)} size="sm" />}
      />
      {sub === 'modules' && <ModulesView courseId={courseId} accent={accent} />}
      {sub === 'pages' && <PagesView courseId={courseId} accent={accent} />}
      {sub === 'files' && <FilesView courseId={courseId} accent={accent} />}
    </div>
  )
}

/* ── Modules ─────────────────────────────────────────────────────────── */

function itemMeta(t: string): { icon: string; label: string } {
  return (
    {
      Assignment: { icon: 'book', label: 'Assignment' },
      Quiz: { icon: 'target', label: 'Quiz' },
      Page: { icon: 'layers', label: 'Page' },
      File: { icon: 'download', label: 'File' },
      Discussion: { icon: 'people', label: 'Discussion' },
      ExternalUrl: { icon: 'external', label: 'Link' },
      ExternalTool: { icon: 'external', label: 'Tool' },
      SubHeader: { icon: 'hash', label: 'Header' }
    }[t] ?? { icon: 'info', label: t }
  )
}

function ModulesView({ courseId, accent }: { courseId: number; accent: string }): JSX.Element {
  const { state, reload } = useAsync<CanvasModule[]>(
    () => paginate<CanvasModule>(`/api/v1/courses/${courseId}/modules?include[]=items&per_page=100`),
    courseId
  )

  if (state.phase === 'loading') return <RowSkeletons count={5} />
  if (state.phase === 'error') return <LoadError message={state.message} onRetry={reload} />
  const mods = state.data.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  if (mods.length === 0) return <EmptyCard icon="layers" title="No modules" body="This course isn’t organised into modules, or Canvas didn’t return any." />

  const openItem = (item: CanvasModuleItem): void => {
    const url = item.html_url || item.external_url
    if (url) window.open(url, '_blank')
  }

  return (
    <AnimatedList stagger={50} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {mods.map((m) => (
        <Card key={m.id} pad={0} style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '15px 18px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 4, height: 22, borderRadius: 99, background: accent }} />
            <Icon name="layers" size={17} style={{ color: 'var(--accent-h)' }} />
            <h3 style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</h3>
            {m.state === 'completed' && <StatusBadge tone="pos" icon="check">Done</StatusBadge>}
            {m.state === 'locked' && <StatusBadge tone="neutral" icon="lock">Locked</StatusBadge>}
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-3)' }}>{m.items?.length ?? m.items_count ?? 0}</span>
          </div>
          {(m.items ?? []).length === 0 ? (
            <div style={{ padding: '14px 18px', fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>No items in this module.</div>
          ) : (
            <div>
              {(m.items ?? []).map((item) => {
                if (item.type === 'SubHeader') {
                  return (
                    <div key={item.id} style={{ padding: '12px 18px 6px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                      {item.title}
                    </div>
                  )
                }
                const meta = itemMeta(item.type)
                const clickable = !!(item.html_url || item.external_url)
                return (
                  <button
                    key={item.id}
                    className={clickable ? 'tap' : undefined}
                    onClick={clickable ? () => openItem(item) : undefined}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: '100%',
                      textAlign: 'left',
                      padding: '12px 18px',
                      paddingLeft: 18 + (item.indent ?? 0) * 18,
                      borderTop: '1px solid var(--border)',
                      cursor: clickable ? 'pointer' : 'default'
                    }}
                    onMouseEnter={clickable ? (e) => (e.currentTarget.style.background = 'var(--surface-2)') : undefined}
                    onMouseLeave={clickable ? (e) => (e.currentTarget.style.background = 'transparent') : undefined}
                  >
                    <Icon name={meta.icon} size={16} style={{ color: 'var(--text-3)', flex: '0 0 auto' }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    <Badge tone="neutral" size="sm">{meta.label}</Badge>
                    {item.completion_requirement?.completed && <Icon name="check" size={15} style={{ color: 'var(--pos)' }} />}
                    {clickable && <Icon name="external" size={14} style={{ color: 'var(--text-3)' }} />}
                  </button>
                )
              })}
            </div>
          )}
        </Card>
      ))}
    </AnimatedList>
  )
}

/* ── Pages ───────────────────────────────────────────────────────────── */

function PagesView({ courseId, accent }: { courseId: number; accent: string }): JSX.Element {
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  const { state, reload } = useAsync<CanvasPageSummary[]>(
    () => paginate<CanvasPageSummary>(`/api/v1/courses/${courseId}/pages?per_page=100&sort=title`),
    courseId
  )

  if (openUrl !== null) {
    return <PageReader courseId={courseId} pageUrl={openUrl} onBack={() => setOpenUrl(null)} />
  }

  if (state.phase === 'loading') return <RowSkeletons count={6} />
  if (state.phase === 'error')
    return state.status === 403 || state.status === 404 ? (
      <EmptyCard icon="lock" title="Pages aren’t available" body="This course doesn’t have the Pages tab enabled in Canvas (or your instructor hid it), so it can’t be shown here." />
    ) : (
      <LoadError message={state.message} onRetry={reload} />
    )
  const pages = state.data
  if (pages.length === 0) return <EmptyCard icon="layers" title="No pages" body="This course doesn’t publish any wiki pages, or Canvas didn’t return them." />

  const sorted = pages.slice().sort((a, b) => (b.front_page ? 1 : 0) - (a.front_page ? 1 : 0) || a.title.localeCompare(b.title))

  return (
    <AnimatedList stagger={35} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map((p) => (
        <ListRow
          key={p.url}
          icon="layers"
          accent={accent}
          iconColor="var(--accent-h)"
          title={p.title}
          onClick={() => setOpenUrl(p.url)}
          meta={
            <MetaLine>
              {p.front_page ? <Badge tone="accent" size="sm">Front page</Badge> : null}
              {p.updated_at ? <span>Updated {fmtDate(p.updated_at)}</span> : null}
            </MetaLine>
          }
          right={<Icon name="chevR" size={16} style={{ color: 'var(--text-3)' }} />}
        />
      ))}
    </AnimatedList>
  )
}

function PageReader({ courseId, pageUrl, onBack }: { courseId: number; pageUrl: string; onBack: () => void }): JSX.Element {
  const { state, reload } = useAsync<CanvasPage>(
    () => get<CanvasPage>(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(pageUrl)}`),
    `${courseId}:${pageUrl}`
  )

  if (state.phase === 'loading') {
    return (
      <div>
        <BackHeader onBack={onBack} backLabel="Pages" title="Loading page…" />
        <ReaderSkeleton />
      </div>
    )
  }
  if (state.phase === 'error') {
    return (
      <div>
        <BackHeader onBack={onBack} backLabel="Pages" title="Page" />
        <LoadError message={state.message} onRetry={reload} />
      </div>
    )
  }
  const page = state.data
  return (
    <div>
      <BackHeader
        onBack={onBack}
        backLabel="Pages"
        title={page.title}
        badge={page.front_page ? <StatusBadge tone="accent">Front page</StatusBadge> : undefined}
        sub={page.updated_at ? `Updated ${fmtDate(page.updated_at)}` : undefined}
      />
      <Reveal delay={60}>
        <Card>
          <CanvasHtml html={page.body} />
        </Card>
      </Reveal>
    </div>
  )
}

/* ── Files ───────────────────────────────────────────────────────────── */

function fileIcon(ct: string | undefined): string {
  if (!ct) return 'download'
  if (ct.startsWith('image/')) return 'eye'
  if (ct.startsWith('video/')) return 'eye'
  if (ct.includes('pdf')) return 'book'
  if (ct.includes('zip') || ct.includes('compressed')) return 'layers'
  return 'download'
}

function FilesView({ courseId, accent }: { courseId: number; accent: string }): JSX.Element {
  const { state, reload } = useAsync<CanvasFile[]>(
    () => paginate<CanvasFile>(`/api/v1/courses/${courseId}/files?per_page=100&sort=name`),
    courseId
  )

  if (state.phase === 'loading') return <RowSkeletons count={6} />
  if (state.phase === 'error')
    return state.status === 403 || state.status === 404 ? (
      <EmptyCard icon="lock" title="Files aren’t available" body="This course doesn’t have the Files tab enabled in Canvas (or your instructor restricted it), so it can’t be shown here." />
    ) : (
      <LoadError message={state.message} onRetry={reload} />
    )
  const files = state.data
  if (files.length === 0) return <EmptyCard icon="download" title="No files" body="This course doesn’t expose any files to you, or Canvas didn’t return them." />

  return (
    <AnimatedList stagger={30} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {files.map((f) => {
        const ct = f['content-type']
        return (
          <ListRow
            key={f.id}
            icon={fileIcon(ct)}
            accent={accent}
            iconColor="var(--accent-h)"
            title={f.display_name || f.filename || 'File'}
            meta={
              <MetaLine>
                <span className="mono">{fmtBytes(f.size)}</span>
                {ct ? <span>{prettyContentType(ct)}</span> : null}
                {f.updated_at ? <span>Updated {fmtDate(f.updated_at)}</span> : null}
              </MetaLine>
            }
            right={
              <Button variant="surface" size="sm" icon="external" onClick={() => window.open(f.url, '_blank')}>
                Open
              </Button>
            }
          />
        )
      })}
    </AnimatedList>
  )
}

function prettyContentType(ct: string): string {
  const base = ct.split(';')[0]
  if (base.startsWith('image/')) return base.replace('image/', '').toUpperCase() + ' image'
  if (base.includes('pdf')) return 'PDF'
  if (base.includes('wordprocessing') || base.includes('msword')) return 'Word doc'
  if (base.includes('spreadsheet') || base.includes('excel')) return 'Spreadsheet'
  if (base.includes('presentation') || base.includes('powerpoint')) return 'Slides'
  if (base.startsWith('text/')) return 'Text'
  if (base.startsWith('video/')) return base.replace('video/', '').toUpperCase() + ' video'
  return base
}
