# React Doctor / React Review TODOs

## P0 - Trust-Breaking False Positives

### [ ] Fix `nextjs-no-side-effect-in-get-handler` false positives

Status: confirmed current, open.

Links:

- Issue: https://github.com/millionco/react-doctor/issues/206
- PRs: https://github.com/millionco/react-doctor/pull/209, https://github.com/millionco/react-doctor/pull/211, https://github.com/millionco/react-doctor/pull/233, https://github.com/millionco/react-doctor/pull/238, https://github.com/millionco/react-doctor/pull/251

Repro:

```ts
export async function GET(req: NextRequest, ctx: RouteContext) {
  const res = await v2GET(req, ctx);
  res.headers.set("X-Deprecated", "Use /api/v2/documents/[id]");
  return res;
}
```

Why it matters:

- One Next.js 14 codebase got 138 errors.
- Reporter said 0 were real side effects.
- Workaround required 138 inline suppressions.

Fix:

- Skip `response.headers.set/append/delete`.
- Skip local request-scoped `Map` / `Set` created inside the handler.
- Decide and document `cookies().set()` / `headers().set()` semantics.
- Keep reporting real DB/cache/process-global writes and mutating `fetch()`.
- Add regressions for `Response`, `NextResponse`, local `Map`, real `db.update().set()`, mutating `fetch()`, and mutating route segments like `/logout`.
- Pick one PR path and close duplicate fixes.

### [ ] Fix `server-auth-actions` member-expression auth calls

Status: confirmed current, open.

Links:

- Issue: https://github.com/millionco/react-doctor/issues/239
- PR: https://github.com/millionco/react-doctor/pull/240

Repro:

```ts
await auth0.getSession();
```

Why it matters:

- Reporter saw 139 false positives.
- Current check only accepts bare identifiers:

```ts
isNodeOfType(callNode?.callee, "Identifier") && AUTH_FUNCTION_NAMES.has(callNode.callee.name);
```

Fix:

- Accept member calls whose final property is in `AUTH_FUNCTION_NAMES`.
- Cover `auth0.getSession()`, `ctx.auth.getUser()`, `clerkClient.getUser()`, `session.auth()`.
- Add project config allowlist for custom auth guards.
- Avoid unrelated false positives like `analytics.getUser()`.

### [ ] Fix `async-defer-await` destructuring false positive

Status: confirmed current, open.

Link: https://github.com/millionco/react-doctor/issues/241

Repro:

```ts
const [flowRow] = await db.select().from(flowsTable).where(eq(flowsTable.seq, flowSeq)).limit(1);

if (!flowRow) return [];
```

Fix:

- Add recursive binding collection for `ArrayPattern`, nested patterns, rest elements, and assignment patterns.
- Add tests for `[row]`, `[, row]`, `[row = fallback]`, `{ rows: [row] }`.

### [ ] Suppress async parallelization advice in tests and ordered UI flows

Status: confirmed current.

Sources:

- Screenshot: `async-parallel` in `SettingsPanels.browser.tsx`.
- Screenshot: ordered test-like `render -> expect -> click -> expect`.
- Dogfood issues: https://github.com/millionco/react-doctor/issues/216, https://github.com/millionco/react-doctor/issues/219
- Related PR: https://github.com/millionco/react-doctor/pull/238

Current problem:

- `async-parallel.ts` uses a narrow local `TEST_FILE_PATTERN`.
- It misses `tests/`, `test/`, `__tests__/`, `e2e/`, `playwright/`, `cypress/`, fixtures, mocks, and `.browser.tsx`.
- It is not tagged `test-noise`, so shared test suppression does not apply.
- Dogfood warnings also include intentional `async-await-in-loop` animation/delay sequences.

Fix:

