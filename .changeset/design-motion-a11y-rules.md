---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

Add deterministic design-quality lint rules spanning motion performance, accessibility, and Tailwind/JSX hygiene.

**Motion**

- **`no-conflicting-spring-options`** — proven Motion transition objects that combine physics spring controls (`stiffness`, `damping`, or `mass`) with duration controls (`duration` or `bounce`) that Motion ignores. Handles direct and nested transition objects while skipping dynamic and spread-overridden configurations.
- **`prefer-motion-transform-property`** — opt-in guidance for compositor-critical Motion animations that use individual transform keys instead of one directly accelerated `transform` value. Scope resolution limits findings to actual Motion components.
- **`pointer-capture-needs-cancel-handler`** — manual intrinsic-element drags that capture their pointer and define move/up handling without a pointer-cancel or lost-capture cleanup path. Requires a proven local `event.currentTarget.setPointerCapture(event.pointerId)` call and skips spreads, custom components, nested callbacks, and uncertain handlers.
- **`no-unthrottled-scroll-mutation`** — direct animation-style writes or `Element.animate()` calls from an unthrottled native scroll listener. Read-only handlers, small class toggles, non-animation style changes, timer throttles, and unknown emitters remain valid.
- **`no-unbounded-animation-frame-loop`** — opt-in detection for a self-rescheduling `requestAnimationFrame` callback with no stop gate and no retained request ID.
- **`no-layout-property-animation`** (extended) — now inspects statically provable Web Animations API keyframes in addition to Motion props.
- **`no-large-animated-blur`** (extended) — now covers Motion and Web Animations keyframes while no longer misclassifying a static inline blur as animation.
- **`no-permanent-will-change`** (extended) — now recognizes permanently active static Tailwind `will-change-*` utilities while preserving state-prefixed and scroll-position cases.
- **`no-global-css-variable-animation`** (narrowed) — reports animated variables only on the document root or body, avoiding false positives for variables deliberately scoped to one element.
- **`no-transition-all`** (extended) — now also flags the Tailwind `transition-all` class (was inline-`style`-only). Animating every property that changes includes expensive layout properties and instant ones like focus rings; name the properties (`transition-colors`, `transition-transform`).
- **`no-tailwind-layout-transition`** — Tailwind arbitrary `transition-[width|height|top|left|right|bottom|margin|padding]`, which animates layout properties the browser recomputes every frame. Animate `transform`/`opacity` instead.
- **`no-ease-in-motion`** — exact inline, Motion, and Tailwind `ease-in` timing that delays the visible response, including transition configuration nested inside static Motion animation targets; preserves `ease-in-out` and dynamic timing values.
- **`no-long-transition-duration`** (extended) — now covers static Motion transition objects, including nested transition configuration, while preserving perpetual loops, decorative hidden motion, dynamic values, unproven components, and duration values ignored by physics-based springs.
- **`no-scale-from-zero`** (extended) — now covers inline transform transitions and Tailwind scale transitions in addition to proven Motion components.
- **`no-excessive-motion-stagger`** — opt-in detection for proven Motion stagger intervals above 80 ms, including `staggerChildren` and scope-resolved `stagger()` calls used by `delayChildren`.

**Accessibility**

