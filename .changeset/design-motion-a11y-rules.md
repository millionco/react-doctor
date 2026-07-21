---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

Add deterministic design-quality lint rules spanning motion performance, accessibility, and Tailwind/JSX hygiene.

Add `react-doctor design [directory]` for a focused UI audit. The command runs the complete design-rule bucket plus other explicitly design-tagged rules, deliberately activates that family's focused opt-in diagnostics, respects explicit per-rule disablements, and skips unrelated analyzers, external lint configuration, custom plugins, and health scoring.

**Motion**

- **`motion-create-in-render`** — Motion component factories executed during a component or custom-hook render, including synchronous iteration callbacks. Module scope, event/effect callbacks, and stable React initializers remain valid.
- **`motion-value-constructor-in-render`** — manual `motionValue()` objects recreated during React render. Recommends `useMotionValue()` while preserving module-scope and explicitly stabilized values.
- **`motion-use-transform-range-length`** — statically provable `useTransform()` input and output arrays with different lengths. Aliased and namespace imports are resolved; dynamic and spread-backed ranges are skipped.
- **`motion-keyframe-times-mismatch`** — static Motion keyframe arrays whose transition `times` count does not match the keyframe count, including transition objects nested inside `animate`.
- **`motion-value-subscription-in-render`** — `.on()` subscriptions attached to proven hook-created Motion values during render. Effect/event subscriptions and `useMotionValueEvent()` remain valid.
- **`motion-imperative-animation-in-render`** — imperative `animate()` calls, animation-control starts, and Motion-value writes executed during React render. Resolves imported APIs, aliases, and `useAnimate()` tuple bindings while preserving effects, event handlers, deferred callbacks, and userland lookalikes.
- **`motion-animate-presence-must-outlive-child`** — presence boundaries removed by the same condition as an exit-bearing child, which prevents Motion from observing the child leave. Stable outer boundaries, correctly propagated nested boundaries, and JSX hidden inside uninvoked callbacks remain valid.
- **`motion-unstable-layout-id-in-iteration`** — repeated literal or index-derived `layoutId` values inside `map()` and `flatMap()` callbacks. Stable item-derived IDs, conditional shared markers, and item-scoped layout groups remain valid.
- **`motion-layout-on-inline-element`** — proven Motion layout animations attached to an explicitly inline element, where transform-based layout animation cannot take effect. Static inline styles and unvariant Tailwind display utilities are resolved with CSS precedence.
- **`motion-drag-axis-constraint-mismatch`** — x-axis drags constrained only by vertical bounds, y-axis drags constrained only by horizontal bounds, and statically inverted numeric intervals. Refs, dynamic objects, spreads, and userland lookalikes remain valid.
- **`waapi-animation-in-render`** — `Element.animate()` calls on proven DOM receivers during component or custom-hook render, including synchronous callbacks and memo initializers. Effects, handlers, deferred work, module scope, and userland methods remain valid.
- **`web-animation-offsets-valid`** — Web Animations keyframe offsets outside `[0, 1]` or in descending order, across array-form and property-indexed keyframes. Equal, missing, null, dynamic, and spread-backed offsets remain valid.
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
- **`no-hover-only-reveal`** (extended) — now recognizes statically hidden Motion opacity states revealed by `whileHover` without an equivalent `whileFocus` state, in addition to Tailwind hover utilities.

**Accessibility**

- **`no-static-motion-config-never`** — root application Motion policies that permanently opt out of the user's reduced-motion setting. Subtree policies, dynamic user preferences, aliases, development conditionals, spreads, and non-Motion components remain valid.
- **`no-blocked-paste`** — password, username, and one-time-code inputs whose paste handler definitely prevents the event, while preserving conditional policies, custom controls, spread-owned handlers, and non-authentication confirmation fields.
- **`no-autoplay-without-muted`** — `<video autoPlay>` / `<audio autoPlay>` missing `muted` (sound-on autoplay is hostile to users and browser-blocked). Skips dynamic `autoPlay`, spreads, and truthy/dynamic `muted`.
- **`no-uninformative-aria-label`** — an `aria-label` whose value is a content-free element-type word (`"icon"`, `"button"`, `"image"`, `"link"`, …) that tells screen-reader users nothing about the action.
- **`no-invalid-progress-range`** — statically impossible native and ARIA progress ranges, including nonpositive native maxima, inverted ARIA bounds, and current values outside their declared range. Dynamic values and spread-owned props remain valid.
- **`role-button-requires-complete-keyboard-activation`** — custom intrinsic elements with `role="button"` whose statically resolved keyboard activation handles Enter or Space but not both. Native buttons, opaque handlers, spreads, and uncertain control flow remain valid.
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
- **`aria-braille-equivalent`** — opt-in detection for nonempty braille labels or role descriptions without a provable non-braille accessible equivalent.
- **`no-aria-hidden-on-body`** — opt-in detection for a statically true `aria-hidden` on the document body.
- **`no-focusable-content-in-role-text`** — opt-in detection for intrinsic focusable controls whose semantics are flattened by a static `role="text"` ancestor.
- **`empty-table-header`** — opt-in detection for native or ARIA table headers with no accessible content or explicit name.
- **`html-xml-lang-mismatch`** — opt-in detection for conflicting static base languages in root `lang` and `xml:lang` declarations.
- **`no-duplicate-static-id-reference`** — opt-in static-tree detection for duplicated literal IDs used by labels or ARIA ID references.
- **`iframe-title-unique`** — opt-in static-tree detection for frames whose normalized literal titles are duplicated.
- **`no-server-side-image-map`** — opt-in detection for statically enabled server-side image maps.
- **`no-presentation-role-conflict`** — opt-in detection for presentational elements that remain focusable or expose global ARIA state.
- **`html-no-nested-interactive`** (extended) — now catches statically focusable descendants inside roles whose children become presentational, including controls with a negative `tabIndex`.