- Tag `async-parallel` as `test-noise` or use shared `isTestFilePath()`.
- Suppress in files importing Playwright, Testing Library, Vitest, Jest, or browser test helpers.
- Do not parallelize `render`, `expect`, `locator.click`, `page.click`, setup/teardown, or ordered UI assertions.
- Allow intentional animation/demo sequencing or require documented inline suppression.
- Add regression for render/assert/click/assert.

### [ ] Stop React Native rules in web-only packages

Status: confirmed current.

Sources:

- Screenshot: `rn-no-raw-text` in `apps/web/src/components/ThreadTerminalDrawer.tsx`.
- Issues: https://github.com/millionco/react-doctor/issues/93, https://github.com/millionco/react-doctor/issues/100, https://github.com/millionco/react-doctor/issues/180, https://github.com/millionco/react-doctor/issues/183

Current problem:

- `rn-no-raw-text.ts` only skips `.web.[jt]sx?` and `"use dom"`.
- It does not understand `apps/web/**` or package framework boundaries.
- `rawTextWrapperComponents` helps RN wrappers, not web-package scoping.

Fix:

- Scope RN rules to packages detected as React Native / Expo.
- Skip RN rules in web, docs, Storybook, Docusaurus, Next/Vite/React DOM packages.
- Add mixed-monorepo fixture: `apps/web` plus `apps/native`.
- Add `Platform.OS === "web"` branch handling for cross-platform files.

### [ ] Make `no-prevent-default` framework-aware

Status: confirmed current.

Source:

- Screenshot: SPA/client-only app got server-action advice for `<form onSubmit preventDefault()>`.

Current problem:

- `no-prevent-default.ts` always recommends server actions for form submit handlers.
- It has no framework/server-capability gate.

Fix:

- Split generic form semantics from server-action advice.
- Only recommend server actions in server-capable frameworks.
- In SPA/client-only apps, suppress the form variant or use client-appropriate wording.
- Keep `<a onClick preventDefault()>` guidance separate.
- Add regressions for Vite SPA, Next App Router, and dialog/local-only forms.

### [ ] Fix `js-length-check-first` guard detection

Status: confirmed current.

Source:

- Screenshot: `.every()` warning fired even though the same condition already checked length equality.

Current problem:

- Rule checks only nearest logical expression's immediate `left`.
- It misses length guards inside larger `&&` chains.

Fix:

- Flatten surrounding `&&` chains.
- Search previous operands for matching length equality.
- Confirm `.every()` receiver and indexed array match the guard.
- Add regression with screenshot shape.

### [x] Fix `js-combine-iterations` on lazy Iterator helpers

Status: fixed.

Links:

- Issue: https://github.com/millionco/react-doctor/issues/205
- Superseded PR: https://github.com/millionco/react-doctor/pull/212

Repro:

```ts
const oddDoubles = numbers
  .values()
  .filter((value) => value % 2 === 1)
  .map((value) => 2 * value)
  .toArray();
```

Done:

- Walks the chain inward from the inner call's receiver, treating `.values()`/`.keys()`/`.entries()` (on non-`Object` receivers), `Iterator.from(...)`, and syntactically-declared generators (`function* gen() {}`, `const gen = function*() {}`) as iterator-rooted and skipping the rule.
- Continues past chainable iteration methods (`map`/`filter`/`flatMap`/`forEach`); stops at unknown / materializing calls (`.toArray()`, `Array.from(...)`, plain identifiers) so eager array chains keep firing.
- Excludes `Object.values/keys/entries(...)` from iterator detection because they return arrays.
- Regression coverage in `tests/regressions/js-performance-rules.test.ts` for eager arrays (still flagged), `.values/.keys/.entries` on Map/Set/array (not flagged), `Object.*` (still flagged), `.toArray()` and `Array.from()` materialization (still flagged), `Iterator.from()`, hoisted and const-bound generators, optional chaining, `.flatMap()` walks, the existing Boolean / identity filter exclusions, and a documented imported-generator false positive.

### [ ] Demote design/Tailwind cleanup from default PR comments

