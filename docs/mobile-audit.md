# Mobile audit

The web UI was first built for a desktop browser. An audit then measured every screen on phones and
fixed what got in the way, without changing the desktop by a single pixel
([ADR 0011](decisions/0011-touch-sizing-desktop-unchanged.md)). This page lists the standards the web
UI and the app follow, what was measured, what changed, and what is still open.

Related: [design.md](design.md), [architecture.md](architecture.md).

## How it was measured

- Playwright against the built UI, with every API call answered from synthetic fixtures (no backend).
- Phones: 390 × 844 (iPhone 15), 375 × 667 (iPhone SE), 412 × 915 (Pixel 9), all with touch
  (`pointer: coarse`), light and dark, 16 screens each.
- A target passes if a hit test within ±21 px of its centre lands on it. An enlarged hit area
  counts; an overlapping neighbour makes it fail.

**Before:** 111 / 106 / 114 targets below 44 px on the three phones, input fields at 14–15 px, and no
horizontal overflow. **After:** 0 / 0 / 0, no field below 16 px, desktop unchanged.

## Standards checklist

| Standard | Rule | Source | Status |
|---|---|---|---|
| Touch targets | ≥ 44 × 44 px for every control on touch screens | Apple HIG, WCAG 2.5.5 | Done; checked by `web/e2e/touch-targets.spec.ts` |
| Spacing | ≥ 8 px between neighbouring targets | Material 3, web.dev | Done |
| Input text | ≥ 16 px in every field, so iOS does not zoom on focus; no `maximum-scale=1` | Community consensus, WCAG zoom | Done; checked by the same test |
| Smallest text | ≥ 11 px (timestamps, badges, labels) | Apple HIG | Done on touch screens |
| Keyboard (Android) | `interactive-widget=resizes-content` in the viewport meta | Chrome 108+ | Done |
| Keyboard (iOS) | VisualViewport sets `--keyboard-inset`; composer and sheets sit above the keyboard | MDN | Done; tested with a simulated keyboard |
| Return key | On touch, Enter makes a new line; the button sends | Phone keyboards have no Shift+Enter | Done |
| Safe areas | `viewport-fit=cover` and `env(safe-area-inset-*)` on tab bar, sheets, FAB | MDN | Done |
| Edge to edge | Page colour in status bar and home-indicator area; `theme-color` follows the theme | PWA practice | Done |
| Sheets | Grabber, swipe down to close, spring back on a short drag, no autofocus on open | Apple HIG | Done |
| Tab bar | Visible on Board and Inbox; 64 px plus safe area | Material 3 | Done |
| FAB | "New chat" as an extended FAB, 56 px high | Material 3 | Done |
| Tabs | Real `tablist` / `tab` / `tabpanel` roles with `aria-selected` | WAI-ARIA | Done |
| No hover-only actions | Everything shown on hover is visible on touch; `:active` feedback | MDN | Done |
| Accessible names | Icon buttons have `aria-label` | WCAG 4.1.2 | Done |
| Tap behaviour | `touch-action: manipulation`, transparent tap highlight, no page overscroll | MDN | Done |
| Image zoom | Pinch and double tap zoom only the image; the page scale stays 1 | – | Done; tested via `visualViewport.scale` |
| Haptics | Short vibration on send, answer, column change, long-press (Android only, never the only feedback) | MDN | Done |
| Reduced motion | `prefers-reduced-motion` shortens all animations | WCAG 2.3.3 | Done |
| Contrast | Text 4.5:1, controls and icons 3:1 | WCAG 1.4.3, 1.4.11 | Mostly; two token pairs fall just short (open) |

## What changed

**Composer.** One row: attach (44 px) on the left, a 16 px text field that grows up to 240 px, and one
round button on the right. That button is the mic when the field is empty, send when there is text,
stop while recording, and "stop turn" while Hermes works. The inner box that looked unclean in dark
mode is gone. Drafts survive closing the thread.

