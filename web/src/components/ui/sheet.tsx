"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Bottom sheets: drag down to close, from the grabber or any element marked data-sheet-drag (e.g. a
 * header). Interactive elements inside such a region keep their taps. Past 96 px, or a quick flick, the
 * sheet closes; otherwise it springs back.
 */
function useSwipeToClose(enabled: boolean) {
  const ref = React.useRef<HTMLDivElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const drag = React.useRef<{ id: number; y: number; t: number; dy: number } | null>(null)
  const set = (dy: number, animate: boolean) => {
    const el = ref.current
    if (!el) return
    el.style.transition = animate ? "transform 180ms ease-out" : "none"
    el.style.transform = dy ? `translateY(${dy}px)` : ""
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (!enabled || e.pointerType === "mouse") return
    const target = e.target as HTMLElement
    if (!target.closest("[data-sheet-drag]") || target.closest("button, a, input, textarea, select, [role=combobox]")) return
    drag.current = { id: e.pointerId, y: e.clientY, t: performance.now(), dy: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    d.dy = Math.max(0, e.clientY - d.y)
    set(d.dy, false)
  }
  const onPointerEnd = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    const velocity = d.dy / Math.max(1, performance.now() - d.t)
    if (d.dy > 96 || (d.dy > 24 && velocity > 0.6)) closeRef.current?.click()
    else set(0, true)
  }
  return { ref, closeRef, handlers: enabled ? { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd } : {} }
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  swipeToClose = false,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  /** Bottom sheets only: grabber on top, drag down to close. */
  swipeToClose?: boolean
}) {
  const { ref, closeRef, handlers } = useSwipeToClose(swipeToClose && side === "bottom")
  const mobileSheet = swipeToClose && side === "bottom"
  return (
    <SheetPortal>
      {/* Phone sheets: a real scrim, so the board behind recedes like under a native sheet. */}
      <SheetOverlay className={cn(mobileSheet && "bg-black/40 dark:bg-black/60")} />
      <SheetPrimitive.Content
        ref={ref}
        {...handlers}
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10",
          // One surface from the rounded top edge down: no border line above the grabber.
          mobileSheet && "data-[side=bottom]:border-t-0",
          className
        )}
        {...props}
      >
        {mobileSheet && (
          <>
            <div data-sheet-drag aria-hidden className="flex h-6 shrink-0 touch-none items-center justify-center">
              <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            <SheetPrimitive.Close ref={closeRef} tabIndex={-1} aria-hidden className="hidden" />
          </>
        )}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
