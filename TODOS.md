# React Doctor / React Review TODOs

Last refreshed against `main` (commit `77b49650`). Items that have
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

### [ ] Stop recommending `millionco/react-doctor@main`

Status: still open in code.

Links:

- https://github.com/millionco/react-doctor/issues/75
- https://github.com/millionco/react-doctor/issues/79

Current problem:

- README still uses `uses: millionco/react-doctor@main` (README lines 67, 86, 115, 127, 138).
- `.github/workflows/` contains only `ci.yml` and `update-leaderboard.yml`; no `release.yml`.
- `@main` was explicitly reported as a supply-chain risk.

Fix:

- Recommend stable action tags in the README.
- Add a release workflow that publishes a versioned action tag.
- Ensure released action inputs match docs.
- Document npm / action / marketing version mapping.

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

### [ ] Clarify React Doctor vs React Review

Status: hosted/product.

User confusion:

- "Should we use react doctor or react review?"
- "Is there additional benefit if already using react-doctor?"
- "So a react-doctor clone?"

Fix:

- React Doctor: local CLI, packages, CI command, offline / local workflows.
- React Review: hosted dashboard, GitHub App, PR comments, baseline / delta, team workflow.
- Add an "Already using React Doctor?" migration path.

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

### [ ] Make local and hosted privacy/data behavior explicit

Status: partially addressed. README documents `--offline` and the
share-URL behavior, but no dedicated privacy / data section exists.
Underlying issues #35 / #89 / #92 are closed on GitHub.

Fix:

- Explain what the CLI sends to score / share APIs.
- Explain exactly what `--offline` disables.
- Explain hosted Review repo / code access.
- Explain local CLI-only mode and the share-link opt-out.

### [ ] Improve score-change communication

Status: partially addressed. README warns "Scores may decrease across
releases" but there is no per-release rule-diff / score-impact path.

Sources:

- 89 -> 49.
- 93 -> 68.
- 44/100 with hundreds of warnings.

Fix:

- Add release notes for material rule changes.
- Show why scores changed: new rules, changed severities, formula, unique error/warning rules.
- Avoid encouraging blind 100/100 chasing.

### [ ] Add clear release/version mapping

Status: open.

Fix:

- Publish a mapping for marketing version, npm version, action tag, and hosted Review version.
- Include rule diff and expected score impact in releases.

### [ ] Verify local report / export support and docs

Status: partially addressed. `--json`, `--score`, and the Node API
(`react-doctor/api`) are documented; SARIF is not.

Links:

- #47
- #60
- #88

Fix:

- Confirm current JSON / report / share outputs.
- Document the local-only report workflow.
- Add a SARIF or generic report path if needed for non-GitHub CI.

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

### [ ] Clarify React Native coverage

Status: partially addressed.

Links:

- Support: #21, #65, #64

Fix:

- Publish RN support matrix.
- Document `rawTextWrapperComponents`.

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

- [ ] #75 / #79 — README still uses `@main`; no release workflow exists.

### CLI and agent workflow

- [ ] #45 changed-file scan summary still needs clear baseline / diff wording.
- [ ] #47 / #60 / #88 local reports — verify current support / docs and decide on SARIF.
- [ ] #214 / #32 custom `package.json` path — still no flag.

### Rule quality

- [ ] #127 `no-usememo-simple-expression` needs clearer rationale / threshold docs.
- [ ] #95 `set-state-in-effect` precision remains worth tracking.
- [ ] #179 index-derived key locals — decide priority.

### Product and docs

- [ ] #188 / #97 Action docs and PR blocking — stable tags and delta semantics still outstanding.
- [ ] #189 Simplified Chinese README — closed PR; decide whether to ship docs.
- [ ] #65 / #21 / #64 RN support exists; support matrix / docs remain open.

### Shipped enhancements

- [ ] #57 configurable accessibility presets closed without clear current support.

## Immediate Order

1. [ ] Update the README to recommend stable action tags and add a release workflow.
2. [ ] Change React Review PR comment semantics to delta-first.
3. [ ] Decide and ship a stable `--package-json` (or equivalent) API.
4. [ ] Ship baseline mode for mature-codebase adoption.
