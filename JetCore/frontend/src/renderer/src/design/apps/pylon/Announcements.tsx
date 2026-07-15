/**
 * Pylon — Courses › Announcements.
 *
 * GET /api/v1/announcements?context_codes[]=course_:cid — the instructor's
 * posts, newest first, with the message HTML rendered inline in the reader.
 */
import { useState, type JSX } from 'react'
import { Card } from '../../ui'
import { AnimatedList, Reveal } from '../../motion'
import { Icon } from '../../icons'
import { fmtDate, paginate, type CanvasAnnouncement } from './canvas'
import { AreaHead, CanvasHtml, EmptyCard, LoadError, RowSkeletons, useAsync } from './shared'

export function AnnouncementsArea({ courseId, accent }: { courseId: number; accent: string }): JSX.Element {
  const { state, reload } = useAsync<CanvasAnnouncement[]>(
    () => paginate<CanvasAnnouncement>(`/api/v1/announcements?context_codes[]=course_${courseId}&per_page=20`),
    courseId
  )
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const toggle = (id: number): void =>
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <div>
      <AreaHead title="Announcements" sub="What your instructor has posted to the class, newest first." />
      {state.phase === 'loading' && <RowSkeletons count={4} />}
      {state.phase === 'error' && <LoadError message={state.message} onRetry={reload} />}
      {state.phase === 'ready' &&
        (state.data.length === 0 ? (
          <EmptyCard icon="bell" title="No announcements" body="Nothing has been posted to this course yet — a quiet, calm inbox." />
        ) : (
          <AnimatedList stagger={45} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {state.data
              .slice()
              .sort((a, b) => (b.posted_at ? Date.parse(b.posted_at) : 0) - (a.posted_at ? Date.parse(a.posted_at) : 0))
              .map((ann, i) => {
                const open = expanded.has(ann.id) || i === 0
                return (
                  <Card key={ann.id}>
                    <button
                      className="tap"
                      onClick={() => toggle(ann.id)}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 13, width: '100%', textAlign: 'left' }}
                    >
                      <div style={{ width: 38, height: 38, flex: '0 0 auto', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
                        <Icon name="bell" size={18} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-0.01em' }}>{ann.title}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, fontSize: 12.5, color: 'var(--text-3)' }}>
                          {ann.author?.display_name ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Icon name="user" size={13} /> {ann.author.display_name}
                            </span>
                          ) : null}
                          {ann.posted_at ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <Icon name="clock" size={13} /> {fmtDate(ann.posted_at)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <span style={{ width: 4, height: 38, borderRadius: 99, background: accent, flex: '0 0 auto' }} />
                      <Icon name={open ? 'chevD' : 'chevR'} size={16} style={{ color: 'var(--text-3)', flex: '0 0 auto', marginTop: 10 }} />
                    </button>
                    {open && (
                      <Reveal style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                        <CanvasHtml html={ann.message} />
                        {ann.html_url && (
                          <button
                            className="tap"
                            onClick={() => ann.html_url && window.open(ann.html_url, '_blank')}
                            style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--accent-h)' }}
                          >
                            Open in Canvas <Icon name="external" size={13} />
                          </button>
                        )}
                      </Reveal>
                    )}
                  </Card>
                )
              })}
          </AnimatedList>
        ))}
    </div>
  )
}
