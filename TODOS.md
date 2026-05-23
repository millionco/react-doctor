# React Doctor / React Review TODOs

Last refreshed against `main` (commit `2cc0a603`). Items that have
landed in code or whose tracking issues/PRs were resolved on GitHub
have been removed; everything below is still genuinely open.

## P0 - Trust-Breaking False Positives

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

## P1 - CI, Docs, Config, Product Semantics

### [~] Stop recommending `millionco/react-doctor@main`

Status: partial. README continues to recommend `@main` per maintainer preference; the versioned-tag path is documented as an opt-in alternative in the new "Release versioning" section. `.github/workflows/release.yml` republishes the floating major/minor action tags after every `changesets` publish so consumers who want `@v0` / `@v0.2` / `@v0.2.3` pinning can.

Links:

- https://github.com/millionco/react-doctor/issues/75
- https://github.com/millionco/react-doctor/issues/79

Remaining:

- Maintainer decision: keep `@main` as the recommended default (current stance) or eventually flip the README to a pinned-tag recommendation.

### [ ] Support mature-codebase adoption workflows natively

Status: user feedback, `react-doctor@0.0.31`. Sticky-comment delivery
and `--diff` / `--staged` shipped; the items below are still open.

Sources:

- Team disabled duplicate `react/*`, `jsx-a11y/*`, `react-hooks-js/*`, and `react-hooks/exhaustive-deps` rules because ESLint already covers them.
- Team disabled `react-doctor/no-barrel-import` because barrel files are an intentional public API pattern and not a Vite perf concern.
- Team disabled 8 CSS/animation perf rules after autofixes degraded `prefers-reduced-motion` behavior by making animations complete instantly and look stuck.
- Team built custom pre-commit, CI, PR comment, dashboard, parallel worker, and per-module config plumbing around React Doctor.

Remaining:

- Make CSS/animation autofixes `prefers-reduced-motion` aware and mark risky autofixes separately from safe ones.
- Add baseline mode so existing violations can be tracked without blocking new commits. PR #288 was closed without merging.
- Add native per-touched-line enforcement beyond the current file-granularity `--diff` / `--staged`.
- Support per-module/package reports, scores, trends, ownership, and backlog counts for monorepos.
- Add native parallel runner controls and config inheritance / per-module overrides.
- Make `no-barrel-import` bundler/framework aware, or add an official way to mark barrel files as intentional public APIs.

### [ ] Finish test-noise suppression audit

Status: substantially addressed by merged PRs #270 (`async-parallel`)
and #301 (autoresearch false-positive drive across 32k diagnostics in
26 OSS repos). A finishing audit pass is still useful.

Fix:

- Audit every rule for test-file noise.
- Tag remaining noisy test rules:
  - remaining async defer rules,
  - JS micro-performance,
  - fixture-heavy UI rules.
- Keep hooks correctness, accessibility correctness, and security enabled in tests.

### [ ] Link PR-comment groups to suppression docs

