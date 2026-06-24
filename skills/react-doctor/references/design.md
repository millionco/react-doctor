# Reviewing and improving UI

Improve interfaces with measured evidence from the rendered page, not taste alone. Use this when the user wants to build, polish, or review a UI: "looks off", "make this nicer", or a pasted screenshot.

The value here is what a screenshot and the live DOM let you measure that reading code cannot: contrast ratios, line length, the spacing scale, radius math, and tap-target size. Lead with those, then apply the craft eye across color, type, surfaces, icons, copy, states, and motion — squint at the composition, reject the slop defaults, polish the details that compound. The same loop covers animation: §15–17 are the motion ruleset, measured the same way.

## Capture the live page

```bash
npx react-doctor browser open http://localhost:3000
npx react-doctor browser screenshot --out review.png   # what the user actually sees
npx react-doctor browser eval --profile                # full picture incl. axe-core a11y: contrast, names, landmarks
```

Review breakpoints with `--viewport WIDTHxHEIGHT` (e.g. `--viewport 390x844` for a phone) on `screenshot`, `snapshot`, or `eval` — it emulates the size for that one command via a CDP override, never resizing your real window. Then measure specifics from the DOM with `eval` (computed styles, bounding boxes, color values) so findings are numbers, not opinions:

```bash
npx react-doctor browser eval 'page.evaluate(() => { const r = document.querySelector("button").getBoundingClientRect(); return { w: r.width, h: r.height }; })'
```

## 1. Measure (objective, in priority order)

`browser eval --profile` runs axe-core and reports contrast, missing names, heading order, and landmarks in its Accessibility section. Lead with these; a smarter model cannot dismiss a measured number as opinion. (If [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) is in your tools, its `lighthouse_audit` adds performance and best-practice findings.)

1. **Contrast**: body text at least 4.5:1, large text (≥ 24px, or ≥ 18.66px bold) at least 3:1. Report the actual ratio (axe gives it).
2. **Hit area**: interactive elements at least 44 × 44px (WCAG), or 40 × 40 with a smaller visible control. Measure the bounding box; a 20px icon needs an expanded hit area, and two hit areas must never overlap.
3. **Line length**: body copy roughly 45 to 75 characters per line.
4. **Spacing scale**: every gap, padding, and margin a multiple of one base (usually 4px). Flag ad-hoc values (`13px`, `7px`), and asymmetric padding where TLBR don't match without reason.
5. **Concentric radius**: a nested rounded element must satisfy `outer = inner + padding`. Mismatched nested radii are the most common "off" tell. Skip when padding > 24px — treat those as separate surfaces with independent radii.
6. **Optical alignment**: icon+text buttons want ~2px less padding on the icon side; triangular or asymmetric icons (play, caret, star) shift toward their visual center, not the geometric one.

## 2. Color

The foundation can't be patched by swapping a hex later — measure contrast first, then judge intent:

- **Gray builds structure; color communicates.** One accent used with intention beats five used by reflex; limit the accent to roughly one role per view. Unmotivated color is noise.
- **The palette should feel like it came from a world**, not applied to a wireframe. Name the specific quality (quiet/loud, dense/spacious, serious/playful) before picking values.
- **Use OKLCH**, and reduce chroma as lightness approaches 0 or 100 so dark/light extremes don't muddy.
- **Never `#000` or `#fff`** — tint every neutral toward the brand hue (chroma ~0.005–0.01). Pure gray and pure black read as untouched defaults.
- **Never gray text on a colored background** — use a darker/lighter shade of that color or an alpha of the foreground.
- **Keep one hue across surface levels; shift only lightness.** Different hues per level fragment the space.
- **Text hierarchy is four levels** (primary, secondary, tertiary, muted). Only two reads as flat.

## 3. Typography

- **Distinct levels at a glance, via size + weight + tracking — not size alone.** Headings: heavier weight, slightly tighter tracking. Body: comfortable weight and size. Labels: medium weight at small size. If a squint can't separate title from body, the hierarchy is too weak.
- **Body text ≥ 16px** on the web (smaller invites zoom and fails older eyes); set a deliberate type scale (one ratio, e.g. 1.2–1.333) rather than ad-hoc sizes.
- **Reject the default font reflex** (system/Inter/Roboto/Arial on a brand surface). Pick a face with intent — describe the brand as a physical object first, then choose; pair at most a display face with a body face, two or three families total.
- **Data wants monospace + `tabular-nums`** (numbers, IDs, codes, timestamps) so columns align and values don't jitter as they change.
- **Wrap on purpose**: `text-wrap: balance` for headings of ≤ 6 lines, `text-wrap: pretty` for body, so no orphaned last word.
- **All-caps and large display text need positive tracking**; tight tracking belongs on large headings, not small caps.