Status: confirmed current.

Source:

- Screenshot: `w-5 h-5 -> size-5` from `design-no-redundant-size-axes`.
- Feedback: weak signal from a "React reviewer."

Fix:

- Make `design` rules opt-in, score-neutral, collapsed, or hidden from PR comments by default.
- Add category/surface controls for CLI, PR comments, score, and CI failure.
- Keep Tailwind version gating, but do not let style cleanup dilute React findings.

### [ ] Separate PR regressions from baseline health in React Review

Status: hosted/product, confirmed by screenshot.

Source:

- Screenshot: score 70, "Needs Improvement", "Below 90", but "This PR leaves the React health score unchanged."

Fix:

- Track baseline score, PR score, delta, new diagnostics, and fixed diagnostics.
- Use neutral wording when unchanged:
  - `Repository score remains 70/100. This PR did not introduce React Review regressions.`
  - `Baseline is below 90, but this PR leaves the score unchanged.`
- Warn/fail only on worsened score or new blocking diagnostics unless absolute-score gating is explicitly configured.

### [ ] Fix ReDoS risk in glob pattern compilation

Status: confirmed current, open.

Link: https://github.com/millionco/react-doctor/pull/243

Fix:

- Add max pattern length and max wildcard count.
- Reject pathological patterns with clear config errors.
- Prefer a proven glob matcher if possible.
- Add tests for worst-case patterns.

## P1 - CI, Docs, Config, Product Semantics

### [ ] Reconcile offline scoring behavior

Status: confirmed current.

Link: https://github.com/millionco/react-doctor/issues/89

Current problem:

- `inspect.ts` omits score in offline mode.
- README says offline skips score API and no score is shown.
- `action.yml` says offline will "calculate score locally."

Fix:

- Implement local score calculation or update `action.yml` and marketplace docs.
- Add tests for `--offline`, `--score --offline`, Action offline score output, and CI auto-offline.

### [ ] Remove stale dead-code claims after Knip removal

Status: confirmed current.

Link: https://github.com/millionco/react-doctor/pull/246

Current problem:

- PR #246 removed Knip/dead-code analysis.
- README still says React Doctor reports dead code.
- `skills/react-doctor/SKILL.md` still advertises dead code coverage.

Fix:

- Remove current dead-code claims from README, marketplace copy, hosted copy, and skill docs.
- Add migration note: dead-code analysis was removed; use Knip directly.

### [ ] Stop recommending `millionco/react-doctor@main`

Status: confirmed current.

Links:

- https://github.com/millionco/react-doctor/issues/75
- https://github.com/millionco/react-doctor/issues/79

Current problem:

- README still uses `uses: millionco/react-doctor@main`.
- `@main` was explicitly reported as supply-chain risk.
- No `.github/workflows/release.yml` was found.

Fix:

- Recommend stable action tags.
- Ensure release workflow exists.
- Ensure released action inputs match docs.
- Document npm/action/marketing version mapping.

### [ ] Expose `--annotations` through `action.yml`

Status: partially addressed.

Link: https://github.com/millionco/react-doctor/issues/81

Fix:

- Add `annotations` input.
- Pass `--annotations` when enabled.
- Document annotations-only, comments-only, or both.

### [ ] Add category-level rule controls

Status: partially addressed.

Fix:

- Support per-rule/per-tag controls for severity, score contribution, PR comment visibility, CLI visibility, and CI failure.
- Use this for `design`, `test-noise`, React Native, server-action, and migration-hint rules.

### [ ] Support mature-codebase adoption workflows natively

Status: user feedback, `react-doctor@0.0.31`.

Sources:

- Team disabled duplicate `react/*`, `jsx-a11y/*`, `react-hooks-js/*`, and `react-hooks/exhaustive-deps` rules because ESLint already covers them.
- Team disabled `react-doctor/no-barrel-import` because barrel files are an intentional public API pattern and not a Vite perf concern.
- Team disabled 8 CSS/animation perf rules after autofixes degraded `prefers-reduced-motion` behavior by making animations complete instantly and look stuck.
- Team built custom pre-commit, CI, PR comment, dashboard, parallel worker, and per-module config plumbing around React Doctor.

