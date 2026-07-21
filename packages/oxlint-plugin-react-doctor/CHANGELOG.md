# oxlint-plugin-react-doctor

## 0.8.2

### Patch Changes

- [#1371](https://github.com/millionco/react-doctor/pull/1371) [`5b468f8`](https://github.com/millionco/react-doctor/commit/5b468f8a929cd210c93d015f1ba9cb9987e1d7b5) Thanks [@aidenybai](https://github.com/aidenybai)! - Add import-aware React Three Fiber and Three.js rules for frame-loop allocation, timing and interpolation, React state updates, unstable constructor props, primitive and loader-cache ownership, selector stability, async callbacks, private package imports, invalid frame scheduling arguments, recursive animation loops, unstable portal containers, nullish and imperative loaders, inline and undisposed GPU resources, instanced-buffer uploads, camera projection updates, renderer and manual-root cleanup, positive-priority rendering, uncapped DPR, excessive point-light shadows, declarative-ref attachment, catalogue registration during render, whole-namespace Three.js registration, unreleased global render-loop effects, synchronous readback, pointer capture, and WebGPU state, Canvas, TSL-uniform, and render-pipeline mistakes. Activate Three.js lifecycle rules independently from Fiber-only rules, gate version-specific contracts on the lowest detected Fiber major, and require file-local runtime provenance before interpreting R3F JSX intrinsics. Recognize ESM, TypeScript import-equals, and global CommonJS `require()` bindings across Three.js and the public Fiber root, native, legacy, WebGPU, Drei, and deprecated package entry points while rejecting shadowed APIs. Preserve symbol-proven mutually exclusive primitive mounts, detect co-mounted resources returned by inline render helpers, prune statically safe logical loader fallbacks, distinguish shared loader assets from locally owned GPU resources, and reject nested returns as render-loop cleanup.

  Add handbook-derived coverage for non-reactive mutable `useThree` scalar selectors, React updates and allocations in R3F pointer-move handlers, shared pointer-event point mutation, redundant Canvas renderer resize listeners, `window.onresize` assignments, and `ResizeObserver` callbacks, component-owned imperative controls cleanup, and legacy shader-material and post-processing APIs below both the R3F 10 WebGPU Canvas and stable R3F 9 Canvas instances with a proven WebGPU renderer factory. Preserve converging boolean-latch transitions written with `if`, ternary, `&&`, or `||` guards in high-frequency state-update rules, name both the mutable leaf and stable root in deep-selector diagnostics, and track immutable TSL uniforms created outside WebGPU node-graph callbacks.

  Track component-owned Three.js resources stored in direct or guarded-lazy `useRef` bindings, and diagnose renderer `setAnimationLoop` scheduling that competes with R3F `useFrame`.

  Require component-owned Three.js animation mixers to stop cached actions and uncache their root, and require modern WebGL postprocessing composers and resource-owning passes imported from either `three/examples/jsm` or `three/addons`, including Three's postprocessing barrel, to dispose their GPU resources without conflating Three's borrowed passes with pmndrs composer ownership. Gate pass cleanup on the earliest supported Three.js release, composer cleanup on release 146, the addon barrel on release 158, and `FXAAPass` on release 177.

  Recognize immediate disposal, conditional instanced-color uploads, reassigned effect cleanup closures, module-scoped WeakMap registration caches, bounded frame-state transitions, resetting frame timers, boolean ref latches, discrete BatchedMesh pointer hits, and conditional controls connections. Ignore whole-namespace registration in test-like files and the documented WebGPU namespace catalogue setup, and diagnose eagerly constructed base textures held in state.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add correctness rules for unsafe parser inputs, selector and regular-expression construction, collapsed literal chains, and accidental object or array string coercion.

- [#1388](https://github.com/millionco/react-doctor/pull/1388) [`b4556e3`](https://github.com/millionco/react-doctor/commit/b4556e31d8804e4c8442ae6a5f198373b94fd378) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix confirmed rule false positives by restoring the correct `jsx-key` spread ordering, requiring positive evidence that a spread can override a key, ignoring JSX arrays consumed as non-rendering data, skipping redirect-only Next.js pages in `nextjs-missing-metadata`, and allowing multi-suffix env template files. Restrict `jsx-no-target-blank` to projects that explicitly target browsers or Electron versions without implicit opener protection.

- [#1398](https://github.com/millionco/react-doctor/pull/1398) [`7eca0ee`](https://github.com/millionco/react-doctor/commit/7eca0eebf94abba3e79143cbc08c03bd1da38b1c) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `zustand-no-whole-store-destructure` to catch whole-store Zustand subscriptions that rerender for every store update.

- [#1327](https://github.com/millionco/react-doctor/pull/1327) [`82c4a12`](https://github.com/millionco/react-doctor/commit/82c4a125c538fd1fd5982c459154fc19388d6ed4) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `effect-needs-cleanup` false positives for legacy MediaQueryList listeners with matching stable cleanup callbacks.

- [#1400](https://github.com/millionco/react-doctor/pull/1400) [`f4aa821`](https://github.com/millionco/react-doctor/commit/f4aa8214bfac4b52c5613f25bbad29e68cbeb28d) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect Remotion v4+ projects and add nine correctness rules for frame-driven animation, deterministic randomness, render-aware media and image loading, stable delay handles, module-scoped render blocking, and abortable `calculateMetadata` fetches.

- [#1380](https://github.com/millionco/react-doctor/pull/1380) [`5332cb6`](https://github.com/millionco/react-doctor/commit/5332cb66cf73086cb8c53cbbdbb379d74e5a2e24) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize matching event listener cleanup across nested collections

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

- [#1415](https://github.com/millionco/react-doctor/pull/1415) [`284b4e4`](https://github.com/millionco/react-doctor/commit/284b4e4e93da7b9ed72f2cbddd72c378737aa0a1) Thanks [@aidenybai](https://github.com/aidenybai)! - Harden shared detector utilities for stable React initializers, resource aliases, and static JSX strings.

- [#1407](https://github.com/millionco/react-doctor/pull/1407) [`6fcd9c9`](https://github.com/millionco/react-doctor/commit/6fcd9c957671b5b7d0b9657260ea1706f73869e2) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect synchronous Zustand get() calls during store initialization

- [#1394](https://github.com/millionco/react-doctor/pull/1394) [`21221c2`](https://github.com/millionco/react-doctor/commit/21221c2d4bc1b9448a32928a582c34ef088236c8) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix effect-needs-cleanup cleanup ownership for matched listener capture projections, one-shot timers with stable unmount ownership, and separately guarded timer releases.

- [#1404](https://github.com/millionco/react-doctor/pull/1404) [`fc1b3a3`](https://github.com/millionco/react-doctor/commit/fc1b3a3984e5993c1eb25478cf1c154d3d4ceddc) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a version-gated Ink ruleset with 19 default checks and an opt-in `usePaste` migration. Preserve the two disproven Newline and Suspense rule IDs as retired configuration aliases.

- [#1325](https://github.com/millionco/react-doctor/pull/1325) [`26b4a0c`](https://github.com/millionco/react-doctor/commit/26b4a0ceb1da349ea61073a78f12723e4336c2dc) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize lazily initialized DOM ref Maps as committed external synchronization in `no-effect-chain`.

- [#1405](https://github.com/millionco/react-doctor/pull/1405) [`61bf03e`](https://github.com/millionco/react-doctor/commit/61bf03eedcc602b2e21c45e1a5f2e3f012c7201c) Thanks [@aidenybai](https://github.com/aidenybai)! - Add MobX core-version and React-binding capabilities plus three gated diagnostics for discarded
  reactions, unsupported `makeAutoObservable` inheritance, and invalid `observer(memo(...))` wrapper
  order.

- [#1412](https://github.com/millionco/react-doctor/pull/1412) [`af33723`](https://github.com/millionco/react-doctor/commit/af337232873fa5c96ec69fac453868f14a9be071) Thanks [@aidenybai](https://github.com/aidenybai)! - Harden MobX version gates and fix reaction lifetime, observer wrapper, and auto-observable inheritance precision.

- [#1395](https://github.com/millionco/react-doctor/pull/1395) [`8e5ae45`](https://github.com/millionco/react-doctor/commit/8e5ae45dd3e93e6df263b37d0179403da5a9a170) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect fresh object, array, function, instance, and allocating collection results returned from proven Zustand v5 selectors, while respecting useShallow and equality-function stabilization.

- [#1403](https://github.com/millionco/react-doctor/pull/1403) [`3598138`](https://github.com/millionco/react-doctor/commit/3598138c7bdd55dac55bf17bc72ccfef1e4c2efd) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix false positives in React Hooks, server action authentication, server prop deduplication, MDX execution risk, public debug artifact, secret fallback, and React Native Babel preset diagnostics. Detect server actions exported through later named or default exports, and gate the legacy Metro preset diagnostic on React Native version and actual package resolution.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the corpus-validated `no-inline-hoc-on-component` diagnostic.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add four async effect safety diagnostics for unguarded async event handlers, loading flags that can remain stuck, unhandled promise side effects in effects, and stale state writes after awaited effect work.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the corpus-validated `styled-components-duplicate-css-property-in-block` diagnostic.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add library-version capabilities, cross-file resolution, cache fingerprinting, shared rule-analysis utilities, and mock-fixture filename recognition.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the corpus-validated `no-create-object-url-without-revoke` and `no-spread-accumulator-in-reduce` diagnostics.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `nextjs-async-dynamic-api-not-awaited` to catch synchronous property access on Next.js 15+ async request APIs while respecting official migration casts and same-path promise unwrapping.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the corpus-validated `context-provider-value-from-unmemoized-local-literal` and `no-eager-new-in-use-state-initializer` diagnostics.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `hook-import-rename-loses-use-prefix` to preserve Rules of Hooks and hook-specific dependency checks when imported hooks are aliased.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add seven resource-lifecycle diagnostics for class teardown, debounced callbacks, listener identity, observers, animation-frame loops, and effect wrappers that discard cleanup returns.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - feat(rules): add the window-open-without-noopener security rule, corpus-validated and FP-hardened

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add five state-update correctness diagnostics for stale boolean toggles, same-reference mutation, updater side effects, undefined-clobbered defaults, and overbroad props dependencies.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `query-floating-mutate-async` and `query-no-mutation-in-effect-as-read` to catch unhandled mutation rejections and effect-driven reads.

- [#1411](https://github.com/millionco/react-doctor/pull/1411) [`f5f13b8`](https://github.com/millionco/react-doctor/commit/f5f13b877ab2096312e60d5b3413fc3bcf35f428) Thanks [@aidenybai](https://github.com/aidenybai)! - Add 38 React Router diagnostics with installed-version, Framework/Data mode, and package-boundary gating.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add render and data-safety diagnostics for leaked JSX numbers, unchecked fetch responses, duplicate fill-map keys, floated JSX promise chains, frozen module values, prop and hook array mutation, unstable render IDs, lost object defaults, forwarded styled props, and un-awaited Detox actions.

- [#1381](https://github.com/millionco/react-doctor/pull/1381) [`f5f6a79`](https://github.com/millionco/react-doctor/commit/f5f6a79ba247128ae48493cd58bbca9c1e16c1ff) Thanks [@aidenybai](https://github.com/aidenybai)! - Treat set-state-in-effect as advisory render guidance instead of a compiler bailout

- [#1369](https://github.com/millionco/react-doctor/pull/1369) [`d970055`](https://github.com/millionco/react-doctor/commit/d9700556d14a2c48e644512e70c5affe703cba2a) Thanks [@aidenybai](https://github.com/aidenybai)! - Rule audit against the React coding-style guidelines: gate seven identity-stability rules on `react-compiler` (`no-inline-prop-on-memo-component`, `rendering-hoist-jsx`, `prefer-module-scope-pure-function`, `rn-list-data-mapped`, `rerender-dependencies`, `no-effect-with-fresh-deps`, `rerender-memo-with-default-value`); un-gate `redux-useselector-returns-new-collection` and `redux-useselector-inline-derivation` (selectors re-run in react-redux's subscription path, which the compiler does not memoize); require `react:19.2` for `prefer-use-effect-event` (useEffectEvent shipped in 19.2); detect post-mount visibility flashes in SSR, client-rendered, and React Native components; skip genuinely custom `memo` comparators in memoized-prop rules without conflating locally shadowed `shallowEqual` or `undefined` bindings with React's defaults; exempt statically enabled `async`/`defer` and `type="module"` scripts in `nextjs-no-native-script` unless they explicitly request render blocking inside a head element; and fix inaccurate messages in `rendering-usetransition-loading`, `rerender-memo-before-early-return`, and `no-effect-event-in-deps`

- [#1311](https://github.com/millionco/react-doctor/pull/1311) [`b852961`](https://github.com/millionco/react-doctor/commit/b8529619bdb06251314dd398c650207732ab5024) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix false positives for state used to rerender external location snapshots.

- [#1410](https://github.com/millionco/react-doctor/pull/1410) [`e6a1557`](https://github.com/millionco/react-doctor/commit/e6a155763ee4a1dd23be6dd60e4beecaf7182ae0) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect in-place mutation of proven Zustand state snapshots that can prevent subscriber updates.

- [#1322](https://github.com/millionco/react-doctor/pull/1322) [`fe241a9`](https://github.com/millionco/react-doctor/commit/fe241a9723c12673f40d6e3ab42a1fa32e1238b2) Thanks [@aidenybai](https://github.com/aidenybai)! - Improve `no-effect-chain` precision by following synchronous React `useCallback` bodies for reader reachability and proven timer, storage, HTTP, query-client, DOM, React-ref, and cleanup synchronization. Infer stable-callback state writes only when the reachable graph targets one state value and contains no opaque calls or other observable work. Tighten global namespace and object provenance to direct, non-defaulted bindings, preserve receiver mutation detection through TypeScript wrappers, and keep concise and explicit local-call returns consistent.

- [#1396](https://github.com/millionco/react-doctor/pull/1396) [`a4eaedd`](https://github.com/millionco/react-doctor/commit/a4eaeddefecba43688c61edaad3452621ceb73de) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `valtio-no-proxy-read-in-render` to detect render-time reads from a Valtio proxy after the same proxy has been passed to `useSnapshot`, while preserving valid proxy reads in callbacks and mutation targets.

- [#1323](https://github.com/millionco/react-doctor/pull/1323) [`a667b45`](https://github.com/millionco/react-doctor/commit/a667b4590700c052124994d73ae1aac202655cf0) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve no-pass-data-to-parent findings for userland hooks while recognizing imported external subscription hooks.

- [#1379](https://github.com/millionco/react-doctor/pull/1379) [`c9f2c4b`](https://github.com/millionco/react-doctor/commit/c9f2c4be53a64dc99bbd2f83ae4e563557add007) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect constructed values passed through imported React 19 context providers

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add seven correctness rules for unsafe optional access, array lookup dereferences, nullish arithmetic precedence, object iteration, and predicate function references.

- [#1397](https://github.com/millionco/react-doctor/pull/1397) [`5774353`](https://github.com/millionco/react-doctor/commit/57743539079f8a8c49fe9d2119822b27603e3a04) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `valtio-no-snapshot-in-callback` to warn when deferred callbacks read Valtio snapshots and accidentally track callback-only fields as render dependencies.

- [#1329](https://github.com/millionco/react-doctor/pull/1329) [`a2f9bf4`](https://github.com/millionco/react-doctor/commit/a2f9bf42c0dbc012dab41938008d90c0bd2dc77f) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `role-supports-aria-props` false positives for global ARIA properties that a role does not explicitly prohibit.

- [#1402](https://github.com/millionco/react-doctor/pull/1402) [`cd9ca68`](https://github.com/millionco/react-doctor/commit/cd9ca68faa25d287c02f4bbdc5007e1fbe1c6fc1) Thanks [@aidenybai](https://github.com/aidenybai)! - Add six DOM and form safety diagnostics for frozen controlled inputs, deprecated keyboard codes, unsafe IME submission, queried DOM mutations, unguarded browser globals, and unnamed radios.

## 0.8.1

## 0.8.0

### Patch Changes

- [#1269](https://github.com/millionco/react-doctor/pull/1269) [`cf7ada5`](https://github.com/millionco/react-doctor/commit/cf7ada5839156399e054b8e47bba1d54122f75b8) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect cleanup leaks in React ref callbacks invoked directly from effects

- [#1373](https://github.com/millionco/react-doctor/pull/1373) [`ac392cb`](https://github.com/millionco/react-doctor/commit/ac392cbbc02e77d7e62aa30d34ed6985860b394c) Thanks [@aidenybai](https://github.com/aidenybai)! - Allow hook-use-state to recognize concise-arrow returns as returned state tuples.

- [#1277](https://github.com/millionco/react-doctor/pull/1277) [`b30fb80`](https://github.com/millionco/react-doctor/commit/b30fb80a6d96de3a4d4c7f5d12cebb9acc5474a8) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix no-pass-data-to-parent to detect parent callbacks stored in refs and refreshed by a preceding effect.

- [#1353](https://github.com/millionco/react-doctor/pull/1353) [`0ff57fa`](https://github.com/millionco/react-doctor/commit/0ff57fa57c6f81330f804d9ca94cab3139c20545) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect no-hydration-branch-on-browser-global through local helpers and React useMemo.

- [#1308](https://github.com/millionco/react-doctor/pull/1308) [`b2f3c9c`](https://github.com/millionco/react-doctor/commit/b2f3c9c463f5f04dd6d7c2d09621ff9edcc7144f) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `effect-needs-cleanup` to follow synchronous React ref callback chains so timers and subscriptions reached through multiple ref callbacks are not missed.

- [#1283](https://github.com/millionco/react-doctor/pull/1283) [`9aa98b9`](https://github.com/millionco/react-doctor/commit/9aa98b94e301f4038a1b6cf85301f6fe872d4d8a) Thanks [@aidenybai](https://github.com/aidenybai)! - Keep rn-no-falsy-and-render scoped to numeric gates rendered through React Native or unknown hosts, excluding proven DOM-host output in mixed-renderer projects.

- [#1362](https://github.com/millionco/react-doctor/pull/1362) [`44d3ad8`](https://github.com/millionco/react-doctor/commit/44d3ad879d28ea47248a8060485ee9d08e8b0c89) Thanks [@aidenybai](https://github.com/aidenybai)! - Resolve React hooks by binding identity across state and effect rules, including named imports, immutable aliases, namespace calls, and isomorphic effect aliases.

- [#1351](https://github.com/millionco/react-doctor/pull/1351) [`3c90f14`](https://github.com/millionco/react-doctor/commit/3c90f14c906778515fabab8615117ce5770b6ae2) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid false positives from `rendering-usetransition-loading` when FileReader success and error callbacks complete the loading state.

- [#1271](https://github.com/millionco/react-doctor/pull/1271) [`f563205`](https://github.com/millionco/react-doctor/commit/f563205ee092aa93202964c05ff739c00ba74541) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `no-uncontrolled-input` false positives for input types whose `value` is read-only in React, including types behind deep const aliases and constant ternaries.

- [#1276](https://github.com/millionco/react-doctor/pull/1276) [`7eb7428`](https://github.com/millionco/react-doctor/commit/7eb74283d0ede1749c24f7b21818ac3a7ddcbfc7) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `role-supports-aria-props` false positives for native number inputs and unresolved input types.

- [#1309](https://github.com/millionco/react-doctor/pull/1309) [`f59ec54`](https://github.com/millionco/react-doctor/commit/f59ec540c751078decf4599ad52046c97c217ca2) Thanks [@aidenybai](https://github.com/aidenybai)! - Stop no-create-ref-in-function-component from warning on createRef values stored as initial React state.

- [#1289](https://github.com/millionco/react-doctor/pull/1289) [`a86b5b0`](https://github.com/millionco/react-doctor/commit/a86b5b0e9571e120fd38e3ebffcd0c78a3d458d7) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix no-render-in-render false positives from hooks in uninvoked nested closures

- [#1294](https://github.com/millionco/react-doctor/pull/1294) [`d7d38d7`](https://github.com/millionco/react-doctor/commit/d7d38d7c881d8b6d31728fbed28a0ee5974bc818) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize browser reads gated by a local or project-imported `useSyncExternalStore` Hook with a false server snapshot.

- [#1319](https://github.com/millionco/react-doctor/pull/1319) [`52fc179`](https://github.com/millionco/react-doctor/commit/52fc179e82afbb43f5d562e0c81c2a4def638e94) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve helper-owned gesture state when an effect also synchronizes it, and keep derived-state detection through transparent React hook receivers.

- [#1292](https://github.com/millionco/react-doctor/pull/1292) [`1adf327`](https://github.com/millionco/react-doctor/commit/1adf3278df268d752a6eb3f40c62ebd7e8d84004) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize immutable and isomorphic React effect aliases in `no-chain-state-updates`.

- [#1263](https://github.com/millionco/react-doctor/pull/1263) [`194cc06`](https://github.com/millionco/react-doctor/commit/194cc06e8c83decb1be71fecb9124009f5b8a837) Thanks [@aidenybai](https://github.com/aidenybai)! - Improve `no-create-ref-in-function-component` precision for render-local attachment refs while preserving stale-ref diagnostics.

- [#1299](https://github.com/millionco/react-doctor/pull/1299) [`c88a39a`](https://github.com/millionco/react-doctor/commit/c88a39a936c2c96dfd282d3ac74f9264dcd68fea) Thanks [@aidenybai](https://github.com/aidenybai)! - Prevent no-effect-chain from reporting clear-only state writes when their values cannot reach downstream guarded work.

- [#1315](https://github.com/millionco/react-doctor/pull/1315) [`3e6dcfc`](https://github.com/millionco/react-doctor/commit/3e6dcfc21712a8cdb7a43ac63c0ed466039852e1) Thanks [@skoshx](https://github.com/skoshx)! - Recognize matching `htmlFor` associations from components already treated as label renderers in
  `control-has-associated-label`.

- [#1288](https://github.com/millionco/react-doctor/pull/1288) [`be6d64b`](https://github.com/millionco/react-doctor/commit/be6d64b466596e40a4ee1233b9c6f260944c4286) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix async-parallel and server-sequential-independent-await to distinguish shadowed callback bindings from genuine result dependencies.

- [#1355](https://github.com/millionco/react-doctor/pull/1355) [`0fbf728`](https://github.com/millionco/react-doctor/commit/0fbf728ec1d6cc70f55d70cea431081b641726e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid effect-needs-cleanup false positives for gesture listeners that synchronously remove themselves and their peer listeners.

- [#1280](https://github.com/millionco/react-doctor/pull/1280) [`30e0ff0`](https://github.com/millionco/react-doctor/commit/30e0ff015e974bc9cc5ad22988fb4da1d0884e01) Thanks [@aidenybai](https://github.com/aidenybai)! - Align iframe-has-title with the accessibility rule's applicability boundary by ignoring frames proven hidden, excluded from sequential focus, or explicitly decorative while preserving diagnostics for uncertain and visible frames.

- [#1333](https://github.com/millionco/react-doctor/pull/1333) [`11388bf`](https://github.com/millionco/react-doctor/commit/11388bfe2dd82851e46970ffea05d2a87a8fdf29) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect parent callback synchronization through React wrappers, immutable aliases, refs, conditional branches, object members, and prop-initialized custom-hook state.

- [#1343](https://github.com/millionco/react-doctor/pull/1343) [`71892af`](https://github.com/millionco/react-doctor/commit/71892afc4651f9354baeb645a0fb77693fbf6f92) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid `effect-needs-cleanup` false positives when a `useSyncExternalStore` subscribe callback returns a delegated disposer through a conditional or nullish fallback.

- [#1282](https://github.com/millionco/react-doctor/pull/1282) [`81da42b`](https://github.com/millionco/react-doctor/commit/81da42bc05a6097d6fd5c4d34afe6c87dc935917) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid server-fetch-without-revalidate false positives for imported or local fetch implementations.

- [#1286](https://github.com/millionco/react-doctor/pull/1286) [`e5d5753`](https://github.com/millionco/react-doctor/commit/e5d57534a7bd4b3a42f9f9cc5cb7c3e4f82ee7d2) Thanks [@aidenybai](https://github.com/aidenybai)! - Prevent `prefer-module-scope-static-value` from recommending behavior-changing hoists for randomness accessed through proven global receivers.

- [#1266](https://github.com/millionco/react-doctor/pull/1266) [`66a1db8`](https://github.com/millionco/react-doctor/commit/66a1db84f4925b2bd919960af6e02b9f66dfaf1a) Thanks [@skoshx](https://github.com/skoshx)! - Fix a false positive in `only-export-components` for exported `use[A-Z]` custom hooks alongside component exports.

- [#1320](https://github.com/millionco/react-doctor/pull/1320) [`b392093`](https://github.com/millionco/react-doctor/commit/b3920938da9f8d3badbffca0f972f0b583c19a86) Thanks [@skoshx](https://github.com/skoshx)! - Ignore parser-confirmed comments when `artifact-env-leak` scans generated JavaScript and TypeScript artifacts, while preserving executable env-leak detection.

- [#1317](https://github.com/millionco/react-doctor/pull/1317) [`6c5c91b`](https://github.com/millionco/react-doctor/commit/6c5c91b68c7e089b0dcd7a269a44b8052f846888) Thanks [@skoshx](https://github.com/skoshx)! - Avoid `server-after-nonblocking` diagnostics for side effects proven to run through Next.js `after()` callbacks.

- [#1297](https://github.com/millionco/react-doctor/pull/1297) [`d8a20e0`](https://github.com/millionco/react-doctor/commit/d8a20e0de7f3707ff9fca132a59f429384d5cc7a) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize type- and write-proven falsy lazy initialization guards in `no-ref-current-in-render`.

- [#1345](https://github.com/millionco/react-doctor/pull/1345) [`f441f59`](https://github.com/millionco/react-doctor/commit/f441f598bb172a92a70c4f425934949042427a51) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid `effect-needs-cleanup` false positives for legacy unary media-query listeners with matching cleanup.

- [#1303](https://github.com/millionco/react-doctor/pull/1303) [`174955c`](https://github.com/millionco/react-doctor/commit/174955c25558a45dc3c8667c6efebb1af16ba8b4) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `no-create-ref-in-function-component` false positives for test-local components proven to be mounted only in independent React Testing Library roots.

- [#1328](https://github.com/millionco/react-doctor/pull/1328) [`bd3655c`](https://github.com/millionco/react-doctor/commit/bd3655c13d25fd43a9946a98a3643235d72ac55d) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect immediate viewport state adoption in a mount effect that registers and cleans up a resize listener.

- [#1350](https://github.com/millionco/react-doctor/pull/1350) [`db5fe10`](https://github.com/millionco/react-doctor/commit/db5fe10229150da08d83f808809bbcd1c640351c) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid treating human-readable storage key names with camelCase segments as hardcoded secrets.

- [#1363](https://github.com/millionco/react-doctor/pull/1363) [`c1e75f0`](https://github.com/millionco/react-doctor/commit/c1e75f06bab2042469f9e61a23de5efef2b6fbb6) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `no-jsx-element-type` false positives on private renderer factories that accurately return one JSX element.

- [#1287](https://github.com/millionco/react-doctor/pull/1287) [`796a56d`](https://github.com/millionco/react-doctor/commit/796a56d4f9f86d451568218dd28c1f4edd11ef98) Thanks [@aidenybai](https://github.com/aidenybai)! - Require native global Intl provenance before reporting formatter construction hoisting diagnostics.

- [#1278](https://github.com/millionco/react-doctor/pull/1278) [`558118c`](https://github.com/millionco/react-doctor/commit/558118ca1fe556a2d563b8208d33fe9cd1a65e3d) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix interactive-supports-focus false positives on native content-editable editing hosts while preserving nested and disabled-host diagnostics.

- [#1279](https://github.com/millionco/react-doctor/pull/1279) [`d4db626`](https://github.com/millionco/react-doctor/commit/d4db626555cf2b9eb19e2824ca21a08a37fde631) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `no-reset-all-state-on-prop-change` false positives for loading state completed by an exact async helper.

- [#1349](https://github.com/millionco/react-doctor/pull/1349) [`a16e452`](https://github.com/millionco/react-doctor/commit/a16e452648eda8a2c05504219d1af66fd428dbf8) Thanks [@aidenybai](https://github.com/aidenybai)! - Accept event listeners whose local AbortController is replaced through a React ref and aborted on unmount.

- [#1281](https://github.com/millionco/react-doctor/pull/1281) [`d3f54c4`](https://github.com/millionco/react-doctor/commit/d3f54c4c1ddbdd4bf0472c8e74e2c0dccc692a5a) Thanks [@aidenybai](https://github.com/aidenybai)! - Prevent nextjs-no-css-link from recommending local CSS imports for statically proven remote HTTP(S) stylesheets.

- [#1360](https://github.com/millionco/react-doctor/pull/1360) [`e5a5f73`](https://github.com/millionco/react-doctor/commit/e5a5f736992f42f67eaf01db056180eb8ed319cb) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid effect-needs-cleanup false positives when listener disposers are retained in React refs and invoked during effect or callback-ref cleanup.

- [#1301](https://github.com/millionco/react-doctor/pull/1301) [`6325f9c`](https://github.com/millionco/react-doctor/commit/6325f9cea5bef7ae66860835e4251250c522055b) Thanks [@aidenybai](https://github.com/aidenybai)! - Stop nextjs-no-img-element from prescribing next/image for exported JSX helpers proven to render only through ImageResponse or Satori.

- [#1295](https://github.com/millionco/react-doctor/pull/1295) [`e86bc57`](https://github.com/millionco/react-doctor/commit/e86bc57911b836e07227aa213b40130136ae423d) Thanks [@aidenybai](https://github.com/aidenybai)! - Require semantic React component evidence before treating PascalCase function parameters as props.

- [#1358](https://github.com/millionco/react-doctor/pull/1358) [`4f3848b`](https://github.com/millionco/react-doctor/commit/4f3848b0019590ef38d74e09296059ea6fbc5292) Thanks [@aidenybai](https://github.com/aidenybai)! - Resolve React effect, state setter, and dependency aliases by binding identity so chained and derived state diagnostics cannot be silenced by immutable renames.

- [#1368](https://github.com/millionco/react-doctor/pull/1368) [`093619c`](https://github.com/millionco/react-doctor/commit/093619c3d8a9990586af270c00ed267b027506b4) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix effect-needs-cleanup false positives for generation-guarded nested subscriptions owned by an effect.

- [#1274](https://github.com/millionco/react-doctor/pull/1274) [`21827da`](https://github.com/millionco/react-doctor/commit/21827da9079291ffdec247a907ff16b796912e95) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid reporting `anchor-has-content` for href-less anchors without link semantics.

- [#1270](https://github.com/millionco/react-doctor/pull/1270) [`12e9592`](https://github.com/millionco/react-doctor/commit/12e9592da8a7b95c3726ca439c334be7ab2f7ab8) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid `no-default-props` false positives for stable class receivers, which React 19 continues to support.

- [#1296](https://github.com/millionco/react-doctor/pull/1296) [`c7f61cd`](https://github.com/millionco/react-doctor/commit/c7f61cd4f53fd864bc3299b7f2e359f161aae522) Thanks [@aidenybai](https://github.com/aidenybai)! - Keep `no-effect-chain` quiet for effects that wait for a committed DOM node before focusing, scrolling, selecting, or measuring it.

- [#1336](https://github.com/millionco/react-doctor/pull/1336) [`95f9937`](https://github.com/millionco/react-doctor/commit/95f99372c0498cc48a3c8829b63511518bf26085) Thanks [@aidenybai](https://github.com/aidenybai)! - Disable `no-chain-state-updates` for React 18 and newer projects.

- [#1354](https://github.com/millionco/react-doctor/pull/1354) [`0f11de1`](https://github.com/millionco/react-doctor/commit/0f11de18bd9ab6e02019b2e49ac7e19f1216135b) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize bounded render-derived equivalents in `exhaustive-deps` dependency lists.

- [#1306](https://github.com/millionco/react-doctor/pull/1306) [`1b86dae`](https://github.com/millionco/react-doctor/commit/1b86dae52c98d58e79ece863eee616008b0e0612) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix prefer-module-scope-static-value false positives for per-render arrays and objects mutated through nested members.

- [#1324](https://github.com/millionco/react-doctor/pull/1324) [`1a30f2c`](https://github.com/millionco/react-doctor/commit/1a30f2caac12f1678243cb8733dd7bc1b598a9da) Thanks [@aidenybai](https://github.com/aidenybai)! - Improve dangerous HTML sink precision for KaTeX output and unsafe fallbacks.

- [#1347](https://github.com/millionco/react-doctor/pull/1347) [`9e55e1f`](https://github.com/millionco/react-doctor/commit/9e55e1f83f3668e4fc39c8e158984f7976e5c12d) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid `effect-needs-cleanup` false positives for callback refs that release listeners from the previous node before replacing their ownership.

- [#1352](https://github.com/millionco/react-doctor/pull/1352) [`c41f271`](https://github.com/millionco/react-doctor/commit/c41f271c3124d5f64cc7149195e93c4ed97fb6a6) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize stable values initialized once through `ref.current ??=` in `exhaustive-deps`.

- [#1375](https://github.com/millionco/react-doctor/pull/1375) [`7e6cdf9`](https://github.com/millionco/react-doctor/commit/7e6cdf920b972a035cc7c5fd405049dbc060ed57) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize transparent TypeScript wrappers on React and HTTP client call receivers.

- [#1291](https://github.com/millionco/react-doctor/pull/1291) [`544356c`](https://github.com/millionco/react-doctor/commit/544356cb0edcc7240f0268dcc6279fa06dab19ee) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix prefer-use-effect-event false positives when a helper also executes synchronously.

- [#1346](https://github.com/millionco/react-doctor/pull/1346) [`cc96f47`](https://github.com/millionco/react-doctor/commit/cc96f473248c63e6c058827fc688579ee33aeb5e) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid `effect-needs-cleanup` false positives when locally observed resources are retained and exhaustively disconnected through the same collection.

- [#1304](https://github.com/millionco/react-doctor/pull/1304) [`5f3ba37`](https://github.com/millionco/react-doctor/commit/5f3ba376289fa07ab9e44c649eb290a967009536) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid accessibility diagnostics for provenance-proven local unit-test fixtures and module mocks while preserving product and component-under-test findings.

- [#1342](https://github.com/millionco/react-doctor/pull/1342) [`cf9acf2`](https://github.com/millionco/react-doctor/commit/cf9acf26c22fde1a0a7874efdf598a78b94c4808) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid `no-pass-data-to-parent` false positives when destructured media-query hook state is forwarded to a parent after an external subscription update.

- [#1293](https://github.com/millionco/react-doctor/pull/1293) [`f94d7b1`](https://github.com/millionco/react-doctor/commit/f94d7b189b5b143c556209a67958556fed53875a) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix no-chain-state-updates false positives from stable useCallback dependencies whose bodies only write state.

- [#1340](https://github.com/millionco/react-doctor/pull/1340) [`c245b9d`](https://github.com/millionco/react-doctor/commit/c245b9d05d7d0c48dc33891b037da21386061955) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid `no-flush-sync` false positives when an adjacent imperative DOM selection or focus handoff requires the React commit to finish synchronously.

- [#1272](https://github.com/millionco/react-doctor/pull/1272) [`ef328c4`](https://github.com/millionco/react-doctor/commit/ef328c457115ff5e352e7016330b0c6a51386589) Thanks [@aidenybai](https://github.com/aidenybai)! - Prevent async-defer-await from flagging compound post-await freshness comparisons while preserving preflight guard diagnostics.

- [#1334](https://github.com/millionco/react-doctor/pull/1334) [`b51022f`](https://github.com/millionco/react-doctor/commit/b51022f8e055ee0db07cce63b6d6e8cf795c4ba5) Thanks [@aidenybai](https://github.com/aidenybai)! - Restore `auth-token-in-web-storage` diagnostics for product API-key records, whose opaque IDs can be usable credentials, and follow web-storage aliases, factories, and local helper functions.

- [#1356](https://github.com/millionco/react-doctor/pull/1356) [`21043e0`](https://github.com/millionco/react-doctor/commit/21043e024e77e65f0df5122d4330b7c759f0187e) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `no-ref-callback-cleanup-before-react-19` to catch ref cleanup functions that React 18 ignores while keeping React 19-only projects quiet.

- [#1273](https://github.com/millionco/react-doctor/pull/1273) [`418e0b2`](https://github.com/millionco/react-doctor/commit/418e0b210de5cb2c628baeda6704294b4c3b5b13) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve register command exemptions through proven ref-held callback aliases.

- [#1290](https://github.com/millionco/react-doctor/pull/1290) [`b76aef7`](https://github.com/millionco/react-doctor/commit/b76aef71635c85260fa76c4ab4d02830077a06f3) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid no-scale-from-zero diagnostics on ordinary JSX data props.

- [#1298](https://github.com/millionco/react-doctor/pull/1298) [`61111f1`](https://github.com/millionco/react-doctor/commit/61111f192a52e8c296b3b0ec7201e4ce3f4b84ae) Thanks [@aidenybai](https://github.com/aidenybai)! - Make no-array-index-as-key detect reachable nullish, logical, and conditional fallbacks to the iteration index

- [#1316](https://github.com/millionco/react-doctor/pull/1316) [`c8a2918`](https://github.com/millionco/react-doctor/commit/c8a29185a03737dea64839d1a8063fbb8b892d79) Thanks [@skoshx](https://github.com/skoshx)! - Skip `supabase-client-owned-authz-field` on files with `'use server'` directive. Server actions with top-level `'use server'` are framework-enforced server-only code, so the rule's client-side threat model does not apply.

- [#1361](https://github.com/millionco/react-doctor/pull/1361) [`8835214`](https://github.com/millionco/react-doctor/commit/88352149101497bbac80dfef98e07e1f2e6b7747) Thanks [@aidenybai](https://github.com/aidenybai)! - Align `no-adjust-state-on-prop-change` with its published contract by reporting prop-triggered resets instead of direct prop mirrors.

- [#1335](https://github.com/millionco/react-doctor/pull/1335) [`2ba83c3`](https://github.com/millionco/react-doctor/commit/2ba83c3201e364939c76187be2725ed0bbf9daa5) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize terminating `componentDidUpdate` state synchronization sourced from JSX callback refs.

## 0.7.9

### Patch Changes

- [#1264](https://github.com/millionco/react-doctor/pull/1264) [`9256423`](https://github.com/millionco/react-doctor/commit/9256423342c830e41a2ab71d940e1306b91de91e) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve proven Boolean visibility gates when opaque short-circuit conditions are present

- [#1260](https://github.com/millionco/react-doctor/pull/1260) [`4829841`](https://github.com/millionco/react-doctor/commit/4829841a4d4a77e64b7fd22faee4446ba2ff955d) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid reset-on-prop-change reports when Boolean render gating keeps state unobservable until reset

## 0.7.8

### Patch Changes

- [#1230](https://github.com/millionco/react-doctor/pull/1230) [`4a73399`](https://github.com/millionco/react-doctor/commit/4a73399f529580b18546df6addee71b53982f30c) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize native controls named by their own `title` attribute in `control-has-associated-label`.

- [#1216](https://github.com/millionco/react-doctor/pull/1216) [`760a3b0`](https://github.com/millionco/react-doctor/commit/760a3b009eb445dc3234c923f2ae33e0441f0e60) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid reporting every-commit effects whose state updates can converge through React's same-value bailout.

- [#1245](https://github.com/millionco/react-doctor/pull/1245) [`af58965`](https://github.com/millionco/react-doctor/commit/af58965a7233b5b66283ad35b3a651435f1e0de9) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid reporting live Boolean-normalized prop trackers as all-state resets.

- [#1255](https://github.com/millionco/react-doctor/pull/1255) [`ed241c3`](https://github.com/millionco/react-doctor/commit/ed241c35e66b6b3759f49390ddcdcf92dcee1921) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid conditional Hook-order findings after immutable React capability guards while preserving mutable control-flow diagnostics.

- [#1256](https://github.com/millionco/react-doctor/pull/1256) [`4190897`](https://github.com/millionco/react-doctor/commit/41908971fdb67be57afe862b0717f79f810bc5cf) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix no-chain-state-updates false positives when state dependencies cannot reach setters guarded by stable prop snapshots.

- [#1249](https://github.com/millionco/react-doctor/pull/1249) [`4fce1c1`](https://github.com/millionco/react-doctor/commit/4fce1c1bff8af9adb66edad3ee66c25c20c5bd1e) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve parameter-provided cleanup callbacks and forwarded callback values as conservative external functions after parameter bindings stopped resolving to their enclosing function. This prevents false positives across shared state and effect analysis.

- [#1250](https://github.com/millionco/react-doctor/pull/1250) [`c79c897`](https://github.com/millionco/react-doctor/commit/c79c897ec6128a3155ae23d10dda3f77e28683a5) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize timers created in synchronous Promise callbacks when an effect cleanup invalidates an effect-local boolean guard and releases the same effect-local handle on every cleanup path, including idiomatic truthy and nullish handle guards followed by a nullish reset and inactive branches that perform work before terminating. Guarded cleanup only counts when the actual release covers every live-handle path and precedes any handle reset. Repeated, suspended, shared-state, conditionally released, generator-cleanup, shadowed-API, unguarded, and rejoining-call callbacks remain diagnostics because they can allocate or orphan timers after cleanup, and the diagnostic now describes missing guaranteed ownership rather than claiming no cleanup was returned.

- [#1220](https://github.com/millionco/react-doctor/pull/1220) [`517f87a`](https://github.com/millionco/react-doctor/commit/517f87a19f50893c4c19e79e6cdb37be12e71f01) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect fresh dependency values forwarded through local custom Hooks.

- [#1196](https://github.com/millionco/react-doctor/pull/1196) [`ec144d9`](https://github.com/millionco/react-doctor/commit/ec144d99c9fb45698250b5ec47edbe1305cbfdbc) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid query-in-effect findings for unrelated refetch methods

- [#1190](https://github.com/millionco/react-doctor/pull/1190) [`afed801`](https://github.com/millionco/react-doctor/commit/afed80154512c3fc4d55f3fe5c01bbc38afae627) Thanks [@aidenybai](https://github.com/aidenybai)! - Keep js-set-map-lookups quiet when Set membership would change lookup semantics.

- [#1222](https://github.com/millionco/react-doctor/pull/1222) [`9c612c5`](https://github.com/millionco/react-doctor/commit/9c612c57e4da1d48a489a6b9dcbbc532126904a0) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize immutable large-text threshold constants in no-polymorphic-children virtualization guards.

- [#1239](https://github.com/millionco/react-doctor/pull/1239) [`9fab4fc`](https://github.com/millionco/react-doctor/commit/9fab4fc77e24d17079815edd0b2590615822ef6a) Thanks [@aidenybai](https://github.com/aidenybai)! - Prevent no-prop-callback-in-render from treating native collection methods on custom Hook parameters as caller callbacks.

- [#1219](https://github.com/millionco/react-doctor/pull/1219) [`04c7e36`](https://github.com/millionco/react-doctor/commit/04c7e36b28b57ae4973662637946485504bc30af) Thanks [@aidenybai](https://github.com/aidenybai)! - Keep no-effect-event-handler quiet for prop-gated external store-to-router synchronization.

- [#1211](https://github.com/millionco/react-doctor/pull/1211) [`165a6cb`](https://github.com/millionco/react-doctor/commit/165a6cbd9c454f1eaff4f353f063503c808bd634) Thanks [@aidenybai](https://github.com/aidenybai)! - Report visibly independent local async helpers without trusting sequencing names or discarded void results.

- [#1237](https://github.com/millionco/react-doctor/pull/1237) [`287dff7`](https://github.com/millionco/react-doctor/commit/287dff742b8d90274ce6ff2298daeee8e7441bcd) Thanks [@aidenybai](https://github.com/aidenybai)! - Only run `only-export-components` when the file is owned by a proven Fast Refresh integration, including source packages explicitly consumed by workspace Vite apps, serving Parcel commands, React Vite Storybooks, and Storybook Webpack projects that explicitly enable `reactOptions.fastRefresh`. Strengthen component, route, wrapper, barrel, React element return, portal, default alias, and React DOM root detection to avoid filename and PascalCase-only false positives.

- [#1207](https://github.com/millionco/react-doctor/pull/1207) [`9fc93f8`](https://github.com/millionco/react-doctor/commit/9fc93f865c7ef2638bfa802f0544256fd5fc85e5) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect dynamic raw HTML rendered by React Markdown without a proven sanitizer.

- [#1252](https://github.com/millionco/react-doctor/pull/1252) [`43327b5`](https://github.com/millionco/react-doctor/commit/43327b535c90fa29a266dc0627030f1b6e6cb925) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix no-unstable-nested-components to distinguish render callbacks from nested component element types.

- [#1215](https://github.com/millionco/react-doctor/pull/1215) [`30b7eeb`](https://github.com/millionco/react-doctor/commit/30b7eebaeb1344b342ee2d59413cd5ef6e213f7a) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid rerender-memo-with-default-value false positives when a same-file React.memo comparator proves fresh empty defaults do not change its bailout.

- [#1209](https://github.com/millionco/react-doctor/pull/1209) [`89dbf08`](https://github.com/millionco/react-doctor/commit/89dbf08d76beeb93d3959d7ea2e2d4a77cdd5c3d) Thanks [@aidenybai](https://github.com/aidenybai)! - Prevent no-legacy-context-api from reporting unrelated classes and registries.

- [#1246](https://github.com/millionco/react-doctor/pull/1246) [`12e7193`](https://github.com/millionco/react-doctor/commit/12e719358046afde6294b5b620e735f8993ec56a) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop no-impure-state-updater flagging a data parameter forwarded to a setter. `resolveToFunction` mistook a `Parameter` definition (whose node is the enclosing function) for the updater, so idiomatic handlers like `(row) => { setSelected(row); setOpen(true) }` were reported. The shared resolver now rejects parameter bindings, which also removes a local workaround in no-pass-data-to-parent.

- [#1227](https://github.com/millionco/react-doctor/pull/1227) [`fbc804e`](https://github.com/millionco/react-doctor/commit/fbc804e6768b292b63fe6d8c249469e32d8b8899) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix no-unstable-nested-components false positives in explicitly Solid-owned JSX files while preserving React and ambiguous-file diagnostics.

- [#1213](https://github.com/millionco/react-doctor/pull/1213) [`046329c`](https://github.com/millionco/react-doctor/commit/046329caf3fdf99924e4b97ffe7b71106922787c) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid reporting state read only by its sole writer effect's equality guard as a missing dependency.

- [#1214](https://github.com/millionco/react-doctor/pull/1214) [`79abd71`](https://github.com/millionco/react-doctor/commit/79abd7177928fc79a91706cc2866b8097c7cd09c) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid `js-length-check-first` diagnostics when `Object.keys` and `Object.values` project the same proven frozen plain object.

- [#1218](https://github.com/millionco/react-doctor/pull/1218) [`a468589`](https://github.com/millionco/react-doctor/commit/a4685891b8ee768176741a74eb7db2f4d0724bdc) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix style-prop-object false positives in explicitly Solid-owned JSX files while preserving React and ambiguous-file diagnostics.

## 0.7.7

### Patch Changes

- [#1212](https://github.com/millionco/react-doctor/pull/1212) [`c1916d5`](https://github.com/millionco/react-doctor/commit/c1916d577d90df5a6587e8a98f28bb1b12168554) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Require exhaustive `for...of` removal loops before they satisfy retained-handler cleanup in `effect-needs-cleanup` — a `break`-truncated loop no longer hides a partial listener leak.

- [#1167](https://github.com/millionco/react-doctor/pull/1167) [`8528def`](https://github.com/millionco/react-doctor/commit/8528deff881314adaf72bb17da1f1dabdcf58b5c) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve intrinsic host-element diagnostics for exact local constant-string JSX aliases.

- [#1205](https://github.com/millionco/react-doctor/pull/1205) [`a01249a`](https://github.com/millionco/react-doctor/commit/a01249aa37f9ac4b693c1d8d162b58463b10d250) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize retained listener callbacks whose exact listeners are released by a guaranteed component-unmount cleanup.

- [#1162](https://github.com/millionco/react-doctor/pull/1162) [`dfd47a7`](https://github.com/millionco/react-doctor/commit/dfd47a75a29f36df2b6799d57ef9695a7174b3f6) Thanks [@aidenybai](https://github.com/aidenybai)! - Harden dangerous HTML provenance across mutable trusted bindings and trusted helper aliases.

- [#1178](https://github.com/millionco/react-doctor/pull/1178) [`0150fc9`](https://github.com/millionco/react-doctor/commit/0150fc901cd5d85c5631e975510d51e48372bdde) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve allocation and async-function facts through Object integrity wrappers.

- [#1170](https://github.com/millionco/react-doctor/pull/1170) [`4fb3694`](https://github.com/millionco/react-doctor/commit/4fb3694e186db0287cc0d49f72a44a38ad63a26e) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve component and memo diagnostics through synchronous local render return indirection.

- [#1202](https://github.com/millionco/react-doctor/pull/1202) [`da3a6e0`](https://github.com/millionco/react-doctor/commit/da3a6e019141ee9c598a661c07171591f7db5f55) Thanks [@aidenybai](https://github.com/aidenybai)! - Prevent prefer-use-effect-event from reporting React useCallback values with stable empty dependency arrays or stable React hook values while preserving changing callback diagnostics, including for useCallback and stable hooks destructured from the React namespace.

- [#1174](https://github.com/millionco/react-doctor/pull/1174) [`a8cd24e`](https://github.com/millionco/react-doctor/commit/a8cd24e2fedbd6c9697266b09e92e9b685d07abf) Thanks [@aidenybai](https://github.com/aidenybai)! - Allow unversioned localStorage payloads whose reads validate parsed fields and safely fall back.

- [#1172](https://github.com/millionco/react-doctor/pull/1172) [`778f1a2`](https://github.com/millionco/react-doctor/commit/778f1a2cc4a2be3863e79236db143677ae4192e1) Thanks [@aidenybai](https://github.com/aidenybai)! - Resolve React Fragment imports and immutable aliases without matching unrelated local components.

- [#1198](https://github.com/millionco/react-doctor/pull/1198) [`5699529`](https://github.com/millionco/react-doctor/commit/5699529155f3735a2d75c56715d3edeb88e791f8) Thanks [@aidenybai](https://github.com/aidenybai)! - Retire `no-cascading-set-state` because React batches synchronous state updates from one effect into the same follow-up commit, so counting setter calls does not establish repeated redraws.

- [#1199](https://github.com/millionco/react-doctor/pull/1199) [`55cebeb`](https://github.com/millionco/react-doctor/commit/55cebebfd98eeb4cfb9f30f1b2bd137521d620dc) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize matching `for...of` listener registration and cleanup loops in `effect-needs-cleanup` while preserving diagnostics for asymmetric loop pairs.

- [#1192](https://github.com/millionco/react-doctor/pull/1192) [`37c53d6`](https://github.com/millionco/react-doctor/commit/37c53d6ebf607a9b3942314cdc13700a876cefcc) Thanks [@aidenybai](https://github.com/aidenybai)! - Resolve React forwardRef imports before applying callback arity guidance.

- [#1180](https://github.com/millionco/react-doctor/pull/1180) [`8ee2977`](https://github.com/millionco/react-doctor/commit/8ee2977e174f0b1dd46554eea785cba853ff2207) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect writes to existing properties of sealed server module state.

- [#1176](https://github.com/millionco/react-doctor/pull/1176) [`c5a06bd`](https://github.com/millionco/react-doctor/commit/c5a06bd8c0d5ade974549326b9131fa9b6ae8e6e) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid false positives in no-locale-format-in-render when deterministic timezone options use a const alias.

- [#1175](https://github.com/millionco/react-doctor/pull/1175) [`1f14fa1`](https://github.com/millionco/react-doctor/commit/1f14fa1bf33530e46e900780d606d246c71da8b0) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid false positives in `no-ref-current-in-render` and `no-impure-state-updater` by recognizing lazy ref initialization and proving external API provenance.

- [#1181](https://github.com/millionco/react-doctor/pull/1181) [`0d11bd5`](https://github.com/millionco/react-doctor/commit/0d11bd54717cc61fff2341eb0a3b1d25d4f645ad) Thanks [@aidenybai](https://github.com/aidenybai)! - Resolve global NaN dependencies through exact immutable bindings.

- [#1195](https://github.com/millionco/react-doctor/pull/1195) [`d674163`](https://github.com/millionco/react-doctor/commit/d6741631233fe3622ff165740f1c260635abfa18) Thanks [@aidenybai](https://github.com/aidenybai)! - Require component provenance before reporting no-prop-types assignments.

- [#1203](https://github.com/millionco/react-doctor/pull/1203) [`5fdc445`](https://github.com/millionco/react-doctor/commit/5fdc445783c626605b293283a2dd709c00575d83) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid accessibility false positives when an accessible descendant performs the same action or a referenced member handler only blocks event propagation.

- [#1166](https://github.com/millionco/react-doctor/pull/1166) [`64950ba`](https://github.com/millionco/react-doctor/commit/64950ba2879e7ccd11ee1a6599d1474992c22558) Thanks [@aidenybai](https://github.com/aidenybai)! - Keep js-set-map-lookups active when a caller-controlled array has a small destructuring fallback.

- [#1193](https://github.com/millionco/react-doctor/pull/1193) [`4753290`](https://github.com/millionco/react-doctor/commit/4753290a1ce3d1aadbe8fec11a7296fd575e9350) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid reporting statically transparent RGB and hex shadow layers in `no-dark-mode-glow`.

- [#1177](https://github.com/millionco/react-doctor/pull/1177) [`c6f996e`](https://github.com/millionco/react-doctor/commit/c6f996ec0183f34bff7fd99593028c15d91f0634) Thanks [@aidenybai](https://github.com/aidenybai)! - Track TanStack Query results through exact const alias chains before checking rest destructuring.

- [#1191](https://github.com/millionco/react-doctor/pull/1191) [`1d7b6e2`](https://github.com/millionco/react-doctor/commit/1d7b6e2887c8478df738d21e1422daac51ffb334) Thanks [@aidenybai](https://github.com/aidenybai)! - Restrict min/max sort recommendations to disposable finite numeric array literals.

- [#1169](https://github.com/millionco/react-doctor/pull/1169) [`8c9a6c4`](https://github.com/millionco/react-doctor/commit/8c9a6c49ab09beabaf8fc47f406ffb9f29a95b34) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve component and callback diagnostics through single-binding rest-tuple parameters.

- [#1182](https://github.com/millionco/react-doctor/pull/1182) [`79105a3`](https://github.com/millionco/react-doctor/commit/79105a3b97238d2db1b4011cf7774c8c8b592253) Thanks [@aidenybai](https://github.com/aidenybai)! - Resolve exact local function bindings passed as effect callbacks while excluding async callbacks from synchronous chain analysis.

- [#1179](https://github.com/millionco/react-doctor/pull/1179) [`81e6647`](https://github.com/millionco/react-doctor/commit/81e6647f3c4c0dbc90881b199753a9d341cf7963) Thanks [@aidenybai](https://github.com/aidenybai)! - Follow exact hook-result aliases when classifying deferred reads.

- [#1164](https://github.com/millionco/react-doctor/pull/1164) [`fbd85e3`](https://github.com/millionco/react-doctor/commit/fbd85e388c12e6d8ea2c2fcf2e9d8405379dd245) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve direct-statement diagnostics through discarded unary and sequence wrappers.

- [#1197](https://github.com/millionco/react-doctor/pull/1197) [`b550b32`](https://github.com/millionco/react-doctor/commit/b550b327ece611503d0565c3d1a9cf0f8e3c7246) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid reporting module-initialized JSX style objects as render-time allocations.

- [#1201](https://github.com/millionco/react-doctor/pull/1201) [`55dcb93`](https://github.com/millionco/react-doctor/commit/55dcb937fbfa6fb58309d5779b4c9b97afd8731c) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize the official `zod/v4` export in Zod migration rules.

- [#1206](https://github.com/millionco/react-doctor/pull/1206) [`a6c24a8`](https://github.com/millionco/react-doctor/commit/a6c24a867e8b17b65fa8a278945fd351643fe05b) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve exact derived hook dependency identities while retaining missing-source diagnostics.

- [#1194](https://github.com/millionco/react-doctor/pull/1194) [`47beb25`](https://github.com/millionco/react-doctor/commit/47beb255f228eef2386e0ecd61a0b122d366ac09) Thanks [@aidenybai](https://github.com/aidenybai)! - Match polyfill script diagnostics against network request identity, ignoring fragments and non-network URL schemes.

- [#1188](https://github.com/millionco/react-doctor/pull/1188) [`acf14c4`](https://github.com/millionco/react-doctor/commit/acf14c4fc9774f53a82a7394cd50e09f02a9e7d6) Thanks [@aidenybai](https://github.com/aidenybai)! - Require proven browser API receiver provenance in synchronous XHR and passive event-listener diagnostics.

- [#1189](https://github.com/millionco/react-doctor/pull/1189) [`b36e439`](https://github.com/millionco/react-doctor/commit/b36e439c26a81b20ede762fdc2f32d50968c7ff3) Thanks [@aidenybai](https://github.com/aidenybai)! - Keep js-hoist-regexp quiet for stateful global and sticky regular expressions.

## 0.7.6

### Patch Changes

- [#1160](https://github.com/millionco/react-doctor/pull/1160) [`dbd4067`](https://github.com/millionco/react-doctor/commit/dbd4067fce8ce9e734738af27b751992ea6bb483) Thanks [@aidenybai](https://github.com/aidenybai)! - Resolve executable browser globals by lexical binding and static property identity.

- [#1155](https://github.com/millionco/react-doctor/pull/1155) [`bc49aaa`](https://github.com/millionco/react-doctor/commit/bc49aaa383da79ac3b31c4f99436bdf26f95495b) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect click handlers in statically known JSX object spreads when no keyboard handler is present.

- [#1147](https://github.com/millionco/react-doctor/pull/1147) [`3075e10`](https://github.com/millionco/react-doctor/commit/3075e10babeb7dfd2ee531572454120df40fa904) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix no-prop-callback-in-effect dependency provenance and callback-ref parity.

- [#1154](https://github.com/millionco/react-doctor/pull/1154) [`0654849`](https://github.com/millionco/react-doctor/commit/06548498e257accee8a186762ace7557900d31cc) Thanks [@aidenybai](https://github.com/aidenybai)! - Track createContext imports through aliases, namespace destructuring, and computed access while honoring lexical shadowing.

- [#1146](https://github.com/millionco/react-doctor/pull/1146) [`18e8717`](https://github.com/millionco/react-doctor/commit/18e8717ec18f2221953e9b8ae810c4a8464e7b6f) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix lifecycle state rules to follow synchronous IIFEs and preserve convergent post-mount DOM guards.

- [#1149](https://github.com/millionco/react-doctor/pull/1149) [`a240f8b`](https://github.com/millionco/react-doctor/commit/a240f8b7d94baf6d5d3eabdf313a91c296ce197e) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid no-polymorphic-children diagnostics for large-string virtualization guards while preserving small-string render-shape checks.

- [#1114](https://github.com/millionco/react-doctor/pull/1114) [`76cd6be`](https://github.com/millionco/react-doctor/commit/76cd6bea69e1f453805a054e8d648abc97ef3384) Thanks [@aidenybai](https://github.com/aidenybai)! - Reduce cold full-scan CPU and allocation overhead with comment-tolerant security-rule content gates, semantic analysis only for rules that consume it, cached binding-mutation scans, analysis-local scope and reference caches, host-native component/export collection, combined state observation passes, single-pass control-flow construction, allocation-free and decorator-aware visitor-key traversal for closure-capture, effect cleanup, and React render analysis, lazy shadow-binding sets, constant-time dependency checks, compatible React Compiler plugin resolution, and newer Oxc parser and resolver releases. Preserve ESLint filename fallbacks, decorator scope semantics, scope-aware React HOC identity, and bodyless TypeScript declarations across the optimized analysis paths.

- [#1157](https://github.com/millionco/react-doctor/pull/1157) [`8fc5848`](https://github.com/millionco/react-doctor/commit/8fc58480f83895fd64d51758cccd393c3d493515) Thanks [@aidenybai](https://github.com/aidenybai)! - Preserve render-value ownership through binding-safe deterministic standard-library transforms.

- [#1156](https://github.com/millionco/react-doctor/pull/1156) [`22bb155`](https://github.com/millionco/react-doctor/commit/22bb1557282fbcf47c6fa865ca7ddca050f21b8f) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize bound subscription disposers and split timer cleanup that covers both effect reruns and unmount.

- [#1151](https://github.com/millionco/react-doctor/pull/1151) [`21da48f`](https://github.com/millionco/react-doctor/commit/21da48ffb694ac857b5cf6336f56923ac411cb59) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid auth-token diagnostics for product-scoped API-key record collections while preserving authentication credential findings.

- [#1148](https://github.com/millionco/react-doctor/pull/1148) [`20cd922`](https://github.com/millionco/react-doctor/commit/20cd922e9a2908b20a36b9e728932975018207a1) Thanks [@aidenybai](https://github.com/aidenybai)! - Allow stateless primitive display lists to use duplicate-disambiguating index keys.

- [#1150](https://github.com/millionco/react-doctor/pull/1150) [`d9676e2`](https://github.com/millionco/react-doctor/commit/d9676e2597fe01a8db537928b7e02cd82b1e3582) Thanks [@aidenybai](https://github.com/aidenybai)! - Track dynamic HTML through local aliases and helper parameters, and exclude declaration files from executable security scans.

- [#1153](https://github.com/millionco/react-doctor/pull/1153) [`3afd146`](https://github.com/millionco/react-doctor/commit/3afd14670042fe8ffb85bd8cc04b15a2987eac52) Thanks [@aidenybai](https://github.com/aidenybai)! - Prove effect-hook calls resolve to React before applying effect callback semantics.

- [#1161](https://github.com/millionco/react-doctor/pull/1161) [`70eff9a`](https://github.com/millionco/react-doctor/commit/70eff9a493f35eb6bdfedbe35ccadec3908ba132) Thanks [@aidenybai](https://github.com/aidenybai)! - Allow effects to notify parents about externally subscribed browser state.

## 0.7.5

### Patch Changes

- [#1138](https://github.com/millionco/react-doctor/pull/1138) [`d4f2209`](https://github.com/millionco/react-doctor/commit/d4f22093a15ab937d40c7f40c1637ea3e53f6e26) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid recommending flatMap for bounded slice and string-tokenization pipelines where a second pass is negligible.

- [#1128](https://github.com/millionco/react-doctor/pull/1128) [`5113067`](https://github.com/millionco/react-doctor/commit/5113067458f03349922bdd0a22ad564574ca74c2) Thanks [@aidenybai](https://github.com/aidenybai)! - Refine `exhaustive-deps` identity tracking for stable and React hook aliases, ref fallbacks, exact props members, and intentional reactive `useMemo` invalidation tokens.

- [#1123](https://github.com/millionco/react-doctor/pull/1123) [`118f806`](https://github.com/millionco/react-doctor/commit/118f80616fb1771f39a5c9a2afa1a5c8eb08120c) Thanks [@aidenybai](https://github.com/aidenybai)! - Expand effect cleanup matching for abort signals, subscriptions, listeners, observers, timers, and retained resources.

- [#1130](https://github.com/millionco/react-doctor/pull/1130) [`63fc41f`](https://github.com/millionco/react-doctor/commit/63fc41f4af69dcc1c8b1f39bf944e7201830be8f) Thanks [@aidenybai](https://github.com/aidenybai)! - Add no-prop-callback-in-render to report discarded parent callbacks executed during render while preserving render props and deferred callbacks.

- [#1132](https://github.com/millionco/react-doctor/pull/1132) [`98005f2`](https://github.com/millionco/react-doctor/commit/98005f2c3dc70debcd5fa5f95ce28aa9f32b5f7e) Thanks [@aidenybai](https://github.com/aidenybai)! - Add no-impure-state-updater to report replay-unsafe side effects inside React state updater callbacks while preserving pure calculations and local accumulators.

- [#1131](https://github.com/millionco/react-doctor/pull/1131) [`7bbb792`](https://github.com/millionco/react-doctor/commit/7bbb792e983318453118d1662dc4b4ac5c2d9dc0) Thanks [@aidenybai](https://github.com/aidenybai)! - Add no-ref-current-in-render to report React ref mutations during render while preserving event, effect, ref-callback, deferred, and predictable lazy-initialization writes.

- [#1143](https://github.com/millionco/react-doctor/pull/1143) [`5aa82e8`](https://github.com/millionco/react-doctor/commit/5aa82e86d065221e249b6e7c454c8411887bda23) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect missing JSX keys when list iterators use named local callbacks.

- [#1141](https://github.com/millionco/react-doctor/pull/1141) [`11333b9`](https://github.com/millionco/react-doctor/commit/11333b9e7db0a8735baa4316f0e0c010b701ed8e) Thanks [@aidenybai](https://github.com/aidenybai)! - Keep no-giant-component diagnostic identity stable by excluding volatile measured line counts from its message.

- [#1122](https://github.com/millionco/react-doctor/pull/1122) [`b47d053`](https://github.com/millionco/react-doctor/commit/b47d05302bfd8d465c468a65809ad5c7a2b0bdd7) Thanks [@aidenybai](https://github.com/aidenybai)! - Add SSR-aware hydration diagnostics and gate browser-global render checks to projects that can server render.

- [#1125](https://github.com/millionco/react-doctor/pull/1125) [`a31f5e8`](https://github.com/millionco/react-doctor/commit/a31f5e8eb87d4e4b889f5ba293189a9a92829771) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix effect-needs-cleanup correlation for useSyncExternalStore subscribe callbacks that return matching disposers.

- [#1142](https://github.com/millionco/react-doctor/pull/1142) [`a989008`](https://github.com/millionco/react-doctor/commit/a989008fec7afce1039978c3355aadc5b8eea147) Thanks [@aidenybai](https://github.com/aidenybai)! - Recognize state consumed through synchronous render-time collection merges in rerender-state-only-in-handlers.

- [#1127](https://github.com/millionco/react-doctor/pull/1127) [`6610ea9`](https://github.com/millionco/react-doctor/commit/6610ea9ea4ce3a75b6502f89ed7ce4cbf0915eff) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect parent callback invocations routed through React refs in no-pass-data-to-parent.

- [#1140](https://github.com/millionco/react-doctor/pull/1140) [`6292f89`](https://github.com/millionco/react-doctor/commit/6292f891f699654147608bc6a09d64ea5959737e) Thanks [@aidenybai](https://github.com/aidenybai)! - Avoid treating qualified product API-key record collections as authentication credentials in browser storage.

- [#1129](https://github.com/millionco/react-doctor/pull/1129) [`593824d`](https://github.com/millionco/react-doctor/commit/593824de1a156677db33de41e2579280d1a5e65b) Thanks [@aidenybai](https://github.com/aidenybai)! - Extend no-derived-state to report canonical render-phase prop and state mirrors while preserving semi-controlled and interaction state.

- [#1139](https://github.com/millionco/react-doctor/pull/1139) [`2b5a18e`](https://github.com/millionco/react-doctor/commit/2b5a18ea3aedb476cf66d21347708102460f218e) Thanks [@aidenybai](https://github.com/aidenybai)! - Allow equality-guarded functional state updates in intentional every-commit effects while retaining infinite-loop diagnostics for fresh and non-converging values.

- [#1136](https://github.com/millionco/react-doctor/pull/1136) [`6821fe0`](https://github.com/millionco/react-doctor/commit/6821fe08bb22ba4f58b7971f4d8026525ee4295c) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect prop- and state-derived values copied into state through local refs while preserving DOM, escaped, and externally assigned refs.

- [#1137](https://github.com/millionco/react-doctor/pull/1137) [`3ec8e1e`](https://github.com/millionco/react-doctor/commit/3ec8e1e85957c446c13a459acf167e9407234746) Thanks [@aidenybai](https://github.com/aidenybai)! - Limit client-localstorage-no-version to persistent localStorage data instead of flagging session-scoped JSON.

- [#1119](https://github.com/millionco/react-doctor/pull/1119) [`b686594`](https://github.com/millionco/react-doctor/commit/b686594dfacbf4362780b25210d450e7eb4a9260) Thanks [@aidenybai](https://github.com/aidenybai)! - Unify effect state-write provenance so derived-state and event-handler diagnostics only report proven render-source copies.

- [#1126](https://github.com/millionco/react-doctor/pull/1126) [`4a5d9bb`](https://github.com/millionco/react-doctor/commit/4a5d9bbe75f5400913f3cf943e3a4ed1beb4d32c) Thanks [@aidenybai](https://github.com/aidenybai)! - Trace conservative project-local helper return provenance in derived-state effect rules without reporting ambiguous or externally sourced values.

- [#1121](https://github.com/millionco/react-doctor/pull/1121) [`3867cf1`](https://github.com/millionco/react-doctor/commit/3867cf1ae77750f8c824181aac2187204348ad60) Thanks [@aidenybai](https://github.com/aidenybai)! - Tighten React 19 deprecation, JSX slot, and React import-origin diagnostics to avoid stale false positives.

- [#1124](https://github.com/millionco/react-doctor/pull/1124) [`70b5d99`](https://github.com/millionco/react-doctor/commit/70b5d99db9f499c65e5dae95663f0497fd5ef420) Thanks [@aidenybai](https://github.com/aidenybai)! - Require `no-fetch-in-effect` cancellation cleanups to guard the matching request and its completion state updates.

## 0.7.4

### Patch Changes

- [#1112](https://github.com/millionco/react-doctor/pull/1112) [`f91ede7`](https://github.com/millionco/react-doctor/commit/f91ede75c5d03970f4d30d66e862ce56e179c290) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `no-match-media-in-state-initializer` to detect SSR-unsafe `matchMedia()` calls evaluated by React state initializers.

- [#1110](https://github.com/millionco/react-doctor/pull/1110) [`6b70b32`](https://github.com/millionco/react-doctor/commit/6b70b3231c5d9531f72e39b0e99550fbe850d86b) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the `effect-listener-cleanup-mismatch` rule for ineffective EventTarget cleanup callbacks and capture flags.

- [#1111](https://github.com/millionco/react-doctor/pull/1111) [`82187a3`](https://github.com/millionco/react-doctor/commit/82187a3b31fb38b622c911e92d70db95e9154ea4) Thanks [@aidenybai](https://github.com/aidenybai)! - Add `no-indeterminate-attribute` to catch native checkboxes whose visual indeterminate state is incorrectly set through an HTML attribute.

## 0.7.3

### Patch Changes

- [#1096](https://github.com/millionco/react-doctor/pull/1096) [`cb8f726`](https://github.com/millionco/react-doctor/commit/cb8f7268530911910bc572bf697614d32674e56a) Thanks [@aidenybai](https://github.com/aidenybai)! - The a11y role/href family no longer goes silent on simple dynamic values. A new shared resolver (`getJsxPropStaticStringValues`) statically evaluates expression-container props — string literals, static template literals, both branches of a ternary, and `const`-bound identifiers (following alias chains) — so `role={isChecked ? "checkbox" : "radio"}` and `const ROLE = "buton"` stop reading as "dynamic, assumed valid". Adopted by `aria-role`, `role-has-required-aria-props`, `role-supports-aria-props`, `interactive-supports-focus`, `prefer-html-dialog`, and `anchor-is-valid`, each with the aggregation its claim demands: correctness rules (`aria-role`, `role-has-required-aria-props`) report when ANY resolved candidate is invalid — that branch is a bug whenever it's taken — while claim-based rules (`role-supports-aria-props`, `interactive-supports-focus`, `prefer-html-dialog`, `anchor-is-valid`) require the violation to hold for EVERY candidate, so a ternary with one valid role or one real href destination stays silent. `let` bindings, parameters, imports, and templates with expressions remain dynamic and are still assumed valid.

- [#1098](https://github.com/millionco/react-doctor/pull/1098) [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-adjust-state-on-prop-change` is demoted from error to warn. It was the lone error-severity member of the derived-state family (`no-derived-state-effect` et al. are all warn), co-fires with them on the same effect, and shares their main false-positive failure mode (flagging non-derivable interactive/env/draft/handshake state). It now matches the family until precision improves.

- [#1099](https://github.com/millionco/react-doctor/pull/1099) [`ee9948a`](https://github.com/millionco/react-doctor/commit/ee9948af13715741788f2ed81cb738a35a0dce35) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-derived-state-effect` now recurses into `if` guards: wrapping the derived-state setter in `if (cond) setX(derive(dep))` (including if/else and braceless forms) no longer silences the rule. Branches containing non-setter work, early returns, or other non-expression statements still disqualify the effect, so guarded escape-hatch effects stay unflagged.

- [#1100](https://github.com/millionco/react-doctor/pull/1100) [`82e0475`](https://github.com/millionco/react-doctor/commit/82e0475b0b5af5e17a2714862d2a717a5a914e90) Thanks [@aidenybai](https://github.com/aidenybai)! - `effect-needs-cleanup` covers more leak shapes. Resource detection now includes DOM observers (`ResizeObserver` / `MutationObserver` / `IntersectionObserver` / `PerformanceObserver` — via their `.observe(...)` registration, released by `.disconnect()` / `.unobserve()`) and connections (`new WebSocket(...)` / `new EventSource(...)`, released by `.close()`; returning the socket handle itself is not cleanup). Cleanup analysis also runs on functions retained across renders (`useCallback` callbacks and component-scope handlers) with a stricter firing policy: a discarded `setInterval` id (unclearable), a discarded socket construction, or a discarded subscribe/observe registration in a file with no release-shaped call anywhere. One-shot `setTimeout` in handlers, `{ once: true }` / `{ signal }` listeners, captured handles, and functions that release their own resources stay unflagged.

- [#1106](https://github.com/millionco/react-doctor/pull/1106) [`f10f9ca`](https://github.com/millionco/react-doctor/commit/f10f9ca8a622befea1e1972cd25ceb5e3ecb3f30) Thanks [@aidenybai](https://github.com/aidenybai)! - Three false-positive fixes from the fuzz FP hunt over the regression corpus and the 47-repo OSS sample. `exhaustive-deps` no longer emits the effect-event dep message for a same-named `useEffectEvent` polyfill imported from a non-React package or defined locally (the origin resolution that already guarded `rules-of-hooks` and `no-effect-event-in-deps` is now shared via `isNonReactEffectEventCallee` and applied to the dep-array check); React's own `useEffectEvent` keeps firing. `no-direct-state-mutation` no longer treats null-initialized state as plain React data when every observed setter call feeds it an opaque instance (`setGainNode(audioContext.createGain())`, `setEditor(new Editor())`) — field writes on such state are the instance's imperative API, not a lost update — while plain-data setter evidence or no evidence at all keeps the classification. `only-export-components` no longer reports `export default defineFrontComponent({ … })`-style calls as an unnamed component: an unknown factory fed only config objects/literals is a library definition and now counts as a plain non-component export (so mixed component+factory modules still report the broken boundary), while known HOCs wrapping anonymous functions and curried HOCs like `compose()(MainView)` keep their existing reports.

- [#1098](https://github.com/millionco/react-doctor/pull/1098) [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-jsx-element-type` is demoted from error to warn. It fires on `JSX.Element` return-type annotations — a type-hygiene preference, not a runtime bug — so it must not block a scan at error severity.

- [#1091](https://github.com/millionco/react-doctor/pull/1091) [`6680538`](https://github.com/millionco/react-doctor/commit/6680538e14dcff2f2cac36422b124e0df3912798) Thanks [@aidenybai](https://github.com/aidenybai)! - `rerender-lazy-ref-init` no longer flags trivial empty-container constructors — `useRef(new Set())` / `new Map()` / `new WeakSet()` / `new WeakMap()` / `new AbortController()` cost about as much as the already-exempt coercion helpers, so recommending the lazy null-check ceremony for them was net-negative. The exemption list is now the shared `TRIVIAL_CONSTRUCTOR_NAMES` constant consumed by both `rerender-lazy-ref-init` and `rerender-lazy-state-init` (which also gains `WeakRef`). User-defined class constructors (`useRef(new HeavyModel(config))`) still fire.

- [#1098](https://github.com/millionco/react-doctor/pull/1098) [`b1bf6b9`](https://github.com/millionco/react-doctor/commit/b1bf6b9c31975620e8ff979d98b337328d75fa7f) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-nested-component-definition` is demoted from error to warn, unifying it with `no-unstable-nested-components` — the same defect class (a component defined inside another component's render) was reported at two different severities depending on which rule caught it.

- [#1095](https://github.com/millionco/react-doctor/pull/1095) [`fb8ffb0`](https://github.com/millionco/react-doctor/commit/fb8ffb0f769532c035baac27443738f4ba84870b) Thanks [@aidenybai](https://github.com/aidenybai)! - Next.js rules gain a file-level platform gate mirroring the React Native one: every `framework: "nextjs"` rule is wrapped with `wrapNextjsRule` / `isNextFileActive` at registry load. The project-level `requires: ["nextjs"]` capability only says SOME workspace depends on Next, so in a monorepo the Next rules (several at error severity) also fired on web-only sibling packages — a Vite playground or plain component library got `next/image` / `next/head` advice for files that never run under Next. The nearest `package.json` is now the authority: a nested workspace package that declares dependencies without `next` skips the Next rules, while manifests declaring `next`, marker-only manifests, the project root, and filename-less test hosts stay active.

- [#978](https://github.com/millionco/react-doctor/pull/978) [`b97a92f`](https://github.com/millionco/react-doctor/commit/b97a92f6111394d6fc01fae5b43b2bb5bf892b64) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix [#976](https://github.com/millionco/react-doctor/issues/976): Next.js projects using `output: "export"` (static export) no longer receive server-only fix recommendations that are impossible without a request-time server. `server-fetch-without-revalidate` is gated off, `nextjs-no-client-side-redirect` keeps firing but its advice drops the middleware / `getServerSideProps` clause (recommending a render-time or client-side redirect instead), and `no-prevent-default` emits the framework-neutral `<form>` message rather than recommending Server Actions. The detection also works when the static export lives in a workspace: a monorepo-root scan whose `apps/web` sets `output: "export"` is now recognized (the config is read next to the manifest that supplies the `next` dependency).

  Under the hood this refactors framework gating into one typed capability vocabulary — a `Capability` union both `requires`/`disabledWhen` metadata and the runtime `hasCapability(settings, …)` check compile against, so a misspelled token fails `tsc` instead of silently never matching. Rules own their capability-conditioned prose via a new `recommendationFor(hasCapability)` hook (core no longer rewrites specific rules' advice), and `no-prevent-default`'s hardcoded SPA framework list is replaced by the new `client-only` capability. ESLint-plugin users who suppressed the `<form>` variant via `settings["react-doctor"].framework` should now set `settings["react-doctor"].capabilities: ["client-only"]`.

  Project discovery now traverses workspaces once instead of up to ~7 times (one pass collects react/tailwind/zod/framework, React Native awareness, reanimated, expo, flash-list, and next facts), and workspace precedence is sorted-deterministic instead of filesystem readdir order — on multi-workspace repos where several packages could supply the framework or React version signal, the first in sorted walk order now consistently wins.

- [#1090](https://github.com/millionco/react-doctor/pull/1090) [`ea3e94e`](https://github.com/millionco/react-doctor/commit/ea3e94e37c467ab958190094dad2b582580be9c0) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-cascading-set-state` now models control flow accurately: mutually-exclusive `if`/`else` and ternary branches contribute the MAX of their setter counts instead of the sum (only one branch runs per dispatch, so summing inflated the "N setState calls run together" count with writes that never co-run), and every synchronous nested function (`const handleKeyDown = () => {…}` DOM listeners, closures handed to helpers, function declarations in switch cases) is now its own scope boundary — previously only `async` functions were, so a sync closure's setters were summed into the effect's count.

- [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4) Thanks [@aidenybai](https://github.com/aidenybai)! - New rule `no-locale-format-in-render` (warn, SSR-capable projects only): flags locale/timezone-dependent formatting evaluated during render — `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString` on date-shaped receivers, `Intl.DateTimeFormat(...).format(...)`, and `Date` default stringification — because the server's locale and timezone differ from the browser's, causing hydration mismatches. Number formatting (`Intl.NumberFormat`, bare `toLocaleString()` on numbers) is deliberately out of scope: its only environment input is the ICU locale, a far weaker mismatch signal that was almost always client-fetched dashboard data in corpus validation. Formatting with an explicit locale and timeZone, inside event handlers or effects, behind client-only guards, or under `suppressHydrationWarning` stays unflagged. `rendering-hydration-no-flicker` gained a matching escape so the recommended post-mount `useEffect` + state fix is never flagged as a flicker.

- [#1097](https://github.com/millionco/react-doctor/pull/1097) [`11e9c87`](https://github.com/millionco/react-doctor/commit/11e9c87340eb3b83e604107f8c264417be178b0a) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-mutating-reducer-state` no longer flags immutable-collection reducers: `return state.set(k, v)` / `const next = state.delete(k); return next` on an Immutable.js/Mori collection returns a NEW collection and is the correct reducer shape, but was reported as an in-place mutation at error severity. Since native Map/Set can't be distinguished without type info, the escape is result-shaped — a collection `.set`/`.add`/`.delete`/`.clear` call whose result is CONSUMED (returned or assigned) matches the immutable idiom and is skipped, while a discarded-result call (`state.set(k, v); return state`) still fires (it's either a native mutation or a no-op immutable call, both bugs). Array mutators stay unconditional because consuming a native `.splice()` result is idiomatic and still mutates.

- [#1094](https://github.com/millionco/react-doctor/pull/1094) [`63e0657`](https://github.com/millionco/react-doctor/commit/63e065739f615310922041866b742f23e57c8a12) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-render-in-render` now requires React-component semantics before firing: it only reports an inline `render*()` call when the callee resolves to a local function whose body calls hooks (a component in disguise, whose hooks get spliced into the caller's hook order). Hook-free render helpers that merely return JSX (inline call == inline JSX, nothing to lose) and class methods (`this.renderHeader()` — methods cannot call hooks) are no longer flagged.

- [#1107](https://github.com/millionco/react-doctor/pull/1107) [`2953b25`](https://github.com/millionco/react-doctor/commit/2953b2592d464afd3dde8eba85f5400fb7863a90) Thanks [@aidenybai](https://github.com/aidenybai)! - New rule `no-stale-timer-ref` (State & Effects, warn): flags `clearTimeout(ref.current)` / `clearInterval(ref.current)` on a `useRef`-held timer id that is never reset afterwards, in components that read `ref.current` truthiness as a "timer pending" signal. Clearing cancels the callback but leaves the old id in the ref, so pending guards keep treating a cancelled timer as live — re-arming dismissed work or skipping future scheduling. The clear-then-null and clear-then-re-arm (debounce) shapes, bare `if (ref.current) clearTimeout(ref.current)` guard idioms, and effect-cleanup returns stay unflagged.

- [#1093](https://github.com/millionco/react-doctor/pull/1093) [`02b1f82`](https://github.com/millionco/react-doctor/commit/02b1f82dd0c6fdf5a8fbbe5bab16c2384ae41bd0) Thanks [@aidenybai](https://github.com/aidenybai)! - `only-export-components` is re-derived against the actual react-refresh boundary constraint, which is about exports only: a module that exports a component must export only components / allowed constants. Non-exported internal components are no longer reported (react-refresh registers them fine, and "export this component" was the wrong advice for config/registry files that merely use a local component). The previously-missed real breaker is now detected: a namespace-object export that bundles components (`export const Pages = { Home, sidebarWidth: 240 }` / `export default { Home, helpers }`) fails the boundary check for the whole module and is reported.

- [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4) Thanks [@aidenybai](https://github.com/aidenybai)! - prefer-use-sync-external-store now detects hand-rolled module-scope stores: a mutable module binding plus a listener registry and same-file subscribe function, consumed as `useState(sharedState)` with a `useEffect(() => subscribe(setState), [])`. Publishes fired between the render-time snapshot and the effect-time subscription are lost and concurrent renders can tear — `useSyncExternalStore(subscribe, getSnapshot)` is the fix. Genuine `useSyncExternalStore` usage, imported subscribe functions, and effects with non-empty dependencies stay unflagged.

- [#1102](https://github.com/millionco/react-doctor/pull/1102) [`da7bb4b`](https://github.com/millionco/react-doctor/commit/da7bb4bfc685e2436bf5202c17ac7596d86ae270) Thanks [@aidenybai](https://github.com/aidenybai)! - no-react19-deprecated-apis no longer flags `useContext`. React 19's `use()` is an additive alternative — `useContext` remains a fully supported, non-deprecated API, so calling it deprecated was misinformation. The rule still flags `forwardRef` (both named imports and `React.forwardRef` member access) on React 19+ projects.

- [#1092](https://github.com/millionco/react-doctor/pull/1092) [`f83092d`](https://github.com/millionco/react-doctor/commit/f83092d9313bc1cae41d8e0a154bd943b7414dd3) Thanks [@aidenybai](https://github.com/aidenybai)! - `rules-of-hooks` and `no-effect-event-in-deps` no longer apply React's effect-event semantics to a `useEffectEvent` that resolves to a userland definition. Previously only a same-named hook imported from a non-React package was exempt; a polyfill DEFINED in the same module (the floating-ui shape — a stable-callback helper designed to be stored, passed as props, and listed in deps) was still treated as React's export, which was the single largest false-positive source in the corpus audit. The called identifier is now resolved through scope analysis: local (non-import) bindings are exempt, React-runtime imports and bare globals (upstream fixture parity) keep firing at error severity.

- [#1101](https://github.com/millionco/react-doctor/pull/1101) [`dfdc763`](https://github.com/millionco/react-doctor/commit/dfdc763bad8a068aaf4b47aaf23b6f83d720cf40) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-usememo-simple-expression` now flags trivial container-literal memos — `useMemo(() => [x], [x])` / `useMemo(() => ({ a, b }), [a, b])` — but only when the memo result's referential identity is provably unused: the result is discarded, immediately destructured, or only ever read through member access (`items.length`, `items.map(...)`). A memoized container passed as a prop, listed in another hook's deps, returned from a hook, or otherwise escaping keeps its memo, since a stable reference is the legitimate reason to memoize a fresh literal.

- [`9b59d96`](https://github.com/millionco/react-doctor/commit/9b59d96f06dc7210686ef097e6ac92ce5f864eb4) Thanks [@aidenybai](https://github.com/aidenybai)! - Detection robustness against verdict-preserving source rewrites: rules no longer go silent when the same defect is spelled with a slightly different shape. `Date.now()` / `Math.random()` / `performance.now()` / `crypto.randomUUID()` and namespace-import calls like `React.forwardRef` now match through TS cast wrappers (`(Date as any).now()`, `(React!).forwardRef`); `prefer-use-sync-external-store` recognizes resync handlers written as block-bodied returns (`() => { return setX(read()); }`); and effect-body analyses (`no-derived-state-effect`, `rendering-hydration-no-flicker`, and everything on `getCallbackStatements`) skip no-op statements (`void 0;`, stray directives) instead of letting them flip a "body contains only setState" check.

## 0.7.2

### Patch Changes

- [#1077](https://github.com/millionco/react-doctor/pull/1077) [`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90) Thanks [@aidenybai](https://github.com/aidenybai)! - Align 30+ rules with their documented behavior, fixing the false-positive clusters confirmed by a validation pass of 2,143 sampled diagnostics against the official rule prompts. Highlights: `jsx-key` now flags key-after-spread (the documented hazard) instead of the safe key-before-spread shape and exempts props rest parameters; `no-did-update-set-state` honors the prop-comparison guard exemption; `no-console` skips Node CLI scripts; `circular-dependency` skips type-only, lazy-import, and render-time-only cycles; `query-mutation-missing-invalidation` exempts read-only mutations; `insecure-crypto-risk` requires cryptographic context instead of matching identifier names; `no-unknown-property` allows valid hyphenated SVG attributes; `no-aria-hidden-on-focusable` verifies the element is actually focusable; `no-flush-sync` implements the documented DOM-measurement carve-out.

- [#1072](https://github.com/millionco/react-doctor/pull/1072) [`1880b15`](https://github.com/millionco/react-doctor/commit/1880b152e4d6aedd5c06cf2ca51783e53cfb4004) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Stop `rules-of-hooks` and `no-effect-event-in-deps` from firing on a `useEffectEvent` imported from a non-React package. Both rules match the hook by NAME to stay in parity with eslint-plugin-react-hooks (whose fixtures call a bare global), so a same-named custom hook — e.g. `@rocket.chat/fuselage-hooks`'s `useEffectEvent`, a stable-callback helper designed to be stored and passed as props — was flagged as if it were React's experimental effect event ("only works when called from Effects", "re-runs your effect every render"). Detection is now disambiguated by import source: a `useEffectEvent` explicitly imported from a module outside `REACT_RUNTIME_MODULE_SOURCES` (`react`, `react-dom`, `preact/compat`, `preact/hooks`) is left alone, while React's own and bare/unimported names keep their existing behavior.

- [#1083](https://github.com/millionco/react-doctor/pull/1083) [`5d2f17f`](https://github.com/millionco/react-doctor/commit/5d2f17f71c9fb8e0d8d649da1b26de8f5cfe6c34) Thanks [@skoshx](https://github.com/skoshx)! - `query-destructure-result` no longer classifies rest-destructuring (`const { data, ...rest } = query`) — that shape is `query-no-rest-destructuring`'s territory, and claiming it in both rules reported the same line twice ([#1082](https://github.com/millionco/react-doctor/issues/1082)). The rule now fires only on the consumption it uniquely owns: spreading the whole TanStack Query result into JSX (`<Inner {...query} />`) or an object literal, which enumerates every field and subscribes the component to all of them.

- [#1077](https://github.com/millionco/react-doctor/pull/1077) [`9cb4149`](https://github.com/millionco/react-doctor/commit/9cb414905de7b360d728ca08d45167116a94ee90) Thanks [@aidenybai](https://github.com/aidenybai)! - Second-round FP/FN sweep: restore delta-audit recall regressions, wire confirmed false-negative clusters (jsx-no-target-blank, button-has-type, no-default-props), repair the never-firing no-layout-property-animation rule, reconcile no-array-index-as-key, gate RN boxShadow rules on new-architecture provenance, and skip the vulnerability axis for devDependencies in the supply-chain check.

## 0.7.1

### Patch Changes

- [#1061](https://github.com/millionco/react-doctor/pull/1061) [`c0c3fc1`](https://github.com/millionco/react-doctor/commit/c0c3fc170972876c8bbc2419b32e66b9c864df85) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix a CI-gate false positive in the baseline delta: pre-existing element-level findings (Accessibility-category rules, plus rules flagged `matchByOccurrence` like `iframe-missing-sandbox`) are now matched by `(file, rule)` occurrence count instead of the flagged line's text, so reformatting the flagged line (reindentation, prettier reflow, collapsing a multi-line JSX element) no longer reports the finding as newly introduced. The flag is resolved at diagnostic creation and carried on the diagnostic as an optional `matchByOccurrence` field (also present in the JSON report). Expression-level rules keep line-text-sensitive matching, and a genuinely new extra occurrence still surfaces.

## 0.7.0

## 0.6.3

### Patch Changes

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - no-array-index-as-key: stop flagging index keys when the mapped receiver is a variable holding a static placeholder array (`const list = Array.from({ length: 3 }); list.map(...)`) — the binding is now resolved to its initializer, matching the existing inline `Array.from({ length: N })` exemption.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - button-has-type: stop flagging `type` values wrapped in TS assertion expressions (`"submit" as const`, `satisfies`) — the wrapper is stripped before proving validity, so a local `const kind = "submit" as const` now resolves like the bare literal; invalid values under a wrapper stay flagged.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - fix(react-builtins): `checked-requires-onchange-or-readonly` no longer flags
  statically disabled checkboxes (`<input type="checkbox" checked={x} disabled />`).
  Users can't toggle a disabled input, so no `onChange` is needed — React's own
  controlled-checkbox runtime warning exempts `disabled` the same way. A dynamic
  `disabled={cond}` still reports, since the input can be enabled at runtime.
  Found by corpus census triage.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - fix: six false-positive classes found by differential testing against the
  upstream ESLint plugins over an OSS corpus:

  - `exhaustive-deps`: cleanup `ref.current` reads no longer warn when the ref
    is assigned via a callback anywhere in the component, and an explicit
    `undefined` deps argument is treated like an omitted one for effect hooks
    (upstream parity; `null` still reports as a non-array deps list).
  - `no-static-element-interactions`: a string-literal role wrapped in a JSX
    expression container (`role={'link'}`) now counts as a role, and `<svg>`
    is skipped — it has the implicit `graphics-document` role, so it isn't
    static (upstream parity).
  - `no-aria-hidden-on-focusable`: dynamic `aria-hidden` expressions
    (`aria-hidden={!interactive || undefined}`) are no longer treated as
    literal `true`.
  - `img-redundant-alt`: hyphens and underscores are word-continuation
    characters, so `alt="image-left-top"` and `alt="my_image_1"` no longer
    match the redundant word "image".
  - `no-noninteractive-tabindex`: the roving-tabindex pattern
    (`tabIndex={active ? 0 : -1}`) is no longer flagged.
  - `rules-of-hooks`: hooks in anonymous callbacks with no resolved name are
    skipped (upstream's conservative approach), and a hook call in a ternary
    test position is no longer treated as conditional.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - display-name: a curried component factory now reports consistently whether the outer arrow uses an expression body (`(order) => (props) => <X />`) or a block body with an explicit return — the block-body shape was silently skipped (found by the metamorphic arrow-body fuzz oracle).

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - fix(react-builtins): `exhaustive-deps` now truncates captured member chains at
  `.current` (e.g. `textareaRef.current.style.height` → `textareaRef`), matching
  upstream eslint-plugin-react-hooks. Previously an effect reading a prop-passed
  ref reported mutable `.current` paths as "stale" dependencies and effectively
  told users to add `ref.current.*` values to the deps array, which is never
  valid. Found by corpus census triage.

- [#1030](https://github.com/millionco/react-doctor/pull/1030) [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566) Thanks [@aidenybai](https://github.com/aidenybai)! - fix(react-builtins): `jsx-no-jsx-as-prop` recognises more conventional JSX
  slot props mined from the real-world corpus — the `*Avatar`, `*Text`,
  `*State`, and `*Zone` suffixes (material-ui `ListItem
leftAvatar`/`primaryText`, supabase `ChartContent loadingState`, leemons
  `leftZone`/`rightZone`), the `config` slot, and capitalised exact forms of
  known slot names (`Footer={<PageFooter />}`). Inline JSX in these slots is the
  component's designed API, so flagging it was unactionable noise. Found by the
  fuzz FP oracle.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix false positives found on a fresh React 19 / RSC / Next.js 15 corpus:

  - `server-sequential-independent-await` no longer flags awaits of Next.js request-scoped APIs (`headers()`, `cookies()`, `draftMode()`, `connection()`, next-intl server helpers) or awaits of already-existing promises such as Next.js 15 `props.params` / `props.searchParams`.
  - `server-fetch-without-revalidate` no longer flags the documented `next/og` static-asset fetch (`fetch(new URL(..., import.meta.url))`) or Remix / React Router `app/` route files, where the Next.js data cache never applies.
  - `rendering-hydration-mismatch-time` no longer flags time/random values in JSX rasterized by `ImageResponse` / satori (og images never hydrate).
  - `nextjs-missing-metadata` no longer flags `"use client"` pages, which cannot export `metadata` / `generateMetadata`.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - no-array-index-as-key: recognize composite keys whose per-item identity comes from a destructured callback field (`({ message }, index) => key={`${message} ${index}`}`) or a method call on the item (`key={`${index}-${color.toHexString()}`}`) — the index is just a uniqueness fallback there; composite keys with no item-derived part stay flagged. Also extend the static-placeholder exemption to `Array.from({length: values.length}, …)` and to numeric `for (let i = 0; …)` loop counters — both imperative twins of the already-exempt `Array(N)` placeholder; a manually incremented index over real items stays flagged.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - no-derived-state (and the shared post-mount-read detector): recognize layout measurements read through a local alias of a ref's `.current` (`const el = contentRef.current; setX(el.scrollHeight > max)`) as deferred DOM measurements, not derived state.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - no-direct-state-mutation: stop flagging in-place writes to a callback-ref target. When a `useState` setter is passed straight to a JSX `ref` attribute (`ref={setNode}`), the paired state holds a DOM element / component instance, so `node.dataset.x = ...` or `node.style.x = ...` is deliberate imperative DOM work, not a lost state update. The wangeditor `useState(null)` + effect-mutation bug (whose ref comes from a separate `useRef`) stays flagged.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - no-initialize-state: stop flagging mount effects that seed state from a resource their cleanup disposes. When the setter argument derives from an effect-local binding referenced by the returned cleanup (`const audioContext = new AudioContext(); setGainNode(audioContext.createGain()); return () => audioContext.close();` — same shape for WebSockets, editors, observers), the effect owns a resource lifecycle and the value cannot be hoisted into `useState(initial)` because render has no matching dispose slot. Deterministic inits beside an unrelated cleanup (`setCount(42)` next to a `clearInterval` cleanup) keep firing.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - no-initialize-state: stop flagging mount effects that seed state from a zero-arg `new Date()` (e.g. an SSR-safe live clock's `setNow(new Date().toLocaleTimeString())`) — it captures the current instant like `Date.now()`, which was already exempt; `new Date(value)` stays flagged.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - no-initialize-state: stop flagging setters that only fire from a callback argument of an effect-local instance (`const observer = new MutationObserver((m) => setEntryCount(m.length)); observer.observe(...)`). The eventual-call resolver treated a callback passed to a constructor or factory as the binding's own call graph, so a method call on the instance counted as a synchronous setter call. Function-expression arguments of a binding's initializer call are now excluded from the resolver (hook wrappers like `useCallback(fn, deps)` still count, since calling the binding runs the wrapped function). Bare identifier arguments (`debounce(setN)`) are unaffected.

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - no-reset-all-state-on-prop-change: stop flagging effects whose state setters only run inside listener / observer / subscription callbacks — those reset on the external event, not on the prop change.

- [#1030](https://github.com/millionco/react-doctor/pull/1030) [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566) Thanks [@aidenybai](https://github.com/aidenybai)! - fix(security): `no-secrets-in-client-code`'s variable-name heuristic no longer
  matches `auth` inside `author`/`authors`/`authority` — a component identifier
  like `TOP_PR_AUTHORS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER = "<uuid>"` is not a
  credential. The credential words that contain "author"
  (`authorization`, `authorised`) still match. Found by the fuzz FP oracle over
  the real-world corpus.

- [#1030](https://github.com/millionco/react-doctor/pull/1030) [`b4faf74`](https://github.com/millionco/react-doctor/commit/b4faf74744c730d0836235854b0233ce59a42566) Thanks [@aidenybai](https://github.com/aidenybai)! - fix(react-builtins): `only-export-components` no longer flags components
  declared inside another function — a test callback (`test("x", () => { const
Harness = () => ... })`), a factory (`function setup() { const Row = () =>
... }`), or an object-literal `render` method. Those are never Fast Refresh
  boundaries, so the "not exported" / "file exports nothing" messages told
  users to export values that can't be exported. The local-component walk now
  stays at module scope, matching the origin rule in
  eslint-plugin-react-refresh. Found by the fuzz FP oracle.

- [#1039](https://github.com/millionco/react-doctor/pull/1039) [`072d37e`](https://github.com/millionco/react-doctor/commit/072d37e8e4f82454d2e187114d0194f26efc1bf0) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: memoize `closureCaptures` per (ScopeAnalysis, function node) so nested callbacks compute once and every calling rule reuses the result, and drop the redundant per-reference containment re-filter

- [#1044](https://github.com/millionco/react-doctor/pull/1044) [`2980d0f`](https://github.com/millionco/react-doctor/commit/2980d0f4ed6abfee061ac02f3a0820806f942b95) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: cache compiled glob RegExps in `compileGlob` so rules matching user-configured patterns per node stop recompiling the same pattern on every call

- [#1041](https://github.com/millionco/react-doctor/pull/1041) [`5fec491`](https://github.com/millionco/react-doctor/commit/5fec491e6844d73f658f355ae2cbe86285068f0e) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: memoize getElementType per JSX opening element (with a settings-identity guard) so the ~30 a11y rules resolve each element once instead of once per rule

- [#1042](https://github.com/millionco/react-doctor/pull/1042) [`05f6399`](https://github.com/millionco/react-doctor/commit/05f639910abf2b3bfc0802e9ad568ecd2b7ce13d) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: memoize `functionContainsReactRenderOutput` per function node so the ~5 rules sharing it walk each function subtree once per file instead of once per query

- [#1040](https://github.com/millionco/react-doctor/pull/1040) [`a1c8ee1`](https://github.com/millionco/react-doctor/commit/a1c8ee110e137bbc8771c8a471c20287cccd2b38) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: replace the security scan's per-match O(content) slice+split in `getLocationAtIndex` with a memoized per-content line-start index answered by binary search

- [#1047](https://github.com/millionco/react-doctor/pull/1047) [`fa61c20`](https://github.com/millionco/react-doctor/commit/fa61c2056951df2429e79d888e5f7334aaf61cfd) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: early-exit sweep — cheap discriminators now run before walks, scope lookups, and parent climbs across ~23 rules (raw-name bails before getElementType, whole-file import gates for the zod and recycler-list rules, substring gates before regex-heavy className analysis, filename gates hoisted to Program, and first-match pruning in containsFetchCall)

- [#1050](https://github.com/millionco/react-doctor/pull/1050) [`ac71a3b`](https://github.com/millionco/react-doctor/commit/ac71a3b8cfc8bdd157f0f1bcd242b61ec69f9c17) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: fused-walk sweep — ~13 repeated subtree traversals collapse into single passes or per-node memos (async-await-in-loop's triple walk and fixpoint pre-pass, js-cache/js-index-maps loop walks, rendering-usetransition's three detectors, display-name's per-candidate program scans, per-binding setter walks in the state/effect rules, and WeakMap memos for prop-name/bound-name/effect-count analyses)

- [#1051](https://github.com/millionco/react-doctor/pull/1051) [`d8628d7`](https://github.com/millionco/react-doctor/commit/d8628d7f21e60b0e6dfd98d76c9f24e03f7afe24) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: memoization sweep — per-file/per-Program analyses stop recomputing per node and per rule (security-scan path classification cached per pattern+path, layout export scans cached per file with mtime invalidation, effect scope/reference/upstream-ref lookups memoized per analysis, the duplicated outer-scope scan converged onto getScopeForNode, zod import classification memoized per identifier, and normalizeFilename skips the no-op allocation)

- [#1049](https://github.com/millionco/react-doctor/pull/1049) [`ebeee56`](https://github.com/millionco/react-doctor/commit/ebeee568abf9a7ed37ed9fe0bba695e4f2a11c9f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: regex-hoist sweep — ~8 per-call RegExp constructions move to module scope or behind cheap gates (public-env secret-name global pattern hoisted, supabase RLS enables collected in one pass instead of per-table compile+slice, dangerous-html-sink inert-target and serializer exemptions gated/lazy, design color/duration parsers get first-char and substring discriminators)

- [#1048](https://github.com/millionco/react-doctor/pull/1048) [`da3b19c`](https://github.com/millionco/react-doctor/commit/da3b19c79c27945d873eb24e34431cbefa8f9938) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf: set-membership sweep — ~13 linear array scans on per-element hot paths now use Sets/Maps (ARIA element-role tables become O(1) lookup maps, event-handler presence checks collapse to one lowercased-Set pass per element, a11y settings lists and tanstack order tables convert to Sets/index Maps)

- [#1043](https://github.com/millionco/react-doctor/pull/1043) [`6a9a73b`](https://github.com/millionco/react-doctor/commit/6a9a73b14908272535aabab6742258b61bc2ee5c) Thanks [@rayhanadev](https://github.com/rayhanadev)! - perf(rules): hoist per-file directory classification out of per-node visitors — the TanStack Start and Next.js rules that called `isInProjectDirectory` (or tested the root-route filename pattern) on every JSX element / call expression now compute it once in `create()` and skip non-matching files entirely

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - rn-no-raw-text: collapse internal whitespace in the quoted raw-text preview so multi-line JSX text produces a single-line message and CRLF vs LF sources report identically (found by the new metamorphic CRLF fuzz oracle).

- [#1032](https://github.com/millionco/react-doctor/pull/1032) [`173cc0a`](https://github.com/millionco/react-doctor/commit/173cc0a8ba5578229e3832b2167d3f7a5386c91b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Reword six diagnostic messages that asserted concrete runtime harm on trigger shapes where the harm does not occur: no-render-in-render (plain render-helper calls do not remount or lose state), no-direct-state-mutation (a setter call after the mutation still redraws), no-direct-mutation-state (setState after the mutation still redraws), server-no-mutable-module-state (a never-written module `let` leaks nothing), query-mutation-missing-invalidation (invalidation can happen at the mutate() call site), and rn-no-dimensions-get (a Dimensions.get() read inside an event handler is fresh, not stale).

## 0.6.2

### Patch Changes

- [#1028](https://github.com/millionco/react-doctor/pull/1028) [`f07ee37`](https://github.com/millionco/react-doctor/commit/f07ee37598360b7d761505afe6960f9fd2f93595) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Undo the 0.6.0 scan-time regression and cut lint CPU ~30% below it (~20% below 0.5.8). Diagnostics are byte-identical throughout; verified per-change on a 1.8k-file monorepo.

  - Share the plugin's scope and control-flow analyses across every rule linting a file. The semantic-context wrapper cached each analysis in a per-rule closure, so every scope-reading rule re-ran the full O(file) analysis on the same AST (~20% of plugin lint CPU, and the multiplier grew as 0.6.0 added scope-hungry false-positive guards — the main driver of the regression). One analysis per Program node now serves all rules.
  - Stop wrapping every visitor of every rule in a root-capture closure — Program enter fires first, so capturing there removes a function call per (node × rule).
  - Yield the cooperative security scan by time budget instead of file count. It yielded every 16 files, so one large minified bundle could hold the event loop for its whole rule set — and lint's child processes are spawned and drained from main-thread continuations, so each stall idled the whole worker pool (worst on 2-core CI runners). It now hands the loop back after any 12ms slice, checked between every (file, rule) step.
  - Memoize `isTestlikeFilename` (every rule re-ran ~70 substring scans per file), collect imports from `Program.body` instead of a whole-program recursion, and skip the generated-image (OG/satori) sweep when the module imports no image-response library.
  - Defer `js-combine-iterations`' generator-name collection to the first chained-iteration candidate, and collect only the node kinds `only-export-components` consumes instead of materializing every node in the program.
  - Stop double-linting cache misses. With the per-file lint cache enabled, every miss ran twice — once in the cacheable pass, again in the always-fresh cross-file sidecar over every file — so a cold-cache scan (every CI run) paid ~2× the lint parse and spawn cost. Misses now run the full config once and hits get the sidecar only; the fresh output is partitioned by rule id, so cache contents, staleness guarantees, and reported diagnostics are unchanged (cold-cache lint CPU −40% measured).

## 0.6.1

### Patch Changes

- [#1027](https://github.com/millionco/react-doctor/pull/1027) [`5f60bef`](https://github.com/millionco/react-doctor/commit/5f60befa8f954d3daf6e790670be8a170683e708) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - fix(rules): path-based framework-directory detection no longer misreads a
  filesystem mount point as a framework directory. Rules now check `app/`,
  `pages/`, `pages/api/`, and `routes/` against the path relative to the
  detected project root (`settings["react-doctor"].rootDirectory`), falling
  back to ignoring the leading segment of an absolute path when no root is
  available. A pages-router repo checked out at `/app` (the most common
  container convention) no longer triggers `nextjs-no-head-import`,
  `nextjs-error-boundary-missing-use-client`,
  `nextjs-global-error-missing-html-body`,
  `nextjs-no-default-export-in-route-handler`, or
  `server-fetch-without-revalidate`; the same class of false positive is
  fixed for `nextjs-no-client-fetch-for-server-data` (`/pages` mounts),
  `server-hoist-static-io` (`/pages` mounts), and the `tanstack-start-*`
  route-file rules (`/routes` mounts).

- [#1025](https://github.com/millionco/react-doctor/pull/1025) [`6885698`](https://github.com/millionco/react-doctor/commit/6885698cda0bc35446a13a1af7327f62c9c68025) Thanks [@aidenybai](https://github.com/aidenybai)! - fix(rules): three false-positive fixes found by the fuzz FP oracle

  - `role-supports-aria-props`: the ported role→props table was missing
    spec-supported properties (aria-query parity) — `aria-multiselectable`
    on listbox/grid/tablist/tree/treegrid, `aria-readonly` on 15 widget
    roles, `aria-errormessage` on treegrid — so valid ARIA markup was
    flagged (upstream report: oxc-project/oxc#20855).
  - `rendering-hydration-no-flicker`: no longer flags `useLayoutEffect` —
    it runs synchronously before paint, so the canonical DOM-measurement
    pattern (`useLayoutEffect(() => setHeight(ref.current...), [])`) never
    flashes (upstream report: facebook/react#34858).
  - `no-derived-state`: the async-intermediate suppression now sees through
    `const f = useCallback(async () => ...)` — a setter reached after an
    await is async sequencing state, not a render-derivable value
    (upstream report: facebook/react#34905).

## 0.6.0

### Patch Changes

- [#936](https://github.com/millionco/react-doctor/pull/936) [`ba2af1b`](https://github.com/millionco/react-doctor/commit/ba2af1b7faa5ef4e1ae39e6c3b786259fba23f1f) Thanks [@aidenybai](https://github.com/aidenybai)! - Update the license to MIT with additional restrictions: the software may not be used as training, fine-tuning, or evaluation data for machine-learning models or AI systems, nor sold or resold as a commercial product or service (e.g. a paid API, SaaS, or hosted/managed service) whose value derives substantially from the software, without prior written permission (contact founders@million.dev). Each version's additional restrictions expire on the second anniversary of its release, after which that version is available under the standard MIT License (an FSL-style grant of future license). Each published package now ships its own up-to-date `LICENSE` file so the terms travel with the tarball.

  The `react-doctor` CLI also now prints a one-time notice (once per run) when it detects it is running inside an AI/ML training pipeline or agent sandbox, pointing to the license terms.

- [#1013](https://github.com/millionco/react-doctor/pull/1013) [`7ef9f0e`](https://github.com/millionco/react-doctor/commit/7ef9f0eb7c026b4f9003902d1ab66d232e8ab43f) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - fix(rules): close three follow-up gaps in the 20-day audit fixes

  - **Comment stripper**: `isRegexLiteralStart` now uses a Unicode-aware
    identifier class, so a division after a non-ASCII identifier (`café / total`,
    `合計 / 個数`) is no longer misread as a regex literal — which had blanked
    real code up to the next slash and let `/* … */` comment bodies escape
    stripping across the pattern-based security-scan rules.
  - **`server-auth-actions`**: the cache/navigation exemption now requires the
    callee to resolve to _any_ import rather than specifically `next/cache` /
    `next/navigation`. A module-local `const revalidatePath = …` (a privileged
    shadow) is still flagged, but a revalidation-only action importing through a
    common re-export barrel (`import { revalidatePath } from "@/lib/cache"`) is no
    longer a false positive.
  - **`rn-no-raw-text`**: fragment piercing now sees through named
    `<Fragment>` / `<React.Fragment>` (via the existing `isJsxFragmentElement`
    helper), not only the shorthand `<>`, so children forwarded through a named
    fragment into a host are classified the same as the shorthand form.

- [#1017](https://github.com/millionco/react-doctor/pull/1017) [`c2af308`](https://github.com/millionco/react-doctor/commit/c2af3082bfcb85c97e4bfa0d0d71f20478cebe9b) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix four false positives found by React Doctor reviewing real, idiomatic React code (the Ink TUI in [#979](https://github.com/millionco/react-doctor/issues/979)):

  - `no-derived-state` no longer flags state accumulators — a `setState` inside an effect whose functional updater computes the new value from its own parameter (`setKeys((previous) => new Set(previous).add(key))`, `setTotal((prev) => prev + count)`, `setItems((prev) => [...prev, item])`). Accumulated history is by definition not derivable from the current props/state. The spread-only object merge (`setForm((prev) => ({ ...prev, field: <derived> }))`) still reports.
  - `no-array-index-as-key` no longer flags positional rendering of string fragments (characters, lines, tokens): `[...str]` and `Array.from(str)` where the source is provably a string (literal, template, `String()` call, or a binding/prop typed `string` in the same file), plus any `str.split(...)` receiver (only strings have `.split`, so no proof is needed) — including a local binding initialized from one (`const parts = line.split(" "); parts.map(...)`). Fragment position is the stable identity there — nothing reorders, filters, or carries per-item state. Data lists still report.
  - `prefer-useReducer` now requires an actual co-update signal instead of merely counting `useState` calls: it reports only when the threshold number of distinct setters are called together as sibling statements of one handler/effect block. Independent state updated from separate handlers or separate keyboard-handler branches stays quiet, and the message no longer claims each `useState` "can trigger a separate render" (wrong since React 18 automatic batching) — it now explains the real rationale: state that changes together is easier to keep consistent as a single reducer action.
  - `jsx-no-jsx-as-prop` only claims what it can prove: when the receiving component is not resolvable in the current file (imported), the message uses conditional wording ("If this child is memoized, …") instead of asserting a memo bailout that may not exist. Same-file components provably wrapped in `memo()` (or MobX `observer()`) keep the assertive message; provably plain function components already stayed quiet.
  - `lazy()` / `React.lazy()` components are no longer treated as memoized — `lazy` defers loading but does not skip re-renders. `jsx-no-jsx-as-prop` now uses the conditional wording for them, and the memoised-consumer-gated rules (`jsx-no-new-object-as-prop`, `jsx-no-new-array-as-prop`, `jsx-no-new-function-as-prop`, `prefer-stable-empty-fallback`) no longer report fresh-reference props passed to a `lazy()` component, matching their premise of a provably defeated memo bailout.

- [#958](https://github.com/millionco/react-doctor/pull/958) [`c72b560`](https://github.com/millionco/react-doctor/commit/c72b560682f1254aa4dd793898f2eed48afdbe27) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `jsx-key`'s spread-overwrites-`key` check to key off the spread's position. A `{...spread}` can only clobber an explicit `key` when it appears _after_ the key — the later attribute wins under the classic runtime (`{ key, ...spread }`) and React falls back to `createElement` under the automatic runtime, so the later spread wins there too. The rule now reports `<App key="x" {...spread} />` (and the sandwiched `<App {...a} key="x" {...b} />`) and stays silent on `<App {...spread} key="x" />`, which previously produced a false positive. Spreads of object literals that provably carry no `key` (e.g. `{...{}}`, `{...{ className }}`) are never treated as overwriting.

- [#988](https://github.com/millionco/react-doctor/pull/988) [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f) Thanks [@aidenybai](https://github.com/aidenybai)! - fix(react-builtins): eliminate false positives across builtin DOM/JSX rules

  Harden the react-builtins rules against false positives on real-world code:

  - `button-has-type`, `iframe-missing-sandbox`, `checked-requires-onchange-or-readonly`: a JSX or `createElement` spread (`{...props}`) can forward the "missing" attribute at runtime, so these rules no longer report an attribute they cannot see — except an `<iframe>` with an explicit `src`, which marks the real embed site where a missing `sandbox` is the author's omission. `button-has-type` also resolves locally-bound and destructured/renamed `type` props (only through `const` initializers and only when the destructure roots at a function parameter), and treats explicitly nullish `createElement` props (`null` / `undefined` / `void 0`) as missing.
  - `no-find-dom-node`: a bare `findDOMNode(...)` is flagged only when it is imported from `react-dom`, so a local helper of the same name is left alone.
  - `no-is-mounted`, `no-this-in-sfc`: fire only inside an actual React component, so a plain class that exposes an `isMounted` method or an ES5 constructor keeps its real `this`.
  - `no-call-component-as-function`, `no-unstable-nested-components`: a capitalized helper that is only ever called `Name()` (never instantiated as an element) is treated as an inline render helper, not a component — unless the helper owns hook calls, which inline into the caller's hook order. The instantiation check is keyed by binding, not name — a same-named component rendered elsewhere in the file doesn't count — and `createElement(Name, …)`, `<Thing.Panel/>`, and escaping reads (`withAnalytics(Inner)`, `component={Inner}`) count as instantiation alongside `<Name/>`.
  - `rules-of-hooks`: a factory-named function (`init` / `create*` / `make*` / `build*`) outside any component or hook whose own scope issues several hook calls is treated as a custom hook / factory body even though its name breaks the `useXxx` / PascalCase convention (Solid→React ports use these shapes); this escape also covers the React 19 `use()` hook. A `use`-prefixed callee that resolves to a local hook-free function (e.g. ajv's `useKeyword`) is not treated as a React hook.
  - `exhaustive-deps`: a zero-arg accessor call (`foo()`) listed in the deps array now matches the captured accessor instead of being dropped as a complex dependency, and its callee resolves for the unstable-function-dep check; a computed callee (`items[index]()`) stays a complex dependency, and an unused zero-arg call dep (`Date.now()`) is reported as a complex expression instead of a misleading unnecessary-dependency message.
  - `jsx-no-script-url`: the `javascript:` match is anchored to the URL start, so an ordinary `https:` link that merely contains `JavaScript:` deeper in its path is not flagged.
  - `jsx-no-comment-textnodes`: an interpolated `//` separator glyph (`{used} // {total} GB`) — including one with a literal right side (`{used} // 512 GB`) — is no longer mistaken for a `// comment`.
  - `no-string-false-on-boolean-attribute`: custom elements (hyphenated tag names) own their attribute semantics and are skipped.
  - `void-dom-elements-no-children`, `no-danger-with-children`: whitespace-with-newline text, `{/* comment */}`, and `{undefined}` / `{null}` / `{void 0}` no longer count as meaningful children; both rules also ignore nullish positional children in `createElement` (`createElement("img", props, null)`). `no-danger-with-children` still reports when two or more children survive the JSX transform, since React's `props.children != null` conflict guard sees the resulting array even when every entry is nullish.
  - `no-unknown-property`: `transform-origin` is allowed on every transformable SVG element (including `a`, `defs`, gradients, and `stop`), not just `<rect>`.
  - `no-prevent-default`: an href-less `<a>` (anchor-as-button) is not a dead link, and an anchor whose handler performs its own navigation after `preventDefault()` (router push, `location.href` assignment, `window.open`) is custom SPA navigation, not a dead link.
  - `jsx-no-jsx-as-prop`: `indicator`, `decoration`, and `*Children` props (antd `checkedChildren` and friends) are recognized as slot props.
  - dumi doc trees (`/.dumi/`) are treated as non-production files, so demo/docs code inside them is skipped by the rules that skip test-like files.

- [#984](https://github.com/millionco/react-doctor/pull/984) [`0b64af5`](https://github.com/millionco/react-doctor/commit/0b64af58b16329c5cae7a210463d2842e34b150d) Thanks [@aidenybai](https://github.com/aidenybai)! - Stop `no-eval` and `auth-token-in-web-storage` from firing in non-production files

  `eval` / `new Function` / a stringy `setTimeout`, and a token written to web
  storage, are only vulnerabilities in code that ships to users. Both rules now
  skip test, spec, fixture, story, and script files (`isTestlikeFilename`), so a
  `new Function(...)` inside a `*.test.ts` or a throwaway token in `__tests__/` is
  no longer reported. The rules stay fully enabled in production code.

- [#983](https://github.com/millionco/react-doctor/pull/983) [`5639b1e`](https://github.com/millionco/react-doctor/commit/5639b1e40e66650cb7042206b19807b2f785d8ff) Thanks [@aidenybai](https://github.com/aidenybai)! - fix: stop flagging non-privileged server actions in server-auth-actions

  `server-auth-actions` flagged any exported server action without an auth check,
  including actions that touch no protected data. It now exempts an action whose
  body only:

  - busts the Next.js cache — `revalidateTag`, `revalidatePath`, `expireTag`,
    `expirePath`, and the `unstable_` variants, and/or
  - navigates — `redirect`, `permanentRedirect`, `notFound`, `forbidden`,
    `unauthorized`.

  An unauthenticated caller gains nothing by invoking such actions, so requiring
  an auth guard was a false positive.

  The exemption is deliberately conservative — the body must contain at least one
  cache- or navigation call (matched only as a bare imported identifier, never a
  same-named method like `obj.redirect()`) and **no** other effect. Any DB query,
  `fetch`, imported helper, raw-SQL tagged template (`sql\`DELETE …\``),
  constructor, or assignment keeps the action flagged, so a genuinely sensitive
  action is never silently allowed through.

- [#1018](https://github.com/millionco/react-doctor/pull/1018) [`988ce57`](https://github.com/millionco/react-doctor/commit/988ce5701af82aef406be48190dace1449a5393c) Thanks [@aidenybai](https://github.com/aidenybai)! - Cut false positives across the state-and-effects rule family while locking the true-positive shapes in with regression tests:

  - `no-cascading-set-state` now counts setters per synchronous dispatch: deferred callbacks (timers, listeners, observers, promise continuations, subscriptions) no longer inflate the count on their own, but still compound when the effect also sets state synchronously; IIFE and synchronous-iteration (`forEach`/`map`/…) callbacks stay counted; statements after an unconditional `return`/`throw` are ignored, and early-return guard branches accumulate across re-runs.
  - `no-chain-state-updates`, `no-event-handler`, `no-pass-live-state-to-parent`, and `no-prop-callback-in-effect` stay silent when the triggering state is externally driven — its setter is called exclusively from timers, listeners, observers, promise continuations, or subscriptions — since there is no React event handler to fold the work into.
  - `no-derived-state` no longer flags a controlled-value mirror whose setter is also handed to a child as an `on*` JSX callback (`onChange={setValue}`): the state buffers the child's live edits.
  - `no-direct-state-mutation` exempts state whose `useState` initializer provably constructs a class instance (`useState(new TrackQueue())` or a lazy initializer returning one) — an opaque imperative object, not render data.
  - `no-pass-live-state-to-parent` and `no-prop-callback-in-effect` skip prop calls whose result flows into another call's argument (`setDisplay(format(amount))`) — a pure transform, not a parent hand-back — and `no-pass-live-state-to-parent` also skips functions returned by state-owning custom hooks.
  - `rerender-functional-setstate` recognizes `debounce`/`throttle` wrappers as deferred execution.
  - `rerender-state-only-in-handlers` no longer flags state that drives a side-effect-only `useEffect` dependency, feeds a render-phase hook call, or participates in React's adjust-state-while-rendering pattern. Effect reads are now resolved through binding scopes, so a local that shadows a state name neither hides nor fakes a read of the outer value.
  - `no-initialize-state` only defers to a mount effect for measurement API calls (`window.matchMedia(...)`), not bare method references (`!!window.matchMedia`) or scalar reads (`window.innerWidth`).

- [#911](https://github.com/millionco/react-doctor/pull/911) [`f69f216`](https://github.com/millionco/react-doctor/commit/f69f21681dd7f17d632a09d742d501ef0b9b3047) Thanks [@skoshx](https://github.com/skoshx)! - fix: reduce false positives in supabase-rls-policy-risk

  The rule now classifies each `CREATE POLICY` statement individually (over
  comment/string-sanitized SQL) instead of matching the whole file with one
  regex. A permissive `using/with check (true)` policy whose `TO` clause names
  **only** server-only roles (`service_role`, `postgres`, `supabase_admin`) is
  treated as hardening, not a public bypass — including two-clause `FOR ALL` /
  `FOR UPDATE` forms and all-server-only role lists that the previous
  negative-lookbehind missed. `anon` / `authenticated` (and a `TO` clause that
  mixes one in, or no `TO` clause at all → `PUBLIC`) stay flagged, since those are
  client-reachable via a JWT.

  `auth.role() = 'service_role'` checks inside policy bodies are still flagged
  (true runtime bypasses). The previous `IF EXISTS` suppression on `DISABLE ROW
LEVEL SECURITY` was removed: it silently downgraded a real risk on live tables,
  and the dropped-table case it targeted needs cross-migration analysis — deferred
  with the issue's cross-migration class.

  Fixes [#910](https://github.com/millionco/react-doctor/issues/910)

- [#988](https://github.com/millionco/react-doctor/pull/988) [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f) Thanks [@aidenybai](https://github.com/aidenybai)! - fix(architecture): eliminate false positives across architecture, correctness, and design rules

  Hardens ~15 rules so they stop firing on valid code, without weakening the real smell each targets.

  Architecture:

  - `no-many-boolean-props` requires actual render output before treating a parameter as component props (so non-component factories like `CreateValidator(options)` are skipped; JSX inside `.map`/`useMemo` callbacks still counts), and no longer counts props that are invoked, wired as event handlers (`onClick={showMenu}`), or passed as imperative-prefixed call arguments (`setTimeout(props.showMenu, 100)`) as boolean flags — resolving each name to the component's own props binding, including renamed destructurings.
  - `no-nested-component-definition` only flags a nested definition that is actually rendered — as JSX (`<Inner/>`) or by reference through a component prop (`component={Inner}`) — inside its own enclosing component, not a capitalized helper that is merely called (`Inner()`), and no longer leaks a sibling component's `<Inner/>` onto a same-named call-only helper.
  - `no-render-in-render` exempts render-prop invocations (`props.renderX()`, `this.props.renderX()`, `props.slots.renderX()` on a nested prop bag, and render props destructured or aliased from props or a component parameter — including defaulted/conditional aliases like `props.renderItem ?? defaultRender`), while still flagging local `render*` helpers, `this.renderX()` class-field calls, and a `render*` parameter of an ordinary nested helper.
  - `no-render-prop-children` ignores `render*Props` config bags and literal `render*` mode/flag values, which are not render slots.
  - `prefer-module-scope-static-value` no longer hoists initializers that call impure globals (`Date.now()`, `Math.random()`, `crypto.randomUUID()`, `nanoid()`, …) — local helpers that merely share one of those names stay hoistable — and abstains when every reference is a read-only scalar lookup (`KEYS.includes(k)`), where referential identity can't matter.
  - `react-compiler-destructure-method` drops `useSearchParams` (its methods are unbound and throw when destructured).
  - `react-compiler-no-manual-memoization` leaves `memo(Component, areEqual)` with a custom comparator alone (a nullish second argument still counts as redundant).

  Correctness:

  - `html-no-invalid-paragraph-child` and `html-no-nested-interactive` stop at JSX attribute boundaries, so an element passed as a prop is no longer treated as a DOM child / nested element — except the explicit `children` prop, which React renders as a real DOM child.
  - `no-polymorphic-children` only flags `typeof children` when `children` resolves to the component's props, not a local variable or field that happens to be named `children`.
  - `no-prevent-default` skips `<form action=…>` (which has a native no-JS submit path) and anchors whose handler carries positive navigation evidence after `preventDefault()` (`router.push`, `navigate(...)`, `window.open`, delegation to a prop handler) — analytics-only handlers stay flagged as dead links — and stays quiet in test/demo files.
  - `no-uncontrolled-input` treats `onInput` as controlling like `onChange`, no longer flags `disabled` inputs (React suppresses its missing-`onChange` warning for `disabled` fields, just like `readOnly`) unless `disabled={false}` is literal, and stays quiet in test/demo files.
  - `rendering-svg-precision` requires at least two over-precise token occurrences before reporting, and stays quiet in test/demo/docs-site files.

  Design:

  - `no-gray-on-colored-background` pairs gray text and colored backgrounds by Tailwind variant scope (order-insensitive, `!important`-aware), including the additive case where a base utility applies under a variant with no same-property override, and tightens the palette/shade patterns.
  - `no-layout-transition-inline` matches an exact set of layout property tokens (now also `border-*-width`, `line-height`, `column-width`) so lookalikes such as `stroke-width` no longer match.
  - `no-long-transition-duration` exempts infinite / looping animation segments (an animation NAME containing "infinite" still counts) and decorative `aria-hidden` elements.
  - `no-outline-none` allows `outline: none` alongside a class that ADDS a visible ring on the element's OWN focus (removal utilities like `focus:ring-0` / `focus:outline-hidden` and `group-focus:`/`peer-focus:` variants don't count) or on elements removed from the tab order (negative `tabIndex`, including conditionals where both branches are negative).
  - `no-side-tab-border` runs arbitrary hex/rgb/hsl border colors through the same achromatic check as named palette colors, preferring the color scoped to the flagged side (`border-l-[#e5e7eb]`) over the base border color.

- [#988](https://github.com/millionco/react-doctor/pull/988) [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f) Thanks [@aidenybai](https://github.com/aidenybai)! - fix(performance): reduce false positives across performance, js-performance, and bundle-size rules

  Hardens the performance rule families so common, legitimate patterns stop
  triggering warnings. Validated against 500 distinct OSS repos with the RDE
  harness (react-doctor caching disabled).

  - **bundle-size** — `no-dynamic-import-path` only treats bundler-analyzable
    relative specifiers (`./`, `../`) as static prefixes (protocol/absolute
    URLs stay flagged); heavy-library rules skip type-only imports;
    `no-undeferred-third-party` ignores `type="module"` and non-executable
    script types.
  - **js-performance** — smarter guards for order-dependent async
    (`async-await-in-loop`, `async-parallel`), `.find()` in loops
    (`js-index-maps`: single-field equality, loop-variant receivers — including
    receivers behind a TS cast — and nested-scope bindings), property-access and
    `localStorage` caching, `filter(Boolean)` chains, `Intl`/`RegExp` memo and
    hoist patterns, direction-aware `Math.min`/`Math.max` hints, small literal
    `includes`, and `[...x].sort()` when `x` is a fresh, otherwise-unreferenced
    array or iterator.
  - **`no-json-parse-stringify-clone`** — exempts clones inside `snapshot*`
    helpers, and no longer flags `JSON.parse(JSON.stringify(x, replacer))` when
    the replacer is an inline function or array (it transforms the output, so
    `structuredClone` is not an equivalent rewrite).
  - **performance / React** — memo inline-prop skips custom comparators and
    `ref`/`key`; hoist-JSX respects render-local components; the hydration rule
    ignores time/random inside nested handlers; loading-state, derived-hook, and
    memo-before-return rules only fire when the suggested refactor would help.

- [#988](https://github.com/millionco/react-doctor/pull/988) [`6e67626`](https://github.com/millionco/react-doctor/commit/6e6762667838caa518cea203fe985184ab0bd31f) Thanks [@aidenybai](https://github.com/aidenybai)! - Eliminate false positives across the framework rules (nextjs, server, tanstack-query, tanstack-start, jotai, preact, view-transitions, client): redirect-in-try-catch rules now resolve the real next/navigation import and treat a catch that re-throws the caught error (or a bare try/finally, or an IIFE boundary) as transparent instead of swallowing, effect-fetch rules follow IIFEs, called local functions, and promise-chain callbacks the effect actually runs while still skipping later-firing handlers, `server-hoist-static-io` tracks request-derived paths through intermediate bindings, the tanstack-query rules verify receiver bindings through scope analysis (`query-mutation-missing-invalidation` recognizes destructured and tRPC-style `utils.x.invalidate()` cache invalidation without accepting unrelated `invalidate()` verbs), `server-no-mutable-module-state` only flags const containers that are actually mutated (including through aliases and one same-file call hop), `no-document-start-view-transition` only fires in files that import React's `ViewTransition`, and passive-event-listener, image-sizes, anchor, GET-handler, loader-waterfall, navigate-in-render, select-atom, raw-query-atom, and children-length checks all gained escape hatches for legitimate patterns. Validated against 500 OSS repositories.

- [#954](https://github.com/millionco/react-doctor/pull/954) [`6339f71`](https://github.com/millionco/react-doctor/commit/6339f715cc1a30521a699b818140ec2fae6f569e) Thanks [@rayhanadev](https://github.com/rayhanadev)! - fix(rn-no-raw-text): report raw text by where it actually crashes, resolving imported wrappers across files

  The `rn-no-raw-text` rule reported raw text inside any element it couldn't prove was a text component — including a custom component imported from another file (e.g. a `<MyButton>` that wraps its label in `<Text>` internally), which produced false positives on the common "custom component that renders Text" pattern.

  The rule now anchors its report on where React Native actually crashes — a host boundary — and resolves imported components across files instead of guessing:

  - Raw text is reported inside a known host primitive (`View`, `ScrollView`, `Pressable`, the `Touchable*` family, `Modal`, …), a lowercase intrinsic, or an in-file component proven to forward its children into one.
  - A component imported from another first-party file (relative or tsconfig-alias) is resolved and classified the same way: one that wraps its children in `<Text>` is left alone, while one that renders them into a `<View>` is still reported — so genuine crashes inside imported wrappers are kept.
  - Components the resolver can't follow (`node_modules`, namespace imports, unanalyzable exports) are left unreported rather than assumed to crash; `rawTextWrapperComponents` / `textComponents` config still covers those.
  - React's structural `<Fragment>` / `<React.Fragment>` now counts as a transparent wrapper alongside fbtee's `<fbt>` / `<fbs>`, so an `<fbt>` nested under a `<Fragment>` inside a `<Text>` is no longer falsely flagged.

## 0.5.8

### Patch Changes

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add a per-file content-addressed lint cache so repeat scans re-lint only the files whose content changed. On a warm scan the oxlint pass partitions the file list by content hash: unchanged files replay their cached raw diagnostics, and only changed files are re-linted. The five cross-file rules (`no-barrel-import`, `nextjs-missing-metadata`, `nextjs-no-use-search-params-without-suspense`, `no-mutating-reducer-state`, `rn-prefer-expo-image`) — whose verdict for a file can depend on _other_ files — always run fresh in a never-cached sidecar pass, so a dependency change can never serve a stale verdict. Output is byte-identical with the cache on or off (the design invariant), so the score, JSON report, and `inspect()`/`diagnose()` return values are unchanged.

  The cache is on by default and content-hashed (so it survives CI re-clones), and is automatically bypassed in audit mode, when an `extends` lint config is adopted, or when user plugins are configured. Disable it with `REACT_DOCTOR_NO_FILE_CACHE=1`; the existing `REACT_DOCTOR_NO_CACHE=1` now disables both the whole-repo scan cache and this per-file cache. A `cross-file-rules` guard test fails if a future rule starts reading other files without being carved into the always-fresh sidecar. The CLI reports cache effectiveness on its Sentry run event as `lintCacheHitRatio`.

  `oxlint-plugin-react-doctor` now exports `CROSS_FILE_RULE_IDS`, the canonical set of rules whose verdict can depend on other files.

## 0.5.7

### Patch Changes

- [#847](https://github.com/millionco/react-doctor/pull/847) [`424d8f9`](https://github.com/millionco/react-doctor/commit/424d8f9f914ff98b791af6b1f88337922c80c8ef) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `agent-tool-capability-risk` (and its sibling `mcp-tool-capability-risk`) false positives when a capability keyword appears only in prose ([#838](https://github.com/millionco/react-doctor/issues/838)).

  The rules already blanked comments before their keyword scan but still matched the dangerous-capability pattern inside string literals. A tool whose `description` happened to contain a capability word as prose — e.g. `description: "...ALWAYS fetch the underlying numbers first"` — fired even though no shell/fs/network primitive was wired to the handler. The keyword scan now blanks string-literal interiors (preserving offsets, so reported lines/columns stay correct), via a new opt-in `ignoreStringLiterals` flag on the shared `scanByPattern` helper.

  Genuine signals still fire: a real call site outside the quotes (`exec(command)`, `fetch(url)`), a capability inside a template interpolation (`` `${fetch(url)}` `` — `${…}` is treated as code, not blanked), and a dangerous module specifier (`import { execFile } from "node:child_process"`, `require("axios")`) are all preserved.

- [#845](https://github.com/millionco/react-doctor/pull/845) [`81bbfcc`](https://github.com/millionco/react-doctor/commit/81bbfcc39a0ae2f7d92ebb8860d854d09a60344d) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `artifact-baas-authority-surface` false positives on `next-sanity` / `@sanity/client` studio bundles ([#840](https://github.com/millionco/react-doctor/issues/840)).

  The rule's "BaaS client config present" gate paired the generic `createClient` token with Firebase's `projectId` field. But that pairing is the _Sanity_ client signature — `createClient({ projectId, dataset, apiVersion })` — not a Firebase or Supabase one, so every Sanity Studio browser chunk tripped the gate and then matched the second factor on a shipped `roles`/`administrator` string. `createClient` now only counts as a BaaS signal next to a Supabase marker (`supabase` / `SUPABASE_URL`); Firebase is still detected by its own verbs (`initializeApp`, `firebase`, `firestore`), so genuine Firebase/Supabase authority maps keep firing.

- [#861](https://github.com/millionco/react-doctor/pull/861) [`937a7ca`](https://github.com/millionco/react-doctor/commit/937a7ca8a1b066a62210dc4a11149b9180dc9851) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop `no-inline-exhaustive-style` from flagging Satori (next/og, @vercel/og) OG-image components.

  OG components style everything inline because Satori rasterizes the JSX to a static image and supports no other styling channel — so the rule's "rebuilds every render" premise never applies, and an exhaustive `style={{…}}` is the only way to lay them out. The rule now shares the same `isGeneratedImageRenderContext` guard the sibling image rules already use (`alt-text`, `nextjs-no-img-element`, `no-unknown-property`): it short-circuits in Next.js metadata image routes (`opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, …) and skips JSX that flows into an `ImageResponse(...)`/`satori(...)` call, including a helper component resolved to that call. The expensive per-node generated-image lookup runs only once a style is large enough to report, so ordinary files pay nothing. Exhaustive inline styles in regular components are still flagged.

- [#862](https://github.com/millionco/react-doctor/pull/862) [`b8170f8`](https://github.com/millionco/react-doctor/commit/b8170f814c079d7bbc9e7796dd13646a6e8175fe) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop `jsx-key` from flagging element collections handed to a non-`children` prop (e.g. `<Tabs items={[<Tab />, <Tab />]} />`).

  The rule decided whether an element needed a `key` purely from its structural position — "is this JSX inside an array literal or a `.map`/`.flatMap`/`Array.from` callback?" — and never looked at where the resulting collection was consumed. React's dev-mode key validation only iterates `props.children` (`jsxWithValidation` → `validateChildKeys(props.children, type)`), so an element array passed to any other prop is never key-validated at the call site; the receiving component owns keying (the `cloneElement` / `Children.map` / `Children.toArray` idiom). Flagging the producer site was a false positive — the same "data handoff, not a sibling render" reasoning the rule already applies to object-`Property` values.

  The fix exempts collections that are the value of a non-`children` JSX attribute, for both array literals and iterator callbacks — including when the value is wrapped in optional chaining, `&&`/`||`/`??`, a ternary branch, or a TS `as` / `satisfies` / `!` assertion (`items={ready && xs.map(...)}`), since none of those change whether React validates it.

  Genuine missing keys still fire: array literals and `.map` results in **children** position (`<Menu>{data.map(...)}</Menu>`, `<ul>{[<li/>, <li/>]}</ul>`), and the explicit `children={[...]}` attribute — which _is_ `props.children` and which React does validate.

- [#865](https://github.com/millionco/react-doctor/pull/865) [`3f7d0e7`](https://github.com/millionco/react-doctor/commit/3f7d0e7ddb055b4970cba2b393ce14f6615732e4) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Ship `no-danger` default-off so it no longer blanket-flags safe `dangerouslySetInnerHTML`.

  `no-danger` is the absolutist oxc port — it flags **every** `dangerouslySetInnerHTML` with zero content awareness, so it fired Security warnings on the canonical-safe idioms that React Doctor's own content-aware detectors deliberately exempt: escaped JSON-LD, theme-init `<script>` templates, CSS-variable `<style>` injection, and sanitized / `safe`-named values. Two default-on Security rules judged the same prop and disagreed.

  The content-aware rules are now the canonical default-on detectors for `dangerouslySetInnerHTML`: `dangerous-html-sink` (dynamic/tainted markup, with the style-tag / static-template / sanitizer exemptions) and `unsafe-json-in-html` (the unescaped-`JSON.stringify` breakout case). `no-danger` remains available opt-in (`"react-doctor/no-danger": "warn"`) for teams that want the stricter "never use `dangerouslySetInnerHTML` at all" policy (oxc / `eslint-plugin-react` parity).

  Score impact: repos using these safe idioms will see fewer Security findings and a correspondingly **higher** score. A CI gate pinned to a fixed threshold may pass where it previously failed. Re-enable `no-danger` in config to restore the old behavior.

- [#846](https://github.com/millionco/react-doctor/pull/846) [`6b8e756`](https://github.com/millionco/react-doctor/commit/6b8e756c40fe300634aec766edb00cbec73d8bc4) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `server-sequential-independent-await` false positive on awaits whose dependency flows through nested destructuring ([#839](https://github.com/millionco/react-doctor/issues/839)).

  The rule's binding collector only saw top-level `Identifier` bindings and shallow object/array pattern elements, so names bound through a nested pattern — e.g. `const [{ slug }, { isEnabled }] = await Promise.all([...])` — were invisible. A follow-up `await client.fetch(BlogPostQuery, { slug }, isEnabled ? ... : ...)` that genuinely depended on those names was wrongly flagged as an independent waterfall. The collector now reuses the recursive `collectPatternNames` utility, so nested array/object patterns, defaulted bindings, and rest elements all count as a real dependency.

- [#831](https://github.com/millionco/react-doctor/pull/831) [`03301fc`](https://github.com/millionco/react-doctor/commit/03301fcdf4adcf256ef7ef7ed83f5566181ab371) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix `server-auth-actions` false positives on custom auth guards ([#829](https://github.com/millionco/react-doctor/issues/829)).

  The rule only recognized a fixed list of auth function names, so a server action protected by a project's own guard — e.g. `await requireAdmin()` or `await getAdminSession()` — was wrongly flagged as callable by anyone. It now recognizes auth checks by naming **convention** as well: an assertive verb plus an auth noun (`requireAdmin`, `ensureSignedIn`, `checkPermission`, `assertUser`, `isAdmin`, `hasRole`), a getter plus a strong auth noun (`getServerAuthSession`, `getAdminSession`), and `current`/`my`/`own` qualifiers (`getCurrentUser`). Genuinely ambiguous names like `getUser` and `getToken` still require an auth-related receiver, so `analytics.getUser()` keeps firing the rule.

- [#859](https://github.com/millionco/react-doctor/pull/859) [`44db3e0`](https://github.com/millionco/react-doctor/commit/44db3e0546fe0518b79e0aa2636754dcccda2939) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `server-fetch-without-revalidate` false positive on mutating fetches. Next.js only caches GET requests, so a `fetch(url, { method: "POST" | "PUT" | "PATCH" | "DELETE" })` in a Server Component or route handler can never serve stale cached data — the rule no longer flags it.

- [#843](https://github.com/millionco/react-doctor/pull/843) [`5b742fa`](https://github.com/millionco/react-doctor/commit/5b742fa28c96443bd5bbd6348ad5aba55e17405c) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `url-prefilled-privileged-action` false positive when a validating helper
  wraps a read behind a receiver chain. The validator-suppression lookbehind only
  recognized `validator(searchParams.get(...))` or `validator(new URLSearchParams(...))`
  directly — real code reads through a receiver (`sanitizeNext(url.searchParams.get(...))`,
  `validateNext(request.nextUrl.searchParams.get(...))`), and that intervening `url.`
  broke the match so validated reads kept firing. The lookbehind now allows an optional
  receiver member-chain between the helper's `(` and the read.

- [#826](https://github.com/millionco/react-doctor/pull/826) [`8908f98`](https://github.com/millionco/react-doctor/commit/8908f98d02ad65e58d740ab948f8111948592cb9) Thanks [@aidenybai](https://github.com/aidenybai)! - Add 7 new rules mined from React, web-platform, security, and accessibility best practices:

  - `no-call-component-as-function` (Bugs): calling a component like `Foo(props)` instead of `<Foo />` runs it outside React and breaks hooks, state, and memoization. Shadow-safe via scope resolution.
  - `no-create-ref-in-function-component` (Bugs): `createRef()` in a function component or hook allocates a fresh ref every render; use `useRef()`.
  - `no-async-effect-callback` (Bugs): an `async` `useEffect`/`useLayoutEffect` callback returns a Promise that React treats as cleanup, causing unmount races.
  - `no-json-parse-stringify-clone` (Performance): `JSON.parse(JSON.stringify(x))` is a slow, lossy deep clone; use `structuredClone(x)`.
  - `no-img-lazy-with-high-fetchpriority` (Performance): `loading="lazy"` and `fetchPriority="high"` are contradictory directives on the same image.
  - `dialog-has-accessible-name` (Accessibility): a `<dialog>` / `role="dialog"` with no `aria-label`/`aria-labelledby` is announced only as "dialog".
  - `auth-token-in-web-storage` (Security): persisting auth tokens in `localStorage`/`sessionStorage` exposes them to XSS exfiltration.

- [#828](https://github.com/millionco/react-doctor/pull/828) [`451beeb`](https://github.com/millionco/react-doctor/commit/451beeb28405aa6810946e3311dfc7fb8de74632) Thanks [@aidenybai](https://github.com/aidenybai)! - Add 3 new rules (mining batch 2), each validated with an OSS noise sweep (0 false positives across ~2,800 diagnostics in react-use, radix-ui/primitives, excalidraw, mantine):

  - `no-document-write` (Performance): `document.write()`/`document.writeln()` blocks parsing and is ignored or wipes the page after load.
  - `no-sync-xhr` (Performance): a synchronous `XMLHttpRequest` (`.open(method, url, false)`) freezes the main thread until the request finishes.
  - `no-string-false-on-boolean-attribute` (Bugs): `disabled="false"` and friends pass the string `"false"`, which is truthy, so the boolean attribute is applied even when you wrote "false". Targets a curated set of true HTML boolean attributes on intrinsic elements; excludes enumerated attrs (`aria-*`, `contentEditable`, `draggable`, `spellCheck`) and custom components.

## 0.5.6

### Patch Changes

- [#812](https://github.com/millionco/react-doctor/pull/812) [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0) Thanks [@aidenybai](https://github.com/aidenybai)! - Add five `security-scan` rules distilled from security-researcher writeups and the deepsec scanner-matcher catalog, closing CWE shapes the bucket didn't cover:

  - **`unsafe-json-in-html`** — `JSON.stringify(...)` embedded in `dangerouslySetInnerHTML` or inline `<script>` markup. `JSON.stringify` does not HTML-escape, so data containing `</script>` or `<` breaks out — the classic SSR data-hydration XSS. Suppressed when an HTML-safe serializer (serialize-javascript, devalue, superjson) or `\u003c` escaping is used.
  - **`jwt-insecure-verification`** — the JWT `none` algorithm (`alg: none` / `algorithms: ["none"]`), which disables signature verification and lets any forged token through. (Detecting an unpinned `jwt.verify` precisely needs scope-aware analysis, so that is left to a future AST rule.)
  - **`secret-in-fallback`** — a secret-shaped env var with a hardcoded string fallback (`process.env.STRIPE_SECRET_KEY ?? "<hardcoded>"`): a committed secret that also makes the app fail open when the var is unset. Skips public vars (PUBLIC/PUBLISHABLE/ANON) and placeholder defaults.
  - **`request-body-mass-assignment`** — spreading or merging request input (`{ ...req.body }`, `Object.assign(target, req.body)`, lodash `merge`/`defaultsDeep`) without a field allowlist: mass assignment (client-set owner/role/price columns) or prototype pollution.
  - **`insecure-session-cookie`** — auth/session cookies exposed to JavaScript: `httpOnly: false`, set via `document.cookie`, or a bare `res.cookie("session", value)` / `cookies().set(...)` with no options.

  All five register through `defineRule` with a project-level `scan`, carry the `Security` category and `security-scan` tag, and are silenced by `react-doctor rules ignore-tag security-scan` like the rest of the family.

- [#819](https://github.com/millionco/react-doctor/pull/819) [`5fc0e27`](https://github.com/millionco/react-doctor/commit/5fc0e270c9a15d25be96ef982755cea81065d141) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix false positives reported in the security and TanStack rules:

  - **`query-destructure-result`** ([#818](https://github.com/millionco/react-doctor/issues/818)): only flags `useQuery`/`useSuspenseQuery`/… when they actually come from a TanStack Query package (`@tanstack/*-query`, legacy `react-query`). A same-named hook imported from elsewhere — notably Convex's `useQuery` from `convex/react`, which returns the data directly — is no longer flagged.
  - **`artifact-env-leak` / `artifact-secret-leak`** ([#816](https://github.com/millionco/react-doctor/issues/816), [#817](https://github.com/millionco/react-doctor/issues/817)): no longer treat server-side or dev-mode Next.js output as browser artifacts. `.next/dev/server/**` (dev source maps), any `.next/**/server/**`, `.output/server/**`, and the dev server's `.next/dev/**` output are excluded; production browser bundles (`.next/static`, `dist/assets`, `public/`, …) are still scanned.
  - **`repository-secret-file`** / **`key-lifecycle-risk`** ([#813](https://github.com/millionco/react-doctor/issues/813)): no longer flag a credential/key file that git ignores — a local-only, gitignored `.env` is not "checked into the repository". Findings are dropped only when git definitively reports the path as ignored (the finding stands when there is no repo or git is unavailable).
  - **`webhook-signature-risk`** ([#814](https://github.com/millionco/react-doctor/issues/814)): recognizes a delegated verification helper (a call pairing a verify-ish verb with a security noun, e.g. `isValidSecret(...)`, `verifySignature(...)`, `checkWebhookHmac(...)`) as verification evidence, so an extracted `timingSafeEqual` comparison in another module no longer trips the rule.

- [#812](https://github.com/millionco/react-doctor/pull/812) [`ea3b827`](https://github.com/millionco/react-doctor/commit/ea3b8278996613114c9c671afe292193388741c0) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a `supabase-table-missing-rls` security-scan rule. It flags a Supabase migration (`supabase/migrations/**`, `supabase/schemas/**`) that runs `create table` for a public-schema table but never enables Row Level Security — the highest-impact and most common Supabase misconfiguration, because RLS is OFF by default for SQL-created tables, so every row is readable and writable with the public anon key. It targets the same misconfiguration Supabase's own `rls_disabled_in_public` database linter flags, and the gap that turns the public anon key into the service key.

  The existing `supabase-rls-policy-risk` only caught an explicit `disable row level security`; this complements it by catching the far more common "never enabled it" case. RLS is checked per table — each `create table` must have an `alter table <name> enable row level security` for that same table, after the create (a sibling table enabling RLS, or a policy without enabling it, does not vouch). SQL comments and string literals are ignored, non-public/Supabase-managed schemas (`auth.`, `storage.`, a `private.` schema, …) are skipped, and the rule is scoped to the `supabase/` directory so plain Drizzle/Prisma `.sql` migrations are not flagged. The scan runs per migration file, so enabling RLS in a _different_ migration than the `create table` is not detected — the same-file pattern (what Supabase tooling emits) is the supported case. Like the rest of the family it carries the `security-scan` tag and is silenced by `react-doctor rules ignore-tag security-scan`.

## 0.5.5

### Patch Changes

- [#809](https://github.com/millionco/react-doctor/pull/809) [`e90eb7a`](https://github.com/millionco/react-doctor/commit/e90eb7acbfc4e06de68de2cb6a96d3242f72963e) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Recognize TanStack Start's current `.validator()` server-fn method (not just the deprecated `.inputValidator()`) in `tanstack-start-server-fn-validate-input` and `tanstack-start-server-fn-method-order`.

  `@tanstack/react-start` renamed the server-function input-validation step from `inputValidator` back to `validator` and now marks `inputValidator` as deprecated. Both rules only matched `inputValidator`, so projects on current TanStack Start that use `.validator()` got a false "missing input validation" diagnostic, and the method-order check ignored a misplaced `.validator()`. Both names are now treated as the same validation step in the chain walker and the method-order sequence, and the rule messages/recommendations point at the canonical `.validator()`.

## 0.5.4

### Patch Changes

- [#744](https://github.com/millionco/react-doctor/pull/744) [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a project-level security file scan: 36 first-class scan rules (leaked artifact secrets and env dumps, permissive Firebase/Supabase rules, raw SQL injection risk, unsafe webhook signature comparisons, committed private key material, public debug artifacts, …) ship in the oxlint plugin as ordinary `defineRule` modules that declare a project-level `scan` instead of AST visitors and run in `@react-doctor/core`'s environment-check phase over one bounded whole-tree walk — covering shipped bundles, dotenv/config files, SQL, and Firebase rules files that per-file linting never sees.

  Scan rules register metadata (id, title, severity, recommendation, `Security` category, `security-scan` tag) like any other rule but carry a project-level `scan` instead of AST visitors, so their findings flow through the standard diagnostic pipeline: per-rule and per-category severity overrides, inline disables, and output `surfaces` now apply to scan-rule diagnostics, and `react-doctor rules ignore-tag security-scan` (config `ignore.tags`) silences the whole family. They never appear in generated oxlint configs or the ESLint presets — they only execute through React Doctor's scan. A plain `--diff` / `--staged` scan skips them like the other whole-project checks, and the gate is now diff mode itself rather than the presence of include paths, so projects configuring `ignore.files` get the security scan too.

- [#744](https://github.com/millionco/react-doctor/pull/744) [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb) Thanks [@aidenybai](https://github.com/aidenybai)! - Fixed false positives in `dangerous-html-sink` (the highest-volume new rule) reported by RDE evals on `repos.json` (200 rootDir scans / 19 distinct repos / 51 total new security diagnostics).

  - Email HTML components (RawHtml, \*Email templates in cal.com `packages/emails`, dub `packages/email`, etc.) were reported even though the rule intends to exempt them (mail clients strip scripts; browser XSS model does not apply). The `EMAIL_TEMPLATE_PATH_PATTERN` skip only looked at the scan-relative path and missed cases where `rootDir` was already the emails package (relativePath = `src/components/RawHtml.tsx`).
  - Trusted rich-text renderers (tldraw `renderHtmlFromRichText(editor, richText)` result assigned to bare `html` then used at a sink in labels) were not recognized, unlike the existing katex / renderToStaticMarkup / hast-util cases in `ESCAPING_SERIALIZER_LIBRARY_PATTERN`. Same shape as the "KaTeX-rendered html identifiers" regression that already passes.

  Updated `EMAIL_TEMPLATE_PATH_PATTERN` (now also matches RawHtml and \*Email filenames) and `ESCAPING_SERIALIZER_LIBRARY_PATTERN` (added `renderHtmlFromRichText`). Added two regression tests using the exact hit shapes from the 51-eval corpus.

  A second eval pass (replaying the rule against every corpus hit's real source) surfaced four more false-positive classes, now fixed:

  - **Empty / literal clears with a trailing comment** — `el.innerHTML = '' // clear` was flagged because the trailing line comment defeated `STRING_LITERAL_VALUE_PATTERN`, after which the value scan bled into the next statement and tainted on an unrelated token there (PostHog `NotebookNodeLatex` reading `content` on the following line). The literal/constant exemptions now tolerate a trailing line comment.
  - **`createHTMLDocument()` parse-to-text** — a disconnected document (no browsing context, scripts never run) used to strip tags to text (tldraw `stripHtml`) is now treated as inert.
  - **Detached `createElement` scratch nodes** — a node that is parsed, then queried / read back, and never attached to a live tree nor returned as a node (Plane `paste-asset`) is now inert; the existing "parsed HTML reaches the document" guard still fires when the node is appended.
  - **In-house serializers + highlighter output via member access** — `render*HTML(...)` serializers (pierre `renderPartialHTML`) and highlighter output stored on an object (`highlightedFiles[0].darkHtml`, shiki) are exempt when a serializer library is present in the file, matching the existing bare-identifier handling.

  Added seven regression tests (including a still-fires guard for object-stored HTML with no serializer library and for scratch nodes appended to the live tree) using the exact hit shapes from the corpus.

  A full-corpus replay (8k+ rootDir scans) surfaced three more false-positive classes, now fixed:

  - **Generated / minified bundles** — `dangerous-html-sink` now skips files the walker flagged as generated bundles (e.g. a minified `iconfont.js` whose inline SVG string tripped the line heuristics). XSS-sink review is for human-authored source, not build output.
  - **Sanitized at the definition site** — `const clean = DOMPurify.sanitize(md.render(x))` then `__html: clean` is now exempt: a bare-identifier value is traced to a `DOMPurify` / `sanitize(...)` / `purify(...)` assignment in the file (the sink only sees the identifier).
  - **HTML encoder output** — `encode*` entity encoders (`encodeNonAsciiHTML`) join the existing `escape*` recognition as escaped, non-live output.

  Added four more regression tests (including a still-fires guard for a bare identifier that is never sanitized in the file).

  A wider corpus pass added three further false-positive classes:

  - **DOM-to-DOM content copies** — `target.innerHTML = other.innerHTML` / `= other.outerHTML` (optionally with a `.replace`/`.trim` transform) re-serializes content already in the document, so it is no injection boundary (a `+` concatenation is still judged, to catch spliced-in input).
  - **camelCase sanitized identifiers** — `__html: htmlSanitized` is now recognized (the `sanitize` convention previously required a word boundary the camelCase name lacked).
  - **hljs / Prism highlighters** — joined the serializer-library allow-list so highlighter output read via member access (`hljsResult.value`) is exempt.

  Added five more regression tests (including a still-fires guard for DOM content concatenated with fresh input).

  Two final classes from the corpus tail:

  - **Commented-out sinks** — a sink that sits inside a `//` line comment or a block-comment line is no longer flagged (commented-out code never runs); a `://` in a URL on the same line does not trip the guard.
  - **`<style>` element innerHTML** — `createElement('style')` then `el.innerHTML = css` injects CSS text, not executable markup (the DOM-API counterpart of the existing `<style dangerouslySetInnerHTML>` exemption).

  Added three more regression tests.

  A `/thermos` review pass hardened the exemptions against false negatives (a security rule must not hide a real sink), tightening the looser ones this changeset added:

  - The serializer-library exemption no longer keys off a bare file-wide keyword (which would exempt any sink in a file that merely imports a highlighter). It now requires a **data-flow link** — the value identifier must be assigned from a serializer (`const html = katex.renderToString(...)`) — sharing one assignment-check path with the sanitizer exemption.
  - `isInertParseTarget` forces **non-inert** when the target name is ever bound to a live DOM node (`getElementById`/`querySelector`/`.current`/`document.body`), closing same-name collisions across functions.
  - The DOM-content-source exemption now bails when a **taint token follows the read** (`a.innerHTML.replace(x, props.userHtml)`), not only on `+` concatenation.
  - The `escape`/`encode` sanitizer arm is scoped to HTML encoders (so `encodeURIComponent`/`escapeRegExp`/`encodeForDisplay` no longer exempt).
  - The commented-out-sink skip strips string literals first, so a protocol-relative URL (`"//cdn"`) before a real sink is not mistaken for a `//` comment.

  Added FN-guard regression tests for each (49 tests total).

  A second full-corpus pass found the largest remaining false-positive class — **syntax-highlighter output** — and two smaller ones:

  - Highlighter output (`highlightedHtml`, `file.highlightedContent`, `highlight*()` calls) is escaped, token-wrapped markup. It is usually routed through React state (`const [highlightedHtml, setHighlightedHtml] = useState(); setHighlightedHtml(await codeToHtml(code))`) or passed as a prop, so the data-flow assignment check never sees it. Now exempt: `highlight*()` calls (escaping serializers), `highlighted*` values (escaped-output naming convention), and present-tense `highlight*` values when the file uses a highlighter library (Shiki/Prism/highlight.js/…).
  - Optional chaining in the DOM-serialization exemption (`Svg?.outerHTML`).
  - The `<textarea>` HTML-entity decode idiom (`textArea.innerHTML = x; return textArea.value`) — textarea content is RCDATA, so scripts never execute — joins the `<style>` inert-element exemption.

  Added six FN-guard regression tests (incl. a non-highlighter `renderedHtml` and a present-tense `highlight*` with no library still firing). 56 tests total.

  ### Detection coverage (recall)

  Beyond precision, `dangerous-html-sink` was missing real DOM-XSS — a security rule must catch the dangerous cases, not just stay quiet. Added:

  - **More sinks** — alongside `dangerouslySetInnerHTML` and `innerHTML =`, the rule now flags `outerHTML =` assignments, `el.insertAdjacentHTML(position, html)` (the value is the second argument), `document.write(ln)(html)`, `Range.createContextualFragment(html)`, and the explicitly-unsafe `Element.setHTMLUnsafe(html)` (the sanitizing `setHTML` is intentionally not a sink).
  - **More taint sources** — the value-taint gate now recognizes the classic OWASP DOM-XSS sources it previously ignored: `location.hash`/`.search`/`.href`, `document.cookie`, `document.referrer`, `window.name`, `localStorage`/`sessionStorage`, and `URLSearchParams` (matched at word boundaries / on the source expression so identifier names like `themeLocalStorageKey` do not false-match).

  Verified against the cached corpus: the new sinks surface previously-missed real injections (e.g. `el.insertAdjacentHTML(pos, content)`, `node.outerHTML = html`, `document.write(editor.getContent())`) while the exemption pipeline and the `isGeneratedBundle` skip keep minified-vendor noise out. Added 7 detection tests (5 must-fire DOM-XSS cases + 2 still-silent guards for static `insertAdjacentHTML` and `outerHTML`-to-`outerHTML` serialization).

  A RDE parity pass against `main` surfaced three more false positives, now fixed:

  - **`mcp-tool-capability-risk`** keyed its surface on every MCP entry point, so it flagged `new McpServer({...})` construction and static `registerPrompt(...)` calls whenever the file mentioned any capability. It now only matches actual TOOL handlers (`server.tool(`, `registerTool(`, `setRequestHandler(CallToolRequestSchema)`) — model-controlled action surfaces — not construction, tool listing, prompts (message templates), or resources (read-only). Added a regressions test (FP guards for construction/prompt + true-positive tool handlers).
  - **`dangerous-html-sink`** now exempts capture-and-restore of a node's own serialized content (`const original = el.innerHTML; … el.innerHTML = original`) — restored markup never left the document — while still flagging a captured value concatenated with fresh input. It also recognizes Mermaid diagram output (`const svg = (await mermaid.render(...)).svg`) as escaping-serializer output, alongside KaTeX/Shiki/Prism.

  This hardens the 6 new security-scan rules (`dangerous-html-sink`, `clickjacking-redirect-risk`, `insecure-crypto-risk`, `mcp-tool-capability-risk`, `raw-sql-injection-risk`, `url-prefilled-privileged-action`) that landed in the posture scanner.

## 0.5.3

## 0.5.2

### Patch Changes

- [#766](https://github.com/millionco/react-doctor/pull/766) [`94f9f4f`](https://github.com/millionco/react-doctor/commit/94f9f4fe98207181958f82275b41d94963bc73a2) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Bump `engines.node` to `^20.19.0 || >=22.13.0` so the declared support range matches transitive dependencies (`eslint-scope@9`, `eslint-visitor-keys@5` require `^22.13.0`), preventing EBADENGINE warnings on npm and hard install failures on Yarn 1 under Node 22.12.x.

- [#784](https://github.com/millionco/react-doctor/pull/784) [`038aaf7`](https://github.com/millionco/react-doctor/commit/038aaf78c12f7f9a2699f46d3a6aa304dc69fc12) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a false positive in `nextjs-missing-metadata` ([#775](https://github.com/millionco/react-doctor/issues/775)): an App Router page is no longer flagged as "missing metadata for search previews" when it inherits `metadata` / `generateMetadata` from a co-located or ancestor `layout.*`. Next.js merges metadata down the segment chain, so a page covered by a parent layout's title/description already has search-preview metadata. The rule now walks up the App Router directory tree (bounded, stopping at `app/`) and stays quiet when an ancestor layout supplies metadata; pages with no metadata anywhere in the chain are still flagged.

- [#796](https://github.com/millionco/react-doctor/pull/796) [`fee3fc4`](https://github.com/millionco/react-doctor/commit/fee3fc436e502ad4a6609ab8bda9c9a782d8ecd7) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - `no-barrel-import` messaging is now framework-aware: files that target React Native / Expo (per the nearest `package.json` platform, native/web file extensions, and the project `framework` setting) say the barrel import "ships extra code in your app bundle & slows startup" instead of the web-only "slows page load" wording. Web projects, web-extension files inside RN monorepos, and projects with an unknown framework keep the existing page-load wording.

- [#782](https://github.com/millionco/react-doctor/pull/782) [`c4f0e60`](https://github.com/millionco/react-doctor/commit/c4f0e607b6092485d226c0d67c783270f4eec8b2) Thanks [@rayhanadev](https://github.com/rayhanadev)! - `only-export-components` now recognizes the route/special files of every file-routing framework react-doctor covers and skips them, so the documented "co-export config/metadata next to the default component" shape stops producing false-positive "non-component export" warnings:

  - **Next.js** — App Router (`page`, `layout`, `loading`, `error`, `not-found`, `template`, `default`, `global-error`, `route`) and Pages Router (`_app`, `_document`, `_error`) special files, plus metadata image routes (`opengraph-image`, `twitter-image`, `icon`, `apple-icon`, incl. numbered variants), which fixes the `alt` / `size` / `contentType` / `revalidate` exports in `opengraph-image.tsx` ([#776](https://github.com/millionco/react-doctor/issues/776)).
  - **Expo Router** — `_layout` and the `+html` / `+not-found` / `+native-intent` reserved files.
  - **TanStack Router / Start** — `__root` and `*.lazy` route modules.
  - **Remix / React Router** — `root`, `entry.client`, and `entry.server` modules.

- [#790](https://github.com/millionco/react-doctor/pull/790) [`f52bd07`](https://github.com/millionco/react-doctor/commit/f52bd0737527df9ab81f3746e64bdb5ac1defbc7) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix false positives in `rn-no-raw-text` ([#788](https://github.com/millionco/react-doctor/issues/788)) for custom components that forward their children into a `<Text>`: the in-file wrapper detection now recognizes components that render `{children}` (or `{props.children}`) inside a nested `<Text>` (the `<View><Text>{children}</Text></View>` shape), not just components whose returned root is a `<Text>`. Detection also handles parenthesized `return (...)` bodies, `memo`/`forwardRef`-wrapped components, fragment roots, conditional and logical returns, early returns inside `if` branches, renamed destructured children (`{ children: content }`), the `<Text children={children} />` prop form, wrappers that forward through another in-file wrapper, children aliased to a variable or destructured from props in the body, props spreads that carry children (`<Text {...props} />`, `<Text {...rest} />`, `<Text {...this.props} />`), class components, and `styled(Text)` / `styled.Text` factories. The rule is also tagged `test-noise`, so it no longer fires in test/story files — raw text rendered through React Native Testing Library never ships to users, and cross-file wrappers (an imported `<Chip>Test Chip</Chip>` in a `.test.tsx`) were the main source of unfixable noise there.

- [#794](https://github.com/millionco/react-doctor/pull/794) [`7c88165`](https://github.com/millionco/react-doctor/commit/7c8816575aff26f11b5099c7ef009c4793fe260f) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - `rules-of-hooks` and `exhaustive-deps` no longer report false positives for hooks called inside a `forwardRef(...)` / `memo(...)` render callback whose binding name is not PascalCase (e.g. `const _Wrapped = forwardRef((props, ref) => { useHook(); ... })`). The render callback passed as the first argument to React's HoCs is a component by construction, so both rules now treat it as one regardless of the variable name it lands on. Only the first argument is promoted — hooks inside `memo`'s second argument (the props comparator) still report, as do genuinely non-component functions like `const _helper = () => { useState(); }`.

## 0.5.1

### Patch Changes

- [#761](https://github.com/millionco/react-doctor/pull/761) [`77a70ab`](https://github.com/millionco/react-doctor/commit/77a70ab8a78dd21dc305a6c2b924e4bbc44058ce) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Stop flagging `only-export-components` on framework route modules ([#758](https://github.com/millionco/react-doctor/issues/758)).

  TanStack Router file routes (`export const Route = createFileRoute(...)({ component: ProfilePage })`) were reported even though the router's bundler plugin owns HMR for those modules. Route-factory exports (`createFileRoute`, `createLazyFileRoute`, `createRootRoute`, `createRootRouteWithContext`, data routers like `createBrowserRouter`, …) now count as component exports, and framework route-module contract exports (Remix / React Router `loader` / `action` / `meta` / …, Next.js Pages Router `getServerSideProps` / `getStaticProps` / …, App Router segment config, Expo Router `unstable_settings`) are allowed alongside components.

## 0.5.0

### Minor Changes

- [#756](https://github.com/millionco/react-doctor/pull/756) [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede) Thanks [@NisargIO](https://github.com/NisargIO)! - React Doctor now runs on repositories that don't depend on React. Previously a scan hard-failed with `No React project found` / `No React dependency`, even though many checks (security, bundle size, JS performance, architecture, and the Zod rules) are framework-agnostic and apply to any TypeScript / JavaScript codebase.

  A project is now analyzable when it has source files, with or without React. A bare directory of TypeScript files — including a monorepo's `packages/` subfolder that has no `package.json` of its own — is scanned by inheriting dependency/framework detection from the enclosing workspace root.

  React-flavoured rules stay off without React. A new `react` capability (set only when React or Preact is present) gates every React-runtime rule family (hooks, JSX, accessibility, render performance, React state) plus any rule tagged `react-jsx-only`, so hook/component-name heuristics like `rules-of-hooks`, `no-legacy-class-lifecycles`, and `no-nested-component-definition` can't false-fire on ordinary TypeScript. Once React (or Preact) is detected, every rule behaves exactly as before.

### Patch Changes

- [#725](https://github.com/millionco/react-doctor/pull/725) [`b4b79ad`](https://github.com/millionco/react-doctor/commit/b4b79addce225c47048127e04be2670c13bca332) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Stop flagging the inline-`renderItem` React Native perf rules on React Compiler projects.

  React Compiler auto-memoizes inline functions and objects in list rows, so these rules were noise on compiler-enabled projects ([#723](https://github.com/millionco/react-doctor/issues/723)). `rn-no-inline-flatlist-renderitem`, `rn-list-callback-per-row`, and `rn-no-inline-object-in-list-item` now ship with `disabledBy: ["react-compiler"]`, matching the `jsx-no-new-*-as-prop` family.

- [#735](https://github.com/millionco/react-doctor/pull/735) [`af98f83`](https://github.com/millionco/react-doctor/commit/af98f83614526cca30f3a31ec2507a5df5da2bed) Thanks [@aidenybai](https://github.com/aidenybai)! - Remove the `react-doctor/jsx-no-target-blank` rule because modern browsers implicitly apply `noopener` to `target="_blank"` links.

## 0.4.2

## 0.4.1

### Patch Changes

- [#713](https://github.com/millionco/react-doctor/pull/713) [`dc35070`](https://github.com/millionco/react-doctor/commit/dc35070a5066f9864a7565b952dec2f81bff1223) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - `only-export-components` now treats Expo Router `_layout.tsx` / `_layout.jsx` files as entry points (same as Next.js `layout.tsx`), so co-located helpers alongside a single wrapped default export no longer trigger false-positive "non-component export" warnings ([#708](https://github.com/millionco/react-doctor/issues/708)).

- [#704](https://github.com/millionco/react-doctor/pull/704) [`b1a22ef`](https://github.com/millionco/react-doctor/commit/b1a22efdf7b18f2cc8b7af6c0b12173ed3c76d34) Thanks [@aidenybai](https://github.com/aidenybai)! - refactor: extract the shared `isBooleanPrefixedPropName` predicate into a single-purpose util and reuse it in `no-many-boolean-props`. Behavior-preserving.

- [#709](https://github.com/millionco/react-doctor/pull/709) [`73dcb20`](https://github.com/millionco/react-doctor/commit/73dcb2040dc6aa207beea074f846fd675c30bd2b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix `nextjs-no-img-element` false positive in Next.js metadata image routes (`opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`). These files rasterize JSX via `next/og` and cannot use `next/image`. Also fix pre-existing `alt-text` bug where backslash paths on Windows were not normalized before the same metadata-route check.

- [#710](https://github.com/millionco/react-doctor/pull/710) [`64667da`](https://github.com/millionco/react-doctor/commit/64667dae16b812ad9b4304bd7906d5ddbb50921a) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix false positive in `no-unknown-property`: the `tw` attribute (used by `@vercel/og` / `next/og` for Tailwind CSS styling) is no longer flagged in Next.js metadata image route files (`opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`).

- [#714](https://github.com/millionco/react-doctor/pull/714) [`ee9ab33`](https://github.com/millionco/react-doctor/commit/ee9ab336d3b2918d319bc048b5b164f58611df83) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix false positives in `nextjs-no-use-search-params-without-suspense` and add cross-file detection. The rule now only fires on page/layout files and resolves imported components — via relative paths, tsconfig `@/` aliases, and barrel re-exports — to detect when a rendered component calls `useSearchParams()` without a `<Suspense>` boundary at the render site. A `<Suspense>` provided by an ancestor `layout.tsx`, the `<React.Suspense>` member form, and aliased `Suspense` imports are all recognized so correctly-wrapped pages aren't flagged.

- [#715](https://github.com/millionco/react-doctor/pull/715) [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Disable `server-fetch-without-revalidate` on Next.js 15+ projects. Next.js 15 changed the default fetch behavior from cached-forever to `no-store`, making the rule's warning obsolete. Adds Next.js version detection (workspace- and `catalog:`-aware, mirroring Expo/FlashList resolution) and the `nextjs:15` capability gate.

- [#688](https://github.com/millionco/react-doctor/pull/688) [`831cf3f`](https://github.com/millionco/react-doctor/commit/831cf3fbfd703f5048de5c2c3258e47988a2cce0) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Add `query-destructure-result` rule: flags `const result = useQuery(...)` where the whole TanStack Query object is assigned instead of destructured, bypassing tracked-property optimization.

## 0.4.0

## 0.3.0

### Minor Changes

- [#644](https://github.com/millionco/react-doctor/pull/644) [`eba20ae`](https://github.com/millionco/react-doctor/commit/eba20ae9a708af81c7d95dbdadf16c8e5c6d21f9) Thanks [@aidenybai](https://github.com/aidenybai)! - Demote 19 low-signal rules to opt-in (`defaultEnabled: false`) so the recommended preset focuses on correctness, performance, accessibility, and security instead of subjective style.

  - Subjective design / house-style preferences (now opt-in): `no-gradient-text`, `no-dark-mode-glow`, `no-pure-black-background`, `no-side-tab-border`, `no-wide-letter-spacing`, `no-justified-text`, `no-z-index-9999`, `design-no-em-dash-in-jsx-text`, `design-no-three-period-ellipsis`, `design-no-vague-button-label`, `design-no-redundant-padding-axes`, `design-no-redundant-size-axes`, `design-no-space-on-flex-children`.
  - Naming-convention preferences (now opt-in): `no-generic-handler-names`, `jsx-pascal-case`.
  - Legacy class-component / PropTypes rules that don't fire in a modern function-component + TypeScript codebase (now opt-in): `prefer-es6-class`, `no-default-props`, `no-prop-types`.
  - Deduplicated the array-index-key pair: `no-array-index-key` is now opt-in because it double-reported with the canonical `no-array-index-as-key` (Bugs category, friendlier message). Opt back into `no-array-index-key` only if you need its extra `React.cloneElement` coverage.

  Every rule still ships in the plugin and can be re-enabled via `severityControls` / config, so teams that adopted any of these as a deliberate house style keep them with a one-line opt-in.

### Patch Changes

- [#666](https://github.com/millionco/react-doctor/pull/666) [`5d7b36b`](https://github.com/millionco/react-doctor/commit/5d7b36bc315ba4c0a8ba6b60bd781a11efbed94f) Thanks [@aidenybai](https://github.com/aidenybai)! - Retires `rn-animate-layout-property`. Reanimated `useAnimatedStyle` runs entirely on the UI thread, so layout-affecting style animations driven by helpers like `withTiming` or `withSpring` are valid and should not be flagged.

## 0.2.18

## 0.2.17

## 0.2.16

## 0.2.15

### Patch Changes

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Collapse diagnostic categories into five clear, outcome-based buckets: **Security**, **Bugs**, **Performance**, **Accessibility**, and **Maintainability**. The previous fine-grained labels (Correctness, State & Effects, React Compiler, Next.js, React Native, Server, TanStack Query/Start, Preact → Bugs; Bundle Size → Performance; Architecture/Design → Maintainability) now roll up so the scan output reads as plain issue types at a glance.

  This changes the `category` value on every diagnostic (CLI output, the per-error headline prefix like `Security: Use of eval()`, and JSON/programmatic output). If you key `categories` severity overrides off the old names, update them to the new buckets. Dead-code findings (unused files/exports/dependencies, circular imports) now report `Maintainability` instead of `Dead Code`. Bundle-size findings now sort with `Performance` (higher stakes) rather than near the bottom of the top-errors block.

- [#630](https://github.com/millionco/react-doctor/pull/630) [`75c1f99`](https://github.com/millionco/react-doctor/commit/75c1f99e062a8fc3e5e4ba294208dbc56bca5f6f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `react-doctor@latest` (and the ESLint/oxlint plugins) crashing before the scan starts with `ERR_MODULE_NOT_FOUND: Cannot find package 'oxc-parser'` under strict package managers like pnpm. The published `oxlint-plugin-react-doctor/dist/index.js` performs a runtime `import { parseSync } from "oxc-parser"` (cross-file parsing for rules like `no-mutating-reducer-state`) and the build intentionally keeps `oxc-parser` external, but the package only declared it under `devDependencies`, so consumers never had it installed. `oxc-parser` is now a real `dependency`. See [#629](https://github.com/millionco/react-doctor/issues/629).

## 0.2.14

## 0.2.13

## 0.2.12

### Patch Changes

- [#570](https://github.com/millionco/react-doctor/pull/570) [`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the `no-prop-types` architecture rule. React 19 removed runtime `propTypes` validation entirely — React no longer reads `Component.propTypes`, so invalid props that used to log a console warning now pass silently. The rule flags `Component.propTypes = { ... }` assignments and `static propTypes` class fields on component-cased identifiers, and is version-gated to React 19+ (`requires: ["react:19"]`) so projects where `propTypes` still runs stay quiet. It steers users toward TypeScript prop types plus explicit runtime validation. See [#460](https://github.com/millionco/react-doctor/issues/460).

- [#572](https://github.com/millionco/react-doctor/pull/572) [`d0f5206`](https://github.com/millionco/react-doctor/commit/d0f52062e09c7bfe11eda2c06ad6e9ab0ab7da58) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the `react-doctor/no-self-updating-effect` rule. It warns when a `useEffect` / `useLayoutEffect` lists a state value in its dependency array and the effect body unconditionally calls that state's own `useState` setter with a value that never settles — a functional updater (`setCount((value) => value + 1)`), a freshly-constructed reference (`setItems([])`, `setUser({ ...user })`), or a value derived from the same state (`setCount(count + 1)`). Every commit re-runs the effect and re-sets the state, causing a render loop that `exhaustive-deps` does not catch because the dependency array is already complete. The rule stays quiet on mount-only `[]` effects, setters deferred inside timer/subscription/promise callbacks, guarded updates, and plausibly-stable scalar writes that settle via `Object.is` (`setOpen(true)`, `setTab(props.tab)`). See [#346](https://github.com/millionco/react-doctor/issues/346).

- [#582](https://github.com/millionco/react-doctor/pull/582) [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a `rn-no-raw-text` false positive on fbtee translation tags. fbtee's `<fbt>` / `<fbs>` (and namespaced children like `<fbt:param>`) are compile-time translation tags that disappear at build time, so text inside `<Text><fbt>…</fbt></Text>` is really rendered inside `<Text>` and is safe on React Native. The rule now treats `fbt` / `fbs` as transparent wrappers when every ancestor up to a text-handling component is also transparent, while still reporting raw text when an `<fbt>` is used outside a `<Text>` boundary. See [#581](https://github.com/millionco/react-doctor/issues/581).

## 0.2.11

### Patch Changes

- [#546](https://github.com/millionco/react-doctor/pull/546) [`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop `js-tosorted-immutable` from firing in React Native / Expo projects. Hermes (the default RN/Expo JS engine) hasn't shipped the ES2023 change-array-by-copy methods, so the rule's recommended `array.toSorted()` rewrite of `[...array].sort()` crashed at runtime with `TypeError: undefined is not a function`. The rule now carries `disabledBy: ["react-native"]`, so it only fires on projects whose engine supports `toSorted()`.

## 0.2.10

### Patch Changes

- Add Preact support and a dedicated Preact rule family. The new checks cover pure-Preact projects importing hooks from `react`, `children.length` usage, `render()` callback arguments, `onChange` where Preact expects `onInput`, and `onDoubleClick` where Preact expects `onDblClick`.

- Add HTML and accessibility checks for invalid paragraph children, invalid table nesting, nested interactive controls, and hand-rolled modals that should use the native `<dialog>` element.

- Add `hooks-no-nan-in-deps` to catch literal `NaN` and `Number.NaN` in hook dependency arrays before they wedge React or Preact dependency tracking.

- Add Jotai diagnostics for fresh objects returned from derived atoms, `selectAtom` creation inside render, and raw TanStack Query atom usage.

- Add React Native performance rules for `renderItem` keys, missing FlashList `estimatedItemSize`, Gesture Detector press targets that should be Pressable, and `ScrollView` content-container flex usage.

- Add `js-async-reduce-without-awaited-acc` for async reducers that forget to await the accumulator.

- Add `activity-wraps-effect-heavy-subtree`, gated to React 19.2+, to flag toggleable `<Activity>` boundaries wrapping same-file components with effects that will be torn down and recreated on hide/show cycles.

- Fix false positives in `control-has-associated-label` and `no-giant-component`; the giant-component rule now verifies React render output instead of flagging large non-React TypeScript modules.

## 0.2.9

### Patch Changes

- Published with the trusted-publishing workflow update. No rule behavior changed in this package.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

## 0.2.7

### Patch Changes

- Add `no-mutating-reducer-state` rule that flags direct mutations of `useReducer` state (e.g. `state.items.push(...)` or `state.count++` inside a reducer body) which silently break React's immutability contract.

- Consolidate ~30 duplicated utility functions (`isFunctionLike`, `findProgramRoot`, `flattenCalleeName`, `isAstDescendant`, `hasJsxKeyAttribute`, `containsJsx`, `compileGlob`, `collectPatternNames`, `flattenJsxName`, `isAllLiteralArrayExpression`, `getCallMethodName`, etc.) into canonical shared modules under `src/plugin/utils/`, eliminating hundreds of lines of redundant code across rule files.

## 0.2.6

### Patch Changes

- Remove `design-no-bold-heading` rule - the heuristic of flagging `font-bold` on headings produced too many false positives in design systems where headings intentionally vary weight.

## 0.2.5

### Patch Changes

- Stop `jsx-key` from flagging shorthand JSX fragments (`<>...</>`) which cannot accept a `key` prop - only `React.Fragment` with explicit syntax supports keys.

- Normalize static template literal handling so rules that inspect string values treat `` `hello` `` the same as `"hello"` instead of skipping template literals with no expressions.

- Fix Node 20 runtime dependency support so the plugin resolves correctly in environments without Node 22+ built-ins.

## 0.2.4

### Patch Changes

- Adopt Effect v4 runtime throughout the core engine - tagged error classes, `Context.Service` dependency injection, and `Effect.gen` generator-based control flow replace the previous imperative error-handling approach.

- Collapse `@react-doctor/types` and `@react-doctor/project-info` into `@react-doctor/core`, simplifying the dependency graph from five workspace packages to three.

- Support user-plugin extension via `config.plugins: [...]` for custom lint rules that run alongside the built-in rule set.

- Drop deprecated `@types/eslint-scope` and `@types/eslint-visitor-keys` stubs.

- Security audit: fix four pre-existing findings (dependency pinning, permission tightening, fork guards on CI workflows).

## 0.2.3

### Patch Changes

- Fix vite build configuration for bundling workspace dependencies so the published package resolves internal imports correctly.

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

## 0.2.1

### Patch Changes

- Make filesystem walks tolerate EPERM/EACCES (macOS Library)

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

## 0.2.0-beta.6

### Minor Changes

- Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

## 0.2.0-beta.5

### Patch Changes

- [#252](https://github.com/millionco/react-doctor/pull/252) [`2d90c1c`](https://github.com/millionco/react-doctor/commit/2d90c1c5ae6d901913a575d40a784058478479ec) - `no-secrets-in-client-code` is scoped to client-reachable bindings.
  The rule no longer reports on values inside `server-only` /
  `"use server"` modules, on identifiers behind a public env-var prefix
  (`NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*`, etc.), or on bindings
  classified by the new file-exposure classifier as never reaching the
  client bundle. Adds `classify-secret-file-exposure.ts`,
  `is-inside-server-only-scope.ts`, and a 561-line regression suite
  covering the removed false-positive shapes.

- [#260](https://github.com/millionco/react-doctor/pull/260) [`b53d873`](https://github.com/millionco/react-doctor/commit/b53d8730459d2dc469a8f9841def231048c8de7e) - `nextjs-no-side-effect-in-get-handler` stops flagging
  `response.headers.set(...)` and locally-constructed `Map` / `Set` /
  `Headers` inside `GET` handlers - those are the response builder,
  not a side effect. The same locally-scoped-safe-bindings classifier
  is reused by `server-auth-actions` and the TanStack Start
  `get-mutation` rule, so safe local mutations no longer trip any of
  the three. The rule still flags writes to module-scoped bindings,
  cookie stores, and external clients.

- [#265](https://github.com/millionco/react-doctor/pull/265) [`18b7033`](https://github.com/millionco/react-doctor/commit/18b7033e9e9e6f45a13c1545c8c505922bd4ab8f) - `async-defer-await` no longer reports three legitimate shapes:
  awaits inside destructured patterns with defaults
  (`const { a = await fallback() } = …`), bare
  `await expressionStatement;` that early-returns, and awaits guarded
  by an `if (…) return …` short-circuit earlier in the function. New
  helpers `collect-pattern-default-reference-names`,
  `collect-reference-identifier-names`, `contains-direct-await`,
  `is-bare-await-expression-statement`, and
  `is-early-exit-if-statement` drive the analysis, with a 409-line
  regression suite.

- [#269](https://github.com/millionco/react-doctor/pull/269) [`838c7f4`](https://github.com/millionco/react-doctor/commit/838c7f4174eaa9a7d0aea26d7e618bcc30818315) - `js-length-check-first` detects length guards anywhere earlier in an
  `&&` chain, not just as the immediate left operand. A guard like
  `obj && obj.items && obj.items.length > 0 && obj.items[0].id` no
  longer false-positives on the `[0]` access because the chain is
  flattened (`flatten-logical-and-chain`) and earlier operands are
  collected (`collect-earlier-and-guard-operands`) before the rule
  decides.

- [#270](https://github.com/millionco/react-doctor/pull/270) [`4cbf436`](https://github.com/millionco/react-doctor/commit/4cbf4368485b91f85701b3eed177282006b69fbc) - `async-parallel` is suppressed in three legitimate contexts: test
  files (`*.test.*` / `*.spec.*` / `__tests__/`, plus calls under
  `describe` / `it` / `test` / `beforeEach` / `afterEach` /
  `vi.*` / `jest.*`), browser-fixture / Playwright helpers
  (`page.*`, `browserContext.*`, `expect.*` chains), and ordered UI
  flows where serial awaits are deliberate. A new
  `is-test-library-import-source` helper recognises Vitest, Jest,
  Mocha, Playwright, and Cypress imports.

- [#272](https://github.com/millionco/react-doctor/pull/272) [`d821ca2`](https://github.com/millionco/react-doctor/commit/d821ca2a82aa5e0eae0a8de0da32123fc1b89102) - `js-combine-iterations` skips lazy `Iterator` helper chains.
  `Iterator.from(...)`, `(...).values()` /
  `(...).entries()` / `(...).keys()` followed by
  `Iterator.prototype.{map,filter,take,drop,flatMap,reduce,forEach,toArray}`
  are evaluated lazily - collapsing them into a single pass changes
  observable behaviour. The previous heuristic mis-flagged these as
  eager `Array.prototype` chains. Resolves [#205](https://github.com/millionco/react-doctor/issues/205).

- [#274](https://github.com/millionco/react-doctor/pull/274) [`3b7cc7c`](https://github.com/millionco/react-doctor/commit/3b7cc7c37336b21e4c0292dbb123b762b10a9a87) - `no-prevent-default` is framework-aware. Remix and Next.js
  progressive-enhancement form handlers (where `event.preventDefault()`
  is required to keep the client-side handler in control), synthetic
  events that have no documented alternative, and form `onSubmit`
  handlers that subsequently call `fetch` / a server action are no
  longer flagged. Backed by a 775-line regression suite covering the
  framework-specific shapes.

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

## 0.2.0-beta.4

No behavioural change in this package; published alongside the
`react-doctor` runtime-dependency fix in beta.4.

## 0.2.0-beta.3

### Patch Changes

- [#253](https://github.com/millionco/react-doctor/pull/253) [`9783acf`](https://github.com/millionco/react-doctor/commit/9783acf525a30a4aa69b20bf37b893bb39b362b0) - `no-barrel-import` resolves each `index.{ts,tsx,js,jsx,mjs,cjs}`
  module's actual export surface (`export * from …`,
  `export { x } from …`, default re-exports) and rewrites diagnostics
  to point at the relative path of the underlying file, instead of
  guessing from the import path. Direct imports of a file whose
  basename happens to be `index.ts` are no longer mis-classified as
  barrel imports. Adds `is-barrel-index-module`,
  `does-module-export-name`, `parse-export-specifiers`,
  `resolve-barrel-export-file-path`, `resolve-relative-import-path`,
  `create-relative-import-source`, and `strip-js-comments` helpers,
  with regression coverage in `tests/run-oxlint/bundle-size.test.ts`.

## 0.2.0-beta.2

### Minor Changes

- [#249](https://github.com/millionco/react-doctor/pull/249) [`f0198e2`](https://github.com/millionco/react-doctor/commit/f0198e2f2d9560a15bdb4a78f4a378ca2ac5fcdd) - **Plugin restructured into per-rule modules.** The kitchen-sink
  `src/plugin/rules/**.ts` files have been split so each rule lives in
  its own file under
  `src/plugin/rules/<category>/<rule-name>.ts`, with a generated
  `src/plugin/rule-registry.ts` wiring them together and shared
  utilities under `src/plugin/utils/**`. The plugin's published
  surface (`src/index.ts`, `rules-by-framework.ts`, `types.ts`) is
  unchanged - consumers that imported the default export continue to
  work - but rule authors writing custom shims should consult the new
  per-file layout. Companion PRs:
  [#218](https://github.com/millionco/react-doctor/pull/218) (initial
  per-file split),
  [#228](https://github.com/millionco/react-doctor/pull/228) /
  [#230](https://github.com/millionco/react-doctor/pull/230) /
  [#231](https://github.com/millionco/react-doctor/pull/231) /
  [#234](https://github.com/millionco/react-doctor/pull/234)
  (colocate severity / framework / category / requires / examples
  with each `defineRule` call),
  [#229](https://github.com/millionco/react-doctor/pull/229) (port
  inline `node.type === "X"` checks to `isNodeOfType(node, "X")`),
  [#235](https://github.com/millionco/react-doctor/pull/235) (drop
  loose `[key: string]: any` escape hatch from `EsTreeNode`),
  [#236](https://github.com/millionco/react-doctor/pull/236) (split
  `rule-maps.ts` into external-plugin-rules + react-doctor-rules),
  and [#242](https://github.com/millionco/react-doctor/pull/242)
  (auto-register rules via codegen).

### Patch Changes

- [#208](https://github.com/millionco/react-doctor/pull/208) [`8556b31`](https://github.com/millionco/react-doctor/commit/8556b31d8e4e165f791db0aa60a6b038b18ec777) - **User-feedback sweep.** Reduce false positives across the design /
  Tailwind / state-and-effects rule families, surface each rule's
  contribution to the project score, and add per-rule severity +
  rule-set selection config options. Closes the bulk of the
  feedback collected on 0.1.x.

- [#254](https://github.com/millionco/react-doctor/pull/254) [`bfaf9c9`](https://github.com/millionco/react-doctor/commit/bfaf9c9530a9f8761df6e2d69abcf44c1699ff77) - React-19-only rules
  (`prefer-use-effect-event`, the React-19 migration rule family) are
  now gated on the project's detected React major version. They stay
  silent on React 18 projects, on workspaces whose direct `react`
  dependency is `<19`, and on monorepos where the root resolution
  pins React 18 - eliminating a major source of "rule doesn't apply
  to my codebase" noise. Backed by a 343-line discover-project test
  suite and additional `parse-react-major` /
  `parse-react-peer-range` coverage.

- [#255](https://github.com/millionco/react-doctor/pull/255) [`6bc33c8`](https://github.com/millionco/react-doctor/commit/6bc33c8aab2be7c7254ce9f2a059acbcdad17a58) - `rerender-state-only-in-handlers` /
  `no-event-trigger-state` treat early-return guards
  (`if (state) return …`) as render-reachable state reads. Values
  consumed only to gate the render output no longer get reclassified
  as handler-only state, so the "use `useRef` because this state is
  never read in render" hint stops firing on guarded render paths.
  Powered by new scope-aware reference collectors
  (`scope-aware-reference-names`,
  `collect-render-reachable-expressions`,
  `collect-render-reachable-names`,
  `collect-function-like-local-names`) and an 887-line regression
  suite.

- [#256](https://github.com/millionco/react-doctor/pull/256) [`0cd9355`](https://github.com/millionco/react-doctor/commit/0cd93551a4a4600282378125d9aa237ef655835a) - `no-effect-event-handler` narrows what counts as an event handler.
  DOM imperatives (`document.classList.add/remove/toggle`,
  `el.scrollIntoView`, …), prop callbacks invoked from inside an
  effect, and side effects routed through a stable ref are no longer
  reclassified as handler-only. Adds
  `find-triggered-side-effect-callee-name` and
  `has-document-class-list-mutation` helpers and a 490-line
  regression suite.

- [#257](https://github.com/millionco/react-doctor/pull/257) [`ffbd20f`](https://github.com/millionco/react-doctor/commit/ffbd20f3d0ebda2221d2ea93f87342165da90fdb) - Locally-defined functions whose name starts with `use…` (custom
  helpers that are not React hooks) no longer trigger
  rules-of-hooks-style diagnostics. Also lands two new typography
  rules: `no-em-dash-in-jsx-text` (em / en dashes in JSX text are
  flagged with a fix that emits `--`) and
  `no-three-period-ellipsis` (now skipped inside `<pre>` / `<code>`
  ancestors via `is-inside-excluded-typography-ancestor`). Backed by
  a 445-line `rules-of-hooks-local-use` regression suite.