Status: `--explain` / `--why`, the per-site `suppressionHint` in
`--verbose`, and `diagnostic.suppressionHint` in `--json` all shipped
(PRs #196 / #198). The remaining gap is on the PR-comment side.

Fix:

- Show the exact suppression snippet inside each PR comment group.
- Accept bare rule IDs (without the `react-doctor/` prefix) when unambiguous.
- Link each PR comment group to suppression docs.

### [ ] Decide custom `package.json` path support

Status: open. PR #214 (`feat: add --package-json flag`) and PR #32
were both closed without a merged replacement.

Fix:

- Pick `--package-json <path>` or another stable API and ship it.
- Avoid cache bugs when the same source dir is analyzed with different manifests.

### [ ] Keep React dependency detection robust in non-standard workspaces

Status: partially addressed. Commit `6543a86f` ("find hoisted react in
monorepo workspace roots (#313)") landed regression fixes; closed PR
#192 ("resolve React from Bun grouped catalogs") still needs a port.

Fix:

- Keep regression coverage for pnpm / Bun catalogs, grouped catalogs, peer deps, and dev deps.
- Improve error text with the nearest detected package and a suggested `--package-json` / `--project` fix.
- Do not regress root-project and monorepo package discovery.

### [ ] Track large-codebase crash and resource failure modes

Status: partially addressed. Knip was removed (`aae328cc`, `9047249f`),
`4920dc0a` tolerates EPERM/EACCES on macOS Library, and PR #262 added
crash coverage. Docs and Windows path-length re-check remain.

Fix:

- Keep crash regressions even after Knip removal.
- Add clearer partial-output / error reporting for scan aborts.
- Document memory expectations and large-repo mitigations.
- Re-check Windows / path-length behavior outside dead-code scanning.

### [x] Clarify React Doctor vs React Review

Status: docs shipped. README now opens with an explicit "React Doctor vs React Review" callout that names the CLI vs hosted split, and points out that the hosted product augments (rather than replaces) CLI users. Hosted-side onboarding / migration path remains a product task.

### [ ] Fix hosted private-repo / repo-not-found failures

Status: hosted/product.

Fix:

- Audit the private-repo auth path.
- Distinguish not installed, missing permission, private repo, rate limit, unsupported host, and backend failure.
- Add a reconnect / retry path.

### [ ] Add non-GitHub / self-hosted GitLab integration path

Status: hosted/product.

Source:

- Self-hosted GitLab user said they feel left out.

Fix:

- Decide support level for GitLab SaaS, self-hosted GitLab, generic CI annotations, and webhook-based hosted Review.
- Publish the current workaround using CLI JSON / SARIF / CI output.
- Add a GitLab CI recipe if hosted integration is not immediate.

### [ ] Improve install flow and post-install empty states

Status: hosted/product.

Sources:

- Fintech user cannot install third-party GHAs.
- User saw scary full-account GitHub access.
- User installed but could not see lints.

Fix:

- Make GitHub App, OAuth, GHA, CLI, and enterprise / self-hosted paths explicit.
- Explain selected-repo vs account-wide access before redirect.
- Add states for waiting, queued, running, no issues, comment failed, repo access failed, unsupported project, backend error.
- Alert internally when install succeeds but no analysis / comment appears.

### [x] Make local and hosted privacy/data behavior explicit

Status: shipped. README has a dedicated "Privacy and data" section
that itemizes the score and share-URL network calls, what each request
actually carries (and what it doesn't: no source code, no file
paths), what `--offline` / `"share": false` disable, and how hosted
React Review's GitHub App scope differs.

### [~] Improve score-change communication

Status: docs partially shipped. The Scoring section now spells out
how to debug a score change (release changelog, unique-rules diff,
`--explain`/`--why`), tells users not to chase 100/100, and points at
the new "Release versioning" pin recipe for score-floor automation.

Remaining:

- Auto-generate the "what rules moved between X and Y" diff in the
  changelog tooling so the docs link points to concrete content per
  release.

### [x] Add clear release/version mapping

Status: shipped. README "Release versioning" section publishes the
mapping table (CLI npm, plugin npm, composite action git tags,
hosted Review) and documents the `@v0` / `@v0.2` / `@v0.2.3` floating
vs exact-pin recommendations. Release workflow keeps the floating
action tags in sync with each npm publish.

Remaining:

- Bake a "rules added / removed since previous release" section into
  the auto-generated changelog so the per-release score impact is
  visible at a glance.

### [~] Verify local report / export support and docs

Status: docs partially shipped. README now has a "Non-GitHub CI"
section that walks through the JSON-report flow for GitLab /
CircleCI / Jenkins / Buildkite consumers and pins the
`JsonReport` / `JsonReportSummary` API surface as the stable
integration contract.

Links:

- #47
- #60
- #88

Remaining:

- Decide whether to ship a first-class SARIF output (or a
  GitLab Code Quality report adapter) instead of relying on
  caller-side translation.

## P2 - Platform and Product Expansion

### [ ] Decide dangerous CI / security config detection

Status: product.

Source:

- User suggested detecting dangerous configs like `pull_request_target` plus shared caches.

Candidate checks:

- `pull_request_target` on untrusted PRs.
- Shared caches in publish / release pipelines.
- Cache poisoning.
- Unpinned third-party actions.
- Overbroad `GITHUB_TOKEN` permissions.
- Secrets exposed to PR code.
- Publish jobs after untrusted build / test.
- Unsafe `workflow_run`.

### [ ] Reframe positioning away from generic "React review bot"

Status: product.

Source:

- User said they did not naturally feel a strong urge to install a "react review bot."

Better wedges:

- Catch bad agent-generated React before merge.
- Stop hooks / rendering / server-client bugs in PRs.
- Framework-aware React CI guardrail.
- Security / correctness-first React reviewer.
- React Review plus repo / CI security checks.

### [ ] Improve hosted React Review PR comment and dashboard polish

Status: hosted/product.

Sources:

- v1 feedback called out dashboard / error states and PR comment quality.
- Competitive feedback criticized whimsical, filler, low-value, or over-broad bot comments.

Fix:

- Put new regressions first and baseline findings separately.
- Collapse low-value warnings by default.
- Keep comments concise, serious, and actionable.
- Improve dashboard empty / error states and copy.

### [ ] Add Preact support position

Status: platform.

Fix:

- Decide no support, best effort, Preact-specific mode, or rule subset.
- Detect `preact`, `preact/compat`, and `@preact/signals`.
- Document unsupported React-specific rules.

### [x] Clarify React Native coverage

Status: shipped. README has a new "React Native support matrix"
table (CLI / tvOS / Expo / Windows / macOS / out-of-tree, plus the
file-extension overrides) directly above the existing mixed-monorepo
section, and the `rawTextWrapperComponents` / `textComponents`
escape hatches are now called out next to the matrix.

Links:

- Support: #21, #65, #64

### [ ] Decide HIR precision work priority

Status: PR #164 was closed without merge.

Link: https://github.com/millionco/react-doctor/pull/164

Decision:

- HIR may reduce AST heuristic false positives.
- Do not merge until false-positive policy is stable and regressions prove it improves real cases.

### [ ] Decide TUI priority

Status: PR #173 was closed without merge.

Link: https://github.com/millionco/react-doctor/pull/173

Decision:

- Useful for local exploration.
- Not a blocker for PR trust, install, or false-positive quality.
- Keep behind a subcommand or beta flag if revived.

### [ ] Decide broader ecosystem "Doctor" variants

Status: product.

Source:

- Requests mention Vue, Angular, Svelte, TypeScript, Python, Solid, and broader agent-friendly-code checks.

Decision:

- Keep React Doctor React-only, or create separate rule packs / products.
- If broadening, separate branding and diagnostics so React-specific quality is not diluted.

## Historical Regression Ledger

GitHub issues referenced below are all CLOSED; the entries kept here
are the ones whose code follow-up is still real.

### GitHub Action and CI

- [~] #75 / #79: README still recommends `@main` per maintainer preference; `.github/workflows/release.yml` republishes floating action tags so `@v0` / `@v0.2` / `@v0.2.3` is available as an opt-in.

### CLI and agent workflow

- [ ] #45 changed-file scan summary still needs clear baseline / diff wording.
- [ ] #47 / #60 / #88 local reports — verify current support / docs and decide on SARIF.
- [ ] #214 / #32 custom `package.json` path — still no flag.

### Rule quality

- [ ] #127 `no-usememo-simple-expression` needs clearer rationale / threshold docs.
- [ ] #95 `set-state-in-effect` precision remains worth tracking.
- [ ] #179 index-derived key locals — decide priority.

### Product and docs

- [~] #188 / #97 Action docs and PR blocking: stable tags available as an opt-in (`@v0` / `@v0.2` / `@v0.2.3`), README still recommends `@main`; delta semantics for the hosted PR comment still outstanding.
- [ ] #189 Simplified Chinese README — closed PR; decide whether to ship docs.
- [x] #65 / #21 / #64 RN support: README now publishes the full RN support matrix.

### Shipped enhancements

- [ ] #57 configurable accessibility presets closed without clear current support.

## Immediate Order

1. [~] Update the README to recommend stable action tags and add a release workflow. Release workflow shipped; README keeps `@main` as the recommended ref per maintainer preference, versioned tags documented as an opt-in.
2. [ ] Change React Review PR comment semantics to delta-first.
3. [ ] Decide and ship a stable `--package-json` (or equivalent) API.
4. [ ] Ship baseline mode for mature-codebase adoption.
