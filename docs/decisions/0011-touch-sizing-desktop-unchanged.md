# 0011: Touch sizing inside the base components, desktop pixel-identical

- **Status:** Accepted
- **Date:** 2026-11

## Context

A mobile audit of the web UI found 106–114 touch targets below 44 px per phone and input fields with
14–15 px text, which makes iOS Safari zoom in on focus ([mobile-audit.md](../mobile-audit.md)). The
desktop layout was considered good and must not get worse.

## Decision

- Change only what touch screens see: Tailwind variant `touch:` (`@media (pointer: coarse)`) for sizes
  and `max-md:` (< 768 px) for layout. A mouse never matches `pointer: coarse`.
- Put the rules into the existing shadcn components (`Button`, `Input`, `Textarea`, `Select`,
  `Toggle`, `Switch`, `Checkbox`, `Command`, `Sheet`, `Dialog`), not into a new `size="touch"` variant.
  Every existing and future size becomes at least 44 px on touch screens without anyone having to
  remember it.
- For small elements that should not look bigger, a `.touch-hitbox` utility enlarges only the hit area
  to `--touch-target` (44 px).
- Guard the result with tests: a hit-test check of every interactive element on every screen for
  three phone sizes, and a pixel comparison of desktop screens against baselines with zero tolerance.

## Consequences

- Touch-target failures went to zero on all tested phones; no field is below 16 px.
- The desktop stays pixel-identical, proven by the regression test.
- Some improvements that would change shared tokens were deferred, for example the contrast of white
  on the indigo primary (4.38:1, just under WCAG AA).
- Desktop screenshots are rendered on macOS; other systems render fonts differently, so the regression
  baselines are platform-specific.

## Alternatives considered

- **A separate mobile component set:** duplicated code and drift.
- **A `size="touch"` variant set per call site:** easy to forget.
- **Disabling zoom (`maximum-scale=1`) instead of 16 px fields:** hurts accessibility (WCAG asks for
  2× zoom).