Already done:

- [x] Land/adopt `customRulesOnly` from #109 so teams can run only React Doctor-specific rules without duplicate ESLint noise.

Remaining:

- Make CSS/animation autofixes `prefers-reduced-motion` aware and mark risky autofixes separately from safe ones.
- Add native diff-only/touched-line enforcement for staged files and PRs.
- Add baseline mode so existing violations can be tracked without blocking new commits.
- Emit first-class PR comment data or provide built-in sticky PR comments with violation summaries and autofix guidance.
- Support per-module/package reports, scores, trends, ownership, and backlog counts for monorepos.
- Add native parallel runner controls and config inheritance/per-module overrides.
- Make `no-barrel-import` bundler/framework aware, or add an official way to mark barrel files as intentional public APIs.

### [ ] Make test-noise suppression consistent

Status: partially addressed.

Fix:

- Audit every rule.
- Tag noisy test rules:
  - async parallel/defer rules,
  - JS micro-performance,
  - design/style,
  - React 19 migration hints,
  - fixture-heavy UI rules.
- Keep hooks correctness, accessibility correctness, and security enabled in tests.

### [ ] Improve suppression ergonomics

Status: partially addressed.

Sources:

- Issue #206 suppression friction.
- Historical issues: #144, #158, #159, #161.

Fix:

- Show exact suppression snippet in PR comments.
- Accept bare rule IDs when unambiguous.
- Support rationale after `--`.
- Link each PR comment group to suppression docs.
- Surface near-miss suppression hints in verbose/PR output.

### [ ] Finish Husky/lint-staged docs

Status: open.

Links:

- Issue: https://github.com/millionco/react-doctor/issues/203
- PR: https://github.com/millionco/react-doctor/pull/213
- Related: #74, #115, #31

Fix:

- Land or replace #213.
- Explain `--diff`, `--staged`, `--full`, partially staged files, and index-vs-working-tree behavior.
- Add recipes for Husky, lint-staged, Lefthook, and pre-commit.

### [ ] Decide custom `package.json` path support

Status: open duplicate PRs.

Links:

- https://github.com/millionco/react-doctor/pull/214
- https://github.com/millionco/react-doctor/pull/32

Fix:

- Pick `--package-json <path>` or another stable API.
- Avoid cache bugs when same source dir is analyzed with different manifests.
- Close duplicate PR.

### [ ] Keep React dependency detection robust in non-standard workspaces

Status: partially addressed.

Sources:

- "No React dependency found" reports in Bun workspaces, catalog setups, and non-standard `package.json` layouts.
- Related fixed issues: #27, #87, #101, #105, #116, #191.
- Related open PRs: #192, #214, #32.

Fix:

- Keep regression coverage for pnpm/Bun catalogs, grouped catalogs, peer deps, and dev deps.
- Improve error text with nearest detected package and suggested `--package-json` / `--project` fix.
- Do not regress root-project and monorepo package discovery.

### [x] Review `no-secrets-in-client-code` scoping before landing #252

Status: landed in #252.

Link: https://github.com/millionco/react-doctor/pull/252

Done:

- Scoped the weak variable-name heuristic to client-exposed files while keeping value-pattern secret detection active.
- Added regression coverage for Vite, Next.js App Router/Pages API, Expo, TanStack Start server functions, server/config/test exclusions, server-suffixed files, and ambiguous TypeScript files.
- Follow up only if we want explicit CRA/Gatsby fixtures beyond the current generic/Vite-style client coverage.

### [x] Audit React version and library-pattern false positives

Status: landed in #254.

Links:

- https://github.com/millionco/react-doctor/pull/254
- https://github.com/millionco/react-doctor/pull/186

Sources:

- Users reported `forwardRef` and React 18-compatible library patterns being penalized.

Done:

- Do not apply React 19-only advice to React 18 packages.
- Respect library peer dependency ranges and upper-bound-only ranges.
- Add fixtures for `forwardRef`, local `use`, React 18/19 split behavior, and mixed peer upper-bound support.

### [ ] Track large-codebase crash and resource failure modes

Status: partially addressed by #262.

Sources:

- PR: https://github.com/millionco/react-doctor/pull/262
- High RAM / OOM / SIGABRT reports on large monorepos.
- Historical dead-code crashes: #77, #132, #135, #149.
- Historical large command/path issue: #46.

Already done:

- [x] Materialize full-scan file lists into batches instead of one giant oxlint invocation.
- [x] Recover diagnostics from successful batches when a large/pathological batch times out or fails.
- [x] Surface dropped-file partial failures instead of silently returning zero diagnostics.

Fix:

- Keep crash regressions even after Knip removal.
- Add clearer partial-output/error reporting for scan aborts.
- Document memory expectations and large-repo mitigations.
- Re-check Windows/path-length behavior outside dead-code scanning.

### [ ] Clarify React Doctor vs React Review

Status: hosted/product.

User confusion:

- "Should we use react doctor or react review?"
- "Is there additional benefit if already using react-doctor?"
- "So a react-doctor clone?"

Fix:

- React Doctor: local CLI, packages, CI command, offline/local workflows.
- React Review: hosted dashboard, GitHub App, PR comments, baseline/delta, team workflow.
- Add "Already using React Doctor?" migration path.

### [ ] Fix hosted private-repo / repo-not-found failures

Status: hosted/product.

Fix:

- Audit private repo auth path.
- Distinguish not installed, missing permission, private repo, rate limit, unsupported host, and backend failure.
- Add reconnect/retry path.

### [ ] Add non-GitHub / self-hosted GitLab integration path

Status: hosted/product.

Source:

- Self-hosted GitLab user said they feel left out.

Fix:

- Decide support level for GitLab SaaS, self-hosted GitLab, generic CI annotations, and webhook-based hosted Review.
- Publish current workaround using CLI JSON/SARIF or CI output.
- Add GitLab CI recipe if hosted integration is not immediate.

### [ ] Improve install flow and post-install empty states

Status: hosted/product.

Sources:

- Fintech user cannot install third-party GHAs.
- User saw scary full-account GitHub access.
- User installed but could not see lints.

Fix:

- Make GitHub App, OAuth, GHA, CLI, and enterprise/self-hosted paths explicit.
- Explain selected-repo vs account-wide access before redirect.
- Add states for waiting, queued, running, no issues, comment failed, repo access failed, unsupported project, backend error.
- Alert internally when install succeeds but no analysis/comment appears.

### [ ] Keep local and hosted privacy/data behavior explicit

Status: partially addressed.

Links:

- https://github.com/millionco/react-doctor/issues/35
- https://github.com/millionco/react-doctor/issues/89
- https://github.com/millionco/react-doctor/issues/92

Fix:

- Explain what CLI sends to score/share APIs.
- Explain what `--offline` disables.
- Explain hosted Review repo/code access.
- Explain local CLI-only mode and share-link opt-out.

### [ ] Improve score-change communication

Status: partially addressed.

Sources:

- 89 -> 49.
- 93 -> 68.
- 44/100 with hundreds of warnings.

Fix:

- Add release notes for material rule changes.
- Show why scores changed: new rules, changed severities, formula, unique error/warning rules.
- Avoid encouraging blind 100/100 chasing.

### [ ] Add clear release/version mapping

Status: partially addressed.

Fix:

- Publish mapping for marketing version, npm version, action tag, and hosted Review version.
- Include rule diff and expected score impact in releases.

### [ ] Verify local report/export support and docs

