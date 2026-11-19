// Desktop input on the web build (web-input.web.ts): keyboard sending and images by paste / drop in
// the composer, drag & drop of cards, right-click menus. Native: all no-ops.
import type { RefObject } from 'react'
import type { Upload } from '@shared/types'

export type DroppedImage = { uri: string; upload: Upload }
export function useComposerKeys(_ref: RefObject<unknown>, _opts: { onSend: () => void; onImages: (images: DroppedImage[]) => void }) {}
export function useCardDrag(_ref: RefObject<unknown>, _id: string, _onContextMenu?: (at: { x: number; y: number }) => void) {}
export function useColumnDrop(_ref: RefObject<unknown>, _onDrop: (id: string) => void): boolean { return false }
export function useSplitResize(_ref: RefObject<unknown>, _onResize: (dx: number) => void, _onEnd?: () => void) {}
export const isWebDesktop = false
/** Window-wide key handler (web); return true when the key was handled. */
export function useKeydown(_fn: (e: { key: string; meta: boolean; shift: boolean; alt: boolean; typing: boolean; preventDefault(): void }) => boolean | void) {}
