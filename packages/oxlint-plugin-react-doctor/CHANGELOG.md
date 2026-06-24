# oxlint-plugin-react-doctor

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
