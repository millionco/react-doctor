# Rule Candidates Backlog

Synthesized from a 12-cluster mining pass over `~/Developer/brain` (react-dev, Kent C. Dodds,
React perf, web perf, Next/Vercel RSC, security, React Native, modern-web, Solid, deep a11y,
ui.sh components, design/motion). ~200 raw candidates → deduped, cross-corroborated, and flagged
against the current ~391-rule inventory.

Legend: **corro** = number of independent clusters that proposed it (higher = safer signal).
Precision: `syntax` | `scope` (needs binding/import resolution) | `path` (needs control flow).
Each is statically detectable with the noted false-positive risk. Already-shipped this branch is
excluded; overlaps with existing rules are flagged.

---

## Tier S — implement next (cross-corroborated, low-FP, clearly new)

1. **`no-call-component-as-function`** — calling a component as a plain function (`Foo(props)`) instead of `<Foo />`; breaks hooks/identity/memoization. scope · **low** FP. _(corro 3: react-dev, kent, react-perf)_
   - `Sidebar(props)` → `<Sidebar {...props} />`
2. **`no-async-effect-callback`** — `useEffect(async () => …)` (effect cleanup gets a Promise, races on unmount). scope · **low**. _(corro 2: kent, solid as framework-agnostic)_
   - `useEffect(async () => { await load() }, [])` → define an inner async fn and call it.
3. ~~**`img-missing-dimensions`**~~ — **dropped, not statically sound.** width/height attrs are only one way to reserve space; CSS `aspect-ratio`/container sizing work too and live in stylesheets a linter can't see. This is a runtime check (Lighthouse `unsized-images`), not a static one. _(corro 3, but defeated by CSS invisibility)_
4. **`no-json-parse-stringify-clone`** — `JSON.parse(JSON.stringify(x))` deep clone (slow, drops Dates/Map/undefined). syntax · **low**. _(corro 2: react-perf, web-perf)_ → `structuredClone(x)`.
5. **`no-create-ref-in-function-component`** — `createRef()` in a function component (new ref every render) → `useRef`. scope · **low**. _(corro 2: react-dev, kent)_
6. **`no-set-state-in-usememo`** — calling a setter inside `useMemo`/`useCallback` factory (side effect in render). path · **low**. _(corro 2: react-dev, kent)_
7. **`no-props-mutation`** — assigning to `props.x` / mutating a prop object. path · **low-med**. _(corro 2: react-dev, kent)_
8. **`dialog-has-accessible-name`** — `<dialog>` / `role="dialog"` with no `aria-label`/`aria-labelledby`. syntax · **low**. _(corro 2: modern-web, a11y-deep)_
9. **`no-aria-label-on-generic-element`** — `aria-label` on a non-interactive, role-less `<div>`/`<span>` (ignored by AT). scope · **med** (skip role/tabindex). _(corro 1: a11y-deep)_ — complements shipped `no-uninformative-aria-label`.
10. **`auth-token-in-web-storage`** — writing a token/JWT/secret-named value to `localStorage`/`sessionStorage` (XSS-exfiltratable). scope · **med**. _(corro 1: security)_ — high severity.

## Tier A — strong, new, low/med FP

### Correctness / React

- **`no-object-or-array-literal-as-key`** — `key={{…}}`/`key={[…]}`/`key={obj}` (new identity each render → remount). syntax · low. _(kent)_
- **`no-state-initialized-from-prop-without-key`** — `useState(props.x)` as the only sync (stale on prop change). scope · med. _(kent; overlaps `no-derived-state` family — verify before building)_
- **`no-ref-current-in-render`** — reading/writing `ref.current` during render (not in effect/handler). path · med. _(react-dev)_
- **`no-module-level-mutable-in-component`** — reassigning a module-scope `let` from render. scope · med. _(react-dev)_
- **`no-jsx-element-in-usememo`** — `useMemo(() => <X/>, …)` (memoizing elements is usually wrong). syntax · med. _(kent)_

### Performance

- **`no-subscription-in-render`** — `.subscribe()` / `addEventListener` called in render body. path · low. _(react-perf)_
- **`no-storage-access-in-render`** — `localStorage.getItem`/`document.cookie` read in render (sync I/O + hydration mismatch). path · med. _(react-perf; corroborates web-perf)_
- **`no-window-size-in-render`** — `window.innerWidth`/`matchMedia().matches` in render (hydration mismatch). path · med. _(react-perf, react-native web analog)_
- **`no-accumulator-spread-in-reduce`** — `arr.reduce((acc,x)=>({...acc,…}),{})` O(n²). path · med. _(web-perf)_
- **`no-new-instance-as-prop`** — `new Date()`/`new RegExp()`/`new Intl.*` literal in JSX prop. syntax · med. _(react-perf; sibling of jsx-no-new-object-as-prop)_