**Thread.** Opens as a bottom sheet with a grabber; drag the grabber or the header down to close. The
header is compact (16 px title, at most two lines). The session id is hidden on phones. The column is a
chip ("● Waiting ⌄") that opens a bottom sheet with 52 px rows. Grabber, header and transcript share one
surface colour; the board behind is dimmed (40 % light, 60 % dark).

**Board.** Column tabs are real tabs, 44 px high. Swiping sideways switches the column. A long-press
(480 ms) opens "Move to" without opening the thread. A hint line explains both gestures.

**Dialogs.** New chat, notifications, remote access and the push confirmation open as bottom sheets on
phones, above the keyboard. From 768 px on they stay centred dialogs.

**Search.** Full screen on phones with a "Cancel" button, 16 px field, full-size "include archived"
switch.

**Approvals and clarify prompts.** 44 px buttons in full width; clarify options 44 px; "skip" with an
enlarged hit area.

**Inbox.** Full-width 44 px filters; accessible names for "mark all read", "open in thread" and the
source filter.

**Image viewer.** Full screen on black: pinch up to 6×, double tap to zoom in and out, pan when zoomed,
swipe down to close when not zoomed, a 44 px close button. The desktop lightbox is unchanged.

**How:** a `touch:` Tailwind variant, the tokens `--touch-target`, `--keyboard-inset` and
`--visual-height`, a `.touch-hitbox` utility, sizes inside the shadcn components, `swipeToClose` on
`Sheet`, `mobileSheet` on `Dialog`, `submitOnEnter` on the prompt input, and the hooks `useTouchUI`
and `useKeyboardInset`.

## Tests

`npm run test:ui` runs, on the built bundle:

- `touch-targets`: every screen on three phones (now 17 screens including the zoomed viewer).
- `mobile-behaviour`: sheet swipe and spring-back, long-press move, column swipe, Enter in the
  composer, sheets above a simulated iOS keyboard, draft kept, pinch, double tap, swipe-to-close only
  when not zoomed.
- `desktop-regression`: 15 desktop screens × light/dark at 1440 × 900, zero-pixel tolerance against
  baselines taken before the mobile work.

## Deliberately not done

| Idea | Why not |
|---|---|
| Swipe actions on cards (e.g. swipe to Done) | Sideways swipe already switches columns; two horizontal gestures on one list collide. Long-press moves cards. |
| Pull to refresh (web) | The board is live over SSE; it would also compete with the sheet's swipe. |
| Approve directly on a board card | Cards are buttons; nested buttons are invalid HTML. The inbox already answers without opening the thread. |
| Medium sheet detent | The sheet uses 94 dvh, which matches the large detent; a half-height state was not needed. |

## Open items

- **Contrast:** white on the indigo primary is 4.38:1 and muted text on muted surfaces in light mode is
  4.39:1, just under WCAG AA. A slightly darker primary would fix it but changes the desktop too.
- **Desktop composer in dark mode** shows a faintly lighter inner box. It was left alone to keep the
  desktop pixel-identical; a one-line change if wanted.
- **Real devices:** all checks ran in Chromium with touch emulation. iOS Safari behaviour (keyboard
  inset, `theme-color` while a sheet is open, Home Screen PWA) needs confirmation on hardware.
  `--keyboard-inset` may lag briefly when the visual viewport scrolls on iOS.
- **Android system bar:** if Chrome does not draw under the gesture bar of an installed PWA, Android
  colours that bar itself. The manifest `theme_color` is dark because a manifest cannot follow the
  theme.

## Native app

The native app (`app/`) follows the same rules with native components: column pager with
synced tabs, bottom sheets (220 ms in, 160 ms out, swipe to close), pinch-zoom viewer, composer above
the keyboard, haptics, hardware back that closes the top layer first, and edge-to-edge system bars in
theme colours. Known gaps:

- Android's predictive back animation is off (back works, without the preview).
- Four column labels may get tight on very narrow phones (360 dp); only wider screens were checked.
- A chat's full history is fetched on every refresh; a paged API would help on slow networks.
- Moving cards uses the column sheet; there is no drag and drop in the app.
