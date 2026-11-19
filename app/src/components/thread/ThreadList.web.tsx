// Web / desktop variant of ThreadList.tsx: a plain scrolling <div> instead of a virtualised list, so
// scrolling is the browser's own (trackpad momentum, rubber band, scrollbar, PageUp/End), text can be
// selected across messages and ⌘F finds everything.
//
//   - flex-direction: column-reverse starts at the bottom and keeps the view anchored there while new
//     messages arrive, with no scroll-to-end code and no transform (an inverted RN list flips the
//     wheel direction on the web).
//   - content-visibility: auto lets the browser skip layout and paint of rows outside the viewport:
//     a 500-message thread costs about what the visible screen costs.
//   - The first OPEN_ROWS rows render at once, older ones in idle chunks right after (DOM order is
//     newest first, so appending older rows adds them above without moving the view).
import { useEffect, useState, type ReactElement } from 'react'
import type { ThreadMessage } from '@shared/types'

export type Row = { key: string; kind: 'msg'; m: ThreadMessage } | { key: string; kind: 'stream'; text: string } | { key: string; kind: 'prompts' }

const OPEN_ROWS = 40
const CHUNK = 120

export function ThreadList<R extends { key: string; kind: string }>({ rows, renderRow, footer }: { rows: R[]; renderRow: (r: R) => ReactElement; footer?: ReactElement }) {
  const [limit, setLimit] = useState(OPEN_ROWS)
  useEffect(() => {
    if (limit >= rows.length) return
    const idle = (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 16))) as (f: () => void) => number
    const id = idle(() => setLimit((l) => l + CHUNK))
    return () => (window.cancelIdleCallback ?? clearTimeout)(id)
  }, [limit, rows.length])
  const shown = rows.length > limit ? rows.slice(0, limit) : rows
  return (
    <div className="hk-thread" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column-reverse', padding: '16px 16px 16px 16px', gap: 12, overscrollBehavior: 'contain' }}>
      {shown.map((r) => (
        <div key={r.key} style={r.kind === 'msg' ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 96px', flexShrink: 0 } : { flexShrink: 0 }}>
          {renderRow(r)}
        </div>
      ))}
      {rows.length <= limit && footer}
    </div>
  )
}
