// Desktop input for the web / desktop build. RN-web views are DOM elements, so these hooks attach
// plain DOM listeners: what the browser offers natively (HTML5 drag & drop, the clipboard, the
// keyboard) instead of an emulation through gesture handlers.
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Upload } from '@shared/types'
import { blobToBase64 } from './upload.web'

export type DroppedImage = { uri: string; upload: Upload }
export const isWebDesktop = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches

const el = (ref: RefObject<unknown>) => ref.current as HTMLElement | null

async function toImages(files: FileList | File[]) {
  const out: DroppedImage[] = []
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) continue
    out.push({ uri: URL.createObjectURL(f), upload: { name: f.name || 'image.png', type: f.type, data: await blobToBase64(f) } })
  }
  return out
}

/** Enter sends, Shift+Enter is a new line, ⌘/Ctrl+Enter also sends; images by paste or drop. */
export function useComposerKeys(ref: RefObject<unknown>, opts: { onSend: () => void; onImages: (images: DroppedImage[]) => void }) {
  const latest = useRef(opts)
  latest.current = opts
  useEffect(() => {
    const node = el(ref)
    if (!node) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.altKey) return
      if ((e.target as HTMLElement).tagName !== 'TEXTAREA') return
      e.preventDefault()
      latest.current.onSend()
    }
    const onPaste = async (e: ClipboardEvent) => {
      const files = e.clipboardData?.files
      if (!files?.length) return
      e.preventDefault()
      latest.current.onImages(await toImages(files))
    }
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); node.dataset.drop = '1' } }
    const onDragLeave = () => { delete node.dataset.drop }
    const onDrop = async (e: DragEvent) => {
      delete node.dataset.drop
      if (!e.dataTransfer?.files.length) return
      e.preventDefault()
      latest.current.onImages(await toImages(e.dataTransfer.files))
    }
    node.addEventListener('keydown', onKey)
    node.addEventListener('paste', onPaste)
    node.addEventListener('dragover', onDragOver)
    node.addEventListener('dragleave', onDragLeave)
    node.addEventListener('drop', onDrop)
    return () => {
      node.removeEventListener('keydown', onKey)
      node.removeEventListener('paste', onPaste)
      node.removeEventListener('dragover', onDragOver)
      node.removeEventListener('dragleave', onDragLeave)
      node.removeEventListener('drop', onDrop)
    }
  }, [ref])
}

const CARD_MIME = 'application/x-hermes-session'

/** A board card: draggable to another column (HTML5 drag & drop) and a right-click menu. */
export function useCardDrag(ref: RefObject<unknown>, id: string, onContextMenu?: (at: { x: number; y: number }) => void) {
  const menu = useRef(onContextMenu)
  menu.current = onContextMenu
  useEffect(() => {
    const node = el(ref)
    if (!node) return
    node.draggable = true
    const onStart = (e: DragEvent) => {
      e.dataTransfer?.setData(CARD_MIME, id)
      e.dataTransfer?.setData('text/plain', id)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
      node.style.opacity = '0.45'
    }
    const onEnd = () => { node.style.opacity = '' }
    const onCtx = (e: MouseEvent) => {
      if (!menu.current) return
      e.preventDefault()
      menu.current({ x: e.clientX, y: e.clientY })
    }
    node.addEventListener('dragstart', onStart)
    node.addEventListener('dragend', onEnd)
    node.addEventListener('contextmenu', onCtx)
    return () => {
      node.removeEventListener('dragstart', onStart)
      node.removeEventListener('dragend', onEnd)
      node.removeEventListener('contextmenu', onCtx)
    }
  }, [ref, id])
}

/** A column as a drop target for cards; returns true while a card hovers over it. */
export function useColumnDrop(ref: RefObject<unknown>, onDrop: (id: string) => void) {
  const [over, setOver] = useState(false)
  const latest = useRef(onDrop)
  latest.current = onDrop
  useEffect(() => {
    const node = el(ref)
    if (!node) return
    let depth = 0
    const isCard = (e: DragEvent) => !!e.dataTransfer?.types.includes(CARD_MIME)
    const onEnter = (e: DragEvent) => { if (isCard(e)) { depth++; setOver(true) } }
    const onOver = (e: DragEvent) => { if (isCard(e)) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' } }
    const onLeave = (e: DragEvent) => { if (isCard(e) && --depth <= 0) { depth = 0; setOver(false) } }
    const onDropEv = (e: DragEvent) => {
      if (!isCard(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      const id = e.dataTransfer!.getData(CARD_MIME)
      if (id) latest.current(id)
    }
    node.addEventListener('dragenter', onEnter)
    node.addEventListener('dragover', onOver)
    node.addEventListener('dragleave', onLeave)
    node.addEventListener('drop', onDropEv)
    return () => {
      node.removeEventListener('dragenter', onEnter)
      node.removeEventListener('dragover', onOver)
      node.removeEventListener('dragleave', onLeave)
      node.removeEventListener('drop', onDropEv)
    }
  }, [ref])
  return over
}

/** The split view's handle: pointer capture, reports horizontal movement. */
export function useSplitResize(ref: RefObject<unknown>, onResize: (dx: number) => void, onEnd?: () => void) {
  const latest = useRef({ onResize, onEnd })
  latest.current = { onResize, onEnd }
  useEffect(() => {
    const node = el(ref)
    if (!node) return
    let lastX = 0
    const move = (e: PointerEvent) => { latest.current.onResize(e.clientX - lastX); lastX = e.clientX }
    const up = (e: PointerEvent) => {
      node.releasePointerCapture(e.pointerId)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      latest.current.onEnd?.()
    }
    const down = (e: PointerEvent) => {
      e.preventDefault()
      lastX = e.clientX
      node.setPointerCapture(e.pointerId)
      node.addEventListener('pointermove', move)
      node.addEventListener('pointerup', up)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }
    node.addEventListener('pointerdown', down)
    return () => node.removeEventListener('pointerdown', down)
  }, [ref])
}

/** Window-wide key handler; `typing` is true while a text field has the focus. */
export function useKeydown(fn: (e: { key: string; meta: boolean; shift: boolean; alt: boolean; typing: boolean; preventDefault(): void }) => boolean | void) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      latest.current({ key: e.key, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey, typing, preventDefault: () => e.preventDefault() })
    }
    // Capture phase: RN-web's TextInput stops the propagation of some keys (Escape) in the field.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
