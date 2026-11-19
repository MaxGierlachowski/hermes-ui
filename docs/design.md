# Design

Hermes UI is a tool you glance at many times a day: which chats need me, what is running, what just
finished. The design keeps that calm and fast. This page describes the direction, the tokens as they
are in the code, and the rules that came out of real use. Phone-specific standards are in
[mobile-audit.md](mobile-audit.md).

## Direction

The look started from a handful of public Dribbble shots of agent Kanban boards, an AI chat with a
contextual side panel, and later from mobile chat and task apps (ChatGPT, Claude, Linear, Slack,
Todoist). What was taken from them:

- **A quiet, Linear-like surface.** Neutral greys, hairline borders, almost no colour. Depth comes from
  one step of lightness per layer (canvas, column, card), not from shadows.
- **One accent.** Indigo, used only for the primary action, focus and selection.
- **Status as a small dot,** not as coloured cards. Live state pulses; nothing flashes.
- **Cards say what the agent is doing now:** title, one muted line of current activity (tool call,
  last reply, or the open question), source and time.
- **A thread like a chat app:** the user's messages in a grey bubble on the right; Hermes' text without
  a bubble on the canvas; tool calls as one-line monospace chips that expand.
- **Approvals stand out without shouting:** a block with an amber left border, the command or question,
  a primary "Allow" and a quiet "Deny". After an answer it collapses to one line.
- **Desktop:** the thread is a resizable panel next to the board, without a backdrop.
- **Phone:** the thread is a bottom sheet, columns are tabs, approval buttons are full width, the
  composer is one pill-shaped row (attach · text · one round button that is mic, send or stop).

## Principles

1. **Calm by default.** Colour only for state and the one primary action.
2. **No layout jumps.** Optimistic updates (a dragged card lands where it was dropped), images keep their
   aspect ratio, new messages append at the bottom.
3. **Show the last known state at once,** then refresh quietly (the app's cache, thin progress bar).
4. **Never lose what the user typed.** Drafts survive closing a thread; messages sent during a turn stay
   visible as "waiting".
5. **Not everything in a user row is the user.** Webhook and cron deliveries, background notices and
   gateway metadata render as event cards or meta lines, never as the user's bubble.
6. **Touch is first-class, desktop stays exact.** Touch changes live behind `pointer: coarse`.
7. **Edge to edge.** The page colour fills status bar and home-indicator areas; no foreign colour strips.
8. **Respect the system:** light or dark from the OS by default, `prefers-reduced-motion`, the device
   language.

## Colour

Web tokens are CSS variables in `web/src/index.css` (OKLCH). The app uses the same values as hex in
`mobile-app/src/lib/theme.ts` and its global CSS.

| Token | Light | Dark |
|---|---|---|
| `background` | `#fafafa` (oklch 0.985 0 0) | `#09090b` (oklch 0.141 0.005 286) |
| `foreground` | `#09090b` | `#fafafa` |
| `card`, `popover` | `#ffffff` | `#18181b` (oklch 0.21) |
| `muted`, `secondary`, `accent` | `#f4f4f5` | `#18181b` / `#27272a` |
| `muted-foreground` | `#71717b` | `#9f9fa9` |
| `border`, `input` | `#e4e4e7` | `#27272a` |
| `primary`, `ring` | `#615fff` (oklch 0.585 0.233 277) | same |
| `destructive` | `#e7000b` | `#ff6467` |

**Status colours** (Tailwind palette, same on web and app):

| State | Colour |
|---|---|
| New Task | zinc-400 (zinc-500 in dark) |
| Doing | indigo-500, pulsing while a turn runs |
| Waiting, open approval | amber-500 |
| Done, connected, success | emerald-500 |
| Error, disconnected | red-500 |

Approval and permission blocks use a 3 px amber left border with a light amber tint. The installed
PWA's `theme-color` is `#fafafa` / `#09090b` and follows the theme at runtime. Code blocks use Shiki
with a light and a dark theme.

## Typography

- **Web:** [Geist](https://vercel.com/font) (variable, OFL-1.1) for everything, with the stylistic
  alternates `cv11` and `ss01`; monospace for code, paths and tool chips.
- **App:** the platform's system font, so text scales with the OS settings; monospace for code.
- **Sizes:** dense on desktop. On touch screens no text is below 11 px and every input field uses
  16 px.
- Long URLs and code wrap anywhere; wide tables scroll inside themselves. Nothing may make a thread
  wider than the screen.

## Shape

- Base radius `--radius: 0.5rem` (8 px). Derived steps: 0.6×, 0.8×, 1.4×, 1.8× and more.
- Bottom sheets on phones: 16 px top corners. The touch composer: 22 px (pill).
- 1 px borders at rest; no resting shadows.

## Components

**Web (`web/`):** [shadcn/ui](https://ui.shadcn.com) (style `radix-nova`, Radix and Base UI
primitives) on Tailwind 4, plus:

- Dice UI Kanban on dnd-kit for the board,
- prompt-kit for the composer, chat container, markdown and loaders,
- cmdk for the ⌘K palette, sonner for toasts, react-resizable-panels for the thread panel,
- next-themes for light/dark, lucide icons, react-zoom-pan-pinch for the touch image viewer.

Touch sizing is built into the base components ([ADR 0011](decisions/0011-touch-sizing-desktop-unchanged.md)),
so there is no separate mobile component set.

**App (`mobile-app/`):** NativeWind 4 (Tailwind classes in React Native) with the same tokens, a small
set of own primitives (button, input, badge, text, icon), lucide icons, react-native-marked for
Markdown, FlashList for lists, a native pager for the board columns, and Reanimated for motion.

## Motion

| Where | Duration |
|---|---|
| Web hovers, state changes | mostly 100–200 ms |
| App screen push (iOS-style slide) | 250 ms on iOS, 200 ms on Android |
| App bottom sheet | 220 ms in (ease-out), 160 ms out |
| App image viewer | 150 ms fade in, 120 ms out |
| Status dot pulse, progress bar | 1.1 s loop |
| Background refresh indicator | appears only after 150 ms, so fast refreshes do not flicker |

Ease-out, no bouncy springs for layout. Sheets spring back only when a drag is too short to close.
The web UI shortens every animation to 1 ms under `prefers-reduced-motion`.

## Light and dark

Both themes use the same token names. The default follows the system; the user can override it (⌘K on
the web, settings in the app). Dark mode raises surfaces one step per layer instead of adding shadows.
The accent stays the same in both themes.

## Language

English is the default; German is built in. German strings are the source keys and the English texts
live in `shared/i18n-en.ts`, shared by web and app. The web UI follows the browser language and can be
switched in ⌘K; the app follows the device language. Texts the backend generates (card activity lines,
notification labels) follow `HERMES_UI_LANG`.

## Naming

The product is called **Hermes UI** everywhere a user sees a name: page title, PWA manifest,
Home Screen title, app name, icons. "Kanban" describes the layout, not the product.
