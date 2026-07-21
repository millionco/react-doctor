# @react-doctor/core

## 0.8.3

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.8.3
  - deslop-js@0.8.3

## 0.8.2

### Patch Changes

- [#1400](https://github.com/millionco/react-doctor/pull/1400) [`f4aa821`](https://github.com/millionco/react-doctor/commit/f4aa8214bfac4b52c5613f25bbad29e68cbeb28d) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect Remotion v4+ projects and add nine correctness rules for frame-driven animation, deterministic randomness, render-aware media and image loading, stable delay handles, module-scoped render blocking, and abortable `calculateMetadata` fetches.

- [#1419](https://github.com/millionco/react-doctor/pull/1419) [`8c4959b`](https://github.com/millionco/react-doctor/commit/8c4959bb7400a6d5f21cc35a8d54d0ed7faf6971) Thanks [@aidenybai](https://github.com/aidenybai)! - Correct false positives and false negatives found by an all-rules 2,000-project parity audit. Tighten project capability detection, browser-target compatibility, React Compiler configuration reachability, Tailwind conflict handling, JSX attribute ordering, accessible-name evidence, server-action provenance, state/effect execution analysis, image and motion evidence, and framework export handling.

- [#1337](https://github.com/millionco/react-doctor/pull/1337) [`0b0b5ac`](https://github.com/millionco/react-doctor/commit/0b0b5ac52301cbfbb5abdffe4d0d9bf673325a94) Thanks [@aidenybai](https://github.com/aidenybai)! - Add deterministic design-quality lint rules spanning motion performance, accessibility, and Tailwind/JSX hygiene.

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

- [#1412](https://github.com/millionco/react-doctor/pull/1412) [`af33723`](https://github.com/millionco/react-doctor/commit/af337232873fa5c96ec69fac453868f14a9be071) Thanks [@aidenybai](https://github.com/aidenybai)! - Harden MobX version gates and fix reaction lifetime, observer wrapper, and auto-observable inheritance precision.

- [#1403](https://github.com/millionco/react-doctor/pull/1403) [`3598138`](https://github.com/millionco/react-doctor/commit/3598138c7bdd55dac55bf17bc72ccfef1e4c2efd) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix false positives in React Hooks, server action authentication, server prop deduplication, MDX execution risk, public debug artifact, secret fallback, and React Native Babel preset diagnostics. Detect server actions exported through later named or default exports, and gate the legacy Metro preset diagnostic on React Native version and actual package resolution.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add library-version capabilities, cross-file resolution, cache fingerprinting, shared rule-analysis utilities, and mock-fixture filename recognition.

- [#1376](https://github.com/millionco/react-doctor/pull/1376) [`1839566`](https://github.com/millionco/react-doctor/commit/18395664810b9e08d024f4b679d7ab2089b05b7e) Thanks [@aidenybai](https://github.com/aidenybai)! - Match baseline diagnostics by rule, message, and normalized source evidence, using side-aware Git snapshots and parser-proven handler forwarding so unchanged findings can move safely while changed or additional findings remain reportable.

- Updated dependencies [[`5b468f8`](https://github.com/millionco/react-doctor/commit/5b468f8a929cd210c93d015f1ba9cb9987e1d7b5), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`b4556e3`](https://github.com/millionco/react-doctor/commit/b4556e31d8804e4c8442ae6a5f198373b94fd378), [`7eca0ee`](https://github.com/millionco/react-doctor/commit/7eca0eebf94abba3e79143cbc08c03bd1da38b1c), [`82c4a12`](https://github.com/millionco/react-doctor/commit/82c4a125c538fd1fd5982c459154fc19388d6ed4), [`f4aa821`](https://github.com/millionco/react-doctor/commit/f4aa8214bfac4b52c5613f25bbad29e68cbeb28d), [`5332cb6`](https://github.com/millionco/react-doctor/commit/5332cb66cf73086cb8c53cbbdbb379d74e5a2e24), [`8c4959b`](https://github.com/millionco/react-doctor/commit/8c4959bb7400a6d5f21cc35a8d54d0ed7faf6971), [`0b0b5ac`](https://github.com/millionco/react-doctor/commit/0b0b5ac52301cbfbb5abdffe4d0d9bf673325a94), [`284b4e4`](https://github.com/millionco/react-doctor/commit/284b4e4e93da7b9ed72f2cbddd72c378737aa0a1), [`6fcd9c9`](https://github.com/millionco/react-doctor/commit/6fcd9c957671b5b7d0b9657260ea1706f73869e2), [`21221c2`](https://github.com/millionco/react-doctor/commit/21221c2d4bc1b9448a32928a582c34ef088236c8), [`fc1b3a3`](https://github.com/millionco/react-doctor/commit/fc1b3a3984e5993c1eb25478cf1c154d3d4ceddc), [`26b4a0c`](https://github.com/millionco/react-doctor/commit/26b4a0ceb1da349ea61073a78f12723e4336c2dc), [`61bf03e`](https://github.com/millionco/react-doctor/commit/61bf03eedcc602b2e21c45e1a5f2e3f012c7201c), [`af33723`](https://github.com/millionco/react-doctor/commit/af337232873fa5c96ec69fac453868f14a9be071), [`8e5ae45`](https://github.com/millionco/react-doctor/commit/8e5ae45dd3e93e6df263b37d0179403da5a9a170), [`3598138`](https://github.com/millionco/react-doctor/commit/3598138c7bdd55dac55bf17bc72ccfef1e4c2efd), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`f5f13b8`](https://github.com/millionco/react-doctor/commit/f5f13b877ab2096312e60d5b3413fc3bcf35f428), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`f5f6a79`](https://github.com/millionco/react-doctor/commit/f5f6a79ba247128ae48493cd58bbca9c1e16c1ff), [`d970055`](https://github.com/millionco/react-doctor/commit/d9700556d14a2c48e644512e70c5affe703cba2a), [`b852961`](https://github.com/millionco/react-doctor/commit/b8529619bdb06251314dd398c650207732ab5024), [`e6a1557`](https://github.com/millionco/react-doctor/commit/e6a155763ee4a1dd23be6dd60e4beecaf7182ae0), [`fe241a9`](https://github.com/millionco/react-doctor/commit/fe241a9723c12673f40d6e3ab42a1fa32e1238b2), [`a4eaedd`](https://github.com/millionco/react-doctor/commit/a4eaeddefecba43688c61edaad3452621ceb73de), [`a667b45`](https://github.com/millionco/react-doctor/commit/a667b4590700c052124994d73ae1aac202655cf0), [`c9f2c4b`](https://github.com/millionco/react-doctor/commit/c9f2c4be53a64dc99bbd2f83ae4e563557add007), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1), [`5774353`](https://github.com/millionco/react-doctor/commit/57743539079f8a8c49fe9d2119822b27603e3a04), [`a2f9bf4`](https://github.com/millionco/react-doctor/commit/a2f9bf42c0dbc012dab41938008d90c0bd2dc77f), [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1)]:
  - oxlint-plugin-react-doctor@0.8.2
  - deslop-js@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.8.1
  - deslop-js@0.8.1

## 0.8.0

### Patch Changes

- [#1370](https://github.com/millionco/react-doctor/pull/1370) [`2979a9b`](https://github.com/millionco/react-doctor/commit/2979a9bc1b1f18c685bafe6d92edb20b4b1a8707) Thanks [@aidenybai](https://github.com/aidenybai)! - Exclude untracked TypeScript emit output from the scan: a .js file is dropped only when a complete untracked emit quartet (.js, .js.map, .d.ts, .d.ts.map) with exact source-map targets and matching sourceMappingURL references proves it duplicates a tracked same-stem .ts/.tsx source. Tracked JavaScript files and incomplete or mismatched output sets are still scanned.

- Updated dependencies [[`cf7ada5`](https://github.com/millionco/react-doctor/commit/cf7ada5839156399e054b8e47bba1d54122f75b8), [`ac392cb`](https://github.com/millionco/react-doctor/commit/ac392cbbc02e77d7e62aa30d34ed6985860b394c), [`b30fb80`](https://github.com/millionco/react-doctor/commit/b30fb80a6d96de3a4d4c7f5d12cebb9acc5474a8), [`0ff57fa`](https://github.com/millionco/react-doctor/commit/0ff57fa57c6f81330f804d9ca94cab3139c20545), [`b2f3c9c`](https://github.com/millionco/react-doctor/commit/b2f3c9c463f5f04dd6d7c2d09621ff9edcc7144f), [`9aa98b9`](https://github.com/millionco/react-doctor/commit/9aa98b94e301f4038a1b6cf85301f6fe872d4d8a), [`44d3ad8`](https://github.com/millionco/react-doctor/commit/44d3ad879d28ea47248a8060485ee9d08e8b0c89), [`3c90f14`](https://github.com/millionco/react-doctor/commit/3c90f14c906778515fabab8615117ce5770b6ae2), [`f563205`](https://github.com/millionco/react-doctor/commit/f563205ee092aa93202964c05ff739c00ba74541), [`7eb7428`](https://github.com/millionco/react-doctor/commit/7eb74283d0ede1749c24f7b21818ac3a7ddcbfc7), [`f59ec54`](https://github.com/millionco/react-doctor/commit/f59ec540c751078decf4599ad52046c97c217ca2), [`a86b5b0`](https://github.com/millionco/react-doctor/commit/a86b5b0e9571e120fd38e3ebffcd0c78a3d458d7), [`d7d38d7`](https://github.com/millionco/react-doctor/commit/d7d38d7c881d8b6d31728fbed28a0ee5974bc818), [`52fc179`](https://github.com/millionco/react-doctor/commit/52fc179e82afbb43f5d562e0c81c2a4def638e94), [`1adf327`](https://github.com/millionco/react-doctor/commit/1adf3278df268d752a6eb3f40c62ebd7e8d84004), [`194cc06`](https://github.com/millionco/react-doctor/commit/194cc06e8c83decb1be71fecb9124009f5b8a837), [`c88a39a`](https://github.com/millionco/react-doctor/commit/c88a39a936c2c96dfd282d3ac74f9264dcd68fea), [`3e6dcfc`](https://github.com/millionco/react-doctor/commit/3e6dcfc21712a8cdb7a43ac63c0ed466039852e1), [`be6d64b`](https://github.com/millionco/react-doctor/commit/be6d64b466596e40a4ee1233b9c6f260944c4286), [`0fbf728`](https://github.com/millionco/react-doctor/commit/0fbf728ec1d6cc70f55d70cea431081b641726e7), [`30e0ff0`](https://github.com/millionco/react-doctor/commit/30e0ff015e974bc9cc5ad22988fb4da1d0884e01), [`11388bf`](https://github.com/millionco/react-doctor/commit/11388bfe2dd82851e46970ffea05d2a87a8fdf29), [`71892af`](https://github.com/millionco/react-doctor/commit/71892afc4651f9354baeb645a0fb77693fbf6f92), [`81da42b`](https://github.com/millionco/react-doctor/commit/81da42bc05a6097d6fd5c4d34afe6c87dc935917), [`e5d5753`](https://github.com/millionco/react-doctor/commit/e5d57534a7bd4b3a42f9f9cc5cb7c3e4f82ee7d2), [`66a1db8`](https://github.com/millionco/react-doctor/commit/66a1db84f4925b2bd919960af6e02b9f66dfaf1a), [`b392093`](https://github.com/millionco/react-doctor/commit/b3920938da9f8d3badbffca0f972f0b583c19a86), [`6c5c91b`](https://github.com/millionco/react-doctor/commit/6c5c91b68c7e089b0dcd7a269a44b8052f846888), [`d8a20e0`](https://github.com/millionco/react-doctor/commit/d8a20e0de7f3707ff9fca132a59f429384d5cc7a), [`f441f59`](https://github.com/millionco/react-doctor/commit/f441f598bb172a92a70c4f425934949042427a51), [`174955c`](https://github.com/millionco/react-doctor/commit/174955c25558a45dc3c8667c6efebb1af16ba8b4), [`bd3655c`](https://github.com/millionco/react-doctor/commit/bd3655c13d25fd43a9946a98a3643235d72ac55d), [`db5fe10`](https://github.com/millionco/react-doctor/commit/db5fe10229150da08d83f808809bbcd1c640351c), [`c1e75f0`](https://github.com/millionco/react-doctor/commit/c1e75f06bab2042469f9e61a23de5efef2b6fbb6), [`796a56d`](https://github.com/millionco/react-doctor/commit/796a56d4f9f86d451568218dd28c1f4edd11ef98), [`558118c`](https://github.com/millionco/react-doctor/commit/558118ca1fe556a2d563b8208d33fe9cd1a65e3d), [`d4db626`](https://github.com/millionco/react-doctor/commit/d4db626555cf2b9eb19e2824ca21a08a37fde631), [`a16e452`](https://github.com/millionco/react-doctor/commit/a16e452648eda8a2c05504219d1af66fd428dbf8), [`d3f54c4`](https://github.com/millionco/react-doctor/commit/d3f54c4c1ddbdd4bf0472c8e74e2c0dccc692a5a), [`e5a5f73`](https://github.com/millionco/react-doctor/commit/e5a5f736992f42f67eaf01db056180eb8ed319cb), [`6325f9c`](https://github.com/millionco/react-doctor/commit/6325f9cea5bef7ae66860835e4251250c522055b), [`e86bc57`](https://github.com/millionco/react-doctor/commit/e86bc57911b836e07227aa213b40130136ae423d), [`4f3848b`](https://github.com/millionco/react-doctor/commit/4f3848b0019590ef38d74e09296059ea6fbc5292), [`093619c`](https://github.com/millionco/react-doctor/commit/093619c3d8a9990586af270c00ed267b027506b4), [`21827da`](https://github.com/millionco/react-doctor/commit/21827da9079291ffdec247a907ff16b796912e95), [`12e9592`](https://github.com/millionco/react-doctor/commit/12e9592da8a7b95c3726ca439c334be7ab2f7ab8), [`c7f61cd`](https://github.com/millionco/react-doctor/commit/c7f61cd4f53fd864bc3299b7f2e359f161aae522), [`95f9937`](https://github.com/millionco/react-doctor/commit/95f99372c0498cc48a3c8829b63511518bf26085), [`0f11de1`](https://github.com/millionco/react-doctor/commit/0f11de18bd9ab6e02019b2e49ac7e19f1216135b), [`1b86dae`](https://github.com/millionco/react-doctor/commit/1b86dae52c98d58e79ece863eee616008b0e0612), [`1a30f2c`](https://github.com/millionco/react-doctor/commit/1a30f2caac12f1678243cb8733dd7bc1b598a9da), [`9e55e1f`](https://github.com/millionco/react-doctor/commit/9e55e1f83f3668e4fc39c8e158984f7976e5c12d), [`c41f271`](https://github.com/millionco/react-doctor/commit/c41f271c3124d5f64cc7149195e93c4ed97fb6a6), [`7e6cdf9`](https://github.com/millionco/react-doctor/commit/7e6cdf920b972a035cc7c5fd405049dbc060ed57), [`544356c`](https://github.com/millionco/react-doctor/commit/544356cb0edcc7240f0268dcc6279fa06dab19ee), [`cc96f47`](https://github.com/millionco/react-doctor/commit/cc96f473248c63e6c058827fc688579ee33aeb5e), [`5f3ba37`](https://github.com/millionco/react-doctor/commit/5f3ba376289fa07ab9e44c649eb290a967009536), [`cf9acf2`](https://github.com/millionco/react-doctor/commit/cf9acf26c22fde1a0a7874efdf598a78b94c4808), [`f94d7b1`](https://github.com/millionco/react-doctor/commit/f94d7b189b5b143c556209a67958556fed53875a), [`c245b9d`](https://github.com/millionco/react-doctor/commit/c245b9d05d7d0c48dc33891b037da21386061955), [`ef328c4`](https://github.com/millionco/react-doctor/commit/ef328c457115ff5e352e7016330b0c6a51386589), [`b51022f`](https://github.com/millionco/react-doctor/commit/b51022f8e055ee0db07cce63b6d6e8cf795c4ba5), [`21043e0`](https://github.com/millionco/react-doctor/commit/21043e024e77e65f0df5122d4330b7c759f0187e), [`418e0b2`](https://github.com/millionco/react-doctor/commit/418e0b210de5cb2c628baeda6704294b4c3b5b13), [`b76aef7`](https://github.com/millionco/react-doctor/commit/b76aef71635c85260fa76c4ab4d02830077a06f3), [`61111f1`](https://github.com/millionco/react-doctor/commit/61111f192a52e8c296b3b0ec7201e4ce3f4b84ae), [`c8a2918`](https://github.com/millionco/react-doctor/commit/c8a29185a03737dea64839d1a8063fbb8b892d79), [`8835214`](https://github.com/millionco/react-doctor/commit/88352149101497bbac80dfef98e07e1f2e6b7747), [`2ba83c3`](https://github.com/millionco/react-doctor/commit/2ba83c3201e364939c76187be2725ed0bbf9daa5)]:
  - oxlint-plugin-react-doctor@0.8.0
  - deslop-js@0.8.0

## 0.7.9

### Patch Changes

- Updated dependencies [[`9256423`](https://github.com/millionco/react-doctor/commit/9256423342c830e41a2ab71d940e1306b91de91e), [`4829841`](https://github.com/millionco/react-doctor/commit/4829841a4d4a77e64b7fd22faee4446ba2ff955d)]:
  - oxlint-plugin-react-doctor@0.7.9
  - deslop-js@0.7.9

## 0.7.8

### Patch Changes

- Updated dependencies [[`4a73399`](https://github.com/millionco/react-doctor/commit/4a73399f529580b18546df6addee71b53982f30c), [`760a3b0`](https://github.com/millionco/react-doctor/commit/760a3b009eb445dc3234c923f2ae33e0441f0e60), [`af58965`](https://github.com/millionco/react-doctor/commit/af58965a7233b5b66283ad35b3a651435f1e0de9), [`ed241c3`](https://github.com/millionco/react-doctor/commit/ed241c35e66b6b3759f49390ddcdcf92dcee1921), [`4190897`](https://github.com/millionco/react-doctor/commit/41908971fdb67be57afe862b0717f79f810bc5cf), [`4fce1c1`](https://github.com/millionco/react-doctor/commit/4fce1c1bff8af9adb66edad3ee66c25c20c5bd1e), [`c79c897`](https://github.com/millionco/react-doctor/commit/c79c897ec6128a3155ae23d10dda3f77e28683a5), [`517f87a`](https://github.com/millionco/react-doctor/commit/517f87a19f50893c4c19e79e6cdb37be12e71f01), [`ec144d9`](https://github.com/millionco/react-doctor/commit/ec144d99c9fb45698250b5ec47edbe1305cbfdbc), [`afed801`](https://github.com/millionco/react-doctor/commit/afed80154512c3fc4d55f3fe5c01bbc38afae627), [`9c612c5`](https://github.com/millionco/react-doctor/commit/9c612c57e4da1d48a489a6b9dcbbc532126904a0), [`9fab4fc`](https://github.com/millionco/react-doctor/commit/9fab4fc77e24d17079815edd0b2590615822ef6a), [`04c7e36`](https://github.com/millionco/react-doctor/commit/04c7e36b28b57ae4973662637946485504bc30af), [`165a6cb`](https://github.com/millionco/react-doctor/commit/165a6cbd9c454f1eaff4f353f063503c808bd634), [`287dff7`](https://github.com/millionco/react-doctor/commit/287dff742b8d90274ce6ff2298daeee8e7441bcd), [`9fc93f8`](https://github.com/millionco/react-doctor/commit/9fc93f865c7ef2638bfa802f0544256fd5fc85e5), [`43327b5`](https://github.com/millionco/react-doctor/commit/43327b535c90fa29a266dc0627030f1b6e6cb925), [`30b7eeb`](https://github.com/millionco/react-doctor/commit/30b7eebaeb1344b342ee2d59413cd5ef6e213f7a), [`89dbf08`](https://github.com/millionco/react-doctor/commit/89dbf08d76beeb93d3959d7ea2e2d4a77cdd5c3d), [`12e7193`](https://github.com/millionco/react-doctor/commit/12e719358046afde6294b5b620e735f8993ec56a), [`fbc804e`](https://github.com/millionco/react-doctor/commit/fbc804e6768b292b63fe6d8c249469e32d8b8899), [`046329c`](https://github.com/millionco/react-doctor/commit/046329caf3fdf99924e4b97ffe7b71106922787c), [`79abd71`](https://github.com/millionco/react-doctor/commit/79abd7177928fc79a91706cc2866b8097c7cd09c), [`a468589`](https://github.com/millionco/react-doctor/commit/a4685891b8ee768176741a74eb7db2f4d0724bdc)]:
  - oxlint-plugin-react-doctor@0.7.8
  - deslop-js@0.7.8

## 0.7.7

### Patch Changes

- Updated dependencies [[`c1916d5`](https://github.com/millionco/react-doctor/commit/c1916d577d90df5a6587e8a98f28bb1b12168554), [`8528def`](https://github.com/millionco/react-doctor/commit/8528deff881314adaf72bb17da1f1dabdcf58b5c), [`a01249a`](https://github.com/millionco/react-doctor/commit/a01249aa37f9ac4b693c1d8d162b58463b10d250), [`dfd47a7`](https://github.com/millionco/react-doctor/commit/dfd47a75a29f36df2b6799d57ef9695a7174b3f6), [`0150fc9`](https://github.com/millionco/react-doctor/commit/0150fc901cd5d85c5631e975510d51e48372bdde), [`4fb3694`](https://github.com/millionco/react-doctor/commit/4fb3694e186db0287cc0d49f72a44a38ad63a26e), [`da3a6e0`](https://github.com/millionco/react-doctor/commit/da3a6e019141ee9c598a661c07171591f7db5f55), [`a8cd24e`](https://github.com/millionco/react-doctor/commit/a8cd24e2fedbd6c9697266b09e92e9b685d07abf), [`778f1a2`](https://github.com/millionco/react-doctor/commit/778f1a2cc4a2be3863e79236db143677ae4192e1), [`5699529`](https://github.com/millionco/react-doctor/commit/5699529155f3735a2d75c56715d3edeb88e791f8), [`55cebeb`](https://github.com/millionco/react-doctor/commit/55cebebfd98eeb4cfb9f30f1b2bd137521d620dc), [`37c53d6`](https://github.com/millionco/react-doctor/commit/37c53d6ebf607a9b3942314cdc13700a876cefcc), [`8ee2977`](https://github.com/millionco/react-doctor/commit/8ee2977e174f0b1dd46554eea785cba853ff2207), [`c5a06bd`](https://github.com/millionco/react-doctor/commit/c5a06bd8c0d5ade974549326b9131fa9b6ae8e6e), [`1f14fa1`](https://github.com/millionco/react-doctor/commit/1f14fa1bf33530e46e900780d606d246c71da8b0), [`0d11bd5`](https://github.com/millionco/react-doctor/commit/0d11bd54717cc61fff2341eb0a3b1d25d4f645ad), [`d674163`](https://github.com/millionco/react-doctor/commit/d6741631233fe3622ff165740f1c260635abfa18), [`5fdc445`](https://github.com/millionco/react-doctor/commit/5fdc445783c626605b293283a2dd709c00575d83), [`64950ba`](https://github.com/millionco/react-doctor/commit/64950ba2879e7ccd11ee1a6599d1474992c22558), [`4753290`](https://github.com/millionco/react-doctor/commit/4753290a1ce3d1aadbe8fec11a7296fd575e9350), [`c6f996e`](https://github.com/millionco/react-doctor/commit/c6f996ec0183f34bff7fd99593028c15d91f0634), [`1d7b6e2`](https://github.com/millionco/react-doctor/commit/1d7b6e2887c8478df738d21e1422daac51ffb334), [`8c9a6c4`](https://github.com/millionco/react-doctor/commit/8c9a6c49ab09beabaf8fc47f406ffb9f29a95b34), [`79105a3`](https://github.com/millionco/react-doctor/commit/79105a3b97238d2db1b4011cf7774c8c8b592253), [`81e6647`](https://github.com/millionco/react-doctor/commit/81e6647f3c4c0dbc90881b199753a9d341cf7963), [`fbd85e3`](https://github.com/millionco/react-doctor/commit/fbd85e388c12e6d8ea2c2fcf2e9d8405379dd245), [`b550b32`](https://github.com/millionco/react-doctor/commit/b550b327ece611503d0565c3d1a9cf0f8e3c7246), [`55dcb93`](https://github.com/millionco/react-doctor/commit/55dcb937fbfa6fb58309d5779b4c9b97afd8731c), [`a6c24a8`](https://github.com/millionco/react-doctor/commit/a6c24a867e8b17b65fa8a278945fd351643fe05b), [`47beb25`](https://github.com/millionco/react-doctor/commit/47beb255f228eef2386e0ecd61a0b122d366ac09), [`acf14c4`](https://github.com/millionco/react-doctor/commit/acf14c4fc9774f53a82a7394cd50e09f02a9e7d6), [`b36e439`](https://github.com/millionco/react-doctor/commit/b36e439c26a81b20ede762fdc2f32d50968c7ff3)]:
  - oxlint-plugin-react-doctor@0.7.7
  - deslop-js@0.7.7

## 0.7.6

### Patch Changes

- [#1158](https://github.com/millionco/react-doctor/pull/1158) [`037bd56`](https://github.com/millionco/react-doctor/commit/037bd569eca61132deb581511d8893c05ee87bf6) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Enable the per-file lint cache in audit mode (`--no-respect-inline-disables`). The neutralize pass already rewrites inline disable directives on disk before the per-file content hash is taken, so the cache key reflects exactly what oxlint linted; `respectInlineDisables` is now folded into the ruleset hash so audit and default runs occupy disjoint cache namespaces and never replay each other's entries. Warm audit-mode scans re-lint only changed files instead of the whole tree — the mode CI and pre-commit hooks run in.

- Updated dependencies [[`dbd4067`](https://github.com/millionco/react-doctor/commit/dbd4067fce8ce9e734738af27b751992ea6bb483), [`bc49aaa`](https://github.com/millionco/react-doctor/commit/bc49aaa383da79ac3b31c4f99436bdf26f95495b), [`3075e10`](https://github.com/millionco/react-doctor/commit/3075e10babeb7dfd2ee531572454120df40fa904), [`0654849`](https://github.com/millionco/react-doctor/commit/06548498e257accee8a186762ace7557900d31cc), [`18e8717`](https://github.com/millionco/react-doctor/commit/18e8717ec18f2221953e9b8ae810c4a8464e7b6f), [`a240f8b`](https://github.com/millionco/react-doctor/commit/a240f8b7d94baf6d5d3eabdf313a91c296ce197e), [`76cd6be`](https://github.com/millionco/react-doctor/commit/76cd6bea69e1f453805a054e8d648abc97ef3384), [`8fc5848`](https://github.com/millionco/react-doctor/commit/8fc58480f83895fd64d51758cccd393c3d493515), [`22bb155`](https://github.com/millionco/react-doctor/commit/22bb1557282fbcf47c6fa865ca7ddca050f21b8f), [`21da48f`](https://github.com/millionco/react-doctor/commit/21da48ffb694ac857b5cf6336f56923ac411cb59), [`20cd922`](https://github.com/millionco/react-doctor/commit/20cd922e9a2908b20a36b9e728932975018207a1), [`d9676e2`](https://github.com/millionco/react-doctor/commit/d9676e2597fe01a8db537928b7e02cd82b1e3582), [`3afd146`](https://github.com/millionco/react-doctor/commit/3afd14670042fe8ffb85bd8cc04b15a2987eac52), [`70eff9a`](https://github.com/millionco/react-doctor/commit/70eff9a493f35eb6bdfedbe35ccadec3908ba132)]:
  - oxlint-plugin-react-doctor@0.7.6
  - deslop-js@0.7.6

## 0.7.5

### Patch Changes

- [#1117](https://github.com/millionco/react-doctor/pull/1117) [`99ac4ff`](https://github.com/millionco/react-doctor/commit/99ac4ff842ea8819b4cfce2548bddf0f5b47e6df) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix project discovery failing with "No React project found" when the resolved `typescript` package loads as CJS without named ESM exports (e.g. typescript@5.3 under pnpm's isolated layout): import the TypeScript compiler API via its default export, and surface unexpected discovery exceptions as a new `ProjectDiscoveryFailed` error instead of masking them as `ProjectNotFound`. ([#1115](https://github.com/millionco/react-doctor/issues/1115))

- Updated dependencies [[`d4f2209`](https://github.com/millionco/react-doctor/commit/d4f22093a15ab937d40c7f40c1637ea3e53f6e26), [`5113067`](https://github.com/millionco/react-doctor/commit/5113067458f03349922bdd0a22ad564574ca74c2), [`118f806`](https://github.com/millionco/react-doctor/commit/118f80616fb1771f39a5c9a2afa1a5c8eb08120c), [`63fc41f`](https://github.com/millionco/react-doctor/commit/63fc41f4af69dcc1c8b1f39bf944e7201830be8f), [`98005f2`](https://github.com/millionco/react-doctor/commit/98005f2c3dc70debcd5fa5f95ce28aa9f32b5f7e), [`7bbb792`](https://github.com/millionco/react-doctor/commit/7bbb792e983318453118d1662dc4b4ac5c2d9dc0), [`5aa82e8`](https://github.com/millionco/react-doctor/commit/5aa82e86d065221e249b6e7c454c8411887bda23), [`11333b9`](https://github.com/millionco/react-doctor/commit/11333b9e7db0a8735baa4316f0e0c010b701ed8e), [`b47d053`](https://github.com/millionco/react-doctor/commit/b47d05302bfd8d465c468a65809ad5c7a2b0bdd7), [`a31f5e8`](https://github.com/millionco/react-doctor/commit/a31f5e8eb87d4e4b889f5ba293189a9a92829771), [`a989008`](https://github.com/millionco/react-doctor/commit/a989008fec7afce1039978c3355aadc5b8eea147), [`6610ea9`](https://github.com/millionco/react-doctor/commit/6610ea9ea4ce3a75b6502f89ed7ce4cbf0915eff), [`6292f89`](https://github.com/millionco/react-doctor/commit/6292f891f699654147608bc6a09d64ea5959737e), [`593824d`](https://github.com/millionco/react-doctor/commit/593824de1a156677db33de41e2579280d1a5e65b), [`2b5a18e`](https://github.com/millionco/react-doctor/commit/2b5a18ea3aedb476cf66d21347708102460f218e), [`6821fe0`](https://github.com/millionco/react-doctor/commit/6821fe08bb22ba4f58b7971f4d8026525ee4295c), [`3ec8e1e`](https://github.com/millionco/react-doctor/commit/3ec8e1e85957c446c13a459acf167e9407234746), [`b686594`](https://github.com/millionco/react-doctor/commit/b686594dfacbf4362780b25210d450e7eb4a9260), [`4a5d9bb`](https://github.com/millionco/react-doctor/commit/4a5d9bbe75f5400913f3cf943e3a4ed1beb4d32c), [`3867cf1`](https://github.com/millionco/react-doctor/commit/3867cf1ae77750f8c824181aac2187204348ad60), [`70b5d99`](https://github.com/millionco/react-doctor/commit/70b5d99db9f499c65e5dae95663f0497fd5ef420)]:
  - oxlint-plugin-react-doctor@0.7.5
  - deslop-js@0.7.5

## 0.7.4

### Patch Changes

- Updated dependencies [[`f91ede7`](https://github.com/millionco/react-doctor/commit/f91ede75c5d03970f4d30d66e862ce56e179c290), [`6b70b32`](https://github.com/millionco/react-doctor/commit/6b70b3231c5d9531f72e39b0e99550fbe850d86b), [`82187a3`](https://github.com/millionco/react-doctor/commit/82187a3b31fb38b622c911e92d70db95e9154ea4)]:
  - oxlint-plugin-react-doctor@0.7.4
  - deslop-js@0.7.4

## 0.7.3

### Patch Changes

- [#1103](https://github.com/millionco/react-doctor/pull/1103) [`08b768b`](https://github.com/millionco/react-doctor/commit/08b768bb4a7ce80927f7ad15bc3850a1f7585457) Thanks [@aidenybai](https://github.com/aidenybai)! - Rescue oxlint OOM-dropped files with a serial replay instead of reporting a partial scan. When a parallel lint pass drops files because oxlint's native binding SIGABRT'd under memory pressure (oxc's fixed-size allocator panics when N concurrent oxlint processes compete for memory on very large packages), those files are now replayed once, serially, one single-file batch each — the memory pressure is usually a function of sibling processes, not the file itself, so the replay typically completes the scan. Only files that still fail alone stay dropped and reported.

- Updated dependencies [[`cb8f726`](https://github.com/millionco/react-doctor/commit/cb8f7268530911910bc572bf697614d32674e56a), [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f), [`ee9948a`](https://github.com/millionco/react-doctor/commit/ee9948af13715741788f2ed81cb738a35a0dce35), [`82e0475`](https://github.com/millionco/react-doctor/commit/82e0475b0b5af5e17a2714862d2a717a5a914e90), [`f10f9ca`](https://github.com/millionco/react-doctor/commit/f10f9ca8a622befea1e1972cd25ceb5e3ecb3f30), [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f), [`6680538`](https://github.com/millionco/react-doctor/commit/6680538e14dcff2f2cac36422b124e0df3912798), [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f), [`fb8ffb0`](https://github.com/millionco/react-doctor/commit/fb8ffb0f769532c035baac27443738f4ba84870b), [`b97a92f`](https://github.com/millionco/react-doctor/commit/b97a92f6111394d6fc01fae5b43b2bb5bf892b64), [`ea3e94e`](https://github.com/millionco/react-doctor/commit/ea3e94e37c467ab958190094dad2b582580be9c0), [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4), [`11e9c87`](https://github.com/millionco/react-doctor/commit/11e9c87340eb3b83e604107f8c264417be178b0a), [`63e0657`](https://github.com/millionco/react-doctor/commit/63e065739f615310922041866b742f23e57c8a12), [`2953b25`](https://github.com/millionco/react-doctor/commit/2953b2592d464afd3dde8eba85f5400fb7863a90), [`02b1f82`](https://github.com/millionco/react-doctor/commit/02b1f82dd0c6fdf5a8fbbe5bab16c2384ae41bd0), [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4), [`da7bb4b`](https://github.com/millionco/react-doctor/commit/da7bb4bfc685e2436bf5202c17ac7596d86ae270), [`f83092d`](https://github.com/millionco/react-doctor/commit/f83092d9313bc1cae41d8e0a154bd943b7414dd3), [`dfdc763`](https://github.com/millionco/react-doctor/commit/dfdc763bad8a068aaf4b47aaf23b6f83d720cf40), [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4)]:
  - oxlint-plugin-react-doctor@0.7.3
  - deslop-js@0.7.3

## 0.7.2

### Patch Changes

- [#1077](https://github.com/millionco/react-doctor/pull/1077) [`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90) Thanks [@aidenybai](https://github.com/aidenybai)! - Align 30+ rules with their documented behavior, fixing the false-positive clusters confirmed by a validation pass of 2,143 sampled diagnostics against the official rule prompts. Highlights: `jsx-key` now flags key-after-spread (the documented hazard) instead of the safe key-before-spread shape and exempts props rest parameters; `no-did-update-set-state` honors the prop-comparison guard exemption; `no-console` skips Node CLI scripts; `circular-dependency` skips type-only, lazy-import, and render-time-only cycles; `query-mutation-missing-invalidation` exempts read-only mutations; `insecure-crypto-risk` requires cryptographic context instead of matching identifier names; `no-unknown-property` allows valid hyphenated SVG attributes; `no-aria-hidden-on-focusable` verifies the element is actually focusable; `no-flush-sync` implements the documented DOM-measurement carve-out.

- [#1071](https://github.com/millionco/react-doctor/pull/1071) [`d353dad`](https://github.com/millionco/react-doctor/commit/d353dadf988c52e3037dff52eec9cf8923145364) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Detect React when scanning a package subdirectory of a monorepo, so React rules no longer gate off silently. Two additions at the `discoverProject` seam:

  - **Nearest-ancestor discovery.** A scan target with no `package.json` of its own now adopts the nearest enclosing package (a leaf workspace, a plain app root, or a monorepo root — whichever is closest, bounded by the git root) instead of only workspace-configured monorepo roots. Scanning `app/src/components` in a plain React app now inherits the app's React detection rather than synthesizing an empty, React-blind project.
  - **Node-resolution React version fallback.** When declarations yield no usable React version (a version-less spec like `workspace:*` / `*` / a dist-tag, or React living only in a hoisted `node_modules` the declaration walks never reach), the version is resolved the way Node itself would — `require.resolve("react/package.json")` — making "React is installed and importable" ⇒ "React is detected" an invariant. Guarded to installations physically inside the enclosing repo so a globally installed React can't leak in, and it never overrides a parseable peer range (`^18 || ^19` still floors to the lowest supported major).

- [#1083](https://github.com/millionco/react-doctor/pull/1083) [`5d2f17f`](https://github.com/millionco/react-doctor/commit/5d2f17f71c9fb8e0d8d649da1b26de8f5cfe6c34) Thanks [@skoshx](https://github.com/skoshx)! - `query-destructure-result` no longer classifies rest-destructuring (`const { data, ...rest } = query`) — that shape is `query-no-rest-destructuring`'s territory, and claiming it in both rules reported the same line twice ([#1082](https://github.com/millionco/react-doctor/issues/1082)). The rule now fires only on the consumption it uniquely owns: spreading the whole TanStack Query result into JSX (`<Inner {...query} />`) or an object literal, which enumerates every field and subscribes the component to all of them.

- [#1077](https://github.com/millionco/react-doctor/pull/1077) [`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90) Thanks [@aidenybai](https://github.com/aidenybai)! - Second-round FP/FN sweep: restore delta-audit recall regressions, wire confirmed false-negative clusters (jsx-no-target-blank, button-has-type, no-default-props), repair the never-firing no-layout-property-animation rule, reconcile no-array-index-as-key, gate RN boxShadow rules on new-architecture provenance, and skip the vulnerability axis for devDependencies in the supply-chain check.

- [#1067](https://github.com/millionco/react-doctor/pull/1067) [`ce9dabf`](https://github.com/millionco/react-doctor/commit/ce9dabf1103f4f989bb8f9c1783a24674ba163e7) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `--staged` silently scanning nothing when the project is a subdirectory of the git repo (the standard monorepo layout, e.g. `apps/webui`). Staged paths are collected project-relative (`git diff --cached --relative`), but the staged-content read used a bare `git show :<path>` index pathspec, which git resolves against the repo root — so in a subproject every read missed, the file was silently skipped, and the scan "passed" with `scannedFileCount: 0` (particularly dangerous in a pre-commit hook). The index read now uses the cwd-relative `git show :./<path>` form, matching how baseline `<ref>:<path>` reads were already resolved.

- Updated dependencies [[`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90), [`1880b15`](https://github.com/millionco/react-doctor/commit/1880b152e4d6aedd5c06cf2ca51783e53cfb4004), [`5d2f17f`](https://github.com/millionco/react-doctor/commit/5d2f17f71c9fb8e0d8d649da1b26de8f5cfe6c34), [`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90)]:
  - oxlint-plugin-react-doctor@0.7.2
  - deslop-js@0.7.2

## 0.7.1

### Patch Changes

- [#1061](https://github.com/millionco/react-doctor/pull/1061) [`c0c3fc1`](https://github.com/millionco/react-doctor/commit/c0c3fc170972876c8bbc2419b32e66b9c864df85) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix a CI-gate false positive in the baseline delta: pre-existing element-level findings (Accessibility-category rules, plus rules flagged `matchByOccurrence` like `iframe-missing-sandbox`) are now matched by `(file, rule)` occurrence count instead of the flagged line's text, so reformatting the flagged line (reindentation, prettier reflow, collapsing a multi-line JSX element) no longer reports the finding as newly introduced. The flag is resolved at diagnostic creation and carried on the diagnostic as an optional `matchByOccurrence` field (also present in the JSON report). Expression-level rules keep line-text-sensitive matching, and a genuinely new extra occurrence still surfaces.

- Updated dependencies [[`c0c3fc1`](https://github.com/millionco/react-doctor/commit/c0c3fc170972876c8bbc2419b32e66b9c864df85)]:
  - oxlint-plugin-react-doctor@0.7.1
  - deslop-js@0.7.1

## 0.7.0

### Patch Changes

- Updated dependencies [[`ced746f`](https://github.com/millionco/react-doctor/commit/ced746f518f11e8283d488c4ff31c44e478bb0e5), [`20d81f6`](https://github.com/millionco/react-doctor/commit/20d81f6f26dc8f0562118076f835da2468591d5f), [`ce49250`](https://github.com/millionco/react-doctor/commit/ce4925008d37d7c86a234e6b9c7c2c3afe873405)]:
  - deslop-js@0.7.0
  - oxlint-plugin-react-doctor@0.7.0

## 0.6.3

### Patch Changes

- Updated dependencies [[`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566), [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566), [`072d37e`](https://github.com/millionco/react-doctor/commit/072d37e8e4f82454d2e187114d0194f26efc1bf0), [`2980d0f`](https://github.com/millionco/react-doctor/commit/2980d0f4ed6abfee061ac02f3a0820806f942b95), [`5fec491`](https://github.com/millionco/react-doctor/commit/5fec491e6844d73f658f355ae2cbe86285068f0e), [`05f6399`](https://github.com/millionco/react-doctor/commit/05f639910abf2b3bfc0802e9ad568ecd2b7ce13d), [`a1c8ee1`](https://github.com/millionco/react-doctor/commit/a1c8ee110e137bbc8771c8a471c20287cccd2b38), [`fa61c20`](https://github.com/millionco/react-doctor/commit/fa61c2056951df2429e79d888e5f7334aaf61cfd), [`ac71a3b`](https://github.com/millionco/react-doctor/commit/ac71a3b8cfc8bdd157f0f1bcd242b61ec69f9c17), [`d8628d7`](https://github.com/millionco/react-doctor/commit/d8628d7f21e60b0e6dfd98d76c9f24e03f7afe24), [`ebeee56`](https://github.com/millionco/react-doctor/commit/ebeee568abf9a7ed37ed9fe0bba695e4f2a11c9f), [`da3b19c`](https://github.com/millionco/react-doctor/commit/da3b19c79c27945d873eb24e34431cbefa8f9938), [`6a9a73b`](https://github.com/millionco/react-doctor/commit/6a9a73b14908272535aabab6742258b61bc2ee5c), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b), [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b)]:
  - oxlint-plugin-react-doctor@0.6.3
  - deslop-js@0.6.3

## 0.6.2

### Patch Changes

- Updated dependencies [[`f07ee37`](https://github.com/millionco/react-doctor/commit/f07ee37598360b7d761505afe6960f9fd2f93595)]:
  - oxlint-plugin-react-doctor@0.6.2
  - deslop-js@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [[`5f60bef`](https://github.com/millionco/react-doctor/commit/5f60befa8f954d3daf6e790670be8a170683e708), [`6885698`](https://github.com/millionco/react-doctor/commit/6885698cda0bc35446a13a1af7327f62c9c68025)]:
  - oxlint-plugin-react-doctor@0.6.1
  - deslop-js@0.6.1

## 0.6.0

### Patch Changes

- [#1011](https://github.com/millionco/react-doctor/pull/1011) [`8232e96`](https://github.com/millionco/react-doctor/commit/8232e967238ff7943c0cac0d0b2a2f9d349c89dd) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Make file discovery deterministic and artifact-free, and add `--max-duration` for graceful partial results on slow scans.

  - File discovery is now identical between the git-tracked path (`git ls-files`) and the filesystem walk: the walk descends into non-ignored dot-directories (e.g. `.dumi`, `.storybook`) instead of skipping every dot-directory, and its output is sorted. Repeated scans of the same tree produce the same file set regardless of which discovery path runs.
  - Committed build output (`dist/`, `build/`, `out/`, `.next/`, `coverage/`, `storybook-static/`, …) is excluded from both discovery paths by path-segment filtering. Previously `git ls-files` listed tracked bundles (gitignore only hides untracked files), so bundled artifacts like `ai/dist/mcp-server.js` were linted.
  - New `--max-duration <seconds>` flag: when the budget is spent, remaining lint batches and the dead-code pass are skipped and the scan returns partial results with the skipped files reported explicitly, instead of a SIGTERM'd empty `{"ok":false,"projects":[]}` report. The budget applies once to the whole invocation — every project of a workspace scan shares it — and a scan whose dead-code pass failed or was truncated reports a `null` score rather than one computed from an incomplete diagnostic set.

- [#973](https://github.com/millionco/react-doctor/pull/973) [`99f2417`](https://github.com/millionco/react-doctor/commit/99f2417d8c181916919e6ae0a5ea0722770c7857) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add `runtimeGlobals` config to silence jsx-no-undef false positives for runtime-injected identifiers

  `jsx-no-undef` is a single-file rule, so it flags capitalized JSX identifiers
  that are provided at runtime rather than imported in the file — react-live's
  `<LiveProvider scope={...}>`, Storybook globals, MDX live blocks, or an ambient
  `declare global` in a separate `.d.ts`. List those names in the new
  `runtimeGlobals` config array and `jsx-no-undef` treats them as known. Opt-in —
  an empty/absent list leaves behavior unchanged.

  Closes [#959](https://github.com/millionco/react-doctor/issues/959)

- [#929](https://github.com/millionco/react-doctor/pull/929) [`5f2bd72`](https://github.com/millionco/react-doctor/commit/5f2bd7254362109555194e43a019824478cb9ab5) Thanks [@skoshx](https://github.com/skoshx)! - fix: validate string array config fields (projects, textComponents, etc.)

  Non-string entries in `config.projects` caused `selectProjects` to crash with `requestedName.trim is not a function`. The validator now filters non-string entries from `projects`, `textComponents`, `rawTextWrapperComponents`, and `serverAuthFunctionNames` with warnings instead of crashing.

  Fixes [#921](https://github.com/millionco/react-doctor/issues/921) (Sentry REACT-DOCTOR-1R)

- [#940](https://github.com/millionco/react-doctor/pull/940) [`441e6af`](https://github.com/millionco/react-doctor/commit/441e6afb55ee154e70e56f10a79565b9fd1f3295) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop a scan from crashing when a git subprocess fails synchronously (fixes REACT-DOCTOR-1E, REACT-DOCTOR-1P, REACT-DOCTOR-20). Unlike a missing binary (`ENOENT`, which arrives on the catchable `'error'` event), `child_process.spawn` **throws synchronously** when the working directory isn't a directory (`ENOTDIR`) or the argument list exceeds the OS command-line limit (`ENAMETOOLONG` — e.g. `--scope lines` on a 1,000+-file diff on Windows). That throw escaped Effect's error channel entirely and took down the whole scan (reported to Sentry as a raw `spawn` error). The git runner now pre-flights both conditions and fails on its normal channel, so the existing fallbacks recover instead: a bad working directory degrades like an unavailable git, and an over-long `--scope lines` diff degrades to file-level scope.

- [#951](https://github.com/millionco/react-doctor/pull/951) [`c16e8ea`](https://github.com/millionco/react-doctor/commit/c16e8ea6f6cd455c837d02aafedb916817a4008e) Thanks [@skoshx](https://github.com/skoshx)! - Fix misleading remediation for react-hooks-js/incompatible-library

  `react-hooks-js/incompatible-library` fires when the React Compiler can't
  memoize through a third-party hook (e.g. `@tanstack/react-virtual`'s
  `useVirtualizer`). The diagnostic carried the generic React Compiler action —
  "Rewrite the flagged code so the compiler can optimize it" — which reads as
  "reimplement the library locally" and steered users off mature libraries.

  The rule stays active (the compiler's own bail-out reason is informative), but
  its remediation now names the real fix: it's how the library works, not a bug in
  your code — memoize values you pass from it into other memoized components, or
  suppress it with `// react-doctor-disable-next-line react-hooks-js/incompatible-library`.

  Closes [#950](https://github.com/millionco/react-doctor/issues/950)

- [#972](https://github.com/millionco/react-doctor/pull/972) [`fff9466`](https://github.com/millionco/react-doctor/commit/fff946689638bab3641474b6f8712a62777934ab) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop react-doctor from flagging its own toolchain as an unused dependency

  After `react-doctor install` — especially via `bunx`, where react-doctor is
  declared in `package.json` but never materialized in `node_modules` — a scan
  reported `react-doctor` itself as an unused devDependency. It's used via the CLI,
  git hooks, CI, and the agent skill (never imported in source), so the dead-code
  import graph can't see it, and deslop's "ships a binary → used" heuristic can't
  read its `bin` when it isn't installed. The dead-code pass now never reports
  react-doctor's own CLI / plugin packages (`react-doctor`,
  `eslint-plugin-react-doctor`, `oxlint-plugin-react-doctor`) as unused.

  Closes [#961](https://github.com/millionco/react-doctor/issues/961)

- [#1012](https://github.com/millionco/react-doctor/pull/1012) [`80e3093`](https://github.com/millionco/react-doctor/commit/80e3093815ecc40f29442ef44b4fee9accd76e8a) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Core-engine reliability and security fixes from the 20-day audit. The lint binary-split retry budget is now scoped per batch and anchored at the first failure, so one pathological batch no longer starves the rest of the scan's recovery (and drop reasons name the limit that fired). `REACT_DOCTOR_SUPPLY_CHAIN_TIMEOUT_MS` can now raise the supply-chain budget instead of only lowering it. A corrupt per-file lint cache no longer fails every warm scan until hand-deleted, and the cache now busts when the oxlint child runs a different Node than the CLI (nvm fallback). The `/tmp` fallback cache directory is scoped per user so another local user can't pre-create and poison it, and the auto-detected default branch is validated before reaching git argv. The spawn argv guard is platform-sized (Windows 24k chars, macOS 800k, other POSIX 1.5M), so large `--scope lines` diffs no longer silently degrade to file scope on Linux/macOS. A security-scan I/O failure now skips that pass instead of failing the whole scan, and is reported on the run's telemetry as `securityScan.failed`. Note: the per-file lint cache is invalidated once on upgrade (its ruleset-hash separators changed).

- [#927](https://github.com/millionco/react-doctor/pull/927) [`c2ce298`](https://github.com/millionco/react-doctor/commit/c2ce2989add3e43d21b7f609cad975e0284b6c42) Thanks [@skoshx](https://github.com/skoshx)! - Fix crash when disable comments contain Object.prototype keys (constructor, toString, valueOf, etc.)

  Resolves REACT-DOCTOR-1Y and fixes [#920](https://github.com/millionco/react-doctor/issues/920).

  The suppression near-miss detector would crash with `TypeError: bareRuleKey.includes is not a function` when an eslint-disable or oxlint-disable comment contained a token matching an Object.prototype member name. Indexing the LEGACY_RULE_KEY_TO_NATIVE_RULE_KEY lookup map with such a token returned an inherited method (which the `??` fallback let through), so `canonicalizeRuleKey` now guards the lookup with a `typeof` check and only treats the result as an alias when it is a string.

- [#930](https://github.com/millionco/react-doctor/pull/930) [`ea4d9af`](https://github.com/millionco/react-doctor/commit/ea4d9afd4f2afc15c5d52217c3d001bd02b84046) Thanks [@skoshx](https://github.com/skoshx)! - Degrade gracefully when git is unavailable or diff base ref is missing (fixes REACT-DOCTOR-F, REACT-DOCTOR-1K, REACT-DOCTOR-14, REACT-DOCTOR-22). CI containers without git installed and shallow clones missing the diff base ref now fall back to a full scan with a clear warning instead of crashing and reporting to Sentry.

- Updated dependencies [[`ba2af1b`](https://github.com/millionco/react-doctor/commit/ba2af1b7faa5ef4e1ae39e6c3b786259fba23f1f), [`b69f4a7`](https://github.com/millionco/react-doctor/commit/b69f4a75360ad17d1d149aeb9de16835e792606a), [`7ef9f0e`](https://github.com/millionco/react-doctor/commit/7ef9f0eb7c026b4f9003902d1ab66d232e8ab43f), [`a7ad969`](https://github.com/millionco/react-doctor/commit/a7ad969e5621ce1f61422b9bf578da600220d3e2), [`c2af308`](https://github.com/millionco/react-doctor/commit/c2af3082bfcb85c97e4bfa0d0d71f20478cebe9b), [`03b7a5f`](https://github.com/millionco/react-doctor/commit/03b7a5f79e50d42f1d4f1aaddb2587605c8edde0), [`c72b560`](https://github.com/millionco/react-doctor/commit/c72b560682f1254aa4dd793898f2eed48afdbe27), [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f), [`0b64af5`](https://github.com/millionco/react-doctor/commit/0b64af58b16329c5cae7a210463d2842e34b150d), [`5639b1e`](https://github.com/millionco/react-doctor/commit/5639b1e40e66650cb7042206b19807b2f785d8ff), [`988ce57`](https://github.com/millionco/react-doctor/commit/988ce5701af82aef406be48190dace1449a5393c), [`f69f216`](https://github.com/millionco/react-doctor/commit/f69f21681dd7f17d632a09d742d501ef0b9b3047), [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f), [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f), [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f), [`6339f71`](https://github.com/millionco/react-doctor/commit/6339f715cc1a30521a699b818140ec2fae6f569e), [`7f9e7f4`](https://github.com/millionco/react-doctor/commit/7f9e7f42832f40a32d7583126c096067f948856f)]:
  - oxlint-plugin-react-doctor@0.6.0
  - deslop-js@0.6.0

## 0.5.8

### Patch Changes

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Bound every long-running scan phase with a hard, runtime-independent timeout so a single wedged dependency socket, quadratic file, or starved event loop can no longer hang a scan for hours (production traces showed `runInspect` up to 16h and `Linter.run` up to 7.5h).

  - **Binary-split cascade** (`spawnLintBatches`): a cumulative split-time budget (`OXLINT_SPLIT_TOTAL_BUDGET_MS`, 3 min) and a recursion-depth cap (`OXLINT_SPLIT_MAX_DEPTH`, 8) now drop the remaining files of a pathological batch into the existing `onPartialFailure` / `skippedCheckReasons["lint:partial"]` channel instead of re-waiting a full spawn timeout at every split level.
  - **Supply-chain check**: a whole-check cap (`SUPPLY_CHAIN_TOTAL_TIMEOUT_MS`, 90s) fails open (no diagnostics) on a many-socket pileup that ignores the per-fetch abort — the same fail-open contract the per-package lookup already had.
  - **Dead-code & lint phases**: Effect-level caps (`REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS`, default 2.5 min; `REACT_DOCTOR_LINT_PHASE_TIMEOUT_MS`, default 5 min) sit above the existing per-unit timeouts and fold a timeout into the existing skipped-check / lint-failure contracts so the rest of the scan still completes. On interruption the dead-code worker and any in-flight oxlint subprocesses are SIGKILL'd (the `AbortSignal` is threaded down to both), so the cap actually reclaims the work instead of leaving orphaned processes running.
  - **Overall deadline**: `REACT_DOCTOR_SCAN_DEADLINE_MS` (default 15 min) backstops any phase not individually capped, raising the new `ScanDeadlineExceeded` reason on the `ReactDoctorError` union. It sits above the sum of the per-phase caps so a scan that legitimately uses those budgets degrades gracefully rather than hard-failing.

  All four caps are env-tunable so the budgets can be raised without a redeploy. The defaults sit well above measured p95, so only the pathological tail is affected — no behavior change for normal scans.

- [#890](https://github.com/millionco/react-doctor/pull/890) [`350a6ed`](https://github.com/millionco/react-doctor/commit/350a6edc59dff4d7d4adcb6c6348144ded900d8c) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Loosen the `typescript` dependency range to `>=5.0.4 <7` so consumers on TypeScript 5 can vendor `@react-doctor/core` without a forced TS 6 install. Every TypeScript compiler API the engine uses (`createSourceFile`, `forEachChild`, `parseConfigFileTextToJson`, and the AST type guards — the newest being `isTypeAssertionExpression`, TS 5.0) exists in TS 5.x, and this matches the range already declared by the published `react-doctor` CLI that bundles core.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Run dead-code analysis sequentially by default and scale its timeout to the repo size — fixing a silent drop of all dead-code findings on large supply-chain scans.

  Dead-code (deslop reachability) is CPU-bound, like the oxlint lint pass. Running them concurrently oversubscribed the cores: deslop's parse pool and the oxlint pool each size to all cores, so together they demanded ~2x the cores, thrashed, and the parse pass missed its in-worker timeout. On a large repo (where the pass already runs near the cap) the supply-chain pass bleeding into the dead-code phase was enough to tip it over, and the fail-open path then silently dropped EVERY dead-code finding — observed dropping all ~349 findings on ~2/3 of supply-chain-on Sentry scans, with no user-visible error.

  Dead-code now runs strictly after lint with the full core budget — fastest per-phase and never oversubscribed (overlapping two CPU-bound passes buys no wall-clock anyway). `REACT_DOCTOR_DEAD_CODE_OVERLAP=on` still forces the overlap, but the two pools now SPLIT the core budget — deslop's parse pool is capped via the new `DESLOP_PARSE_CONCURRENCY` env and lint shrinks to the remainder — so they sum to the cores instead of doubling them.

  The dead-code phase + in-worker timeouts now scale with the project's source-file count (and inversely with the dead-code core share when overlapped) instead of a flat cap, so a large repo's legitimately-long pass isn't reclaimed before it finishes; the ceiling still reclaims a genuinely wedged worker, and an explicit `REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS` override is honored verbatim. This supersedes the previous memory-gated dead-code overlap and replaces the flat dead-code phase cap with the size-scaled budget.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Skip the deslop analysis passes whose output react-doctor discards — an ~8.5x speedup of the dead-code phase on large repos.

  react-doctor consumes only deslop's graph dead-code findings: unused files, unused exports, unused dependencies, and circular dependencies. The dead-code worker projects exactly those four off deslop's result (`check-dead-code.ts` `normalizeResult`); the other ~18 fields deslop computes never cross the worker boundary. Two of deslop's passes produce only discarded output and are the bulk of the runtime: the full-TypeScript-Program **semantic** pass (unused types / enum & class members / misclassified deps), and a set of **code-quality** detectors (duplicate-block / copy-paste detection, complexity hotspots, feature flags, TypeScript smells, private-type leaks, re-export cycles). Profiling a ~9k-file repo (Sentry) showed `generateReport` was ~90% of the phase and duplicate-block detection alone was ~83s of ~130s.

  deslop gains a `reportCodeQuality` flag (default `true`, so deslop used standalone is unchanged) that gates those six code-quality detectors — they were the only expensive detectors still running unconditionally while the cheaper redundancy detectors were already opt-in. react-doctor's dead-code worker now passes both `semantic: { enabled: false }` and `reportCodeQuality: false`.

  Measured on Sentry: deslop drops from ~132s to ~15.5s (8.5x) with byte-identical consumed findings (198 unused files, 10 unused exports, 4 unused deps, 137 cycles), and a full supply-chain-on scan drops from ~142s to ~40s. Skipping these is provably safe — each consumed finding comes from its own detector, independent of the disabled passes — and a parity test locks the invariant so a future deslop change that ever coupled a consumed finding to either pass fails CI first.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Diagnostics are now emitted in a deterministic order across runs (JSON report, terminal output, on-disk dump, and the agent handoff), so two runs of the same repo produce byte-identical ordering instead of the parallel lint pass's arrival order. Lint scans also schedule the largest source files first (LPT batch ordering) for better wall-clock on large repos — a free reordering using the file size the minified-file gate already stat'd. Set `REACT_DOCTOR_LINT_BATCH_ORDERING=arrival` to fall back to discovery order. The diagnostics array content (and the JSON `schemaVersion`) is unchanged — only the ordering becomes deterministic.

- [#879](https://github.com/millionco/react-doctor/pull/879) [`9f733f7`](https://github.com/millionco/react-doctor/commit/9f733f7cff1055f631d69dbc84848efa948c0d89) Thanks [@skoshx](https://github.com/skoshx)! - Skip pnpm hardening check for monorepo sub-packages. Hardening settings are workspace-level and should only be checked at the workspace root or standalone pnpm projects.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Replace the fixed 16-worker lint ceiling with a memory-and-core-budgeted auto count (up to 32). The auto path now picks `min(cores, floor(availableMemory / 1 GiB))` clamped to `[1, 32]`, where `availableMemory` is `os.totalmem()` floored by the container's cgroup memory limit (read directly, since Node's memory APIs report the host total inside a container). `os.freemem()` is deliberately not used — it excludes reclaimable page cache and reads near-zero on macOS / cache-heavy Linux, which would have collapsed the default scan to a single worker.

  The 1 GiB/worker budget matches the per-worker footprint the old fixed-16 ceiling already tolerated (16 workers on a typical 16 GiB CI box), so machines with at least ~1 GiB per core stay core-bound and unchanged. A 32/64-core runner with enough memory now uses up to 32 workers instead of idling cores behind the old 16; a high-core but memory-starved box or container uses fewer workers so the oxlint native binding doesn't OOM (the existing `EAGAIN`/`ENOMEM` serial replay remains the runtime backstop). Past ~10 workers parallel efficiency already flattens, so this is headroom and OOM-safety, not a proportional speedup.

  The cgroup v2 limit is read from the mount-root `memory.max`, which is the container's limit under the standard cgroup-namespace setup CI runners use; a non-namespaced nested cgroup falls back to the host total (with the serial replay as the backstop).

  Note for `diagnose({ projects })` batch scans: each project's lint pass is budgeted independently against the whole machine, so a batch (default 4 concurrent projects) can now spawn up to `4 × 32` concurrent oxlint processes on a large runner (was `4 × 16`). The per-project `EAGAIN`/`ENOMEM` serial replay still backstops any over-subscription; dividing the per-project memory budget by the batch concurrency is a possible follow-up.

  Explicit `REACT_DOCTOR_PARALLEL=N` and `inspect({ concurrency: N })` pins are now clamped to 32 (was 16). The `[~N workers]` scan suffix can show more than 16 on large runners, and the `oxlint.workers` telemetry distribution (plus the wide-event `workerCount` / `parallel`) now reports the real resolved worker count on the default auto path instead of only when a count was pinned.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add a per-file content-addressed lint cache so repeat scans re-lint only the files whose content changed. On a warm scan the oxlint pass partitions the file list by content hash: unchanged files replay their cached raw diagnostics, and only changed files are re-linted. The five cross-file rules (`no-barrel-import`, `nextjs-missing-metadata`, `nextjs-no-use-search-params-without-suspense`, `no-mutating-reducer-state`, `rn-prefer-expo-image`) — whose verdict for a file can depend on _other_ files — always run fresh in a never-cached sidecar pass, so a dependency change can never serve a stale verdict. Output is byte-identical with the cache on or off (the design invariant), so the score, JSON report, and `inspect()`/`diagnose()` return values are unchanged.

  The cache is on by default and content-hashed (so it survives CI re-clones), and is automatically bypassed in audit mode, when an `extends` lint config is adopted, or when user plugins are configured. Disable it with `REACT_DOCTOR_NO_FILE_CACHE=1`; the existing `REACT_DOCTOR_NO_CACHE=1` now disables both the whole-repo scan cache and this per-file cache. A `cross-file-rules` guard test fails if a future rule starts reading other files without being carved into the always-fresh sidecar. The CLI reports cache effectiveness on its Sentry run event as `lintCacheHitRatio`.

  `oxlint-plugin-react-doctor` now exports `CROSS_FILE_RULE_IDS`, the canonical set of rules whose verdict can depend on other files.

- [#908](https://github.com/millionco/react-doctor/pull/908) [`2cadd3f`](https://github.com/millionco/react-doctor/commit/2cadd3fe2cb5b0476b35b1581c0a4c99bcdf1306) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Persist react-doctor's scan caches across CI runs (plan 10).

  In CI every commit is a fresh, SHA-scoped checkout, so the project-local `node_modules/.cache` never survives between commits — every run recomputes from scratch. This makes the engine's caches survivable:

  - **`REACT_DOCTOR_CACHE_DIR`** (new env): an operator/CI-pinned cache root. The GitHub Action points it at a stable `${runner.temp}` path and persists it with `actions/cache`, so the per-file content-addressed lint cache restores across runs — a PR re-lints only its changed files instead of the whole project. Keyed on the react-doctor version + lockfile + os/arch, with a `restore-keys` partial-hit fallback; the engine re-validates every restored entry by content hash + ruleset hash, so a stale entry simply misses and recomputes (no correctness risk).
  - **Supply-chain on-disk cache** (new): per-PURL Socket artifacts are cached under the cache dir with a 24h TTL (`SUPPLY_CHAIN_CACHE_TTL_MS`), so unchanged dependencies skip the network on repeated scans — locally and in CI — removing the bulk of the Socket fetches a full scan makes. Fail-open (a cache miss/error just fetches; a write failure never sinks the scan) and disabled by the existing `REACT_DOCTOR_NO_CACHE` off-switch.

  The `action.yml` cache wiring ships as an action release (cut a tag after dogfooding). A `--print-cache-key` flag for a tighter (ruleset-exact) actions/cache key is a possible follow-up; the version+lockfile key already restores soundly today.

- [#893](https://github.com/millionco/react-doctor/pull/893) [`4560b6d`](https://github.com/millionco/react-doctor/commit/4560b6dd39a6826f3d65476df12032cae7abfc63) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Propagate the V8 compile cache (`NODE_COMPILE_CACHE`) to oxlint batch subprocesses so later batches reuse warm bytecode. Measured ~2% of the lint phase on large multi-batch scans; no benefit for single-batch (`--diff`/`--staged`) scans. The dominant per-child cost is plugin eval/registration, which the compile cache does not address — this is a small internal speedup, not a headline. Opt out with `NODE_DISABLE_COMPILE_CACHE=1`.

- Updated dependencies [[`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae), [`8bbcca8`](https://github.com/millionco/react-doctor/commit/8bbcca87daf06e60d0fa3005f8ad636fc929e513), [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae), [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae)]:
  - deslop-js@0.5.8
  - oxlint-plugin-react-doctor@0.5.8

## 0.5.7

### Patch Changes

- [#848](https://github.com/millionco/react-doctor/pull/848) [`431e515`](https://github.com/millionco/react-doctor/commit/431e515260a209088c2305c6372249009dd95474) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop a broken `eslint-plugin-react-hooks` install from sinking the whole lint pass, and fix the misleading error it produced (issue [#833](https://github.com/millionco/react-doctor/issues/833)).

  When the optional `react-hooks-js` (React Compiler) plugin can't be imported in the user's environment, oxlint fails the entire config load — which previously dropped every curated react-doctor diagnostic too and left the scan with `skippedChecks: ["lint"]` and zero results. The oxlint error is also multi-line, and the 200-char error preview truncated its plugin path mid-string (often right at `…/node_modules/`), so it read as react-doctor passing an invalid directory rather than a plugin that failed to load.

  - **Graceful degradation:** the oxlint runner now detects a `react-hooks-js` plugin-load failure and retries once with that plugin (and its compiler rules) dropped — mirroring the existing adopted-`extends` fallback. The curated react-doctor rules, dead-code, and environment checks all still run; only the React Compiler rules are skipped, surfaced as a clear `lint:partial` note that includes oxlint's real underlying reason.
  - **Readable error:** the unparseable-output preview grew from 200 to 600 chars so the full plugin path and the underlying `Error:` line survive instead of being cut at `…/node_modules/`.

- Updated dependencies [[`424d8f9`](https://github.com/millionco/react-doctor/commit/424d8f9f914ff98b791af6b1f88337922c80c8ef), [`81bbfcc`](https://github.com/millionco/react-doctor/commit/81bbfcc39a0ae2f7d92ebb8860d854d09a60344d), [`937a7ca`](https://github.com/millionco/react-doctor/commit/937a7ca8a1b066a62210dc4a11149b9180dc9851), [`b8170f8`](https://github.com/millionco/react-doctor/commit/b8170f814c079d7bbc9e7796dd13646a6e8175fe), [`3f7d0e7`](https://github.com/millionco/react-doctor/commit/3f7d0e7ddb055b4970cba2b393ce14f6615732e4), [`6b8e756`](https://github.com/millionco/react-doctor/commit/6b8e756c40fe300634aec766edb00cbec73d8bc4), [`03301fc`](https://github.com/millionco/react-doctor/commit/03301fcdf4adcf256ef7ef7ed83f5566181ab371), [`44db3e0`](https://github.com/millionco/react-doctor/commit/44db3e0546fe0518b79e0aa2636754dcccda2939), [`5b742fa`](https://github.com/millionco/react-doctor/commit/5b742fa28c96443bd5bbd6348ad5aba55e17405c), [`8908f98`](https://github.com/millionco/react-doctor/commit/8908f98d02ad65e58d740ab948f8111948592cb9), [`451beeb`](https://github.com/millionco/react-doctor/commit/451beeb28405aa6810946e3311dfc7fb8de74632)]:
  - oxlint-plugin-react-doctor@0.5.7

## 0.5.6

### Patch Changes

- [#812](https://github.com/millionco/react-doctor/pull/812) [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0) Thanks [@aidenybai](https://github.com/aidenybai)! - Add five `security-scan` rules distilled from security-researcher writeups and the deepsec scanner-matcher catalog, closing CWE shapes the bucket didn't cover:

  - **`unsafe-json-in-html`** — `JSON.stringify(...)` embedded in `dangerouslySetInnerHTML` or inline `<script>` markup. `JSON.stringify` does not HTML-escape, so data containing `</script>` or `<` breaks out — the classic SSR data-hydration XSS. Suppressed when an HTML-safe serializer (serialize-javascript, devalue, superjson) or `\u003c` escaping is used.
  - **`jwt-insecure-verification`** — the JWT `none` algorithm (`alg: none` / `algorithms: ["none"]`), which disables signature verification and lets any forged token through. (Detecting an unpinned `jwt.verify` precisely needs scope-aware analysis, so that is left to a future AST rule.)
  - **`secret-in-fallback`** — a secret-shaped env var with a hardcoded string fallback (`process.env.STRIPE_SECRET_KEY ?? "<hardcoded>"`): a committed secret that also makes the app fail open when the var is unset. Skips public vars (PUBLIC/PUBLISHABLE/ANON) and placeholder defaults.
  - **`request-body-mass-assignment`** — spreading or merging request input (`{ ...req.body }`, `Object.assign(target, req.body)`, lodash `merge`/`defaultsDeep`) without a field allowlist: mass assignment (client-set owner/role/price columns) or prototype pollution.
  - **`insecure-session-cookie`** — auth/session cookies exposed to JavaScript: `httpOnly: false`, set via `document.cookie`, or a bare `res.cookie("session", value)` / `cookies().set(...)` with no options.

  All five register through `defineRule` with a project-level `scan`, carry the `Security` category and `security-scan` tag, and are silenced by `react-doctor rules ignore-tag security-scan` like the rest of the family.

- [#824](https://github.com/millionco/react-doctor/pull/824) [`cf9e05b`](https://github.com/millionco/react-doctor/commit/cf9e05be8ee1f1781878c28b8342490ec11c176f) Thanks [@aidenybai](https://github.com/aidenybai)! - Show the full file total when the scan hands off to dead-code analysis, so the live counter no longer looks stuck below `N` ([#815](https://github.com/millionco/react-doctor/issues/815)).

  The linter already emits a final `(N, N)` progress tick when its last batch finishes, but ora throttles renders to its frame interval — that last frame was overwritten by the `"Analyzing dead code…"` text before it ever painted, so the spinner appeared to freeze at whatever value the smooth-creep timer last drew (e.g. `80/165`). Every file was always scanned; only the counter looked short. The dead-code phase now reads `Scanned N files, analyzing dead code…`, keeping the complete count visible for the whole (longer) dead-code pass.

- [#819](https://github.com/millionco/react-doctor/pull/819) [`5fc0e27`](https://github.com/millionco/react-doctor/commit/5fc0e270c9a15d25be96ef982755cea81065d141) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix false positives reported in the security and TanStack rules:

  - **`query-destructure-result`** ([#818](https://github.com/millionco/react-doctor/issues/818)): only flags `useQuery`/`useSuspenseQuery`/… when they actually come from a TanStack Query package (`@tanstack/*-query`, legacy `react-query`). A same-named hook imported from elsewhere — notably Convex's `useQuery` from `convex/react`, which returns the data directly — is no longer flagged.
  - **`artifact-env-leak` / `artifact-secret-leak`** ([#816](https://github.com/millionco/react-doctor/issues/816), [#817](https://github.com/millionco/react-doctor/issues/817)): no longer treat server-side or dev-mode Next.js output as browser artifacts. `.next/dev/server/**` (dev source maps), any `.next/**/server/**`, `.output/server/**`, and the dev server's `.next/dev/**` output are excluded; production browser bundles (`.next/static`, `dist/assets`, `public/`, …) are still scanned.
  - **`repository-secret-file`** / **`key-lifecycle-risk`** ([#813](https://github.com/millionco/react-doctor/issues/813)): no longer flag a credential/key file that git ignores — a local-only, gitignored `.env` is not "checked into the repository". Findings are dropped only when git definitively reports the path as ignored (the finding stands when there is no repo or git is unavailable).
  - **`webhook-signature-risk`** ([#814](https://github.com/millionco/react-doctor/issues/814)): recognizes a delegated verification helper (a call pairing a verify-ish verb with a security noun, e.g. `isValidSecret(...)`, `verifySignature(...)`, `checkWebhookHmac(...)`) as verification evidence, so an extracted `timingSafeEqual` comparison in another module no longer trips the rule.

- [#812](https://github.com/millionco/react-doctor/pull/812) [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a `supabase-table-missing-rls` security-scan rule. It flags a Supabase migration (`supabase/migrations/**`, `supabase/schemas/**`) that runs `create table` for a public-schema table but never enables Row Level Security — the highest-impact and most common Supabase misconfiguration, because RLS is OFF by default for SQL-created tables, so every row is readable and writable with the public anon key. It targets the same misconfiguration Supabase's own `rls_disabled_in_public` database linter flags, and the gap that turns the public anon key into the service key.

  The existing `supabase-rls-policy-risk` only caught an explicit `disable row level security`; this complements it by catching the far more common "never enabled it" case. RLS is checked per table — each `create table` must have an `alter table <name> enable row level security` for that same table, after the create (a sibling table enabling RLS, or a policy without enabling it, does not vouch). SQL comments and string literals are ignored, non-public/Supabase-managed schemas (`auth.`, `storage.`, a `private.` schema, …) are skipped, and the rule is scoped to the `supabase/` directory so plain Drizzle/Prisma `.sql` migrations are not flagged. The scan runs per migration file, so enabling RLS in a _different_ migration than the `create table` is not detected — the same-file pattern (what Supabase tooling emits) is the supported case. Like the rest of the family it carries the `security-scan` tag and is silenced by `react-doctor rules ignore-tag security-scan`.

- [#823](https://github.com/millionco/react-doctor/pull/823) [`bac7c82`](https://github.com/millionco/react-doctor/commit/bac7c82950e2392ac4b21448f3e9cf86b605567f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a supply-chain scan crash on npm dist-tags and wildcards ([#807](https://github.com/millionco/react-doctor/issues/807)).

  `resolveConcreteVersion` called `semver.minVersion(spec)` directly, but `semver` **throws** (`TypeError: Invalid comparator: latest`) on a non-range spec instead of returning `null`. Any full scan — or PR scan touching `package.json` — containing a dist-tag like `"trigger.dev": "latest"` (or `"next"`) crashed before the Socket fail-open path could run (regression from [#804](https://github.com/millionco/react-doctor/issues/804), affecting 0.5.3–0.5.5).

  The spec is now validated with `semver.validRange` before resolving its floor: dist-tags and other non-ranges are skipped (nothing to score), as is a wildcard-only range (`*`/`x`/`X`), which previously resolved to a synthetic `0.0.0` and scored a version nobody pinned. Real ranges (`^1.2.3`, `1.x`, `>=2 <3`) and protocol/URL specs (`workspace:`, `file:`, `npm:`, `git+…`) are unchanged.

- Updated dependencies [[`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0), [`5fc0e27`](https://github.com/millionco/react-doctor/commit/5fc0e270c9a15d25be96ef982755cea81065d141), [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0)]:
  - oxlint-plugin-react-doctor@0.5.6

## 0.5.5

### Patch Changes

- Updated dependencies [[`e90eb7a`](https://github.com/millionco/react-doctor/commit/e90eb7acbfc4e06de68de2cb6a96d3242f72963e)]:
  - oxlint-plugin-react-doctor@0.5.5

## 0.5.4

### Patch Changes

- [#744](https://github.com/millionco/react-doctor/pull/744) [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a project-level security file scan: 36 first-class scan rules (leaked artifact secrets and env dumps, permissive Firebase/Supabase rules, raw SQL injection risk, unsafe webhook signature comparisons, committed private key material, public debug artifacts, …) ship in the oxlint plugin as ordinary `defineRule` modules that declare a project-level `scan` instead of AST visitors and run in `@react-doctor/core`'s environment-check phase over one bounded whole-tree walk — covering shipped bundles, dotenv/config files, SQL, and Firebase rules files that per-file linting never sees.

  Scan rules register metadata (id, title, severity, recommendation, `Security` category, `security-scan` tag) like any other rule but carry a project-level `scan` instead of AST visitors, so their findings flow through the standard diagnostic pipeline: per-rule and per-category severity overrides, inline disables, and output `surfaces` now apply to scan-rule diagnostics, and `react-doctor rules ignore-tag security-scan` (config `ignore.tags`) silences the whole family. They never appear in generated oxlint configs or the ESLint presets — they only execute through React Doctor's scan. A plain `--diff` / `--staged` scan skips them like the other whole-project checks, and the gate is now diff mode itself rather than the presence of include paths, so projects configuring `ignore.files` get the security scan too.

- Updated dependencies [[`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb), [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb)]:
  - oxlint-plugin-react-doctor@0.5.4

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.5.3

## 0.5.2

### Patch Changes

- [#769](https://github.com/millionco/react-doctor/pull/769) [`2f26228`](https://github.com/millionco/react-doctor/commit/2f26228e36cfe64a430a41596d7b1053d6d7d307) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Consolidate the scan-scope controls into one `--scope` flag (and `scope` config option) with four values, shared verbatim by the CLI and the GitHub Action:

  - `full` (default) — the whole project, every issue. Whole-project checks (dead-code, environment, supply-chain) run only here.
  - `files` — only the files changed vs the base, with all issues in them (no compare-to-main). What `--staged` and an uncommitted `--diff` did.
  - `changed` — only issues the change introduced vs the base (the baseline delta). What `--diff <base>` and the action's `scope: changed` did.
  - `lines` — only issues on the lines the change actually touched. New: previously this scoping existed only inside the GitHub Action's inline-review-comment step; it now lives in the engine, so the CI gate, score display, summary, and inline comments all honor one scope.

  `--base <ref>` sets the comparison base for `files` / `changed` / `lines` (auto-detected when omitted). Behavior is unchanged by default: the CLI `--scope` defaults to `full` and the action `scope` input still defaults to `changed`. `--diff` / `config.diff` keep working as a deprecated alias (`--diff <base>` → `--scope changed --base <base>`, `--diff false` → `--scope full`) and emit a one-time deprecation warning; `--staged` is retained as the source selector and composes with `--scope files` / `--scope lines`.

- [#783](https://github.com/millionco/react-doctor/pull/783) [`a48fb06`](https://github.com/millionco/react-doctor/commit/a48fb06ffbe7221655e18529fcc954ecae17a22f) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Add a `--output-dir <dir>` flag that writes the full diagnostics dump (diagnostics.json + one .txt per rule) to a directory of your choice instead of a random temp folder, prints the written path whenever the flag is set (previously `--verbose`-only), and makes the agent handoff reuse that directory instead of writing a second temp copy. Without the flag, behavior is unchanged.

- Updated dependencies [[`94f9f4f`](https://github.com/millionco/react-doctor/commit/94f9f4fe98207181958f82275b41d94963bc73a2), [`038aaf7`](https://github.com/millionco/react-doctor/commit/038aaf78c12f7f9a2699f46d3a6aa304dc69fc12), [`fee3fc4`](https://github.com/millionco/react-doctor/commit/fee3fc436e502ad4a6609ab8bda9c9a782d8ecd7), [`c4f0e60`](https://github.com/millionco/react-doctor/commit/c4f0e607b6092485d226c0d67c783270f4eec8b2), [`f52bd07`](https://github.com/millionco/react-doctor/commit/f52bd0737527df9ab81f3746e64bdb5ac1defbc7), [`7c88165`](https://github.com/millionco/react-doctor/commit/7c8816575aff26f11b5099c7ef009c4793fe260f)]:
  - oxlint-plugin-react-doctor@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [[`77a70ab`](https://github.com/millionco/react-doctor/commit/77a70ab8a78dd21dc305a6c2b924e4bbc44058ce)]:
  - oxlint-plugin-react-doctor@0.5.1

## 0.5.0

### Minor Changes

- [#756](https://github.com/millionco/react-doctor/pull/756) [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede) Thanks [@NisargIO](https://github.com/NisargIO)! - React Doctor now runs on repositories that don't depend on React. Previously a scan hard-failed with `No React project found` / `No React dependency`, even though many checks (security, bundle size, JS performance, architecture, and the Zod rules) are framework-agnostic and apply to any TypeScript / JavaScript codebase.

  A project is now analyzable when it has source files, with or without React. A bare directory of TypeScript files — including a monorepo's `packages/` subfolder that has no `package.json` of its own — is scanned by inheriting dependency/framework detection from the enclosing workspace root.

  React-flavoured rules stay off without React. A new `react` capability (set only when React or Preact is present) gates every React-runtime rule family (hooks, JSX, accessibility, render performance, React state) plus any rule tagged `react-jsx-only`, so hook/component-name heuristics like `rules-of-hooks`, `no-legacy-class-lifecycles`, and `no-nested-component-definition` can't false-fire on ordinary TypeScript. Once React (or Preact) is detected, every rule behaves exactly as before.

### Patch Changes

- [#741](https://github.com/millionco/react-doctor/pull/741) [`963eaf5`](https://github.com/millionco/react-doctor/commit/963eaf53db7de069baf2c7d18075443c3d934f9b) Thanks [@NisargIO](https://github.com/NisargIO)! - Add a `no-vulnerable-react-server-components` security check that flags projects running React Server Components on a version with a known advisory — primarily the critical unauthenticated RCE (CVE-2025-55182, CVSS 10.0), and the later high-severity DoS (CVE-2026-23870).

  It resolves the concrete installed version of React's RSC runtime and compares it against the patched releases per minor line (19.0 → 19.0.6, 19.1 → 19.1.7, 19.2 → 19.2.6). Frameworks and bundlers that expose `react-server-dom-*` directly (Vite, Parcel, React Router, Waku, RedwoodSDK) are checked by those package versions; Next.js — which vendors its own RSC runtime — is checked by its `next` version and the easiest corrective fix points at a Next.js upgrade (15.5.18 / 16.2.6) rather than a React bump. Pure client-side React apps with no RSC packages and no Next.js are unaffected and stay quiet, and the check never flags off an ambiguous declared range whose lockfile may resolve to a patched version.

- Updated dependencies [[`b4b79ad`](https://github.com/millionco/react-doctor/commit/b4b79addce225c47048127e04be2670c13bca332), [`af98f83`](https://github.com/millionco/react-doctor/commit/af98f83614526cca30f3a31ec2507a5df5da2bed), [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede)]:
  - oxlint-plugin-react-doctor@0.5.0

## 0.4.2

### Patch Changes

- [#721](https://github.com/millionco/react-doctor/pull/721) [`d17dc87`](https://github.com/millionco/react-doctor/commit/d17dc87865e059f21534990d0925115db439dc3e) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a `defineConfig` helper for authoring a typed `doctor.config.{ts,js,mjs,cjs}` and read `react-doctor.config.json` as a deprecated fallback.

  `defineConfig` is exported from `react-doctor/api` (and `@react-doctor/api` / `@react-doctor/core`) as an identity helper that gives editor autocomplete and type-checking without an explicit `satisfies ReactDoctorConfig` annotation:

  ```ts
  // doctor.config.ts
  import { defineConfig } from "react-doctor/api";

  export default defineConfig({
    lint: true,
    rules: { "react-doctor/no-array-index-as-key": "off" },
  });
  ```

  The pre-migration `react-doctor.config.json` filename is now read as the lowest-priority fallback (after `doctor.config.*` and `package.json#reactDoctor`) instead of being ignored, so an un-migrated config keeps applying. It still emits a deprecation warning nudging a rename, and interactive runs continue to auto-migrate it to `doctor.config.ts`. A present-but-broken legacy file stops config resolution (it won't silently inherit an ancestor repo's config), and `react-doctor rules <...>` migrates a legacy file to `doctor.config.json` on write rather than editing it in place.

  Note: a `react-doctor.config.json` that was previously ignored in non-interactive runs (CI, coding agents, `--json`/`--score`/`--staged`) is now honored again, which can change which rules fire, the score, and PR gating for projects that still have one. Rename it to `doctor.config.json` (or delete it) to avoid surprises.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.2

## 0.3.1

### Patch Changes

- [#715](https://github.com/millionco/react-doctor/pull/715) [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Disable `server-fetch-without-revalidate` on Next.js 15+ projects. Next.js 15 changed the default fetch behavior from cached-forever to `no-store`, making the rule's warning obsolete. Adds Next.js version detection (workspace- and `catalog:`-aware, mirroring Expo/FlashList resolution) and the `nextjs:15` capability gate.

- Updated dependencies [[`dc35070`](https://github.com/millionco/react-doctor/commit/dc35070a5066f9864a7565b952dec2f81bff1223), [`b1a22ef`](https://github.com/millionco/react-doctor/commit/b1a22efdf7b18f2cc8b7af6c0b12173ed3c76d34), [`73dcb20`](https://github.com/millionco/react-doctor/commit/73dcb2040dc6aa207beea074f846fd675c30bd2b), [`64667da`](https://github.com/millionco/react-doctor/commit/64667dae16b812ad9b4304bd7906d5ddbb50921a), [`ee9ab33`](https://github.com/millionco/react-doctor/commit/ee9ab336d3b2918d319bc048b5b164f58611df83), [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b), [`831cf3f`](https://github.com/millionco/react-doctor/commit/831cf3fbfd703f5048de5c2c3258e47988a2cce0)]:
  - oxlint-plugin-react-doctor@0.4.1

## 0.3.0

### Minor Changes

- [#663](https://github.com/millionco/react-doctor/pull/663) [`9a8ad6e`](https://github.com/millionco/react-doctor/commit/9a8ad6e40d9ed1fbe7ddb1f1c57bfd5c791a4b9e) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Rework CI reporting: a renamed `blocking` gate, PR-introduced-issues-only baselines, inline PR review comments, and a simpler CLI flag surface.

  **CI gate**

  - **`fail-on` is renamed to `blocking`** (CLI `--blocking <level>`, config `blocking`, GitHub Action `blocking` input). Same `error | warning | none` values, default `error`: a scan fails CI when an `error`-severity diagnostic reaches the `ciFailure` surface; `warning` blocks on any diagnostic; `none` stays advisory (always exits 0). `--fail-on` / `failOn` still work as a deprecated, warned alias hidden from `--help`.
  - `--blocking warning` now wins over `--no-warnings` (it previously silently no-op'd the gate — you can't block on warnings you've hidden).

  **Baseline — report only the issues a PR introduces (Codecov-style)**

  - In `--diff <base>` mode, react-doctor runs a second lint pass over the changed files as they existed at the base merge-base and reports only the diagnostics the change introduced; pre-existing findings that merely shifted lines are matched out by a content fingerprint (`file + rule + flagged-line hash`). The head project-health **score is unchanged**; the gate fails on newly-introduced errors only. If the baseline can't be computed (base unreachable, or a lint pass failed), the run degrades to a plain diff — all findings stay visible and CI isn't gated on findings whose new-vs-pre-existing attribution is unknown.
  - **New core API:** `computeDiagnosticDelta`, `Git.showRefContent` / `Git.mergeBase`, `materializeSourceTree`, and `InspectOptions.baseline` / `InspectResult.baselineDelta`.
  - **JSON report v2:** baseline runs emit `schemaVersion: 2` with a `baseline` block (`newCount`, `fixedCount`, `baseTotalCount`) and `mode: "baseline"`; `summary.score` stays the head score. v1 reports are unchanged.

  **GitHub Action**

  - Posts **inline PR review comments** on the changed lines that triggered each diagnostic (with fix guidance + a docs link), plus a restyled CLI-style sticky summary with linkable findings and the new / fixed delta. The `annotations` input was removed.
  - On pull requests it fetches the base commit for baselining — use `fetch-depth: 0` on `actions/checkout`. New `fixed-issues` output. Defaults: `project: "*"`, `node-version: 24`.

  **CLI flags (fewer flags, fewer footguns)**

  - `--explain` / `--why` → the `react-doctor why <file>:<line>` subcommand (`rules explain <rule>` still explains what a rule means).
  - Removed `--full` (use `--diff false` to force a full scan), `--pr-comment` (the Action renders its comment from `--json`), and the positive `--respect-inline-disables` (already the default; use `--no-respect-inline-disables` for audit mode). The internal `--changed-files-from` is hidden from `--help`.
  - Removed flags now fail with a migration error instead of being silently dropped, and an empty `--project` filter (e.g. `--project ","`) is rejected.

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.0

## 0.2.19

### Patch Changes

- Updated dependencies [[`eba20ae`](https://github.com/millionco/react-doctor/commit/eba20ae9a708af81c7d95dbdadf16c8e5c6d21f9), [`5d7b36b`](https://github.com/millionco/react-doctor/commit/5d7b36bc315ba4c0a8ba6b60bd781a11efbed94f)]:
  - oxlint-plugin-react-doctor@0.3.0

## 0.2.18

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.18

## 0.2.17

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.17

## 0.2.16

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.16

## 0.2.15

### Patch Changes

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Collapse diagnostic categories into five clear, outcome-based buckets: **Security**, **Bugs**, **Performance**, **Accessibility**, and **Maintainability**. The previous fine-grained labels (Correctness, State & Effects, React Compiler, Next.js, React Native, Server, TanStack Query/Start, Preact → Bugs; Bundle Size → Performance; Architecture/Design → Maintainability) now roll up so the scan output reads as plain issue types at a glance.

  This changes the `category` value on every diagnostic (CLI output, the per-error headline prefix like `Security: Use of eval()`, and JSON/programmatic output). If you key `categories` severity overrides off the old names, update them to the new buckets. Dead-code findings (unused files/exports/dependencies, circular imports) now report `Maintainability` instead of `Dead Code`. Bundle-size findings now sort with `Performance` (higher stakes) rather than near the bottom of the top-errors block.

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix dead-code analysis silently failing ("Scanning failed (dead-code analysis, non-fatal).") on type-heavy projects. deslop's semantic pass builds a full TypeScript program and walks every identifier through the type checker; on projects with large generic types (tRPC routers, Effect/Zod schemas, deep generics) the checker instantiates enormous types and the child process exceeds Node's default ~4 GB heap, dying with an uncatchable "JavaScript heap out of memory" that surfaced as empty worker output and a non-fatal scan failure. The dead-code worker child is now spawned with `--max-old-space-size=8192` so those projects complete instead of crashing.

- Updated dependencies [[`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7), [`75c1f99`](https://github.com/millionco/react-doctor/commit/75c1f99e062a8fc3e5e4ba294208dbc56bca5f6f)]:
  - oxlint-plugin-react-doctor@0.2.15

## 0.2.14

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.13

## 0.2.12

### Patch Changes

- Updated dependencies [[`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de), [`d0f5206`](https://github.com/millionco/react-doctor/commit/d0f52062e09c7bfe11eda2c06ad6e9ab0ab7da58), [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb)]:
  - oxlint-plugin-react-doctor@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies [[`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163)]:
  - oxlint-plugin-react-doctor@0.2.11

## 0.2.10

### Patch Changes

- Add Preact project detection and capability wiring. Scans now distinguish pure Preact projects from `preact/compat` setups and still enable Preact rules for Vite + Preact projects where the build framework remains `vite`.

- Add React minor-version capability parsing for APIs that ship after a major release. `react:19.2` now gates the `<Activity>` rule instead of enabling it for every React 19 project.

- Fix dead-code scan freezes by running analysis through a bounded worker path and continuing the inspect pipeline when analysis stalls or errors.

- Carry the latest rule-plugin capability updates through core, including Preact, Jotai, React Native performance, JS performance, HTML correctness, accessibility, and state-and-effects checks.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.10`.

## 0.2.9

### Patch Changes

- Dependency bump: `oxlint-plugin-react-doctor@0.2.9`.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.8

## 0.2.7

### Patch Changes

- Unify the dual diagnostic-filter pipelines into a single `buildDiagnosticPipeline` source of truth, removing a longstanding divergence between CLI and API filtering.

- Wire the `Progress` service into `runInspect`, eliminating the manual spinner `Ref` plumbing that leaked implementation details into renderers.

- Move scattered magic numbers into `constants.ts` with unit-suffixed `SCREAMING_SNAKE_CASE` names per project conventions.

- Consolidate `isProjectBoundary` helpers and rename the event-handler `isFunctionLike` to avoid collision with the oxlint plugin's AST utility of the same name.

- Push score-surface filtering into `runInspect` so downstream consumers no longer need to re-apply surface filters.

- Add `resolveScanTarget` helper and share `restoreLegacyThrow` across CLI and API entry points.

- Emit automated agent guidance (issue-reporting links) in inspect output for AI-assisted workflows.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.7

## 0.2.6

### Patch Changes

- Inherit the `design-no-bold-heading` rule removal from `oxlint-plugin-react-doctor@0.2.6`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.6

## 0.2.5

### Patch Changes

- Add `require-pnpm-hardening` environment check that warns when `pnpm` is detected without strict lockfile settings, helping prevent phantom dependency issues.

- Cover child workspace diff include paths so `--diff` mode in monorepos correctly scans files changed inside nested workspace packages, not just the root.

- Fix Node 20 runtime dependency support so the core package resolves correctly without Node 22+ built-ins.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.5

## 0.2.4

### Patch Changes

- **Effect v4 foundation.** Introduce tagged error classes (`Schema.TaggedErrorClass`), `Schema.Class` wire records for diagnostics and reports, `Context.Reference` for ambient config, and branded `Schema.brand` paths (`OxlintBinaryPath`, `NodeBinaryPath`). All fallible operations now fail with `ReactDoctorError` carrying a `reason` union that renderers dispatch on via `Effect.catchReasons`.

- **10 Effect v4 services.** Stand up `Files`, `Git`, `Project`, `Config`, `Linter`, `DeadCode`, `Score`, `Reporter`, `Progress`, and `NodeResolver` as `Context.Service` classes with `layerNode` / `layerOf` / `layerCapture` / `layerNoop` test variants.

- **`runInspect` streaming orchestrator.** Replace the imperative scan loop with a per-element pipeline that streams diagnostics through `buildDiagnosticPipeline`, enabling concurrent lint + dead-code analysis and real-time progress reporting.

- **Collapse `@react-doctor/types` and `@react-doctor/project-info` into `@react-doctor/core`**, reducing the workspace package count and simplifying imports.

- **Opt-in OpenTelemetry export.** Set `REACT_DOCTOR_OTLP_ENDPOINT` and `REACT_DOCTOR_OTLP_AUTH_HEADER` to ship every `Effect.fn("Service.method")` span and top-level `Effect.withSpan` to an OTLP-compatible backend.

- **User-plugin extension.** `config.plugins: [...]` loads additional oxlint plugin packages alongside the built-in rule set so teams can ship custom rules.

- **Security fixes.** Pin CI workflow permissions, add fork guards, fix four pre-existing audit findings.

- **Adopt `Effect.Console` throughout.** Drop the custom `Logger` service; renderers and services use `Console.log` / `Console.warn` / `Console.error` from `effect/Console`, which is swappable for tests via `Console.Console` service override.

- **Git service.** DI-wrap every `spawnSync('git', ...)` call site behind the `Git` service, then replace `spawnSync` with Effect's `ChildProcess` for non-blocking execution.

- **`NodeResolver` + `StagedFiles` services.** Remove the last `Effect.runSync` hack from `Linter.layerOxlint` by lifting Node resolution and staged-file discovery into their own services.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.4

## 0.2.3

### Patch Changes

- Fix vite build configuration for bundling workspace dependencies so `@react-doctor/core` resolves internal imports correctly at publish time.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.3
  - @react-doctor/project-info@0.2.3
  - @react-doctor/types@0.2.3

## 0.2.2

### Patch Changes

- Restore `eslint-plugin-react-hooks` as a hard dependency so React Compiler rules resolve without requiring users to install the peer separately.

- [#273](https://github.com/millionco/react-doctor/pull/273) [`47772b7`](https://github.com/millionco/react-doctor/commit/47772b7da4f6e412b09e3a4f74d888307faf74a1) - Natively port the 8 rules from `eslint-plugin-react-you-might-not-need-an-effect`
  (NickvanDyke, MIT) into `oxlint-plugin-react-doctor`. They now ship as
  `react-doctor/*` rules and no longer require the optional peer
  dependency. The optional peer-dep surface (`effect/*` rules,
  `resolveYouMightNotNeedEffectPlugin`,
  `YOU_MIGHT_NOT_NEED_EFFECT_NAMESPACE`) is removed from
  `@react-doctor/core`.

  The ports use a real `eslint-scope` ScopeManager (cached per Program
  via `WeakMap`) - same `references` / `resolved.defs[].node.init` /
  `isEventualCallTo` chasing the upstream plugin uses. Diagnostic
  messages match upstream verbatim with template variables substituted
  in JS.

  | Rule (now `react-doctor/<id>`)      | What it catches                                                          |
  | ----------------------------------- | ------------------------------------------------------------------------ |
  | `no-derived-state`                  | Storing derived state via a useEffect instead of computing during render |
  | `no-chain-state-updates`            | Chaining state updates across effects                                    |
  | `no-event-handler`                  | Using state + a guarded effect as an event handler                       |
  | `no-adjust-state-on-prop-change`    | Adjusting state in an effect when a prop changes                         |
  | `no-reset-all-state-on-prop-change` | Resetting all state in an effect (use a `key` prop)                      |
  | `no-pass-live-state-to-parent`      | Pushing live state to a parent via a callback in an effect               |
  | `no-pass-data-to-parent`            | Passing fetched data to a parent via a callback in an effect             |
  | `no-initialize-state`               | Initializing state inside a mount-only effect                            |

  Parity coverage: 195 of 196 upstream test cases pass (the 1 remaining
  case is upstream's own `todo: true`, "Set derived state via identical
  intermediate setter").

  These coexist with React Doctor's existing thematically-related rules
  (`no-derived-state-effect`, `no-effect-chain`, `no-event-trigger-state`,
  `no-prop-callback-in-effect`) - different IDs, different shapes,
  different messages.

- Updated dependencies [[`47772b7`](https://github.com/millionco/react-doctor/commit/47772b7da4f6e412b09e3a4f74d888307faf74a1)]:
  - oxlint-plugin-react-doctor@0.2.2
  - @react-doctor/project-info@0.2.2
  - @react-doctor/types@0.2.2

## 0.2.1

### Patch Changes

- Make filesystem walks tolerate EPERM/EACCES (macOS Library)

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.1
  - @react-doctor/project-info@0.2.1
  - @react-doctor/types@0.2.1

## 0.2.0

### Minor Changes

- [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758) - Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

- [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0) - Extract project / dependency / framework detection, the oxlint runner +
  scoring engine, and the shared TypeScript type layer out of the
  `react-doctor` monolith into three new public workspace packages:
  `@react-doctor/types`, `@react-doctor/project-info`, and
  `@react-doctor/core` ([#249](https://github.com/millionco/react-doctor/issues/249)). The oxlint plugin is restructured into
  per-rule modules under `src/plugin/rules/<category>/<rule>.ts` with a
  codegen'd `rule-registry.ts` ([#218](https://github.com/millionco/react-doctor/issues/218), [#228](https://github.com/millionco/react-doctor/issues/228), [#230](https://github.com/millionco/react-doctor/issues/230), [#231](https://github.com/millionco/react-doctor/issues/231), [#234](https://github.com/millionco/react-doctor/issues/234), [#235](https://github.com/millionco/react-doctor/issues/235), [#236](https://github.com/millionco/react-doctor/issues/236),
  [#242](https://github.com/millionco/react-doctor/issues/242)). Land the user-feedback sweep ([#208](https://github.com/millionco/react-doctor/issues/208)): scoring transparency hooks,
  per-rule severity + rule-set selection config options, and reduced
  false positives across the design / Tailwind / state-and-effects rule
  families. Reorganise the CLI into `cli/commands/` + `cli/utils/`
  ([#250](https://github.com/millionco/react-doctor/issues/250)), and forward `reactMajorVersion` through programmatic
  `diagnose()` ([#174](https://github.com/millionco/react-doctor/issues/174)).

### Patch Changes

- [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c) - Rule-fix wave for the 0.2.0-beta.5 release:

  - Scope `no-secrets-in-client-code` to client-reachable bindings -
    skips server-only modules, public env-prefixed values, and
    locally-classified safe files ([#252](https://github.com/millionco/react-doctor/issues/252)).
  - `nextjs-no-side-effect-in-get-handler` stops flagging
    `response.headers.set(...)` and locally-constructed `Map` / `Set` /
    `Headers` inside GET handlers; the same safe-bindings classifier
    benefits `server-auth-actions` and the TanStack Start
    `get-mutation` rule ([#260](https://github.com/millionco/react-doctor/issues/260)).
  - `async-defer-await` no longer reports awaits inside destructured
    patterns with defaults, bare-statement early-returns, or awaits
    guarded by an earlier `if … return …` ([#265](https://github.com/millionco/react-doctor/issues/265)).
  - `js-length-check-first` detects length guards anywhere earlier in
    an `&&` chain, not only as the immediate left operand ([#269](https://github.com/millionco/react-doctor/issues/269)).
  - `async-parallel` is suppressed in test files, browser-fixture /
    Playwright helpers, and ordered UI flows where serial awaits are
    deliberate ([#270](https://github.com/millionco/react-doctor/issues/270)).
  - `js-combine-iterations` skips lazy `Iterator` helper chains
    (`Iterator.from`, `Iterator.prototype.{map,filter,take,drop,…}`)
    whose evaluation semantics differ from `Array.prototype` ([#272](https://github.com/millionco/react-doctor/issues/272),
    resolves [#205](https://github.com/millionco/react-doctor/issues/205)).
  - `no-prevent-default` is framework-aware: Remix / Next.js
    progressive-enhancement form handlers, synthetic event types with
    no documented alternative, and form `onSubmit` handlers that
    subsequently call `fetch` / a server action no longer trip ([#274](https://github.com/millionco/react-doctor/issues/274)).
  - New per-surface diagnostic controls in `@react-doctor/core` +
    `react-doctor`: design and Tailwind cleanup categories are demoted
    from the default PR-comment surface while staying visible in the
    CLI report and at the CI failure gate ([#271](https://github.com/millionco/react-doctor/issues/271)).

- [#284](https://github.com/millionco/react-doctor/pull/284) [`b34c5c4`](https://github.com/millionco/react-doctor/commit/b34c5c4db28539d9407fc08600e0e8c28dea67cd) - Harden glob pattern compilation against ReDoS:

  - Replace the hand-rolled glob-to-regex compiler with [`picomatch`](https://github.com/micromatch/picomatch), the proven matcher behind `chokidar`, `fast-glob`, and `micromatch`. The previous compiler turned patterns like `**/**/**/**/**/foo.tsx` into nested optional `(?:.+/)?` groups whose backtracking is exponential in the number of `**` segments - a 20-deep pattern hung for over 30 seconds on a 60-character non-matching input.
  - Reject obviously pathological patterns early with a clear `InvalidGlobPatternError` carrying the offending pattern and a human-readable reason, instead of crashing the scan. Limits live in `@react-doctor/core/constants` (`MAX_GLOB_PATTERN_LENGTH_CHARS = 1024`, `MAX_GLOB_PATTERN_WILDCARD_COUNT = 24`) and bound worst-case work regardless of the underlying engine. Real-world ignore patterns like `**/foo/**/bar/**/*.tsx` sit well under the cap.
  - Surface invalid `ignore.files` and `ignore.overrides[*].files` entries as `[react-doctor] …` warnings on stderr and skip just the bad pattern, so a single typo no longer takes the whole scan down.
  - Add regression tests covering the worst-case patterns (deeply-stacked globstars and dense `a*a*a*…` alternations) and the validation surface.

- [#266](https://github.com/millionco/react-doctor/pull/266) [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255) - Scope React Native rules to per-package boundaries. Previously every
  `rn-*` rule fired on every file in a project whose top-level framework
  was detected as React Native or Expo - even on sibling workspaces that
  were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
  alongside `apps/web` and `packages/storybook`) the rules would noisily
  report issues against Next.js, Vite, Docusaurus, Storybook, and plain
  React DOM packages where they don't apply.

  React Native rules now walk up to the file's nearest `package.json`
  before running. The rule body is skipped when the package declares a
  web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
  `@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
  `react-dom` without an RN sibling) and stays active when the package
  declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
  `react-native-macos`, anything under the `@react-native/` or
  `@react-native-` community namespaces (`@react-native-firebase/*`,
  `@react-native-async-storage/*`, `@react-native-community/*`, …), or
  Metro's top-level `"react-native"` resolution field.

  The detection is bidirectional: a web-rooted monorepo (root
  `package.json` declares `next` or `vite`) still loads `rn-*` rules
  when any workspace targets React Native or Expo, so the rules now
  fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
  layout that the file-level boundary alone covered.

  `rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
  branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
  `Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
  case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
  Optional chaining (`Platform?.OS`) and the TS non-null assertion
  (`Platform.OS!`) parse the same way as the bare form. The walker stops
  at function and `Program` boundaries so JSX defined inside a callback
  hoisted out of a `Platform.OS` branch does not inherit the parent
  guard.

  Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
  keep the rule active even when the surrounding package classification
  is ambiguous.

- [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c) - False-positive sweep across the rule plugin and the oxlint runner:

  - Gate React-19-only rules on the detected React major version so they
    stay silent on React 18 projects, with hardened catalog / peer-range /
    workspace traversal in `@react-doctor/project-info` ([#254](https://github.com/millionco/react-doctor/issues/254)).
  - Treat early-return guards as render-reachable state reads so
    `rerender-state-only-in-handlers` / `no-event-trigger-state` stop
    recommending `useRef` for state that gates render output ([#255](https://github.com/millionco/react-doctor/issues/255)).
  - Narrow `no-effect-event-handler` - DOM imperatives, prop callbacks
    invoked from effects, and side effects routed through a stable ref
    are no longer reclassified as handler-only ([#256](https://github.com/millionco/react-doctor/issues/256)).
  - Suppress rules-of-hooks diagnostics on locally-defined `useX`
    helpers that are not React hooks, and add the `no-em-dash-in-jsx-text`
    / `no-three-period-ellipsis` typography rules ([#257](https://github.com/millionco/react-doctor/issues/257)).
  - Collapse duplicate oxlint diagnostics and recover diagnostics from
    large monorepo projects via batched runs + a new
    `dedupe-diagnostics` helper in `@react-doctor/core` ([#262](https://github.com/millionco/react-doctor/issues/262)).

- Updated dependencies [[`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255), [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758), [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0)]:
  - oxlint-plugin-react-doctor@0.2.0
  - @react-doctor/project-info@0.2.0
  - @react-doctor/types@0.2.0

## 0.2.0-beta.6

### Minor Changes

- Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

### Patch Changes

- [#284](https://github.com/millionco/react-doctor/pull/284) [`b34c5c4`](https://github.com/millionco/react-doctor/commit/b34c5c4db28539d9407fc08600e0e8c28dea67cd) - Harden glob pattern compilation against ReDoS:

  - Replace the hand-rolled glob-to-regex compiler with [`picomatch`](https://github.com/micromatch/picomatch), the proven matcher behind `chokidar`, `fast-glob`, and `micromatch`. The previous compiler turned patterns like `**/**/**/**/**/foo.tsx` into nested optional `(?:.+/)?` groups whose backtracking is exponential in the number of `**` segments - a 20-deep pattern hung for over 30 seconds on a 60-character non-matching input.
  - Reject obviously pathological patterns early with a clear `InvalidGlobPatternError` carrying the offending pattern and a human-readable reason, instead of crashing the scan. Limits live in `@react-doctor/core/constants` (`MAX_GLOB_PATTERN_LENGTH_CHARS = 1024`, `MAX_GLOB_PATTERN_WILDCARD_COUNT = 24`) and bound worst-case work regardless of the underlying engine. Real-world ignore patterns like `**/foo/**/bar/**/*.tsx` sit well under the cap.
  - Surface invalid `ignore.files` and `ignore.overrides[*].files` entries as `[react-doctor] …` warnings on stderr and skip just the bad pattern, so a single typo no longer takes the whole scan down.
  - Add regression tests covering the worst-case patterns (deeply-stacked globstars and dense `a*a*a*…` alternations) and the validation surface.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.6
  - @react-doctor/types@0.2.0-beta.6
  - @react-doctor/project-info@0.2.0-beta.6

## 0.2.0-beta.5

### Patch Changes

- [#252](https://github.com/millionco/react-doctor/pull/252) [`2d90c1c`](https://github.com/millionco/react-doctor/commit/2d90c1c5ae6d901913a575d40a784058478479ec) - Add public env-prefix detection (`get-public-env-prefix.ts`) and a
  recommendation builder (`build-no-secrets-recommendation.ts`) so
  client-secret diagnostics are scoped to actually client-reachable
  bindings instead of every string literal in the project.
  `run-oxlint.ts` and `runners/oxlint/config.ts` pass the detected
  prefix and the file-exposure classification through to the
  `no-secrets-in-client-code` rule.

- [#260](https://github.com/millionco/react-doctor/pull/260) [`b53d873`](https://github.com/millionco/react-doctor/commit/b53d8730459d2dc469a8f9841def231048c8de7e) - `run-oxlint.ts` + `runners/oxlint/config.ts` thread the new
  locally-scoped-safe-bindings classification through to the GET
  handler rule so `response.headers` and locally-constructed `Map` /
  `Set` / `Headers` no longer fail the Next.js GET-handler diagnostic.

- [#271](https://github.com/millionco/react-doctor/pull/271) [`7a7ec84`](https://github.com/millionco/react-doctor/commit/7a7ec84fad631d96f70279394be5f086b8424d17) - **Per-surface diagnostic filtering.** New public API:
  `diagnostic-surface.ts` (the `DiagnosticSurface` type - `pr-comment`,
  `cli`, `ci-failure-gate`), `filter-for-surface.ts` (filter a
  diagnostic list to those allowed on a given surface), and extended
  `validate-config-types.ts` with `surfaces.*` schema. Consumers can
  now demote whole categories (design, Tailwind cleanup) from default
  PR comments while keeping them visible in the CLI report and the
  CI gate. Exported from `packages/core/src/index.ts`.

- [#266](https://github.com/millionco/react-doctor/pull/266) [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255) - Scope React Native rules to per-package boundaries. Previously every
  `rn-*` rule fired on every file in a project whose top-level framework
  was detected as React Native or Expo - even on sibling workspaces that
  were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
  alongside `apps/web` and `packages/storybook`) the rules would noisily
  report issues against Next.js, Vite, Docusaurus, Storybook, and plain
  React DOM packages where they don't apply.

  React Native rules now walk up to the file's nearest `package.json`
  before running. The rule body is skipped when the package declares a
  web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
  `@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
  `react-dom` without an RN sibling) and stays active when the package
  declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
  `react-native-macos`, anything under the `@react-native/` or
  `@react-native-` community namespaces (`@react-native-firebase/*`,
  `@react-native-async-storage/*`, `@react-native-community/*`, …), or
  Metro's top-level `"react-native"` resolution field.

  The detection is bidirectional: a web-rooted monorepo (root
  `package.json` declares `next` or `vite`) still loads `rn-*` rules
  when any workspace targets React Native or Expo, so the rules now
  fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
  layout that the file-level boundary alone covered.

  `rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
  branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
  `Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
  case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
  Optional chaining (`Platform?.OS`) and the TS non-null assertion
  (`Platform.OS!`) parse the same way as the bare form. The walker stops
  at function and `Program` boundaries so JSX defined inside a callback
  hoisted out of a `Platform.OS` branch does not inherit the parent
  guard.

  Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
  keep the rule active even when the surrounding package classification
  is ambiguous.

- Updated dependencies [[`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255)]:
  - oxlint-plugin-react-doctor@0.2.0-beta.5
  - @react-doctor/project-info@0.2.0-beta.3
  - @react-doctor/types@0.2.0-beta.3

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- [#249](https://github.com/millionco/react-doctor/pull/249) [`f0198e2`](https://github.com/millionco/react-doctor/commit/f0198e2f2d9560a15bdb4a78f4a378ca2ac5fcdd) - **New public package.** Extracted from the `react-doctor` monolith
  in [#249](https://github.com/millionco/react-doctor/pull/249).
  Public surface: the oxlint runner family
  (`runners/oxlint/{config,capabilities,resolve-use-call-binding}.ts`,
  `run-oxlint`, `apply-ignore-overrides`, `batch-include-paths`),
  scoring (`calculate-score`), config validation
  (`validate-config-types`, `can-oxlint-extend-config`), diagnostic
  combination / dedupe / JSON reports (`combine-diagnostics`,
  `dedupe-diagnostics`, `build-json-report`,
  `build-json-report-error`), and the
  `check-reduced-motion` / `collect-ignore-patterns` /
  `list-source-files` helpers. Consumers that previously reached into
  `react-doctor/src/utils/*` should switch to importing from
  `@react-doctor/core`.

### Patch Changes

- [#208](https://github.com/millionco/react-doctor/pull/208) [`8556b31`](https://github.com/millionco/react-doctor/commit/8556b31d8e4e165f791db0aa60a6b038b18ec777) - **User-feedback sweep.** Surface each rule's contribution to the
  project score via the new scoring transparency hooks, accept
  per-rule severity overrides, and accept a `ruleSet` selector from
  config - all without changing the public `diagnose()` signature.

- [#254](https://github.com/millionco/react-doctor/pull/254) [`bfaf9c9`](https://github.com/millionco/react-doctor/commit/bfaf9c9530a9f8761df6e2d69abcf44c1699ff77) - `runners/oxlint/capabilities.ts` now consults the detected React
  major version when deciding which capability flags to enable. The
  React-19-only rule families are switched off on React 18 projects
  so the runner stops emitting rules the project can't act on.

- [#257](https://github.com/millionco/react-doctor/pull/257) [`ffbd20f`](https://github.com/millionco/react-doctor/commit/ffbd20f3d0ebda2221d2ea93f87342165da90fdb) - Adds `runners/oxlint/resolve-use-call-binding.ts` (619 LOC binding
  resolver) and `runners/oxlint/should-suppress-local-use-hook-diagnostic.ts`
  so the runner can post-filter rules-of-hooks diagnostics that point
  at locally-defined `useX` helpers (not actually React hooks).

- [#262](https://github.com/millionco/react-doctor/pull/262) [`bca5d30`](https://github.com/millionco/react-doctor/commit/bca5d30fc549a16c4628001dcd2c5a83e85c04f8) - Eval-driven oxlint robustness pass. `run-oxlint.ts` now batches
  include paths via the new `list-source-files` helper instead of
  globbing the universe, `utils/dedupe-diagnostics.ts` collapses
  duplicate diagnostics emitted across batched runs, and the runner
  recovers diagnostics from large monorepo projects that previously
  silently dropped output. Backed by `dedupe-diagnostics.test.ts`,
  `oxlint-batching.test.ts`, and `build-json-report.test.ts`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.2
  - @react-doctor/project-info@0.2.0-beta.2
  - @react-doctor/types@0.2.0-beta.2
