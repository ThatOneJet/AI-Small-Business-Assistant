/**
 * Pylon — the per-course host.
 *
 * Once a course is picked, this renders its sub-nav (Assignments · Coursework ·
 * Announcements) and hosts the active area. Each area lazy-loads its own Canvas
 * data the first time it's opened. Quizzes live UNDER Assignments (Canvas counts
 * them as assignments) and are taken inline there — no separate Quizzes section.
 */
import type { JSX } from 'react'
import { Icon } from '../../icons'
import { AssignmentsArea } from './Assignments'
import { CourseworkArea } from './Coursework'
import { AnnouncementsArea } from './Announcements'
import type { CourseView } from './Dashboard'

export type CourseArea = 'assignments' | 'coursework' | 'announcements'

const AREAS: { id: CourseArea; label: string; icon: string }[] = [
  { id: 'assignments', label: 'Assignments', icon: 'book' },
  { id: 'coursework', label: 'Coursework', icon: 'layers' },
  { id: 'announcements', label: 'Announcements', icon: 'bell' }
]

export function CourseScreen({
  course,
  area,
  onArea,
  openAssignmentId
}: {
  course: CourseView
  area: CourseArea
  onArea: (a: CourseArea) => void
  openAssignmentId?: number
}): JSX.Element {
  return (
    <div>
      {/* course identity + sub-nav */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18 }}>
          <div style={{ width: 44, height: 44, borderRadius: 'var(--r-md)', flex: '0 0 auto', display: 'grid', placeItems: 'center', background: 'var(--accent-soft)', color: 'var(--accent-h)' }}>
            <Icon name="cap" size={22} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--accent-h)' }}>{course.code}</div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{course.name}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
          {AREAS.map((a) => {
            const on = area === a.id
            return (
              <button
                key={a.id}
                className="tap"
                onClick={() => onArea(a.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '11px 14px 13px',
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: on ? 'var(--text)' : 'var(--text-3)',
                  borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                  marginBottom: -1,
                  transition: 'color .2s var(--ease), border-color .2s var(--ease)'
                }}
                onMouseEnter={(e) => {
                  if (!on) e.currentTarget.style.color = 'var(--text-2)'
                }}
                onMouseLeave={(e) => {
                  if (!on) e.currentTarget.style.color = 'var(--text-3)'
                }}
              >
                <Icon name={a.icon} size={15} style={{ color: on ? 'var(--accent-h)' : 'currentColor' }} />
                {a.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* keyed by course+area so switching remounts (fresh load) */}
      <div key={`${course.id}:${area}:${openAssignmentId ?? ''}`}>
        {area === 'assignments' && (
          <AssignmentsArea courseId={course.id} accent={course.color} initialOpenId={openAssignmentId} />
        )}
        {area === 'coursework' && <CourseworkArea courseId={course.id} accent={course.color} />}
        {area === 'announcements' && <AnnouncementsArea courseId={course.id} accent={course.color} />}
      </div>
    </div>
  )
}
