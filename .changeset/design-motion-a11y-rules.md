---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

Add design-quality lint rules distilled from a cross-resource design reference, spanning motion performance, accessibility, and Tailwind/JSX hygiene.

**Motion**

- **`no-transition-all`** (extended) — now also flags the Tailwind `transition-all` class (was inline-`style`-only). Animating every property that changes includes expensive layout properties and instant ones like focus rings; name the properties (`transition-colors`, `transition-transform`).
- **`no-tailwind-layout-transition`** — Tailwind arbitrary `transition-[width|height|top|left|right|bottom|margin|padding]`, which animates layout properties the browser recomputes every frame. Animate `transform`/`opacity` instead.
- **`no-ease-in-motion`** — exact inline, Motion, and Tailwind `ease-in` timing that delays the visible response; preserves `ease-in-out` and dynamic timing values.
- **`no-scale-from-zero`** (extended) — now covers inline transform transitions and Tailwind scale transitions in addition to proven Motion components.

**Accessibility**

- **`no-autoplay-without-muted`** — `<video autoPlay>` / `<audio autoPlay>` missing `muted` (sound-on autoplay is hostile to users and browser-blocked). Skips dynamic `autoPlay`, spreads, and truthy/dynamic `muted`.
- **`no-uninformative-aria-label`** — an `aria-label` whose value is a content-free element-type word (`"icon"`, `"button"`, `"image"`, `"link"`, …) that tells screen-reader users nothing about the action.
- **`no-low-contrast-inline-style`** — computes the real WCAG 2.1 contrast ratio from a co-located inline `color` + `backgroundColor` and flags pairs below 4.5:1 (3:1 for large/bold text). Only fires on opaque, statically-resolvable colors (skips alpha, `var()`, gradients).
- **`no-broken-image-source`** — intrinsic `<img>` elements with missing, empty, or hash-only static sources; skips dynamic and spread-provided sources.
- **`no-placeholder-only-field`** — text inputs and textareas that rely on placeholder text without an associated label; recognizes wrapping labels, `htmlFor`, explicit ARIA names, and uncertain spread props.
- **`no-all-caps-body-text`** — long semantic body passages transformed to uppercase or authored entirely in capitals; short labels and headings remain valid.
- **`no-tight-body-leading`** — long body copy with a statically proven line-height ratio below 1.3, including precise inline values and Tailwind's tight leading utilities.
- **`no-crushed-letter-spacing`** — static inline or arbitrary Tailwind tracking below -0.08em on text-bearing elements.
- **`no-overwide-text-measure`** — explicit body-text widths above 80ch in inline styles or arbitrary Tailwind utilities.
- **`no-skipped-heading-level`** — opt-in analysis of explicit heading sequences inside static page or article trees, without inferring across component boundaries.

**Design / Tailwind hygiene**

- **`no-redundant-display-class`** — a display utility matching the element's default (`block` on a `<div>`, `inline` on a `<span>`); skips variant-prefixed and meaningful displays (`flex`, `grid`, `hidden`).
- **`prefer-truncate-shorthand`** — `overflow-hidden text-ellipsis whitespace-nowrap` collapses to the single `truncate` utility.
- **`no-full-viewport-width`** — `w-screen` / `w-[100vw]` / inline `100vw`, which overflows horizontally when a scrollbar is visible; prefer `w-full` / `width: 100%`.
- **`no-svg-currentcolor-with-fill-class`** — `fill="currentColor"` / `stroke="currentColor"` fighting a `fill-*` / `stroke-*` color class (the class silently wins); keep one, or use `fill-current`.
- **`no-clipped-overlay`** — absolute menus, listboxes, dialogs, and tooltips nested under `overflow-hidden` or `overflow-clip` containers.
- **`no-nested-card-surface`** — opt-in detection for a complete rounded, bounded card treatment nested inside another card surface.
- **`no-side-tab-border`** (extended) — also recognizes heavy top or bottom accents on rounded surfaces while preserving square dividers.
- **`no-oversized-long-heading`** — opt-in detection for sentence-length `<h1>` copy set at an explicit hero display size.
- **`no-italic-serif-display-heading`** — opt-in detection for oversized headings that combine serif and italic treatments.
- **`no-repeated-kicker-labels`** — opt-in file-level detection for three or more short uppercase tracked labels immediately preceding headings.
- **`no-numbered-section-markers`** — opt-in detection for consecutive decorative number labels preceding section headings.

**Tailwind canonicalization** (distilled from ui.sh's canonicalize-tailwind guidance)

- **`no-deprecated-tailwind-class`** — Tailwind v4 renamed/removed `bg-gradient-*` → `bg-linear-*`, `flex-shrink-*` → `shrink-*`, `flex-grow-*` → `grow-*`, `overflow-ellipsis` → `text-ellipsis`. Gated on a new `tailwind:4` capability so v3 projects are unaffected.
- **`no-arbitrary-px-font-size`** — `text-[13px]` doesn't scale with the user's root font size; use rem (`text-[0.8125rem]`). Pixels stay fine for `border-*`/`outline-*`.
- **`prefer-dvh-over-vh`** — `h-screen`/`min-h-screen`/`h-[100vh]` overflow under mobile browser chrome; prefer `dvh` (`h-dvh`/`min-h-dvh`). Gated on `tailwind:3.4`.

Also adds a `tailwind:4` project capability to `@react-doctor/core` for version-gated Tailwind rules.