### Web platform / perf

- **`no-document-write`** — `document.write(…)`. syntax · low. _(web-perf)_
- **`no-sync-xhr`** — `new XMLHttpRequest(); …open(…, false)`. scope · low. _(web-perf)_
- **`no-blocking-sync-dialog`** — `alert()`/`confirm()`/`prompt()`. syntax · med (dev usage). _(web-perf)_
- **`iframe-missing-lazy-loading`** — `<iframe>` without `loading="lazy"`. syntax · low-med. _(web-perf)_
- **`no-img-lazy-with-high-fetchpriority`** — `<img loading="lazy" fetchPriority="high">` (contradiction; LCP). syntax · low. _(modern-web)_
- **`img-srcset-requires-sizes`** — `<img srcset>` (or `<source>`) without `sizes`. syntax · low. _(modern-web)_
- **`link-preload-missing-as`** / **`link-font-preload-missing-crossorigin`** — `<link rel="preload">` correctness. syntax · low. _(web-perf)_
- **`no-wildcard-namespace-import`** — `import * as X from "<known-large pkg>"` (tree-shaking-hostile; needs a pkg allowlist). scope · med. _(web-perf)_

### Forms (modern-web + a11y, strongly corroborated)

- **`no-type-number-for-formatted-input`** — `<input type="number">` for phone/OTP/card/zip (use `inputmode`+`type=text`). scope · med. _(modern-web, a11y-deep)_
- **`prefer-input-type-email-tel`** — email/tel field as `type="text"` with no `inputMode`. scope · med. _(modern-web)_
- **`password-input-requires-autocomplete`** — `<input type="password">` without `autoComplete` (`current-password`/`new-password`). syntax · med. _(modern-web)_
- **`no-autocomplete-off-on-identity-field`** — `autoComplete="off"` on name/email/address fields. syntax · med. _(modern-web, a11y-deep)_

### Accessibility (beyond jsx-a11y)

- **`role-img-requires-name`** — `role="img"` without `aria-label`. syntax · low. _(a11y-deep)_
- **`fieldset-requires-legend`** — `<fieldset>` without `<legend>`. syntax · low-med. _(a11y-deep)_
- **`no-filename-alt-text`** — `alt="hero.png"` / `alt="IMG_1234"` (filename as alt). syntax · low. _(a11y-deep)_
- **`no-redundant-live-region`** — `aria-live` on a `role="alert"`/`status` (double-announce). syntax · low. _(a11y-deep)_

### Security (mostly `scan` rules over config/non-linted files)

- **`supabase-service-role-key-in-client`** — service-role key referenced in client code. scan · low. _(security)_ — high severity.
- **`firebase-admin-sdk-in-client`** — `firebase-admin` imported in client bundle. scope · low. _(security)_ — high severity.
- **`jwt-verify-unpinned-algorithm`** — `jwt.verify` without an `algorithms` allowlist. scope · med. _(security; extends existing jwt-insecure-verification)_
- **`disabled-tls-certificate-validation`** — `rejectUnauthorized: false` / `NODE_TLS_REJECT_UNAUTHORIZED=0`. syntax · low. _(security)_
- **`unsafe-native-deserialization`** — `node-serialize.unserialize`/`vm.runIn… (untrusted)`. scope · med. _(security)_
- **`client-controlled-open-redirect`** — `location.href = <req/searchParams value>`. path · med. _(security)_

### Motion / design (design-deferred — verdict SHIP)

- **`no-tailwind-will-change`** — static `will-change-*` class. syntax · med. _(extends shipped inline `no-permanent-will-change`)_
- **`no-tailwind-long-duration`** — `duration-[>1000ms]` / `duration-1000`+ on a transition. syntax · low. _(extends `no-long-transition-duration` to Tailwind)_
- **`no-animate-presence-child-without-key`** — conditional `<motion.*>` inside `<AnimatePresence>` lacking `key` (exit silently breaks). scope · med. _(design-deferred, react-perf)_
- **`no-high-bounce-spring`** — framer `transition={{ type:"spring", bounce:>0.3 }}` on UI. scope · med. _(design-deferred)_
- **`no-linear-ease-on-transition`** — `ease-linear` on a non-loop transition. syntax · med (loops). _(design-deferred)_
- **`no-uppercase-subunit-leading`** — `uppercase` + `leading-none`/`<1.0` (cap collision on wrap). syntax · low. _(design-deferred, hallmark gate 55)_

### ui.sh components (Tailwind/structure)