- **`no-static-motion-config-never`** — root application Motion policies that permanently opt out of the user's reduced-motion setting. Subtree policies, dynamic user preferences, aliases, development conditionals, spreads, and non-Motion components remain valid.
- **`no-blocked-paste`** — password, username, and one-time-code inputs whose paste handler definitely prevents the event, while preserving conditional policies, custom controls, spread-owned handlers, and non-authentication confirmation fields.
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
- **`no-cramped-container-padding`** — text inside an explicitly bounded or colored surface with less than 8px of static padding.
- **`no-assertive-status`**: flags status regions that use assertive live announcements instead of a deliberate alert.
- **`no-focusable-content-in-aria-hidden`**: finds statically focusable descendants inside an `aria-hidden` subtree.
- **`no-multiple-unlabeled-navigation-landmarks`**: finds static JSX trees with multiple unnamed navigation landmarks.
- **`no-aria-invalid-without-description`**: opt-in detection for invalid controls that do not reference explanatory text.
- **`details-requires-summary`**: opt-in detection for native disclosure widgets without a first-child summary.
- **`fieldset-requires-legend`**: opt-in detection for field groups with multiple controls but no direct legend.
- **`data-table-requires-accessible-name`**: opt-in detection for tables with header cells but no caption or ARIA name.
- **`no-multiple-main-landmarks`**: finds static JSX trees with multiple main landmarks.
- **`no-nonresizable-textarea`**: opt-in detection for textareas that disable both resize axes.
- **`form-control-requires-name`**: opt-in detection for native form controls that cannot contribute a name to form submission.
- **`no-ungated-tailwind-animation`**: opt-in detection for continuous Tailwind animations without a reduced-motion gate.
- **`no-transitioned-focus-ring`** — detects Tailwind focus rings or outlines whose box-shadow/outline transition delays visible keyboard focus; color-only hover transitions remain valid.

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
- **`no-image-hover-transform`** — opt-in detection for images that scale or rotate on hover through static Tailwind utilities.
- **`no-repeating-gradient-decoration`** — opt-in detection for repeating CSS gradients used as generic surface texture.
- **`no-hairline-border-wide-shadow`** — opt-in detection for card treatments that combine a one-pixel border with a broad shadow.
- **`no-icon-tile-heading-stack`** — opt-in detection for repeated card composition built from a colored icon tile followed by a heading.
- **`no-hero-eyebrow-chip`** — opt-in detection for tracked uppercase eyebrow copy placed immediately before an oversized hero heading.
- **`no-common-root-font`** — opt-in detection for page roots that explicitly select a commonly reused UI font.
- **`no-default-warm-page-surface`** — opt-in detection for full-page warm-neutral Tailwind surfaces.
- **`no-default-purple-page-gradient`** — opt-in detection for full-page purple-to-blue or purple-to-cyan Tailwind gradients.
- **`no-flat-page-type-scale`** — opt-in page-level analysis for three or more explicit text sizes compressed into less than a 2× range.
- **`no-monotonous-page-spacing`** — opt-in page-level analysis for a dominant spacing value repeated across a sufficiently large static sample.
- **`no-generic-marketing-copy`** — opt-in detection for broad promotional phrases in static page or article copy.
- **`no-manufactured-contrast-copy`** — opt-in detection for pages that repeatedly frame claims as short artificial contrasts.
- **`no-decorative-grid-background`** — opt-in detection for layered one-pixel linear gradients that draw a coordinate grid outside data-visualization contexts.
- **`no-smooth-scroll-without-reduced-motion`**: opt-in detection for smooth-scrolling utilities without a reduced-motion override.
- **`no-inert-sticky-position`**: opt-in detection for sticky elements without a static inset anchor.
- **`no-img-without-dimensions`**: opt-in detection for images without intrinsic dimensions or a statically reserved CSS box.
- **`no-small-form-control-text`**: opt-in detection for native controls with a static font size below 16 px.
- **`no-undersized-icon-button`**: opt-in detection for icon-only buttons with a provable target below 24 px on either axis.
- **`no-layout-shifting-interaction-state`**: opt-in detection for interaction utilities that change layout geometry or font metrics.
- **`no-hover-only-reveal`**: opt-in detection for content revealed on hover without an equivalent keyboard-focus state.
- **`no-fixed-inside-transformed-ancestor`**: opt-in detection for fixed descendants whose static ancestor establishes a containing block.
- **`no-decorative-blur-orb`** — opt-in detection for empty, absolutely positioned, strongly blurred circular color fields used as generic decoration.
- **`no-repeated-glass-surfaces`** — opt-in page-level detection for three or more complete translucent, blurred, bordered, and rounded surface treatments.
- **`no-excessive-pill-treatment`** — opt-in page-level detection for five or more short labels or actions presented as filled or outlined pills.
- **`no-uniform-feature-card-grid`** — opt-in detection for grids whose direct children all repeat the same complete card, heading, and paragraph composition.
- **`no-excessive-centered-copy`** — opt-in page-level detection for repeated substantial paragraphs set as centered copy.
- **`no-full-viewport-centered-hero`** — opt-in detection for structurally simple hero sections that combine full-viewport height, centered layout, and a primary heading.
- **`no-repeated-emoji-tiles`** — opt-in page-level detection for three or more emoji-only glyphs placed in small, rounded, colored square tiles.
- **`no-uppercase-mono-label`** — opt-in detection for static short labels that combine monospace, uppercase, and explicit tracking while preserving code elements and dynamic identifiers.
- **`no-tight-display-tracking`** — opt-in detection for static primary headings using Tailwind's tightest built-in letter spacing.
- **`no-excessive-card-surfaces`** — opt-in page-level detection for six or more complete card surfaces in a static page tree.
- **`no-repeated-section-shells`** — opt-in detection for pages that repeat the same large vertical section padding and centered max-width wrapper structure at least three times.
- **`no-pure-black-shadow`** — opt-in detection for visible inline or Tailwind shadows colored with opaque or translucent pure black.
- **`no-decorative-pulse`** — opt-in detection for stable text that pulses continuously outside a proven loading or progress state.
- **`no-excessive-font-families`** — opt-in page-level detection for four or more literal font families while preserving tokenized font variables.
- **`no-fake-browser-chrome`** — opt-in detection for framed previews that recreate empty red, yellow, and green browser controls as decoration.
- **`no-overloaded-hover-state`** — opt-in detection for a single hover state that stacks three or more effect families such as motion, color, shadow, opacity, or filters.
- **`no-placeholder-persona-copy`** — opt-in detection for generic sample identities rendered in top-level page copy.
- **`no-repeated-hover-scale`** — opt-in page-level detection for the same hover scale repeated on at least three elements within one static page root.
- **`no-tight-all-caps-heading`** — opt-in detection for long all-caps headings with a statically proven line-height below 1.0.
- **`prefer-tabular-numeric-data`** — opt-in detection for dynamically formatted numeric table cells without inherited tabular or monospace figures.
- **`require-autoplay-video-poster`** — opt-in detection for statically autoplaying intrinsic videos without a poster frame.
- **`no-gradient-text`** (extended) — now recognizes Tailwind v4 linear, radial, conic, numeric-angle, and arbitrary gradient background utilities without combining utilities across variants.