Status: partially addressed.

Links:

- #47
- #60
- #88

Fix:

- Confirm current JSON/report/share outputs.
- Document local-only report workflow.
- Add SARIF or generic report path if needed for non-GitHub CI.

### [ ] Make PR blocking and `fail-on` semantics explicit

Status: partially addressed.

Sources:

- Users asked for simple "block merge if score < X" behavior.
- Existing scoring/delta feedback shows absolute thresholds can be misleading.

Fix:

- Document `fail-on`, score thresholds, annotations, and PR comments together.
- Separate "fail on new regressions" from "fail because baseline score is below threshold."
- Add examples for advisory mode, regression-only mode, and strict threshold mode.

## P2 - Platform and Product Expansion

### [ ] Decide dangerous CI/security config detection

Status: product.

Source:

- User suggested detecting dangerous configs like `pull_request_target` plus shared caches.

Candidate checks:

- `pull_request_target` on untrusted PRs.
- Shared caches in publish/release pipelines.
- Cache poisoning.
- Unpinned third-party actions.
- Overbroad `GITHUB_TOKEN` permissions.
- Secrets exposed to PR code.
- Publish jobs after untrusted build/test.
- Unsafe `workflow_run`.

### [ ] Reframe positioning away from generic "React review bot"

Status: product.

Source:

- User said they did not naturally feel a strong urge to install a "react review bot."

Better wedges:

- Catch bad agent-generated React before merge.
- Stop hooks/rendering/server-client bugs in PRs.
- Framework-aware React CI guardrail.
- Security/correctness-first React reviewer.
- React Review plus repo/CI security checks.

### [ ] Improve hosted React Review PR comment and dashboard polish

Status: hosted/product.

Sources:

- v1 feedback called out dashboard/error states and PR comment quality.
- Competitive feedback criticized whimsical, filler, low-value, or over-broad bot comments.

Fix:

- Put new regressions first and baseline findings separately.
- Collapse low-value warnings by default.
- Keep comments concise, serious, and actionable.
- Improve dashboard empty/error states and copy.

### [ ] Add Preact support position

Status: platform.

Fix:

- Decide no support, best effort, Preact-specific mode, or rule subset.
- Detect `preact`, `preact/compat`, and `@preact/signals`.
- Document unsupported React-specific rules.

### [ ] Clarify React Native coverage

Status: partially addressed.

Links:

- Support: #21, #65, #64
- False positives: #93, #100, #180, #183

Fix:

- Publish RN support matrix.
- Document `rawTextWrapperComponents`.
- Fix web-package and `Platform.OS === "web"` scoping.

### [ ] Decide HIR precision work priority

Status: open.

Link: https://github.com/millionco/react-doctor/pull/164

Decision:

- HIR may reduce AST heuristic false positives.
- Do not merge until false-positive policy is stable and regressions prove it improves real cases.

### [ ] Decide TUI priority

Status: open.

Link: https://github.com/millionco/react-doctor/pull/173

Decision:

- Useful for local exploration.
- Not a blocker for PR trust, install, or false-positive quality.
- Keep behind subcommand or beta flag.

### [ ] Decide broader ecosystem "Doctor" variants

Status: product.

Source:

- Requests mention Vue, Angular, Svelte, TypeScript, Python, Solid, and broader agent-friendly-code checks.

Decision:

- Keep React Doctor React-only, or create separate rule packs/products.
- If broadening, separate branding and diagnostics so React-specific quality is not diluted.

## Open PR Triage