## 4. Surfaces, depth, and spacing

- **Pick one depth strategy and commit**: borders-only, a single subtle shadow, layered shadows, or surface-color shifts. Mixing them is the amateur tell.
  ```css
  --shadow-layered:
    0 0 0 0.5px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.04), 0 2px 4px rgba(0, 0, 0, 0.03),
    0 4px 8px rgba(0, 0, 0, 0.02); /* one shadow that doubles as a hairline ring */
  ```
- **Elevation = small lightness jumps on the same hue** (a few percent per level): base canvas → cards → dropdowns/popovers → stacked overlays. You barely see it but you feel it.
- **Borders are low-opacity rgba** (~0.05–0.12 alpha) that disappear until needed; a solid hex border looks harsh. Treat border strength as a scale, not on/off.
- **Inputs are inset** — slightly darker than their surroundings — signaling "type here" without a heavy outline. Give controls their own tokens, don't reuse surface tokens.
- **A sidebar shares the canvas background** with a divider border, not a different fill — different fills split the UI into two worlds.
- **Spacing is multiples of one base**; vary it for rhythm (same padding everywhere is monotony) but keep it explainable. Radius is a scale too — don't mix sharp and soft at random.
- **Nested cards are almost always wrong**; reach for an inset/alternate background or a divider before wrapping a card in a card. Use a fixed z-index scale, never arbitrary `z-[9999]`.

## 5. Icons and imagery

- **Icons clarify, not decorate** — if removing one loses no meaning, remove it.
- **One icon set, one stroke weight.** Prefer precise, lighter line icons over thick default sets; align icons optically (not mathematically) with adjacent text.
- **Icon-only buttons need an `aria-label`** (and `aria-hidden` on the icon); give a standalone icon a subtle background container for presence.
- **Frame untinted images** with an inset `outline: 1px solid rgba(0,0,0,.1)` (white/10 in dark mode), never a tinted slate/zinc border.

## 6. Copy

The words are part of the design; vague copy reads as unfinished:

- **Buttons are a specific verb + object** — never `OK`, `Submit`, `Yes`, `Continue`, or `Click here`. The label is the control's accessible name (`Save API key`, `Send invite`, `Delete account`).
- **Destructive actions name the destruction and the count**: `Delete 5 items`, not `Remove` or `Delete selected`. Confirmations are serious, not cute: `Delete this project? This can't be undone.`
- **Errors state the problem and the fix, in order** — what happened, why (if known), how to fix — in active voice, inline next to the field. No `Oops!`, no humor on frustration paths, no exclamation marks. Reframe to the value (`Enter a date as MM/DD/YYYY`), never blame the user.
- **Empty states are onboarding**: name what's empty, say why it matters, give one clear next action.
- **Loading copy is specific** (`Saving your draft…`), and scales to the wait: spinner alone < 2s, `Loading…` over 2s, progress + honest label over 10s.
- **Placeholders are examples, not labels** — the label lives in a real `<label>`; use the placeholder to show format (`name@example.com`).
- **Voice is constant; tone shifts by moment** (success brief, error empathetic, destructive grave). Labels describe (`Email address` over `Email`); link text stands alone (`View pricing plans`, never `here`). No emoji as UI chrome.

## 7. Interaction states

Every interactive element needs all eight, or it reads as a photograph of software:

- **default, hover, focus-visible, active, disabled** — plus the data states **loading, empty, error**.
- **Loading** uses skeletons over a centered spinner; **empty** states teach the interface; **errors** appear next to where the action happened.
- **One primary action per view** (filled), the rest secondary/ghost — competing primaries flatten the hierarchy.
- Use `AlertDialog` for destructive/irreversible actions, never block paste in inputs, and build custom components for native `select`/date controls (they can't be styled reliably). Reach for vetted accessible primitives rather than rebuilding keyboard/focus by hand, and don't mix two primitive systems in one surface.
- For the transitions on these states, see Motion (§15–17).

## 8. Accessibility (beyond the measured pass)

§1 catches contrast, names, heading order, and landmarks via axe. The rest needs judgment, fixed in priority order — names → keyboard → focus → semantics → forms/errors:

- **Accessible name on every control**: text button = its text; icon-only = `aria-label` + `aria-hidden` on the glyph; input/select/textarea = a real `<label htmlFor>` (or `aria-label`); link = descriptive text. Decorative `<svg>`/`<canvas>` gets `aria-hidden="true"` — skipping it is the modern a11y tell.
- **Keyboard works without a mouse**: no `<div onClick>` without `role` + `tabIndex` + a key handler; every control is reachable and operable by Tab/Enter/Space.
- **Visible focus**: never `outline: none` without a replacement ring; never a positive `tabIndex` (it breaks natural order).
- **Don't encode meaning in color alone** — pair status/error color with an icon or text.
- **Dialogs trap focus** while open and restore it to the trigger on close.

## 9. Dark mode

- **Preserve light mode's contrast ratios, don't invert** — re-pick panels, shadows, and decoration. Default to the OS `prefers-color-scheme`; add a manual toggle only when asked.
- **Surfaces**: a card sits slightly lighter than the page (e.g. `zinc-900` on `zinc-950`) with a `ring-1 ring-white/5` and **`shadow-none`** — ambient shadows are invisible on dark.
- **Drop large branded/colored panels** (use the same background plus a hairline divider), hide decorative gradient blobs (`dark:hidden`), and make decorative glyphs much fainter (`dark:text-white/5`).
- **One light color for all headings** (no accent + neutral mix); keep text contrast (primary ≥ 4.5:1, secondary ≥ 3:1) and mirror borders, focus, and disabled states in both themes.
- **Images**: ship real dark assets over CSS filters; `dark:invert dark:grayscale` on a screenshot is a stopgap; soften white-background images so they don't glow. Dark-only sites set `color-scheme: dark` on `<html>` so native scrollbars and controls follow.

## 10. Responsive

- **Mobile-first**: the smallest viewport is the default; `min-width` queries add complexity going up; never `max-width` as the primary direction. Breakpoints land where the **content** breaks (in `rem`), not at device sizes; three or four suffice. Never disable zoom in the viewport meta.
- **Size up on mobile, step down at `sm:`** — body `text-base` → `sm:text-sm`, inputs `py-2.5` → `sm:py-1.5`, inline icons `size-5` → `sm:size-4`. Exceptions: an `<h1>` stays the same or gets _smaller_ on mobile; multi-column layouts collapse to a single column (don't shrink the columns into unusable slivers).
- **Body ≥ 16px on mobile** (smaller triggers iOS input zoom). Use `clamp()` for sizes that scale continuously, media queries for discrete layout shifts.
- **Detect input by `pointer`/`hover`, not width** — a touchscreen laptop has a fine pointer too. Never ship a hover-only interaction with no tap path; coarse pointers get ≥ 44px targets.
- **Heights use `dvh`/`svh`**, never `width: 100vw` (it includes the scrollbar and overflows); pad for the notch with `env(safe-area-inset-*)`. Clickable text (buttons, nav, CTAs) must never wrap — shorten the label or `white-space: nowrap`.

## 11. Hierarchy and cognitive load

- **Working memory holds ≤ 4 items.** Keep top-level nav ≤ 5, form fields ≤ 4 per group, one primary action plus one or two secondary, dashboard metrics ≤ 4, pricing tiers ≤ 3.
- **One focal point**: something dominates by size, position, contrast, or surrounding space. When every element carries the same visual weight, nothing stands out (the "visual noise floor").
- **Eliminate extraneous load**: cut chrome that doesn't help the task, and use progressive disclosure instead of showing everything at once.

## 12. Squint at the composition

Step back from the screenshot. Correct is not the same as crafted:

- **Rhythm**: does density vary with purpose, or is every card the same size and gap (the flat "no one decided" look)?
- **Proportion**: do the specific numbers say something (a 280px sidebar serves the content; 360px makes them peers)? If you can't articulate what a proportion says, it says nothing.
- **Layout**: don't default to centering everything — left-aligned asymmetry or a confident strict grid reads as designed; a centered icon-title-subtitle stack reads as template. When cards are genuinely right, `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` stays responsive without breakpoints.
- **Backgrounds**: atmosphere and depth (subtle gradient, noise, layered transparency) beat a flat fill on brand surfaces.

## 13. Reject the slop defaults

The master gate: if someone could glance at the screen and say "AI made that" without doubt, it failed. The cliché is usually chosen by training data, not by you — and the obvious anti-cliché is the next trap:

| Domain                     | Reflex palette to avoid   |
| -------------------------- | ------------------------- |
| Observability / monitoring | Dark + saturated blue     |
| Fintech                    | Navy + gold               |
| AI / agents                | Purple + cream            |
| Crypto                     | Neon on black             |
| Dev tool                   | Monospace + dark gradient |

When the slop test fails, fix the upstream choice (the whole stance), not the surface — swapping a font or deleting a gradient won't repair a defaulted foundation. The common surface tells, each with its fix:

- Default font stack on a brand surface → commit to a typeface with intent.
- 1px gray border + a harsh uniform shadow → a layered `box-shadow` that doubles as a 1px ring (keep real borders only for dividers and input outlines).
- `transition: all` with `ease-in-out` on UI → transition specific properties, `ease-out`, under 300ms.
- Centered-everything, equal-weight grid → one focal point, intentional asymmetry.
- Orphaned heading words → `text-wrap: balance`; layout-shifting numbers → `font-variant-numeric: tabular-nums`.

## 14. Components

Recurring patterns where the defaults go wrong (platform-native surfaces — iOS/Android/terminal — are out of scope for web React review):

- **Buttons**: a secondary must never out-contrast the primary; inline form actions (`Change avatar`, `Resend code`) are secondary _and_ smaller than the submit, never the same height. Cap an app UI at two button sizes (≥ 6px apart) at compact `text-sm`; the icon-side padding equals the vertical padding so the glyph isn't stranded; a spinner replaces the label, it doesn't sit beside it.
- **Forms**: group related fields, label every control, validate on blur or submit (not keystroke), and show each error inline under its field. Placeholders show format, not the label.
- **Overlays**: pick by job — `Dialog` for a focused input task, a confirm/`AlertDialog` for destructive, `Sheet`/`Drawer` for side or mobile-bottom detail, `Popover` for small contextual content, hover card/tooltip for hover info. Prefer the native `<dialog>` (free focus-trap, escape, `::backdrop`); center modals (never corner-stuck), make the page behind `inert`, send first focus to the first field (not the close button), and use a 40–60% scrim. Flip popovers near the viewport edge and never clip them in an `overflow: hidden` parent; show one sheet/popover at a time, never cascade. **Prefer undo over confirm**: for reversible actions just do it and show a toast with Undo for 5–10s; keep the confirm (and type-to-confirm) only for irreversible destruction.
- **Tables**: sentence-case headers with `nowrap`; horizontal row dividers only (no vertical or outer borders); sit them on the background, not inside a card; `tabular-nums` for numeric columns; `aria-sort` when sortable; wrap in a horizontal-scroll container on small screens.
- **Navigation**: always ship a mobile menu; mark the active item with color or a soft/muted background — never a primary-color fill or a font-weight change between states; always show the current location.
- **Toasts**: auto-dismiss in 3–5s (5–10s with an Undo action), `aria-live="polite"`, and never steal focus; confirm completed actions with brief feedback that auto-dismisses.

## 15. Motion: when to animate, easing, duration

Motion is reviewed on the same loop — most "feel" problems are decidable from rules, and `browser eval '<repro>' --profile` shows whether the animation drops frames (see [performance.md](./performance.md)). Motion must earn its place: spatial continuity, state change, feedback, explanation, or preventing a jarring jump — not "it looks cool" on something seen often.

**Should it animate?**

| Frequency                                       | Decision                     |
| ----------------------------------------------- | ---------------------------- |
| 100+×/day (keyboard shortcuts, command palette) | No animation, ever           |
| Tens of ×/day (hover, list nav)                 | Remove or drastically reduce |
| Occasional (modals, drawers, toasts)            | Standard animation           |
| Rare / first-run (onboarding, celebration)      | Can add delight              |

Never animate a keyboard-initiated action — it repeats hundreds of times a day, and motion makes it feel slow.

**Easing**: `ease-out` for enter/exit (and the default), `ease-in-out` for on-screen movement, `ease` for hover/color, `linear` only for constant motion. Never `ease-in` on UI — it delays the moment the user is watching. Built-in curves are weak; use strong custom ones:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

**Duration**: button press 100–160ms, tooltips 125–200ms, dropdowns 150–250ms, modals/drawers 200–500ms. UI animations stay under 300ms — a 180ms dropdown feels more responsive than a 400ms one.

## 16. Motion: physics, interruptibility, choreography

- **Physicality**: never `scale(0)` (start from `scale(0.9–0.97)` + `opacity: 0`); scale popovers from the trigger via `transform-origin`, but keep modals centered; press feedback is `transform: scale(0.97)` on `:active` (160ms ease-out). Springs simulate physics for drag, "alive", and interruptible motion — keep bounce subtle (0.1–0.3) and out of most UI: `{ type: "spring", duration: 0.5, bounce: 0.2 }`.
- **Interruptibility**: CSS transitions retarget mid-flight; keyframes restart from zero, so prefer transitions for rapidly-triggered elements. Drive entry without JS via `@starting-style`:
  ```css
  .toast {
    opacity: 1;
    transform: translateY(0);
    transition:
      opacity 400ms ease,
      transform 400ms ease;
    @starting-style {
      opacity: 0;
      transform: translateY(100%);
    }
  }
  ```
  Use **asymmetric timing**: slow where the user decides, fast where the system responds.
- **Choreography**: stage in sequence (backdrop → panel → control), don't animate many things at once. Stagger group entrances 30–80ms apart (decorative, never blocking interaction). Soften abrupt stops with a slight overshoot; reserve anticipation/exaggeration/secondary flourishes for rare moments, and for frequent elements often animate only the exit.

## 17. Motion: performance and accessibility

Measure jank with `browser eval '<repro>' --profile`: a long animation frame attributed to a layout or paint property, or heavy style-recalc/layout in the timeline, is your evidence. Rendering steps: **composite** = `transform`/`opacity`; **paint** = color/border/gradient/filter; **layout** = size/position.

- **Animate only `transform` and `opacity`** — GPU, skipping layout and paint. Never `width`/`height`/`top`/`left`/`margin`/`padding`.
- **Never drive child transforms via a CSS variable on the parent** (it restyles every child); set `transform` on the element directly.
- **Library `x`/`y`/`scale` shorthands aren't always hardware-accelerated** — animate the full `transform` string.
- **CSS and WAAPI run off the main thread**; rAF stutters under load. Use CSS for predetermined motion, JS for interruptible; WAAPI gives JS control at compositor speed.
- **Scroll-linked**: Scroll/View Timelines (`animation-timeline: view()`) or `IntersectionObserver`, never scroll events; pause off-screen.
- **Layout-like moves**: FLIP — measure first and last, animate the delta via `transform`; batch all reads before writes.
- Blur ≤ 8px and one-shot only; `will-change` only on elements about to animate (removed after); view transitions for navigation only. `clip-path: inset(...)` powers reveals/wipes; `translate` percentages are element-relative; `scale()` scales children too.
- **Gestures**: momentum dismissal (velocity `abs(distance)/elapsedMs > ~0.11`), damping past edges, pointer capture once dragging starts, ignore extra touch points after a drag begins.

**Accessibility**: reduced motion means fewer and gentler, not none — keep opacity/color, drop movement.

```css
@media (prefers-reduced-motion: reduce) {
  .el {
    animation: fade 0.2s ease;
  }
}
@media (hover: hover) and (pointer: fine) {
  .el:hover {
    transform: scale(1.05);
  } /* touch fires false hovers */
}
```

**Reviewing motion** — block on sight: `transition: all`; `scale(0)`; `ease-in` on UI enter/exit; keyframes on a rapidly-retriggered element; animating a layout or paint property; scroll-event-driven motion; a CSS-variable-on-parent recalc storm. Remediate cheapest-first: delete → reduce → fix easing → fix `transform-origin` → make interruptible → move to `transform`/`opacity` → asymmetric timing → polish → reduced-motion.

## The loop

Build or fix, screenshot, re-measure, compare. Confirm the measured issue you targeted actually moved — the ratio crossed the threshold, the target grew, the nested radii now match — and that the screenshot reads better before and after.

## Working rules

- Always look at the screenshot; never review UI from JSX alone.
- Report measured findings with their numbers; keep taste suggestions short and clearly separate from the measured ones.
- The correct fix is simpler than the hack: prefer flex + section padding over negative margins, `max-width` + auto margins over absolute positioning, real tokens over `calc()` workarounds.