**HTML and component contracts**

- **`html-no-nested-form`**: finds statically nested native forms, which HTML parsing and submission do not support.
- **`html-label-has-single-control`**: finds labels that statically contain more than one labelable control.
- **`motion-animate-presence-requires-key`**: requires keys on direct static children of proven Motion `AnimatePresence` components.
- **`motion-animate-presence-wait-single-child`**: finds `mode="wait"` instances with multiple direct static children.
- **`no-mixed-srcset-descriptors`**: finds `srcSet` candidates that mix width and pixel-density descriptor modes.
- **`shadcn-tabs-trigger-requires-list`**: opt-in detection for proven shadcn-style tab triggers outside a corresponding tab list.
- **`no-srcset-without-sizes`**: requires `sizes` when an intrinsic image uses width descriptors in a static `srcSet`.

**Metadata**

- **`nextjs-metadata-url-consistency`** — statically provable disagreement between a Next.js page's canonical URL and `openGraph.url`, with normalization for equivalent trailing slashes and no claims about dynamic or inherited values.

**Tailwind canonicalization** (distilled from ui.sh's canonicalize-tailwind guidance)

- **`no-deprecated-tailwind-class`** — Tailwind v4 renamed/removed `bg-gradient-*` → `bg-linear-*`, `flex-shrink-*` → `shrink-*`, `flex-grow-*` → `grow-*`, `overflow-ellipsis` → `text-ellipsis`. Gated on a new `tailwind:4` capability so v3 projects are unaffected.
- **`no-arbitrary-px-font-size`** — `text-[13px]` doesn't scale with the user's root font size; use rem (`text-[0.8125rem]`). Pixels stay fine for `border-*`/`outline-*`.
- **`prefer-dvh-over-vh`** — `h-screen`/`min-h-screen`/`h-[100vh]` overflow under mobile browser chrome; prefer `dvh` (`h-dvh`/`min-h-dvh`). Gated on `tailwind:3.4`.

Also adds a `tailwind:4` project capability to `@react-doctor/core` for version-gated Tailwind rules.