- [x] #257 `fix: suppress local use hook false positives` - landed in main.
- [x] #256 `fix: narrow effect event handler detection` - landed in main.
- [x] #255 `fix: treat return guards as render state reads` - landed in main.
- [x] #254 `fix: avoid React 19 rule false positives on React 18` - landed in main.
- [x] #253 `Fix no-barrel-import index false positives` - landed in main.
- [x] #252 `fix: scope client secret diagnostics` - landed in main.
- [ ] #251 `feat: port PR 217 lint rule coverage` - large rule expansion; do not land before false-positive defaults are settled.
- [ ] #243 ReDoS glob pattern fix - prioritize security review.
- [ ] #240 auth member expressions - prioritize; fixes #239.
- [ ] #238 React Review audit - reconcile with #206 fix path.
- [ ] #233 / #211 / #209 GET side-effect fixes - choose one and close duplicates.
- [ ] #217 v2 Rasmus precision branch - port useful fixes intentionally.
- [ ] #214 / #32 `--package-json` - pick one API and close duplicate.
- [ ] #213 Husky/lint-staged docs - land or replace.
- [ ] #212 Iterator helpers - land or fold into #251.
- [ ] #210 `fix` - retitle/body or close.
- [ ] #207 Molten Hub coverage - triage likely unrelated.
- [ ] #192 Bun grouped catalogs - close if obsolete.
- [ ] #189 Simplified Chinese README - docs decision.
- [ ] #186 library-aware React 19/test scoping/build-entry/string lookup - partly obsolete after Knip removal; port useful parts.
- [ ] #185 stacked disable docs - close if README already covers it.
- [ ] #179 index-derived key locals - decide priority.
- [ ] #173 TUI - product priority.
- [ ] #164 HIR port - precision research; high review burden.

## Open Issue Triage

- [ ] #241 async-defer-await false positives - covered by P0.
- [ ] #239 auth member-expression false positives - covered by P0.
- [ ] #219 React Review audit - covered by async/test noise, baseline semantics, and #238.
- [ ] #216 React Review default-branch diagnostics - covered by async/test noise, baseline semantics, and #238.
- [ ] #215 `Hello` - close unless reporter adds actionable detail.
- [ ] #206 GET side-effect false positives - covered by P0.
- [ ] #205 Iterator helper false positive - covered by P0.
- [ ] #203 Husky/lint-staged docs - covered by P1.

## Historical Regression Ledger

### Monorepo and discovery

- [x] #73 monorepo root project/config issues.
- [x] #67 root project not offered.
- [x] #48 workspace pattern selection missed packages.
- [x] #62 custom aliases caused dead-code false positives; obsolete after Knip removal.
- [x] #136 workspace-local Knip config ignored; obsolete after Knip removal.
- [ ] #82 Action/docs still need stale docs and release pinning fixes.

### Dead-code and Knip

- [x] #77 dead-code abort.
- [x] #132 `issues.files is not iterable`.
- [x] #135 Knip plugin failure recovery.
- [x] #149 empty pattern crash.
- [x] #246 removed Knip/dead-code integration.
- [ ] Remove remaining stale dead-code docs.

### Dependency detection

- [x] #87 Bun `catalog:`.
- [x] #191 Bun grouped catalogs in current code.
- [x] #116 pnpm `catalog:`.
- [x] #101 pnpm workspace catalog regression.
- [x] #105 React in peer/dev deps plus catalogs.
- [x] #27 React in `peerDependencies`.

### GitHub Action and CI

- [x] #66 warnings-only / no-error GHA failure.
- [x] #190 score step non-zero on Needs Work.
- [ ] #75 / #79 release tags addressed historically, but README still uses `@main`.
- [x] #80 / #78 ANSI escape codes in comments.
- [x] #61 / #63 Action `diff` input.
- [ ] #107 Action offline input exists but description is wrong.
- [ ] #81 annotations exist in CLI but not `action.yml`.
- [x] #113 / #119 missing bundled jsx-a11y rule.

### CLI and agent workflow