**Design / Tailwind hygiene**

- **`no-redundant-display-class`** — a display utility matching the element's default (`block` on a `<div>`, `inline` on a `<span>`); skips variant-prefixed and meaningful displays (`flex`, `grid`, `hidden`).
- **`prefer-truncate-shorthand`** — `overflow-hidden text-ellipsis whitespace-nowrap` collapses to the single `truncate` utility.
- **`no-full-viewport-width`** — `w-screen` / `w-[100vw]` / inline `100vw`, which overflows horizontally when a scrollbar is visible; prefer `w-full` / `width: 100%`.
- **`no-svg-currentcolor-with-fill-class`** — `fill="currentColor"` / `stroke="currentColor"` fighting a `fill-*` / `stroke-*` color class (the class silently wins); keep one, or use `fill-current`.
- **`no-pointer-disabled-enabled-control`** — opt-in detection for enabled native controls that statically disable pointer input through inline styles or an unvariant Tailwind utility. Disabled, inert, hidden, nonfocusable, dynamic, and variant-scoped cases remain valid.
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
- **`no-generic-purple-blue-icon-gradient`** — opt-in detection for compact, rounded purple-to-blue gradient tiles used as generic icons or avatars.
- **`no-dynamic-tailwind-class-fragment`** — opt-in detection for Tailwind utilities assembled across runtime template interpolations, which the Tailwind source scanner cannot discover as complete class names.
- **`no-emoji-heading-decoration`** — opt-in detection for decorative emoji embedded in static native heading copy while preserving dynamic content, icon components, and non-product example paths.
- **`no-inert-pointer-affordance`** — opt-in detection for noninteractive native elements that advertise clickability with `cursor-pointer` but have no local or delegated interaction signal.
- **`no-repeated-placeholder-navigation`** — opt-in detection for navigation containers that repeat bare `href="#"` destinations while preserving real fragment links and isolated scroll-to-top anchors.
- **`no-tiny-uppercase-tracked-label`** — opt-in detection for static labels that combine an explicit font size of 11 px or less with uppercase transformation and non-default tracking, while preserving code-like values, dynamic copy, responsive-only styles, and readable sizes.

Tailwind-specific design detectors now require a detected Tailwind dependency, and JSX-only design detectors require React. The newest visual heuristics also abstain when spreads, custom-component forwarding, later utility precedence, or semantic emoji placement make the verdict uncertain.

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
- **`no-invisible-focus-control`**: opt-in detection for fully transparent native controls whose proxy surface provides no visible keyboard-focus treatment.
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
- **`no-empty-card-shell`** — opt-in detection for empty elements styled as complete card surfaces.
- **`no-mixed-icon-libraries`** — opt-in file-level detection for JSX that mixes imports from multiple icon-system families.
- **`no-pill-navigation-count`** — opt-in detection for bare numeric navigation counts styled as generic pills instead of semantic badges.
- **`no-redundant-title-tooltip`** — opt-in detection for `title` text that merely repeats an element's visible static label.
- **`no-symmetric-text-button-padding`** — opt-in detection for text buttons whose static Tailwind padding is symmetric on both axes.
- **`no-uppercase-tracked-navigation-label`** — opt-in detection for static navigation labels combining uppercase and expanded tracking.
- **`require-scale-reveal-transform-origin`** — opt-in detection for proven Motion reveal elements that animate scale without a static transform origin.
- **`no-gradient-text`** (extended) — now recognizes Tailwind v4 linear, radial, conic, numeric-angle, and arbitrary gradient background utilities without combining utilities across variants.
- **`design-no-three-period-ellipsis`** (extended) — now checks static placeholders, titles, alternative text, and ARIA labels in addition to JSX text.
- **`design-no-vague-button-label`** (narrowed) — preserves conventional Continue navigation when the same form proves a Back or Previous action.
- **`design-no-em-dash-in-jsx-text`** (narrowed) — skips files in conventional long-form documentation, article, blog, content, and post paths.
- **`no-cramped-container-padding`** (narrowed) — no longer treats a one-sided table or layout divider as a closed container around text.

**Render lifecycle**

- **`no-create-object-url-in-render`** — detects global `URL.createObjectURL()` calls in component or custom-hook render, including memo and state initializers, where discarded renders can leak disposable browser resources.

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

React Compiler detection now recognizes the Vite 6 `reactCompilerPreset()` integration, the supported JavaScript, TypeScript, CommonJS, and ESM Babel configuration filenames, and the official Rsbuild and Rspack `reactCompiler` configuration. This keeps compiler-redundant diagnostics disabled when those integrations are active without changing the JSON report shape.

Large-corpus validation keeps the highest-noise visual heuristics (`no-arbitrary-px-font-size`, `no-cramped-container-padding`, `no-full-viewport-width`, and `prefer-motion-transform-property`) in the focused design scan instead of the general scan. It also avoids diagnostics for responsive navigation variants and opaque navigation wrappers, translated fragment content, custom label components, display-sized paragraphs, test image mocks, imperatively sourced image refs, non-production placeholder fields, link-named editor actions, image boxes controlled by unresolved CSS, card-styled controls and code blocks, and terminal-style technical labels.