- **`no-unshrinkable-flex-icon`** — icon (svg/`*Icon`) in a `flex` row without `shrink-0` next to text. scope · med. _(uidotsh ★)_
- **`no-truncate-without-min-w-0`** — `truncate` on a flex child without `min-w-0` (won't truncate). scope · med. _(uidotsh)_
- **`no-hover-on-non-interactive`** — `hover:*` styles on a non-interactive, role-less element. scope · med-high. _(uidotsh)_
- **`no-xmlns-on-inline-svg`** — `xmlns` on an inline JSX `<svg>` (redundant bytes). syntax · low. _(uidotsh)_
- **`design-no-emoji-in-jsx-text`** — emoji glyph as UI text/icon. syntax · med → default-off. _(uidotsh, design-deferred)_

### React Native (Tier 1)

- **`rn-animated-missing-use-native-driver`** — `Animated.timing/spring` without `useNativeDriver`. scope · low. _(rn)_
- **`rn-no-virtualized-list-in-scrollview`** — `<FlatList>`/`<FlashList>` inside `<ScrollView>` (kills virtualization). scope · low. _(rn)_
- **`rn-no-animated-value-in-render`** — `new Animated.Value()` in render body (use `useRef`). path · low. _(rn)_
- **`rn-modal-missing-on-request-close`** — `<Modal>` without `onRequestClose` (Android back). syntax · low. _(rn correctness)_
- **`rn-no-onpress-on-view`** — `onPress` on `<View>` (no-op; use `Pressable`). syntax · low. _(rn)_

## Tier B — Solid-dialect family (product decision)

React Doctor currently _skips_ Solid/Qwik files (`react-jsx-only` tag). `eslint-plugin-solid` is a
ready-made, battle-tested rule set we could port behind a `solid` capability — a net-new surface,
not a few rules. Highest-value: **`solid-no-destructure-props`** (breaks reactivity),
**`solid-signal-read-uncalled-in-jsx`** (`{count}` vs `{count()}`), **`solid-no-react-specific-props`**
(`className`/`htmlFor`→`class`/`for`), **`solid-no-react-deps`** (passing a deps array to `createEffect`),
**`solid-prefer-for`** (`<For>` over `.map`), **`solid-no-derived-state-effect`**. Plus the
framework-agnostic **`no-async-effect-callback`** (already in Tier S).

## Already covered / drop (dedupe catches)

- `no-viewport-zoom-disabled` → **EXISTS** (`no-disabled-zoom`).
- `no-set-state-as-dom-event-handler`, `no-side-effects-in-reducer`, `no-state-mutation-in-updater` → overlap `no-set-state-in-render` / `no-mutating-reducer-state` family; verify before building.
- `no-tabular-nums-on-numeric-cell`, `no-nonconcentric-nested-radius` → need cell-type/geometry; default-off at best.
- `next-image-dangerously-allow-svg`, `graphql-introspection-enabled-in-prod`, `cors-credentialed-origin-reflection` → niche security scan; lower priority.

## Skip — too noisy / not statically sound (from the deferred pass)

`no-named-line-height` (`leading-tight` is often fine), `no-inline-static-style`, `no-arbitrary-over-bare-value` (`z-[999]`→`z-999`), `no-straight-quotes-in-jsx` (apostrophes), `no-cliche-purple-gradient` (opinionated; default-off only), `no-uniform-hover-scale` (cross-element, not per-element), `heading-order` (~50% static precision).

---

### Recommended next implementation batch (highest signal × lowest noise) — SHIPPED (7)

`no-call-component-as-function`, `no-async-effect-callback`, `no-json-parse-stringify-clone`,
`no-create-ref-in-function-component`, `dialog-has-accessible-name`, `auth-token-in-web-storage`,
`no-img-lazy-with-high-fetchpriority` — all syntax/scope-only, low-FP, each grounded in ≥1 (mostly
≥2) sources and orthogonal to the existing rules. Implemented with adversarial tests + FP-regression
coverage (incl. scope-resolution shadow-safety) on branch `add-mined-correctness-perf-a11y-rules`.

**Dropped from the batch: `img-missing-dimensions`** — a static linter cannot see CSS, and width/
height attributes are only _one_ of several valid ways to reserve space (CSS `aspect-ratio`,
container sizing, CSS width/height all work). Lighthouse's `unsized-images` audit makes this call at
runtime against computed styles; a syntax rule would false-positive on every image sized by an
external/global stylesheet. Moved to the not-statically-sound list below.

> Raw per-cluster candidate detail (bad/good for all ~200) was produced in `/tmp/rd-mine/*.md`
> (ephemeral). Ask to persist any cluster's full detail into the repo if needed.