- [x] #31 specific path/diff scans.
- [ ] #74 / #115 / #203 pre-commit docs and staged semantics.
- [x] #43 silent global install removed.
- [x] #39 Ami prompt automation issue.
- [x] #106 full-project scan command.
- [ ] #45 changed-file scan summary still needs clear baseline/diff wording.
- [ ] #89 offline score still inconsistent.
- [x] #92 share link opt-out.
- [x] #262 large-monorepo batch recovery and partial-failure reporting.
- [ ] #47 / #60 / #88 local reports: verify current support/docs.
- [x] #117 namespace hook calls.
- [x] #49 corporate proxy.
- [ ] #214 / #32 custom package JSON path.

### Config and suppressions

- [x] #86 / #41 ignore files/folders.
- [x] #91 / #110 ignore file fixes.
- [x] #144 JSX block suppressions.
- [x] #158 multi-line JSX suppressions.
- [x] #159 stacked disable comments.
- [x] #160 per-file rule ignore.
- [x] #98 config overrides.
- [x] #51 invalid config warning.
- [ ] #85 config docs exist; category/surface controls missing.
- [x] #161 / #198 `--why` / suppression audit.
- [ ] #185 stacked disable docs PR may be obsolete.

### Rule quality

- [x] #146 `useState -> useRef` transitive usage.
- [x] #126 React Compiler / Next router misdetection.
- [ ] #127 `no-usememo-simple-expression` needs clearer rationale/threshold docs.
- [ ] #95 `set-state-in-effect` precision remains worth tracking.
- [x] #19 `no-derived-state-effect` reset-state message.
- [x] #83 `nextjs-no-client-side-redirect` message.
- [ ] #93 / #100 / #180 / #183 RN wrapper components partially addressed; web scoping still open.
- [x] #55 Next `<Script>` JSON-LD.
- [x] #76 `@expo/vector-icons`.
- [x] #138 / #139 passive event listener caveat.
- [x] #152 / #186 React 19 library patterns addressed by #254.
- [x] #253 `no-barrel-import` index false positives.
- [x] #255 state-only-in-handlers return guard read.
- [x] #256 narrow `prefer-use-effect-event` handler detection.
- [x] #257 local `use` hook false positives.
- [ ] #179 index-derived key locals open.

### Product and docs

- [x] #40 architecture/how-it-works docs.
- [ ] #99 offline docs stale because Action description conflicts.
- [ ] #188 / #97 Action docs and PR blocking partially addressed; need stable tags and delta semantics.
- [ ] #189 Simplified Chinese README open.
- [ ] #203 Husky/lint-staged docs open.
- [ ] #65 / #21 / #64 RN support exists; precision/scoping remains open.
- [x] #53 non-git source file count.
- [x] #33 Expo React Compiler detection.

### Shipped enhancements

- [x] #143 / #96 / #151 standalone plugin distribution.
- [x] #187 / #201 `eslint-plugin-react-you-might-not-need-an-effect`.
- [x] #94 reduced motion detection.
- [ ] #164 HIR port open.
- [ ] #173 TUI open.
- [x] #162 `prefer-use-effect-event`.
- [x] #156 `no-effect-chain`.
- [x] #155 `no-event-trigger-state`.
- [x] #154 `prefer-use-sync-external-store`.
- [ ] #57 configurable accessibility presets closed without clear current support.
- [x] #109 custom rules only.
- [x] #124 TanStack Start rules.
- [ ] #131 design rules shipped; default PR surfacing still needs review.
- [ ] #202 Tailwind `size-N` shipped; default PR surfacing still needs review.

## Immediate Order

1. Land #240 or equivalent for auth member expressions.
2. Choose and land one #206 GET side-effect fix.
3. Land #212 or equivalent Iterator helper guard.
4. Patch #241 array destructuring in `async-defer-await`.
5. Add `async-parallel` and JS micro-perf test-file suppression.
6. Add package-level framework scoping for RN/web and SPA/server-action rules.
7. Change React Review PR comment semantics to delta-first.
8. Update docs for stable action tags, offline score behavior, dead-code removal, and annotations.
9. Triage stale PRs #192, #185, #210, and #207.
