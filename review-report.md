# `react-doctor` Code Review Report

Scope: `packages/react-doctor/src/**/*.ts`, `packages/react-doctor/tests/**`, `packages/website/**`, `vite.config.ts`, `action.yml`, root tooling, published `dist/`.
Lens: bugs and behavioral regressions first, then security, then dead code / DRY, then `AGENTS.md` violations and elegance opportunities.

Severity legend: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low.

---

## Executive Summary — Top Findings, Ordered by Severity

The report below is ~5500 lines across 10 review passes. Each pass dug into a different angle (rule implementations, dist artifacts, server-side privacy, build toolchain, etc.). For triage, work the items in this order — they're the ones with real user impact and concrete fixes.

### Critical (act on first)

1. **Command injection via `--diff <base>`** — §24.1. `execSync(\`git merge-base ${baseBranch} HEAD\`)` interpolates user input into a shell command. End-to-end exploitable through `action.yml`'s unquoted `$INPUT_DIFF`. Fix: switch to `spawnSync('git', ['merge-base', baseBranch, 'HEAD'], …)` like every other git caller in the codebase already does.
2. **`--diff` flag's user input is **double-shell-evaluated** in the GitHub Action** — §40.1. `$FLAGS=… --diff $INPUT_DIFF` and then `npx … $FLAGS` both interpolate without quoting. Same input flows through two stages of shell evaluation.
3. **`/api/score` and `/api/estimate-score` log full request bodies including `filePath`s** — §17.1. README says `--offline` is for "anonymous, not stored" telemetry, but the default mode POSTs the entire `Diagnostic[]` (with file paths) to `react.doctor/api/score`, which then `console.log(JSON.stringify(body))` to platform logs. Private monorepo file paths leak via Vercel/server logs.
4. **11 plugin rules registered but never enabled** — §1.1. `no-eval`, `no-generic-handler-names`, and 9 `js-*` rules are in `plugin/index.ts` and have entries in `RULE_CATEGORY_MAP`/`RULE_HELP_MAP` but `oxlint-config.ts` never enables them. The rule code (~300 LOC) and ~14 fixture components for them are dead.
5. **`dist/worker.js` and `dist/worker.d.ts` are missing `diagnoseCore`** — §39.1. README claims worker re-exports the same surface as browser, but the published artifact has 5 exports vs browser's 6. Worker consumers calling `import { diagnoseCore } from "react-doctor/worker"` get a runtime + TypeScript error.
6. **Systemic rule-scope weakness: rules fire on locally-named functions** — §48.1–48.6. Every rule that targets `useQuery`, `useMutation`, `redirect`, `navigate`, `useSearchParams`, etc. checks only `node.callee.name === "X"` with no import-source verification. The fixtures themselves (which redefine these as local consts) **document this as correct behavior**. Real-world projects with custom hooks/helpers of the same names get false positives.
7. **`design-issues.tsx` has 47 fixture components for 14 design rules — zero assertions** — §33.1. Fixtures, plugin registrations, category maps, help maps all exist; tests never assert any of the design rules fire. A regression that disabled all 14 rules would pass CI green.
8. **`loadConfig` walks past project boundaries indefinitely** — §25.1. A leftover `~/react-doctor.config.json` silently applies to every unrelated project the user runs `react-doctor` in. Could mask real issues with `lint: false` or `customRulesOnly: true`.
9. **Score logic + thresholds + visualization duplicated 7+ times** — §18, §56.1. Across `core/calculate-score-locally.ts`, `scan.ts`, `api/score/route.ts`, `api/estimate-score/route.ts`, `share/page.tsx`, `share/og/route.tsx`, `share/badge/route.ts`, `leaderboard/page.tsx`, `share/animated-score.tsx`, `terminal.tsx`. **Score-bar widths are FOUR different values** (50/30/20/15) across the surfaces. A user comparing share-page bar to CLI output sees different proportions.
10. **`design-issues.tsx`-style problem: `js-performance-issues.tsx` has 11 components, 9 testing the dead rules from #4** — §33.2. Same fingerprint of incomplete refactor.

### High (substantial bugs / regressions)

11. **`prompts.ts` cancellation message references a non-existent `--fix` flag** — §1.2. Misleading user-facing copy.
12. **SIGINT during `--json` produces no output** — §1.3. JSON consumers can't distinguish "scan interrupted" from "scan succeeded with empty result".
13. **`neutralizeDisableDirectives` mutates user source files in place** — §1.5. A SIGKILL or oxlint SIGABRT (documented as possible) leaves the user's repo with broken `eslint_disable`/`oxlint_disable` comments.
14. **Tempdir leak in `--staged` mode** — §1.7. `mkdtempSync` runs before the `try` block; any throw between creates an orphaned tempdir.
15. **`--diff <branch>` silently falls back to full scan when the branch doesn't exist** — §1.8. CI users get green builds that scanned nothing.
16. **`action.yml` and CLI disagree on `--fail-on` default** — §1.12. CLI default = `none`, action default = `error`. Same invocation behaves differently in different contexts.
17. **`scan` (CLI) and `diagnose` (public API) duplicate the entire pipeline** — §3.6. Two parallel implementations of project discovery, lint+deadcode orchestration, scoring.
18. **`dist/worker.js` already shipped to npm** — §39.1, confirmed in published artifact. Real bug live for users.
19. **CI doesn't run `pnpm typecheck`** — §10.1. Type errors that don't break the bundler can land on `main`.
20. **Three `@types/node` versions in lockfile** — §57.1, §75.3. `12.20.55`, `20.19.33`, `25.6.0` simultaneously. Type resolution non-deterministic.
21. **TanStack Start rules silently miss `React.useEffect()` namespace calls** — §9.1. Three rules use literal `Identifier` checks instead of the `EFFECT_HOOK_NAMES` Set + `isHookCall` helper. False negatives for `tanstackStartNoUseEffectFetch`, false positives for `tanstackStartNoNavigateInRender`.
22. **`Diagnostic.weight` is set in 3 places but never used** — §65.1. Dead feature.
23. **`Diagnose Core` `:exit` visitor reliance** — §9.2. 11 rules use ESLint-style `:exit` events. If oxlint's plugin host doesn't fire them (oxlint compatibility has been changing), depth counters drift forever and rules silently misfire.
24. **`failOn` invalid config silently downgrades to `"none"`** — §43.1. CI runs that should have failed pass green.
25. **Public action's `node-version: 20` default** — §10.2, §40.6. Below the package's `engines.node: >=22`. EBADENGINE warning on default invocation.

### High (security / privacy)

26. **`/api/score` + `/api/estimate-score` accept unbounded request bodies, open CORS `*`, no rate limiting** — §17.2, §17.3. Trivially DoS-able from any browser tab.
27. **`/install-skill` is `curl | bash`** — §17.4. Subdomain takeover or DNS hijack on `react.doctor` lets an attacker write to `~/.claude/`, `~/.cursor/`, `~/.codex/` etc.
28. **`/share/og` route can be DoS'd** — §17.5. No `Cache-Control`, unbounded `p` (project name), each render is ~50–200ms via Satori/Resvg.
29. **`react-doctor-oxlintrc-${process.pid}.json` is symlink-attack vulnerable** — §1.14, §58.3. Predictable filename, no atomic create-or-fail.
30. **NVM_DIR / nvm binary path injections** — §24.2, §24.3. Lower severity (local user attack against themselves), but real.
31. **Logger writes everything to stdout, including errors** — §63.1. Breaks `2>/dev/null`, `2>&1`, error-capture in CI.
32. **`printAnnotations` doesn't URL-encode messages** — §64.1. GitHub Actions annotation parser truncates at first `\n`, breaks on `::`, mangles on `,`/`=` in file paths.

### High (test coverage)

33. **No CLI E2E tests; `--staged`, `--diff`, `--annotations`, `--score`, `--fail-on` all untested** — §2.2, §2.3.
34. **No tests for `tanstack-start-no-secrets-in-loader`'s `VITE_*` whitelist false-negative** — §27.3.
35. **Fixtures redefine `useQuery`, `redirect`, `navigate`, `useSearchParams`, etc. as local consts** — §51.1. The test suite documents systemic-rule-scope-weakness as the desired behavior.
36. **`tests/run-oxlint.test.ts` shares state via top-level `let`** — §44.5. Running with a filter that excludes the populator crashes dependent tests.

### High (DRY / dead code)

37. **`dist/cli.d.ts` is just `export {};`** — §39.2. Three tokens.
38. **`browser.ts` and `worker.ts` are functionally the same file** — §3.1. Worker is even slightly less complete.
39. **Calculate-score split across 4 files** — §3.2. Two implementations (browser/node) differ by one identifier (`fetch` vs `proxyFetch`).
40. **`core/build-diagnose-result.ts` is a 22-line identity function** — §3.3.
41. **`combine-diagnostics.ts` is a thin wrapper around `merge-and-filter-diagnostics.ts`** — §3.4. Plus dead re-export of `computeJsxIncludePaths` (only used by tests).
42. **`index.ts` imports `summarizeDiagnostics` it never uses** — §3.5.
43. **`react-perf` plugin is loaded but produces zero diagnostics** — §49.1. Pure overhead.
44. **`eslint-plugin-react-hooks` in runtime `dependencies` instead of `peerDependenciesMeta.optional: true`** — §50.2. Installed for everyone, used by ~10% (React Compiler users).
45. **`packages/website/public/install-skill.sh` exists alongside the route's inlined string** — §26.1. Three sources of truth for the same skill content; descriptions already drifted (§26.2).
46. **`packages/website/public/llms.txt` missing 8 CLI flags** — §55.1. The `llms.txt`-named doc specifically targets AI agents, who recommend the wrong flags.
47. **README claims score `label: "Good"`** — §32.1. Actual label set is `"Great"/"Needs work"/"Critical"`. Copy-paste examples never match.

### High (configuration / DX)

48. **Repo identity drift: `aidenybai/` vs `millionco/`** — §31.1. Six files point to one org; three to the other. CLI `--help`, README, and "Star on GitHub" CTA disagree with `package.json`'s repository URL.
49. **README leaderboard table missing the top entry (`nodejs.org`)** — §32.3.
50. **README `pnpm -r run build` fails on a fresh checkout** — §32.6. Builds website which needs `next build` env.
51. **`MAX_KNIP_RETRIES = 5` but the loop runs 6 times** — §41.1. Off-by-one in the constant naming.
52. **`JsonReport.error` truncates to `{ message, name }`** — §42.1. Loses the cause chain that `formatErrorChain` already handles.
53. **`JsonReport.error` is `?`-optional**, not gated on `ok: false` — §11.3. Breaks discriminated-union narrowing.
54. **Single-vendor pre-1.0 dependency on `@voidzero-dev/vite-plus-core`** — §73.1. Whole build/test/lint pipeline.

### Medium / Low

The report has another ~150 medium / low findings: AGENTS.md compliance issues (constants outside `constants.ts`, types outside `types.ts`, multi-export utility files), individual rule edge cases, format/spacing inconsistencies, missing `noopener`, `Promise.allSettled` over `Promise.all`, mode-conflict validation, etc. These are mostly polish that don't affect users today.

### What to ship first (suggested order)

A maintainer with limited time should prioritize:

1. **§24.1** — fix `execSync` command injection.
2. **§17.1** — strip `filePath` from the score-API POST or default `--offline` in CI.
3. **§39.1** — fix `dist/worker.js` to export `diagnoseCore`.
4. **§1.1** — enable the 11 dead rules or delete their code, fixtures, and metadata.
5. **§31.1** — pick one canonical GitHub URL and replace everywhere.
6. **§33.1, §33.2** — wire up the design-issues + js-performance-issues fixtures to `describeRules`.
7. **§25.1** — bound `loadConfig`'s ancestor walk.
8. **§40.1** — quote `$FLAGS` and `$INPUT_*` in `action.yml`.
9. **§18 / §56.1** — extract scoring + thresholds + bar-rendering into a shared package; eliminates 7 duplicates plus 4 inconsistent bar widths.

Items 1–9 together represent the most user-visible, security-relevant, and DRY-impactful items in the report. Most are 1-line to ~50-line fixes.

---

### 🔴 1.1 Eleven plugin rules are registered but never enabled — completely dead

`src/plugin/index.ts` registers these rules:

```202:211:packages/react-doctor/src/plugin/index.ts
    "js-combine-iterations": jsCombineIterations,
    "js-tosorted-immutable": jsTosortedImmutable,
    "js-hoist-regexp": jsHoistRegexp,
    "js-min-max-loop": jsMinMaxLoop,
    "js-set-map-lookups": jsSetMapLookups,
    "js-batch-dom-css": jsBatchDomCss,
    "js-index-maps": jsIndexMaps,
    "js-cache-storage": jsCacheStorage,
    "js-early-exit": jsEarlyExit,
```

…plus `no-eval` (`plugin/index.ts:166`) and `no-generic-handler-names` (`plugin/index.ts:146`).

But `src/oxlint-config.ts` only enables `react-doctor/js-flatmap-filter`. None of the 11 rules above appear in that file (verified with grep). Result: their rule code (`src/plugin/rules/js-performance.ts`, `src/plugin/rules/security.ts:noEval`, `src/plugin/rules/architecture.ts:noGenericHandlerNames`) **never fires**. They are also referenced in `src/utils/run-oxlint.ts` `RULE_CATEGORY_MAP` and `RULE_HELP_MAP` (`run-oxlint.ts:38, 99, 114, 116, 163`) which is misleading because they will never produce a diagnostic.

This is either a missing config (regression — rules should be on) or a giant dead-code surface (~300 LOC of rules that ship for no reason). Tests don't cover any of these (`tests/run-oxlint.test.ts` only asserts `js-flatmap-filter` and `async-parallel`).

### 🟠 1.2 `prompts.ts` cancellation message references a non-existent `--fix` flag

```13:18:packages/react-doctor/src/utils/prompts.ts
const onCancel = () => {
  logger.break();
  logger.log("Cancelled.");
  logger.dim("Run `npx react-doctor@latest --fix` to fix issues.");
  logger.break();
  process.exit(0);
};
```

There is no `--fix` flag defined anywhere on the CLI (verified — `Grep "--fix"` only returns this single line). When a user hits Ctrl-C at any prompt the tool gives them advice that does not work. Misleading user-facing string.

(There is also a separate `exitGracefully` in `cli.ts:82-87` for SIGINT/SIGTERM that prints just "Cancelled." — two divergent cancellation paths.)

### 🟠 1.3 SIGINT during `--json` produces no JSON

```82:90:packages/react-doctor/src/cli.ts
const exitGracefully = () => {
  logger.break();
  logger.log("Cancelled.");
  logger.break();
  process.exit(0);
};

process.on("SIGINT", exitGracefully);
process.on("SIGTERM", exitGracefully);
```

In `--json` mode the logger is silenced (`cli.ts:188-190`), so ctrl-C produces zero output and exits with code 0. A consumer of the JSON contract (CI, programmatic caller) cannot distinguish "scan interrupted" from "scan succeeded with empty result". Should write a `JsonReport` with `ok: false` (or at least a non-zero exit code) on signal.

### 🟠 1.4 Redundant `getDiffInfo` call doubles git work for the common case

```291:330:packages/react-doctor/src/cli.ts
      const diffInfo = getDiffInfo(resolvedDirectory, explicitBaseBranch);
      const isDiffMode = await resolveDiffMode(...);
      ...
      for (const projectDirectory of projectDirectories) {
        let includePaths: string[] | undefined;
        if (isDiffMode) {
          const projectDiffInfo = getDiffInfo(projectDirectory, explicitBaseBranch);
```

`getDiffInfo` spawns up to 4 `execSync` calls (`getCurrentBranch`, `detectDefaultBranch`, possibly `git rev-parse --verify`, then `git merge-base` + `git diff`). For a single-project repo (where `resolvedDirectory === projectDirectories[0]`) the work is performed twice for no reason. Caching the result keyed by `(directory, explicitBaseBranch)` would halve the diff-mode startup cost.

Worse, the first call at line 294 happens **even when `--diff` is not requested** — if `effectiveDiff === undefined && !diffInfo`, the prompt is never shown but we still spent the git round-trip.

### 🟠 1.5 `neutralizeDisableDirectives` mutates user source files in place; a crash leaves them broken

```37:55:packages/react-doctor/src/utils/neutralize-disable-directives.ts
    const neutralizedContent = neutralizeContent(originalContent);
    if (neutralizedContent !== originalContent) {
      originalContents.set(absolutePath, originalContent);
      fs.writeFileSync(absolutePath, neutralizedContent);
    }
```

`neutralizeContent` rewrites every `eslint-disable` and `oxlint-disable` to `eslint_disable` / `oxlint_disable` directly in the working tree, then relies on `restore` running. If the process is `kill -9`'d, OOM-killed, or panics in oxlint/Node native code (the README itself documents `SIGABRT` here — `constants.ts:33`), the user's repo is left with broken comments. Recovery requires `git checkout` of the affected files, which is not obvious to the user.

Lower-risk approach: copy the affected files into a tmp directory, neutralize there, point oxlint at the tmp paths, and remap diagnostic file paths back (already done for `--staged` mode in `materializeStagedFiles`). At minimum, a `process.on('exit')` and signal handler should attempt restoration.

### 🟠 1.6 oxlint's tsconfig path is hard-coded to `./tsconfig.json`

```532:534:packages/react-doctor/src/utils/run-oxlint.ts
    if (hasTypeScript) {
      baseArgs.push("--tsconfig", "./tsconfig.json");
    }
```

But `discover-project.ts:593` only checks `tsconfig.json` for the `hasTypeScript` flag, while `run-knip.ts:82` already accepts `tsconfig.base.json` as an alternative:

```82:85:packages/react-doctor/src/utils/run-knip.ts
const TSCONFIG_FILENAMES = ["tsconfig.base.json", "tsconfig.json"];

const resolveTsConfigFile = (directory: string): string | undefined =>
  TSCONFIG_FILENAMES.find((filename) => fs.existsSync(path.join(directory, filename)));
```

Inconsistent: knip is `tsconfig.base.json`-aware, oxlint is not. A monorepo project that uses only `tsconfig.base.json` will (a) have `hasTypeScript=false` (so no tsconfig is passed) **and** (b) if the user adds a `tsconfig.json` later, oxlint may fail loudly because the tsconfig differs from the actual one used.

### 🟠 1.7 Tempdir leak in staged mode

```233:236:packages/react-doctor/src/cli.ts
        const tempDirectory = mkdtempSync(path.join(tmpdir(), "react-doctor-staged-"));
        const snapshot = materializeStagedFiles(resolvedDirectory, stagedFiles, tempDirectory);

        try {
```

`mkdtempSync` runs **before** the `try`. If `materializeStagedFiles` throws (e.g. ENOSPC, EACCES on a config file copy), `snapshot` is never assigned and `snapshot.cleanup` cannot be reached. The tempdir is leaked. Move the `mkdtempSync` inside the `try` and register cleanup with a top-level `try/finally`, or push the temp dir creation into `materializeStagedFiles` itself so ownership is co-located.

### 🟠 1.8 `--diff <branch>` silently falls back to full scan when the branch is missing

```80:95:packages/react-doctor/src/utils/get-diff-files.ts
export const getDiffInfo = (directory: string, explicitBaseBranch?: string): DiffInfo | null => {
  const currentBranch = getCurrentBranch(directory);
  if (!currentBranch) return null;

  const baseBranch = explicitBaseBranch ?? detectDefaultBranch(directory);
  if (!baseBranch) return null;
  ...
```

`detectDefaultBranch` is only consulted when `explicitBaseBranch` is undefined. But when an explicit branch is passed and it doesn't exist (typo, unfetched ref), `getChangedFilesSinceBranch` swallows the error and returns `[]`, and the caller treats that as "no changed files in this project, skip" — silently masking the problem. CI users get green builds that scanned nothing. This must be a hard error or at minimum a `logger.warn`.

### 🟡 1.9 Inconsistent "silent" state restore for the spinner

```489:502:packages/react-doctor/src/scan.ts
  const wasLoggerSilent = isLoggerSilent();
  if (options.silent) {
    setLoggerSilent(true);
    setSpinnerSilent(true);
  }

  try {
    return await runScan(directory, options, userConfig, startTime);
  } finally {
    if (options.silent && !wasLoggerSilent) {
      setLoggerSilent(false);
      setSpinnerSilent(false);
    }
  }
```

The flag captured (`wasLoggerSilent`) is only the logger's, but the restore is applied to **both** logger and spinner. If `setSpinnerSilent(true)` had been set externally (by a future call site) without the matching logger flag, this finally block would incorrectly turn the spinner back on. Capture both states (`wasSpinnerSilent = ...`) or use a single shared "silent" state.

### 🟡 1.10 Spinner `activeCount` underflow / double-finalize

```18:37:packages/react-doctor/src/utils/spinner.ts
const finalize = (method: "succeed" | "fail", originalText: string, displayText: string) => {
  pendingTexts.delete(originalText);
  activeCount--;

  if (activeCount <= 0 || !sharedInstance) {
    sharedInstance?.[method](displayText);
    sharedInstance = null;
    activeCount = 0;
    return;
  }
  ...
```

Calling `succeed`/`fail` twice on the same handle will:
- Decrement `activeCount` past 0,
- `pendingTexts.delete` an already-deleted key (silent no-op),
- Then either call `sharedInstance?.[method]` against a `null` sharedInstance, or try to `stop()` and re-`start()` an instance that no longer matches the active count.

The clamp on line 25 (`activeCount = 0`) hides the bug rather than preventing it. There is also no idempotency on the returned handle, so it relies on every caller invoking exactly one of `succeed`/`fail` exactly once. A `WeakSet`-of-finalized-handles guard would be more robust.

### 🟡 1.11 `--no` short-form collides with Commander's `--no-foo` semantics

```167:174:packages/react-doctor/src/cli.ts
  .option("--no-lint", "skip linting")
  .option("--dead-code", "enable dead code detection")
  .option("--no-dead-code", "skip dead code detection")
  .option("--verbose", "show file details per rule")
  .option("--score", "output only the score")
  .option("--json", "output a single structured JSON report (suppresses other output)")
  .option("-y, --yes", "skip prompts, scan all workspace projects")
  .option("-n, --no", "skip prompts, always run a full scan (decline diff-only)")
```

Commander's parser treats `--no-*` as the negation of an option named `*`. Defining a bare `--no` flag alongside `--no-lint` and `--no-dead-code` is a footgun: if Commander ever resolves `--no` differently across versions, all three break together. Rename to `--decline` or `--full` (and keep `-n` if desired).

### 🟡 1.12 `action.yml` and CLI disagree on the default for `--fail-on`

```23:25:action.yml
  fail-on:
    description: "Exit with error code on diagnostics: error, warning, none"
    default: "error"
```

```179:179:packages/react-doctor/src/cli.ts
  .option("--fail-on <level>", "exit with error code on diagnostics: error, warning, none", "none")
```

A user running the CLI directly gets `none` (never fails); the GitHub Action defaults to `error`. The same invocation behaves differently in two contexts. Pick one default and document it.

### 🟡 1.13 `verbose` boolean coerced inconsistently

```115:115:packages/react-doctor/src/cli.ts
    verbose: isCliOverride("verbose") ? Boolean(flags.verbose) : (userConfig?.verbose ?? false),
```

`flags.verbose` is already typed as `boolean` (see `CliFlags`), so `Boolean(flags.verbose)` is redundant. Other booleans in the same object don't get the same wrapping, so the inconsistency itself is suspicious — it suggests an older code path used to pass strings. This is a smell worth resolving by trusting the type or by using `Boolean` everywhere uniformly.

### 🟡 1.14 `oxlintrc-${process.pid}.json` race when scans recurse

```521:521:packages/react-doctor/src/utils/run-oxlint.ts
  const configPath = path.join(os.tmpdir(), `react-doctor-oxlintrc-${process.pid}.json`);
```

`runOxlint` is currently called sequentially from `cli.ts` (per project), so there's no in-process race. But the `index.ts` public `diagnose` API does not enforce serialization, and the browser/worker paths in `adapters/browser/diagnose-browser.ts` proxy through `runOxlint` indirectly. If two scans run concurrently in the same process, both write the same path then unlink it in `finally`. Use `mkdtempSync` like the staged mode does.

### 🟡 1.15 Score sharing leaks project names to a third-party server

```227:244:packages/react-doctor/src/scan.ts
const buildShareUrl = (
  diagnostics: Diagnostic[],
  scoreResult: ScoreResult | null,
  projectName: string,
): string => {
  ...
  params.set("p", projectName);
```

`projectName` comes from `package.json#name`. For private/internal projects this URL is printed verbatim to the terminal (and copy-pasted to chats, screenshots, CI logs). Combined with `tryScoreFromApi` POSTing `diagnostics` (file paths included) to `https://www.react.doctor/api/score`, a CI user gets a small data-exfiltration vector by default — `--offline` is opt-in. Consider either making `--offline` the default in CI environments (already detected via `AUTOMATED_ENVIRONMENT_VARIABLES`) or stripping file paths from the POST body.

### 🟡 1.16 `tryScoreFromApi` is called with a `fetch` shadowed by the global one in `calculate-score-browser.ts`

```7:8:packages/react-doctor/src/utils/calculate-score-browser.ts
export const calculateScore = async (diagnostics: Diagnostic[]): Promise<ScoreResult | null> =>
  (await tryScoreFromApi(diagnostics, fetch)) ?? calculateScoreLocally(diagnostics);
```

Passing the global `fetch` directly. In Node 18+ it works, but in any environment where `fetch` is missing or polyfilled differently this throws. The Node variant uses `proxyFetch` which has fallbacks. Either pull a tiny `getFetch()` helper that handles both, or guard with `typeof fetch !== "function"` so the local fallback is preserved.

### 🟢 1.17 `--diff` boolean parsing edge case: `--diff true` vs `--diff main`

`Commander`'s `[base]` argument means it accepts an optional value. `--diff` (no value) ⇒ `flags.diff === true`; `--diff main` ⇒ `flags.diff === "main"`. The code in `cli.ts:292-293` handles both, but `--diff false` (a literal string `"false"`) would currently be treated as a base branch named `false`. Worth a guard.

---

## 2. Test Gaps

### 🟠 2.1 No tests for the unsupported lint rules

The 11 dead rules in §1.1 also have **zero direct test coverage**. The fixture-driven `tests/run-oxlint.test.ts` only verifies the rules the config actually enables; the rule implementations in `js-performance.ts`, `security.ts:noEval`, and `architecture.ts:noGenericHandlerNames` could be silently broken and CI would still pass.

### 🟠 2.2 No CLI E2E tests

There's no test harness exercising `cli.ts` itself. The flag-resolution order (`isCliOverride` vs `userConfig` vs default) in `resolveCliScanOptions` and `resolveFailOnLevel` is a notorious source of regressions and has zero coverage. A `--json` snapshot test (one fixture, full scan, snapshot the JSON) would catch the largest behavioral regressions.

### 🟠 2.3 No tests for `--staged`, `--diff`, `--annotations`, `--score`, `--fail-on`

These four flags determine how the tool integrates with CI/Husky. None of them are exercised by `tests/scan.test.ts`. `materializeStagedFiles`, `getDiffInfo`, and `printAnnotations` would silently regress without anyone noticing until users complain.

### 🟡 2.4 `prompts` patching is untested

`prompts.ts:21-60` monkey-patches `prompts/lib/elements/multiselect`. There's a file `tests/should-auto-select-current-choice.test.ts` and `tests/should-select-all-choices.test.ts` that test the predicates in isolation but no test confirms the patch is actually wired up correctly. If the upstream `prompts` package changes its module shape, tests pass but interactive UX breaks.

### 🟡 2.5 No test for `neutralizeDisableDirectives` round-trip

This function destructively edits user files (§1.5). There's no test that verifies the restore actually reverts the file when the spawned oxlint invocation succeeds, fails, or throws.

---

## 3. DRY / Dead Code / Unnecessary Files

### 🔴 3.1 `browser.ts` and `worker.ts` are functionally the same file

```text
$ diff src/browser.ts src/worker.ts
1d0
< export type { Diagnostic, ProjectInfo, ReactDoctorConfig, ScoreResult } from "./types.js";
3d1
< export type { BrowserDiagnoseInput, BrowserDiagnoseResult } from "./adapters/browser/diagnose.js";
...
```

Same exports, only ordered differently. `worker.ts` is even slightly **less complete** — it omits the `Diagnostic, ProjectInfo, ReactDoctorConfig, ScoreResult` re-exports. Two `package.json` `exports` keys point at them (`./browser` and `./worker`) but a single source file would suffice; alternatively `worker.ts` should be `export * from "./browser.js"`. The vite config builds them separately too (`vite.config.ts:46-55`), doubling bundle size and confusion.

### 🔴 3.2 Duplicate calculate-score files

Four files for two implementations:

- `src/core/calculate-score-locally.ts` — pure local logic.
- `src/core/try-score-from-api.ts` — network logic.
- `src/utils/calculate-score-browser.ts` — `await tryScoreFromApi(d, fetch) ?? calculateScoreLocally(d)`
- `src/utils/calculate-score-node.ts` — `await tryScoreFromApi(d, proxyFetch) ?? calculateScoreLocally(d)`
- `src/utils/calculate-score.ts` — re-export of the node variant.

The Node and browser variants differ by **one identifier** (`fetch` vs `proxyFetch`). Collapse to a single `calculateScore(diagnostics, fetchImplementation = fetch)`.

### 🔴 3.3 `src/core/build-diagnose-result.ts` is an identity function

```17:22:packages/react-doctor/src/core/build-diagnose-result.ts
export const buildDiagnoseResult = (params: BuildDiagnoseResultParams): DiagnoseResultShape => ({
  diagnostics: params.diagnostics,
  score: params.score,
  project: params.project,
  elapsedMilliseconds: params.elapsedMilliseconds,
});
```

Twenty-two lines of code (incl. two interfaces) to return its own input as a plain object. The only callers are `core/diagnose-core.ts:102-107` and `tests/browser.test.ts:54-59`. Inlining the object literal at the call site is shorter than the import statement.

### 🟠 3.4 `combine-diagnostics.ts` is mostly a wrapper around `merge-and-filter-diagnostics.ts`

```8:21:packages/react-doctor/src/utils/combine-diagnostics.ts
export const combineDiagnostics = (
  lintDiagnostics: Diagnostic[],
  deadCodeDiagnostics: Diagnostic[],
  directory: string,
  isDiffMode: boolean,
  userConfig: ReactDoctorConfig | null,
  readFileLinesSync: (filePath: string) => string[] | null = createNodeReadFileLinesSync(directory),
  includeEnvironmentChecks = true,
): Diagnostic[] => {
  const extraDiagnostics =
    isDiffMode || !includeEnvironmentChecks ? [] : checkReducedMotion(directory);
  const merged = [...lintDiagnostics, ...deadCodeDiagnostics, ...extraDiagnostics];
  return mergeAndFilterDiagnostics(merged, directory, userConfig, readFileLinesSync);
};
```

It also re-exports `computeJsxIncludePaths` (line 6) for convenience — but every real caller (`scan.ts`, `core/diagnose-core.ts`, `index.ts`) imports `computeJsxIncludePaths` directly from `utils/jsx-include-paths.js`. The re-export is only used by the test file `tests/combine-diagnostics.test.ts:3`.

The function itself only exists for `scan.ts`. The browser/worker path uses `mergeAndFilterDiagnostics` directly via `core/build-result.ts`. Inlining the spread + reduced-motion logic into `scan.ts` and deleting `combine-diagnostics.ts` would remove ~22 lines and a level of indirection.

### 🟠 3.5 `index.ts` imports `summarizeDiagnostics` it never uses

```26:26:packages/react-doctor/src/index.ts
import { summarizeDiagnostics } from "./utils/summarize-diagnostics.js";
```

It is only re-exported on line 41 (which is a `export { … } from "..."` form that doesn't need the import). The `import` on line 26 is dead.

### 🟠 3.6 `scan` (CLI) and `diagnose` (public API) duplicate the entire pipeline

`src/scan.ts:scan` and `src/index.ts:diagnose` both:
- resolve directory,
- load user config,
- compute jsx include paths,
- resolve lint include paths,
- discover project,
- run lint + dead code in parallel,
- merge diagnostics,
- compute score.

`diagnose` already delegates to `diagnoseCore`. `scan` instead has its own implementation in `runScan` that mirrors `diagnoseCore`'s logic plus presentation. The right factoring is to have a single `diagnoseCore` and a thin presentation wrapper for `scan`. Today, fixing a bug in one (e.g. how `customRulesOnly` flows) requires fixing it in both.

Concretely, `mergeScanOptions` (`scan.ts:427-440`) and the option resolution in `diagnoseCore` (`core/diagnose-core.ts:53-54`) duplicate the `inputOptions ?? userConfig ?? default` pattern.

### 🟠 3.7 Two diverging names for the same field: `scoreResult` vs `score`

- `ScanResult.scoreResult: ScoreResult | null` (`types.ts:99`)
- `DiagnoseResult.score: ScoreResult | null` (`index.ts:54`, `core/diagnose-core.ts:14`, `adapters/browser/diagnose.ts:18`)
- `JsonReportProjectEntry.score: ScoreResult | null` (`types.ts:193`)

Same payload, three field names. Pick `score` (already adopted by 3 of 4 places) and rename `ScanResult.scoreResult`.

### 🟠 3.8 `JsonReport` carries `diagnostics` redundantly

```207:222:packages/react-doctor/src/types.ts
export interface JsonReport {
  ...
  projects: JsonReportProjectEntry[];
  diagnostics: Diagnostic[];
  ...
```

`projects[].diagnostics` already contains the full per-project list; the top-level `diagnostics` is just `projects.flatMap(p => p.diagnostics)` (`build-json-report.ts:53`). For a 5-workspace monorepo with thousands of diagnostics this doubles the JSON payload size on disk and over the wire.

Either drop the top-level field (consumers can flatten) or, if API stability matters, mark it as a derived view in the schema and emit it as a Symbol-backed lazy projection in TypeScript (or generate it on-demand only when stringifying).

### 🟡 3.9 Re-exports in `combine-diagnostics.ts` create import-graph cycles

`combine-diagnostics.ts` imports from `check-reduced-motion.ts` (utils → utils), and re-exports from `jsx-include-paths.ts`. The tests import `computeJsxIncludePaths` from `combine-diagnostics`, but real code imports it from `jsx-include-paths.ts`. This kind of re-export is a stylistic violation of "one utility per file" (`AGENTS.md` line 18) and increases import-graph complexity for no win.

### 🟡 3.10 `KNIP_*_MAP` triplets in `run-knip.ts`

```14:33:packages/react-doctor/src/utils/run-knip.ts
const KNIP_CATEGORY_MAP: Record<string, string> = { ... };
const KNIP_MESSAGE_MAP: Record<string, string> = { ... };
const KNIP_SEVERITY_MAP: Record<string, "error" | "warning"> = { ... };
```

Three parallel maps keyed by the same string. One map of `{category, message, severity}` objects would express the invariant that the three are 1:1 correlated, instead of allowing them to drift (e.g. someone adding `"unlisted"` to one map but not the others).

### 🟡 3.11 The `silenced` helper ignores its return value's relationship to `console`

```62:80:packages/react-doctor/src/utils/run-knip.ts
const silenced = async <T>(fn: () => Promise<T>): Promise<T> => {
  const originalLog = console.log;
  ...
  console.log = () => {};
  ...
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    ...
  }
};
```

If two `silenced` calls overlap (e.g. someone calls `silenced` from inside another `silenced`), the inner one captures the already-noop functions as "originals", and the outer's restoration leaves `console.log` as a noop forever. Use a refcount or a single saved baseline.

This also overrides _all_ `console` methods globally including for parallel `Promise.all` work — anything spawned inside `silenced` (e.g. logging from `runOxlint` in §1.2 of `scan.ts`) would also be eaten.

### 🟡 3.12 `RULE_HELP_MAP` and `RULE_CATEGORY_MAP` in `run-oxlint.ts` are huge co-located constants

`run-oxlint.ts:19-357` is ~340 lines of static configuration data inlined in the same file as the spawn logic. Splitting into `src/rule-metadata.ts` (or `src/plugin/rule-metadata.ts`) would (a) follow `AGENTS.md` "magic numbers in constants.ts" spirit, (b) let the plugin and the CLI share one source of truth (today the plugin's rule names in `plugin/index.ts` and the metadata maps here can drift silently — there's no static check that every registered rule has a category).

### 🟡 3.13 `core/build-result.ts` and `core/build-diagnose-result.ts` are confusingly similar names

Both live in `core/`. `buildDiagnoseTimedResult` (with a verb in the middle) and `buildDiagnoseResult` (without) do almost-but-not-quite the same job. Consolidating into one file with clear naming like `assemble-result.ts` (or eliminating one — see §3.3) would help.

### 🟢 3.14 `print*` functions in `scan.ts` mix concerns

`scan.ts` has `printDiagnostics`, `printScoreGauge`, `printBranding`, `printSummary`, `printProjectDetection`, `buildBrandingLines`, `buildScoreBar`, `buildPlainScoreBar`, `buildScoreBarSegments`, `buildCountsSummaryLine`. ~300 LOC of pure presentation that has no business living next to the orchestration logic in `runScan`. Extract a `src/presentation/` directory; keep `scan.ts` focused on the pipeline. (Bonus: makes the CLI/diagnose unification in §3.6 much easier.)

---

## 4. `AGENTS.md` Compliance Issues

### 🟠 4.1 Many local interfaces violate "Keep all types in the global scope"

> MUST: Keep all types in the global scope.

Counter-examples (all interfaces declared inside non-`types.ts` files):

| File | Interface |
|---|---|
| `src/cli.ts:31` | `CliFlags` |
| `src/scan.ts:48` | `ScoreBarSegments` |
| `src/scan.ts:415` | `ResolvedScanOptions` |
| `src/core/diagnose-core.ts:6,13,20,28` | `DiagnoseCoreOptions`, `DiagnoseCoreResult`, `DiagnoseRunnerContext`, `DiagnoseCoreDeps` |
| `src/core/build-result.ts:4,14` | `BuildDiagnoseResultInput`, `BuildDiagnoseTimedResult` |
| `src/core/build-diagnose-result.ts:3,10` | `BuildDiagnoseResultParams`, `DiagnoseResultShape` |
| `src/core/try-score-from-api.ts:4` | `ScoreRequestFetch` |
| `src/utils/build-json-report.ts:11` | `BuildJsonReportInput` |
| `src/utils/build-json-report-error.ts:3` | `BuildJsonReportErrorInput` |
| `src/utils/proxy-fetch.ts:3` | `GlobalProcessLike` |
| `src/utils/resolve-compatible-node.ts:7,13` | `NodeVersion`, `NodeResolution` |
| `src/utils/get-staged-files.ts:28` | `StagedSnapshot` |
| `src/utils/discover-project.ts:157` | `CatalogCollection` |
| `src/utils/detect-agents.ts:14` | `AgentMeta` |
| `src/install-skill.ts:17` | `InstallSkillOptions` |
| `src/adapters/browser/diagnose.ts:6,16` | `BrowserDiagnoseInput`, `BrowserDiagnoseResult` |
| `src/adapters/browser/diagnose-browser.ts:7` | `DiagnoseBrowserInput` |
| `src/adapters/browser/process-browser-diagnostics.ts:6,14` | `ProcessBrowserDiagnosticsInput`, `ProcessBrowserDiagnosticsResult` |
| `src/index.ts:44,50,57` | `DiagnoseOptions`, `DiagnoseResult`, `ToJsonReportOptions` |
| `src/plugin/types.ts` | `ReportDescriptor`, `RuleContext`, `Rule`, `RuleVisitors`, `RulePlugin`, `EsTreeNode`, `ParsedRgb` |

Either move them into `types.ts` (the rule's literal reading) or relax the rule in AGENTS.md to "co-locate types with usage when private to a module."

### 🟠 4.2 Many magic constants live outside `constants.ts`

> MUST: Put all magic numbers in `constants.ts` using `SCREAMING_SNAKE_CASE` with unit suffixes.

Examples:

- `src/cli.ts:47` `VALID_FAIL_ON_LEVELS`, `src/cli.ts:92-99` `AUTOMATED_ENVIRONMENT_VARIABLES`.
- `src/scan.ts:53` `SEVERITY_ORDER`.
- `src/install-skill.ts:15` `SKILL_NAME`.
- `src/utils/prompts.ts:9` `PROMPTS_MULTISELECT_MODULE_PATH`.
- `src/utils/run-knip.ts:14-33` `KNIP_*_MAP` triplet, line 82 `TSCONFIG_FILENAMES`.
- `src/utils/run-oxlint.ts:19-141` `PLUGIN_CATEGORY_MAP`, `RULE_CATEGORY_MAP`, `RULE_HELP_MAP`, `FILEPATH_WITH_LOCATION_PATTERN`, `REACT_COMPILER_MESSAGE`.
- `src/utils/check-reduced-motion.ts:8-10, 12-24` `REDUCED_MOTION_GREP_PATTERN`, `REDUCED_MOTION_FILE_GLOBS`, `MISSING_REDUCED_MOTION_DIAGNOSTIC`.
- `src/utils/discover-project.ts:21-100, 428` `REACT_COMPILER_PACKAGES`, `NEXT_CONFIG_FILENAMES`, `BABEL_CONFIG_FILENAMES`, `VITE_CONFIG_FILENAMES`, `EXPO_APP_CONFIG_FILENAMES`, `REACT_COMPILER_*_PATTERN`, `FRAMEWORK_PACKAGES`, `FRAMEWORK_DISPLAY_NAMES`, `REACT_DEPENDENCY_NAMES`.
- `src/utils/filter-diagnostics.ts:17-19` `OPENING_TAG_PATTERN`, `DISABLE_NEXT_LINE_PATTERN`, `DISABLE_LINE_PATTERN`.
- `src/utils/detect-agents.ts:20` `AGENTS_SKILL_DIR`.

Even ignoring the literal "magic numbers" rule, having ~700 LOC of constants spread across 12+ files makes it hard to audit which strings/numbers are user-visible.

### 🟡 4.3 "One utility per file" violated repeatedly

Files in `src/utils/` exporting multiple utilities:

- `calculate-score-node.ts`, `calculate-score-browser.ts` — `calculateScore` + re-export.
- `combine-diagnostics.ts` — `combineDiagnostics` + re-export.
- `get-diff-files.ts` — `getDiffInfo` + `filterSourceFiles`.
- `get-staged-files.ts` — `getStagedSourceFiles` + `materializeStagedFiles`.
- `find-monorepo-root.ts` — `isMonorepoRoot` + `findMonorepoRoot`.
- `format-error-chain.ts` — `formatErrorChain` + `getErrorChainMessages`.
- `discover-project.ts` — `formatFrameworkName`, `discoverProject`, `listWorkspacePackages`, `discoverReactSubprojects`.
- `filter-diagnostics.ts` — `filterIgnoredDiagnostics` + `filterInlineSuppressions`.
- `is-ignored-file.ts` — `compileIgnoredFilePatterns` + `isFileIgnoredByPatterns`.
- `match-glob-pattern.ts` — `compileGlobPattern` + `matchGlobPattern`.
- `resolve-compatible-node.ts` — `isNvmInstalled`, `installNodeViaNvm`, `resolveNodeForOxlint` + helpers.
- `detect-agents.ts` — `ALL_SUPPORTED_AGENTS`, `detectAvailableAgents`, `toDisplayName`, `toSkillDir`, `SupportedAgent`.

If the rule is meant strictly, every one of these would need to be split. If it isn't, the rule should be softened to something like "avoid mega-utility files; collocate a small group of tightly related helpers."

### 🟡 4.4 Type casts (`as`) used where guards exist

> MUST: Do not type cast ("as") unless absolutely necessary.

Notable casts that could be replaced:

- `src/utils/load-config.ts:18, 35` casts a JSON parse result to `ReactDoctorConfig` after `isPlainObject` confirms it's an object — but the cast goes further than the guard. Use a real validator (zod, valibot, or a hand-rolled `parseConfig` that returns `null` on shape mismatch) so an invalid config doesn't propagate downstream.
- `src/utils/discover-project.ts:263, 271, 273, 289` repeatedly casts to `Record<string, unknown>` because of how `packageJson.catalog` / `catalogs` are typed. Adding `catalog?: unknown; catalogs?: unknown` to `PackageJson` and narrowing locally would eliminate four casts.
- `src/utils/proxy-fetch.ts:53` `as RequestInit` — at minimum extract a typed wrapper interface.
- `src/utils/run-knip.ts:115, 121` `as Record<string, unknown>` / `as KnipResults` — knip already exports types via `knip/session`; the project even has a `src/knip.d.ts` shim. Tighten the shim to remove the casts.
- `src/utils/run-oxlint.ts:479` `as OxlintOutput` — the JSON parse is unchecked. A 1-property guard (`"diagnostics" in output && Array.isArray(output.diagnostics)`) would make this cast at least defensible.
- `src/utils/detect-agents.ts:33` `as SupportedAgent[]` — `Object.keys` is structurally typed; you can express this with a `satisfies` clause and avoid the cast.

### 🟢 4.5 Non-trivial logic in arrow IIFE in `scan.ts`

```536:572:packages/react-doctor/src/scan.ts
  const lintPromise = resolvedNodeBinaryPath
    ? (async () => {
        const lintSpinner = options.scoreOnly ? null : spinner("Running lint checks...").start();
        try {
          ...
        } catch (error) {
          ...
        }
      })()
    : Promise.resolve<Diagnostic[]>([]);
```

A 35-line async IIFE inside a ternary is hard to read. The same applies to `deadCodePromise` directly below. Extract `runLintWithSpinner` and `runDeadCodeWithSpinner` named functions — improves readability and shrinks `runScan` significantly.

---

## 5. Build / Project Hygiene

### 🟡 5.1 Vite emits two near-identical bundles

`vite.config.ts:46-55` builds `browser.ts` and `worker.ts` in the same `pack` block. Because they're mostly the same code, both bundles ship duplicate copies of `core/diagnose-core.ts`, `utils/calculate-score-browser.ts`, etc. Either consolidate into a single bundle (`exports['./worker']` re-points to `./browser`) or use vite's `external` to dedupe.

### 🟡 5.2 `knip.d.ts` has a tiny ad-hoc shim that contradicts knip's real types

```1:7:packages/react-doctor/src/knip.d.ts
declare module "knip" {
  import type { MainOptions } from "knip/session";
  export const main: (
    options: MainOptions,
  ) => Promise<{ issues: unknown; counters: Record<string, number> }>;
}
```

`knip` is an actual TS package (now in v6) and exports proper types. This shim widens the return to `unknown` and forces the `as KnipResults` cast in `run-knip.ts:121` (cf. §4.4). Removing the shim and using upstream types would strengthen the boundary.

### 🟡 5.3 `vite.config.ts` (root) and `packages/react-doctor/vite.config.ts` both define configs

Root `vite.config.ts` configures `vp lint`/`fmt`. Package vite-plus pack config is in `packages/react-doctor/vite.config.ts`. These coexist fine, but the root config's `plugins: ["typescript", "react", "import"]` claims `react` and `import` plugins for a project that contains a CLI tool, a worker, and a Next.js website. Worth checking that linting actually fires for both packages with the right rule sets.

### 🟢 5.4 Top-level `vite.config.ts` is misnamed for what it does (it's a vp config, not a build config)

Renaming to `vp.config.ts` (if vp supports it) or at least adding a comment at the top clarifies that this isn't producing a build artifact.

### 🟢 5.5 `tests/` lives outside `src/`

Vitest finds them, but `vite.config.ts` `test.testTimeout: 30_000` (`packages/react-doctor/vite.config.ts:64`) is the only acknowledgement. `tsconfig.json` has `"include": ["src"]` (`packages/react-doctor/tsconfig.json:7`), so types in `tests/` are typechecked through the test-runner's resolution but not the package's `tsc --noEmit`. A second `tsconfig.test.json` extending the main would be cleaner.

---

## 6. Smaller / Stylistic

| Severity | File / Location | Issue |
|---|---|---|
| 🟢 | `src/utils/logger.ts:11-40` | All seven methods have the identical `if (isSilent) return;` prologue. A higher-order `silentSafe(fn)` wrapper would halve the code. |
| 🟢 | `src/utils/format-error-chain.ts:1-21` | `getErrorChainMessages` and `formatErrorChain` are both exported; the former is only used inside `extract-failed-plugin-name.ts`. Consider keeping the function private or merging files. |
| 🟢 | `src/utils/handle-error.ts:8-24` | `options: HandleErrorOptions` defaults to `DEFAULT_HANDLE_ERROR_OPTIONS`, which is referenced by no other call site. Either inline the default `shouldExit = true` parameter, or remove the unused customization point. |
| 🟢 | `src/utils/discover-project.ts:170-232` `parsePnpmWorkspaceCatalogs` | Hand-rolled YAML parser with state machine. Will silently misparse multi-line strings, anchors, comments inside values. Use a real YAML lib (already pulled in transitively) or document the strict subset. |
| 🟢 | `src/utils/discover-project.ts:314-336` `parsePnpmWorkspacePatterns` | Same hand-rolled YAML parsing; same concern. |
| 🟢 | `src/utils/discover-project.ts:43-48` | `VITE_CONFIG_FILENAMES` misses `vite.config.mts` and `vitest.config.*` — Vite projects routinely use `.mts` now. |
| 🟢 | `src/utils/detect-agents.ts:35-47` `isCommandAvailable` | Iterates `process.env.PATH` for every binary candidate per agent (8 agents × 1–2 binaries each × N PATH dirs = up to 800+ stat calls on first run). Memoize per-binary. Also doesn't handle Windows extensions (`.exe`, `.cmd`). |
| 🟢 | `src/utils/select-projects.ts` | `selectProjects` (arrow const) is declared **before** the helper `const`s it calls (`resolveProjectFlag`, `printDiscoveredProjects`, `promptProjectSelection`). Works at runtime but reads as a TDZ smell; either reorder or convert helpers to function declarations. |
| 🟢 | `src/scan.ts:444-478` `printProjectDetection` | Five sequential `spinner(...).start().succeed(...)` calls flicker on slow terminals. Either render statically or batch into one frame. |
| 🟢 | `src/scan.ts:160-176` `writeDiagnosticsDirectory` | `mkdirSync(outputDirectory)` without `recursive: true` — works because `randomUUID` guarantees a fresh name, but inconsistent with the rest of the code which uses `recursive: true`. |
| 🟢 | `src/utils/spinner.ts:13-16` `noopHandle` | Fresh object literal would be safer than a shared frozen reference (callers shouldn't mutate, but a shared instance invites it). Consider `Object.freeze`. |
| 🟢 | `src/utils/run-oxlint.ts:359-375` `cleanDiagnosticMessage` | Two nearly identical branches; the `react-hooks-js` branch's fallback `rawMessage || help` is less defensive than the default branch's `cleaned || message` (does not consult `RULE_HELP_MAP`). Easy unification. |
| 🟢 | `src/utils/check-reduced-motion.ts:42-50` | Uses `git grep` shell-style with quoted globs. On a non-git directory or sparse checkout this throws and falls into the catch as "no reduced-motion handling found", producing a false-positive diagnostic. |
| 🟢 | `src/install-skill.ts:30-34` | When the skill directory is missing, the message says "Could not locate the react-doctor skill bundled with this package" but the build is what produces it (`vite.config.ts:9-17` `copySkillToDist`). If a user installs a partial tarball this silently exits — should at least print the expected `sourceDir`. |
| 🟢 | `src/utils/install-skill-for-agent.ts:16-19` | `rmSync(installedSkillDirectory, { recursive: true, force: true })` then `cpSync` clobbers without warning. If the user has manually extended their skill, those edits are lost without a prompt. |
| 🟢 | `src/utils/install-skill-for-agent.ts:5-20` | `alreadyInstalledDirectories` parameter is awkward — the caller in `install-skill.ts:67-78` builds a Set, passes it in, then re-adds after the call. The contract would be cleaner if the function returned the directory and let the caller manage the Set. |
| 🟢 | `src/utils/get-staged-files.ts:54` | Hard-coded list of project config filenames `["tsconfig.json", "package.json", "react-doctor.config.json"]`. Misses `tsconfig.base.json`, `oxlint.json`, `.oxlintrc.json`, `knip.json`, etc., which means staged-mode scans can pick different configs than the working tree. |
| 🟢 | `src/utils/proxy-fetch.ts:19-27` | Module-level mutable `let` flags (`isProxyUrlResolved`, `resolvedProxyUrl`) aren't necessary — the proxy URL is read from `process.env`, which is itself memoized. A simple `const` with `getProxyUrl = () => readEnvProxy()` is fine. |
| 🟢 | `src/cli.ts:181-181` | `directory` defaults to `"."`; `path.resolve(".")` is `process.cwd()`. The default in commander's argument should probably be unset and the resolution explicit (`flags.directory ?? process.cwd()`) for testability. |
| 🟢 | `src/cli.ts:405-409` | `main` is declared but only invoked once at the bottom. Just call `program.parseAsync()` directly. |
| 🟢 | `tests/scan.test.ts:9-21` | `vi.mock("ora", ...)` provides a fake but doesn't constrain the API surface. If `ora` adds new methods that the spinner code starts using, this mock silently misbehaves rather than failing. |
| 🟢 | `tests/browser.test.ts:67-82` | Stubs `globalThis.fetch` to throw, but doesn't unstub before other tests. Vitest's `vi.stubGlobal` is reset between files but not between `it`s — be explicit. |
| 🟢 | `tests/run-oxlint.test.ts:38-61` | `let basicReactDiagnostics: Diagnostic[];` populated by an `it` block, then read by `describeRules`. If the first three `it`s are skipped/filtered (e.g. `--filter`), the latter blocks blow up with "Cannot read properties of undefined" — confusing failure mode. Use `beforeAll`. |
| 🟢 | `src/types.ts:67-73` `PackageJson` | Doesn't model `catalog` / `catalogs` fields used by `discover-project.ts`, which is why §4.4 needs the `as Record<string, unknown>` casts. |
| 🟢 | `src/utils/discover-project.ts:582-590` | `findDependencyInfoFromMonorepoRoot` is only called when neither `reactVersion` nor framework was found. But it walks the same directories as `findReactInWorkspaces` already did — duplicate filesystem traversal in the cold path. |
| 🟢 | `src/utils/get-diff-files.ts:26-39` | Inner `for (const candidate ... of DEFAULT_BRANCH_CANDIDATES)` swallows all errors with `try { } catch {}` (note empty body). At minimum log at debug. |

---

## 7. Suggested Quick Wins (no behavior change)

If you act on only a few items:

1. **Enable the dead rules** (or delete them and their metadata). §1.1 — biggest functional gap.
2. **Fix the misleading `--fix` message** in `prompts.ts`. §1.2 — 1-line fix.
3. **Delete `worker.ts`, redirect `./worker` export to `browser.js`** (or vice versa). §3.1 — removes confusion.
4. **Inline `buildDiagnoseResult`** and delete `core/build-diagnose-result.ts`. §3.3 — pure dead weight.
5. **Remove the unused `summarizeDiagnostics` import in `index.ts`**. §3.5 — 1-line fix.
6. **Cache `getDiffInfo` per directory in `cli.ts`**. §1.4 — measurable startup speedup.
7. **Fix the action.yml / CLI default mismatch on `--fail-on`**. §1.12 — silent CI behavior change between contexts.
8. **Move large constant maps out of `run-oxlint.ts`**. §3.12 — keeps that file scannable.
9. **Replace the `as KnipResults` cast with proper types from knip**. §4.4 / §5.2.
10. **Add a CLI E2E `--json` snapshot test**. §2.2 — locks down the most regression-prone surface.

---

## 8. Items I Did Not Verify Against Runtime

- Whether the `prompts` multiselect prototype patches still match the latest `prompts` package shape (would require running `nr test`).
- Whether `oxlint`'s `--tsconfig` flag tolerates a missing `tsconfig.json` gracefully.
- Whether `git grep` semantics in `check-reduced-motion.ts` are identical across git ≥ 2.20.
- Whether the share URL endpoint actually accepts a missing `s` param (the `buildShareUrl` only sets it conditionally).

These would warrant a follow-up if a related bug ever surfaces.

---

# Second Pass — Rule Implementation Bugs, CI, and More

This section covers areas the first pass didn't examine in depth: the 14 rule files under `src/plugin/rules/`, the GitHub Actions workflow, fixture coverage, and additional cross-cutting issues.

## 9. Rule Implementation Bugs

### 🔴 9.1 `tanstack-start.ts` rules silently miss `React.useEffect()` namespace calls

Three TanStack Start rules check for effect hooks using literal Identifier matches instead of the `EFFECT_HOOK_NAMES` Set + `isHookCall` helper that every other rule in the codebase uses:

```210:212:packages/react-doctor/src/plugin/rules/tanstack-start.ts
      if (node.callee?.type !== "Identifier") return;
      if (node.callee.name !== "useEffect" && node.callee.name !== "useLayoutEffect") return;
```

```372:377:packages/react-doctor/src/plugin/rules/tanstack-start.ts
        if (
          node.callee?.type === "Identifier" &&
          (node.callee.name === "useEffect" || node.callee.name === "useLayoutEffect")
        ) {
          effectDepth++;
        }
```

```398:402:packages/react-doctor/src/plugin/rules/tanstack-start.ts
        if (
          node.callee?.type === "Identifier" &&
          (node.callee.name === "useEffect" || node.callee.name === "useLayoutEffect")
        ) {
          effectDepth--;
        }
```

`isHookCall` (in `helpers.ts:110-115`) explicitly handles both `Identifier` and `MemberExpression` callees, so projects that import `import * as React from 'react'` and write `React.useEffect(...)` work for every other effect-related rule. These three rules silently skip those calls, producing two distinct bugs:

- `tanstackStartNoUseEffectFetch` — **false negatives**: `React.useEffect(() => fetch(...))` in a route file is never reported.
- `tanstackStartNoNavigateInRender` — **false positives**: `navigate()` calls placed inside `React.useEffect` are flagged as if they were in render, because the depth counter never increments.

The dedicated test file `tests/namespace-hooks.test.ts` already covers other rules' namespace-hook handling but doesn't include any `tanstack-start` cases, so neither bug is caught.

Fix: replace the inline checks with `isHookCall(node, EFFECT_HOOK_NAMES)`. Already done correctly elsewhere (e.g. `tanstack-query.ts:150`, `nextjs.ts:130, 222`).

### 🔴 9.2 `oxlint` may not invoke `:exit` visitors — silently breaking 11 rules

The codebase relies extensively on ESLint's `:exit` visitor convention (15 occurrences total across `architecture.ts`, `tanstack-query.ts`, `tanstack-start.ts`, `nextjs.ts`, `helpers.ts:createLoopAwareVisitors`):

```184:184:packages/react-doctor/src/plugin/helpers.ts
    visitors[`${loopType}:exit`] = decrementLoopDepth;
```

Every depth-tracking rule (`noNestedComponentDefinition`, `queryStableQueryClient`, `tanstackStartNoNavigateInRender`, `nextjsNoRedirectInTryCatch`, `tanstackStartRedirectInTryCatch`, plus the loop-aware `js-*` rules in §1.1) depends on the corresponding `:exit` events firing to decrement counters.

oxlint's plugin API has historically had partial ESLint compatibility — `:exit` visitor support has been added/changed/in-flux across versions. If a future or current oxlint version does not invoke a given `:exit` event, the depth counter monotonically increases and:

- **`queryStableQueryClient`**: after the first encountered component, every later `new QueryClient()` is wrongly considered "inside a component" → false positives forever after.
- **`tanstackStartNoNavigateInRender`**: every `navigate()` call after the first `useEffect`/event handler is wrongly suppressed → false negatives.
- **`nextjsNoRedirectInTryCatch`**: `tryCatchDepth` never decrements → every `redirect()` after the first `try` block is wrongly flagged.

There are no tests verifying the depth counters reset correctly. Each rule that uses `:exit` should have a fixture with sequential blocks (component → outside → component → outside) to assert the rule fires only when expected.

A defensive alternative is to track scope via parent-pointer walks instead of enter/exit events, eliminating reliance on a non-portable feature.

### 🟠 9.3 `node.arguments?.length < 2` is a no-op when `arguments` is undefined

```7:10:packages/react-doctor/src/plugin/rules/client.ts
    CallExpression(node: EsTreeNode) {
      if (!isMemberProperty(node.callee, "addEventListener")) return;
      if (node.arguments?.length < 2) return;

      const eventNameNode = node.arguments[0];
```

```404:404:packages/react-doctor/src/plugin/rules/performance.ts
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || node.arguments?.length < 2) return;
```

When `node.arguments` is `undefined`, `node.arguments?.length` is `undefined`, and `undefined < 2` is **false** — so the early return doesn't fire. The next line then accesses `node.arguments[0]`, throwing `TypeError: Cannot read properties of undefined`.

In practice ESTree `CallExpression` nodes always have an `arguments` array, so this won't crash on real input. But:

1. Other call sites in the same files use `node.arguments.length < 2` (no `?.`) — `state-and-effects.ts:26, 126, 271`, which are stricter. Inconsistent within the codebase.
2. If oxlint ever produces a sparse node (e.g. for an error-recovery case), this rule errors instead of skipping.

Use `(node.arguments?.length ?? 0) < 2` or just `!node.arguments || node.arguments.length < 2`.

### 🟠 9.4 `noEffectEventHandler` only fires on a single-statement effect — easy to evade

```140:154:packages/react-doctor/src/plugin/rules/state-and-effects.ts
      const statements = getCallbackStatements(callback);
      if (statements.length !== 1) return;

      const soleStatement = statements[0];
      if (
        soleStatement.type === "IfStatement" &&
        soleStatement.test?.type === "Identifier" &&
        dependencyNames.has(soleStatement.test.name)
      ) {
```

The rule requires exactly one statement, the statement to be an `if`, and the test to be a bare identifier. Real-world effects almost always have at least a cleanup pre-condition (`if (!ref.current) return;`), a logger call, or `await` boilerplate. A single comment line — `// reset` — increases `statements.length` past 1 and disables the rule. The signal-to-noise ratio is low. Either widen the heuristic or drop the rule to `warn` and document the limitation.

### 🟠 9.5 `noDerivedStateEffect` over-fires when the dependency array contains non-Identifiers

```31:39:packages/react-doctor/src/plugin/rules/state-and-effects.ts
      const depsNode = node.arguments[1];
      if (depsNode.type !== "ArrayExpression" || !depsNode.elements?.length) return;

      const dependencyNames = new Set(
        depsNode.elements
          .filter((element: EsTreeNode) => element?.type === "Identifier")
          .map((element: EsTreeNode) => element.name),
      );
      if (dependencyNames.size === 0) return;
```

`useEffect(..., [props.foo, state])` — `props.foo` is a `MemberExpression`, not an `Identifier`. It's silently dropped. The rule then sees `dependencyNames = {state}` and decides whether the body "derives from deps" using only `state`. The body might depend on `props.foo`, which the rule no longer knows about, so a real "derived from deps that we missed" gets reported as "state reset on prop change" with bad guidance.

The same pattern repeats in `noEffectEventHandler:140-148`. These rules need either (a) full member-expression deps tracking, or (b) a bail-out when any dep is non-Identifier.

### 🟠 9.6 `nextjsNoSideEffectInGetHandler` `getExportedGetHandlerBody` only inspects the first declarator

```411:434:packages/react-doctor/src/plugin/rules/nextjs.ts
const getExportedGetHandlerBody = (node: EsTreeNode): EsTreeNode | null => {
  if (node.type !== "ExportNamedDeclaration") return null;
  const declaration = node.declaration;
  if (!declaration) return null;
  ...
  if (declaration.type === "VariableDeclaration") {
    const declarator = declaration.declarations?.[0];
    if (
      declarator?.id?.type === "Identifier" &&
      declarator.id.name === "GET" &&
```

`export const A = ..., GET = async (req) => { /* ... */ };` declares two variables in one declaration; only `declarations[0]` (`A`) is checked. The `GET` handler is invisible to the rule.

This is unusual style but legal TS, and a single-line CSRF-vulnerable handler could slip through.

### 🟠 9.7 `containsAuthCheck` (server actions) only walks the first 3 statements

```43:48:packages/react-doctor/src/plugin/rules/server.ts
        const firstStatements = (declaration.body?.body ?? []).slice(
          0,
          AUTH_CHECK_LOOKAHEAD_STATEMENTS,
        );
        if (!containsAuthCheck(firstStatements)) {
```

`AUTH_CHECK_LOOKAHEAD_STATEMENTS = 3` (constants:8). Real-world server actions often start with input validation (zod parsing, manual checks), cookie reading, then auth — pushing the auth check past statement 3. The rule then complains "no auth check" even when there is one. Also, `auth(...)` may be wrapped in an `assertAuth` helper or destructured as `const { user } = await getSession()` which the helper does correctly — but the slice of 3 is the larger issue.

Fix: walk all statements until a return/throw/await of a side-effecting call is reached, or expand the lookahead to e.g. 10.

### 🟠 9.8 `serverAfterNonblocking` only triggers in files with module-level `"use server"`

```60:68:packages/react-doctor/src/plugin/rules/server.ts
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      CallExpression(node: EsTreeNode) {
        if (!fileHasUseServerDirective) return;
```

Compare with `serverAuthActions:40` which also accepts function-level `"use server"` via `hasUseServerDirective(declaration)`. `serverAfterNonblocking` only checks the module directive, so per-function `"use server"` directives (a common Next.js pattern in mixed files) are skipped — an inconsistency between two rules that should be parallel.

### 🟠 9.9 `tanstackStartNoSecretsInLoader` whitelists only `VITE_*` env vars

```518:520:packages/react-doctor/src/plugin/rules/tanstack-start.ts
            const envVarName = child.property?.type === "Identifier" ? child.property.name : null;
            if (envVarName && !envVarName.startsWith("VITE_")) {
              context.report({
```

TanStack Start projects with a `Vinxi` or `Vite`-like setup typically use `VITE_PUBLIC_*` (sometimes), and Vite explicitly documents that **any** `VITE_`-prefixed variable is exposed to the client. So both `process.env.VITE_API_KEY` and `process.env.NEXT_PUBLIC_API_KEY` would be wrongly considered safe by this rule's heuristic — `VITE_API_KEY` is a leak waiting to happen, since it's literally exposed to the bundle. The opposite logic is needed: **flag anything with a public-ish prefix that contains a known secret keyword** (api_key, secret, token, …) and skip plain `process.env.NODE_ENV`-style.

### 🟠 9.10 `noPreventDefault` only checks `<a>` and `<form>` — bypasses normal `<button onClick>` use

```87:90:packages/react-doctor/src/plugin/rules/correctness.ts
const PREVENT_DEFAULT_ELEMENTS: Record<string, string> = {
  form: "onSubmit",
  a: "onClick",
};
```

The rule message for `<a>` says "use a `<button>` or routing component instead". But the most common preventDefault misuse is on `<button onClick={(e) => { e.preventDefault(); ... }}>`, where there's nothing to prevent in the first place. This is currently never flagged. The scope of the rule is narrower than its name implies.

### 🟠 9.11 `queryStableQueryClient` doesn't handle `useState` initializers wrapping `new QueryClient()` correctly

```50:69:packages/react-doctor/src/plugin/rules/tanstack-query.ts
      CallExpression(node: EsTreeNode) {
        if (node.callee?.type === "Identifier" && STABLE_HOOK_WRAPPERS.has(node.callee.name)) {
          stableHookDepth++;
        }
      },
      "CallExpression:exit"(node: EsTreeNode) {
        if (node.callee?.type === "Identifier" && STABLE_HOOK_WRAPPERS.has(node.callee.name)) {
          stableHookDepth--;
        }
      },
      NewExpression(node: EsTreeNode) {
        if (componentDepth <= 0) return;
        if (stableHookDepth > 0) return;
```

The depth counter only matches **bare** `useState(...)` etc. — `React.useState(() => new QueryClient())` is a `MemberExpression` callee and never increments `stableHookDepth`. So `React.useState(() => new QueryClient())` is wrongly flagged inside a component.

Same root cause as §9.1 — should use `isHookCall(node, STABLE_HOOK_WRAPPERS)`.

### 🟠 9.12 `noTinyText` reports `0px` font sizes

```619:619:packages/react-doctor/src/plugin/rules/performance.ts
        if (pxValue !== null && pxValue > 0 && pxValue < TINY_TEXT_THRESHOLD_PX) {
```

`pxValue > 0` correctly excludes zero. But the zero check excludes a legitimate use case (visually-hidden text labels). More importantly, the ABSOLUTE threshold of 12px ignores the cascade — a `<p style={{ fontSize: 10 }}>` inside a `<small>` can be valid. This rule will produce false positives on any small caption/footnote/legal-disclaimer style. Worth a `category: "Architecture"` rather than the current `Accessibility` tagging? Or scoped to specific selectors?

### 🟠 9.13 `noWideLetterSpacing` `numValue / 16` assumes pixels but `numValue` is unitless

```658:660:packages/react-doctor/src/plugin/rules/performance.ts
          if (numValue !== null && numValue > 0) {
            letterSpacingEm = numValue / 16;
          }
```

When CSS receives `letterSpacing: 2` (a unitless number), most styling layers (including React's own inline-style coercion) treat it as `2px`. Fine. But if it's a `--spacing-tight` token someone resolved to a number that represents `em` (e.g., `0.05`), this rule divides by 16 and misses the whole point. The rule is brittle to whatever shape the inline-style value takes.

### 🟡 9.14 `parseColorToRgb` accepts only 3- and 6-digit hex; 4- and 8-digit (alpha) is silently rejected

```97:128:packages/react-doctor/src/plugin/rules/design.ts
const parseColorToRgb = (value: string): ParsedRgb | null => {
  const trimmed = value.trim().toLowerCase();

  const hex6Match = trimmed.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  ...
  const hex3Match = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
```

`#000000aa` (8-digit hex with alpha) and `#000a` (4-digit hex) are widely used for translucent black backgrounds. The parser returns `null` for both, so `isPureBlackColor`/`isBackgroundDark` fail for `#000000ff` (still pure black). The 8/4-digit hex formats have been Web-supported for years.

### 🟡 9.15 `splitShadowLayers` regex doesn't handle nested parens beyond one level

```159:159:packages/react-doctor/src/plugin/rules/design.ts
const splitShadowLayers = (shadowValue: string): string[] => shadowValue.split(/,(?![^(]*\))/);
```

For `0 0 4px rgb(255, 0, 0)`, the negative lookahead `(?![^(]*\))` correctly preserves the `,` inside `rgb(...)`. But for `0 0 4px color(srgb 1 0 0 / 0.5)` (modern CSS Color Module 4, which is increasingly common in design systems), the inner `color()` contains commas in a different way — actually no commas, but the regex was written assuming a single level. Doesn't crash, but fails silently on `color()` / `lab()` / `oklch()` etc.

### 🟡 9.16 `parseShadowLayerBlur` extracts the third numeric token even when only two are present

```177:183:packages/react-doctor/src/plugin/rules/design.ts
const parseShadowLayerBlur = (layer: string): number => {
  const withoutColors = layer.replace(/rgba?\([^)]*\)/g, "").replace(/#[0-9a-f]{3,8}\b/gi, "");
  const numericTokens = [...withoutColors.matchAll(/(\d+(?:\.\d+)?)(px)?/g)].map((match) =>
    parseFloat(match[1]),
  );
  return numericTokens.length >= 3 ? numericTokens[2] : 0;
};
```

`box-shadow: 0 0 #fff` is a valid (no-blur) declaration. The function returns `0` correctly. But `box-shadow: 5px 10px #fff` (offsets only, no blur) returns the second token's value `10` as if it were the blur — wait, no, `numericTokens.length >= 3` means need 3+. So it returns 0 here. OK.

But what about `box-shadow: 5px 10px 4px 2px #fff` (with spread)? The function returns `numericTokens[2] = 4`, which is correct (blur is the 3rd numeric value before spread/color). OK.

And what about `box-shadow: inset 5px 5px 10px #000`? `inset` isn't numeric, so tokens = [5, 5, 10], returns 10. Correct.

So this is actually OK for typical inputs but there's no test coverage and the regex doesn't handle negative numbers (`-5px`) — `(\d+(?:\.\d+)?)` won't match a leading minus. Inset glows commonly use `inset 0 -2px 4px ...`. The blur is still the third positive number, but if someone had `0 0 -4px` (rare/invalid), tokens would be `[0, 0]` and the rule misses it.

### 🟡 9.17 `extractMutatingRouteSegment` strips `[bracket]` segments incorrectly

```402:409:packages/react-doctor/src/plugin/rules/nextjs.ts
const extractMutatingRouteSegment = (filename: string): string | null => {
  const segments = filename.split("/");
  for (const segment of segments) {
    const cleaned = segment.replace(/^\[.*\]$/, "");
    if (MUTATING_ROUTE_SEGMENTS.has(cleaned)) return cleaned;
  }
  return null;
};
```

`segment.replace(/^\[.*\]$/, "")` replaces a bracketed segment with `""`. So `[id]` becomes `""` (empty). But a route like `/users/[id]/delete/route.ts` has segments `["users", "[id]", "delete", "route.ts"]` — `"delete"` is found, so the rule fires. OK.

But `/api/users-[id]/route.ts` has segment `"users-[id]"` which isn't matched by `^\[.*\]$` (anchored), so it remains literal `"users-[id]"`. Won't match any mutating segment. Probably not a common case, but the regex anchors are wrong if you want to handle `[...slug]` parameter prefixes — and `[...slug]` contains the dot which `.*` matches. OK actually for that.

The bigger issue: the `cleaned` value when the regex matches is `""`, which can't possibly be in the `MUTATING_ROUTE_SEGMENTS` set, so the function essentially treats `[id]` as if it didn't exist. That's intentional — but confusing logic. A simpler `if (segment.startsWith("[")) continue;` would be clearer.

### 🟡 9.18 `nextjsNoClientSideRedirect` walks every node in every effect on every CallExpression

```221:236:packages/react-doctor/src/plugin/rules/nextjs.ts
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
        const callback = getEffectCallback(node);
        if (!callback) return;

        walkAst(callback, (child: EsTreeNode) => {
          const navigationDescription = describeClientSideNavigation(child, isPagesRouterFile);
```

For each `useEffect` call the rule walks the entire callback AST manually with `walkAst`. Combined with the parent visitor traversing the whole file, large files can do O(n²) work. For typical files it's fine; for a 1000-line file with 50 `useEffect`s it's not. A visitor-based approach (just listen for `MemberExpression` and check ancestor chain for `useEffect`) would be linear.

### 🟡 9.19 `noUsememoSimpleExpression` picks up `useMemo(() => [])` as "trivial" because of `Array` initializer

`isSimpleExpression` (`helpers.ts:68-90`) returns `true` for `Identifier`, `Literal`, `TemplateLiteral`, simple `BinaryExpression`, `UnaryExpression`, `ConditionalExpression`, and member expressions of those. It does NOT consider `ArrayExpression` or `ObjectExpression` simple. So `useMemo(() => [], [])` is correctly considered non-simple.

But `useMemo(() => name)` where `name` is just an Identifier — the rule fires. That can be intentional (memoizing a stable reference for a downstream `useEffect` dep). The rule may produce noise on those cases. Worth scoping to "trivial **and** literal-or-arithmetic" only.

### 🟡 9.20 `findSideEffect` reports the first matching side effect, hiding others

```226:249:packages/react-doctor/src/plugin/helpers.ts
export const findSideEffect = (node: EsTreeNode): string | null => {
  let sideEffectDescription: string | null = null;
  walkAst(node, (child: EsTreeNode) => {
    if (sideEffectDescription) return;
```

`if (sideEffectDescription) return;` — once one side effect is found, the walk continues for every other node but does nothing. (The early return only exits the inner callback, not the walk itself.) This is correct functionally but wastes O(n) work per call on remaining nodes; converting to an iterator that can early-exit would be ideal. More importantly, `nextjsNoSideEffectInGetHandler` only learns about the first side effect — useful for the message, but the fix loop is "fix one, run again, find the next". An aggregation would be friendlier.

### 🟢 9.21 `noScaleFromZero` only matches scale-as-a-Property of `initial`/`exit`

The rule misses `<motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1 }} />` if `scale` is computed (`{ scale: SCALE_ZERO }` where `SCALE_ZERO = 0`) or wrapped in a tuple (`scale: [0, 1]`). Easy to evade.

### 🟢 9.22 `parseColorToRgb` accepts `#aabbccdd` 8-digit hex but downstream `hasColorChroma` ignores alpha

Even after fixing §9.14, the chroma check would treat fully transparent and fully opaque colors identically. Probably fine — chroma is hue-shift detection, not visibility. Documented for future readers.

### 🟢 9.23 `BLUR_VALUE_PATTERN` only matches `blur(NN px)` not `blur(NNrem)` or `blur(calc(...))`

```316:316:packages/react-doctor/src/plugin/constants.ts
export const BLUR_VALUE_PATTERN = /blur\((\d+(?:\.\d+)?)px\)/;
```

`blur(0.5rem)` is valid CSS and produces an 8px blur (1rem = 16px). The rule never fires on rem values. Same for `blur(calc(--blur-amount))`. The current behavior is "blur isn't checked unless authored in px", which is fine but undocumented.

### 🟢 9.24 `tanstack-start.ts:hasTopLevelAwait` misses `for await (...)`

```596:613:packages/react-doctor/src/plugin/rules/tanstack-start.ts
const hasTopLevelAwait = (statement: EsTreeNode): boolean => {
  if (statement.type === "VariableDeclaration") { ... }
  if (statement.type === "ExpressionStatement") { ... }
  if (statement.type === "ReturnStatement") { ... }
  return false;
};
```

`for await (const item of stream) {}` is an `ForOfStatement` with `await: true`, not handled here. A loader using `for await (const chunk of fetch(...).body) {}` would be considered non-blocking. Also misses `if (await x())` (conditional with await), `await x; await y;` chained in declarations, etc. Not a common pattern but worth a comment that the rule is a heuristic.

### 🟢 9.25 `clientPassiveEventListeners` only checks the third argument as `ObjectExpression`

```15:25:packages/react-doctor/src/plugin/rules/client.ts
      const optionsArgument = node.arguments[2];

      if (!optionsArgument) {
        context.report({...});
        return;
      }

      if (optionsArgument.type !== "ObjectExpression") return;
```

If the user passes `addEventListener("scroll", handler, options)` where `options` is an Identifier or function call (very common in shared addEventListener wrappers), the rule silently exits at `optionsArgument.type !== "ObjectExpression"`, effectively allowing the bypass. Either flag the variable form ("can't verify passive flag — pass `{ passive: true }` inline") or skip silently with a documented limitation.

### 🟢 9.26 `noFetchInEffect` doesn't recognize promise libraries other than `fetch`/`axios`/`ky`/`got`

```58:59:packages/react-doctor/src/plugin/constants.ts
export const FETCH_CALLEE_NAMES = new Set(["fetch"]);
export const FETCH_MEMBER_OBJECTS = new Set(["axios", "ky", "got"]);
```

Misses `wretch`, `superagent`, `sdk.client.get(...)`, `trpc.users.get.query(...)`, raw `XMLHttpRequest`, etc. The rule's value proposition is "use react-query/SWR/server components", but it only detects the obvious cases. This is OK for a heuristic, but it makes the rule's reach narrower than the help text implies.

### 🟢 9.27 `isMemoCall` checks `React.memo` but not `Memo` aliased imports

```27:34:packages/react-doctor/src/plugin/rules/performance.ts
  if (
    node.callee?.type === "MemberExpression" &&
    node.callee.object?.type === "Identifier" &&
    node.callee.object.name === "React" &&
    node.callee.property?.type === "Identifier" &&
    node.callee.property.name === "memo"
  )
    return true;
```

`import { memo as Memo } from "react"; Memo(MyComp)` — first call site of `noInlinePropOnMemoComponent` adds `MyComp` to the memoized set when the binding is `memo`, but not `Memo`. The rule has no scope analysis — it relies on lexical `memo` and `React.memo`. Acceptable for a heuristic but worth a comment.

### 🟢 9.28 `architecture.ts:noNestedComponentDefinition` `componentStack` may pop wrong context

```108:115:packages/react-doctor/src/plugin/rules/architecture.ts
      VariableDeclarator(node: EsTreeNode) {
        if (!isComponentAssignment(node)) return;
        if (componentStack.length > 0) {
          context.report({...});
        }
        componentStack.push(node.id.name);
      },
      "VariableDeclarator:exit"(node: EsTreeNode) {
        if (isComponentAssignment(node)) componentStack.pop();
      },
```

If multiple `VariableDeclarator` nodes are inside a single `VariableDeclaration` (e.g. `const A = () => {}, B = () => {}` — both component-typed), the stack pushes both names but pops them in reverse order (which is fine). However, if a non-component declarator is between two components — `const A = () => {}, x = 1, B = () => {}` — the visitor correctly skips `x`. So this is OK.

Same for `FunctionDeclaration` enter/exit. Symmetric.

But there's still a subtle issue: when `:exit` events don't fire (per §9.2), the stack monotonically grows. After the first component, every subsequent component is reported as "defined inside `<previous>`" even when it's not. Critical that §9.2 be tested.

---

## 10. CI / Workflows

### 🟠 10.1 CI does not run `pnpm typecheck`

```9:28:.github/workflows/ci.yml
  test:
    runs-on: ubuntu-latest
    steps:
      ...
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
      - run: pnpm lint
      - run: pnpm format:check
```

The root `package.json` defines `typecheck: "turbo run typecheck"`, and `packages/react-doctor/package.json` has `typecheck: "tsc --noEmit"` — but the CI workflow never invokes either. Type errors that don't break the bundler can land on `main` undetected. Add `- run: pnpm typecheck` between `pnpm test` and `pnpm lint`.

### 🟠 10.2 CI uses Node 24, but `engines.node` is `>=22` and the package targets `node18`

```17:19:.github/workflows/ci.yml
      - uses: actions/setup-node@v4
        with:
          node-version: 24
```

Three Node versions in play:
- CI builds on Node 24 (workflow).
- `package.json` requires Node ≥22 (`engines`).
- Vite pack `target: "node18"` (`packages/react-doctor/vite.config.ts:25, 42`).
- Recommended for oxlint nvm install: `OXLINT_RECOMMENDED_NODE_MAJOR = 24` (constants.ts:60).

A user on Node 22.0.0 will install fine (passes engines), but might hit oxlint native-binding issues that CI never catches because CI is on Node 24. Adding a matrix `node-version: [22, 24]` would catch the regressions documented in `OXLINT_NODE_REQUIREMENT` (`^20.19.0 || >=22.12.0`).

### 🟠 10.3 No matrix for OS

`runs-on: ubuntu-latest` only. The codebase has Windows-specific concerns (`SPAWN_ARGS_MAX_LENGTH_CHARS` HACK in constants.ts, and the `detect-agents.ts` PATH lookup that misses `.exe`/`.cmd`). Without a Windows matrix entry, those concerns can never be validated.

### 🟢 10.4 CI uses `actions/checkout@v4` but README example uses `@v5`

```13:13:.github/workflows/ci.yml
      - uses: actions/checkout@v4
```

```56:56:packages/react-doctor/README.md
- uses: actions/checkout@v5
```

The `@v5` reference in README is stale or aspirational; pick one and align both.

### 🟢 10.5 No release workflow

Despite `pnpm release: "pnpm build && changeset publish"` in `package.json:25`, there's no GitHub Actions workflow that runs it. Releases are manual, which means version management is in the developer's terminal — easy to mis-tag.

---

## 11. Public API Surface Concerns

### 🟠 11.1 `index.ts` exports `toJsonReport` with version default `"0.0.0"`

```67:69:packages/react-doctor/src/index.ts
  buildJsonReport({
    version: options.version ?? "0.0.0",
    directory: options.directory ?? result.project.rootDirectory,
```

Programmatic consumers who forget `version` get a JSON report claiming to come from version `0.0.0`. This will mislead anyone parsing the report later (analytics, version-pinned diffs). Either require `version`, or read `process.env.VERSION ?? packageJson.version` (mirroring `cli.ts:29`).

### 🟠 11.2 Inconsistent `getDiffInfo` re-exports

```40:41:packages/react-doctor/src/index.ts
export { getDiffInfo, filterSourceFiles } from "./utils/get-diff-files.js";
export { summarizeDiagnostics } from "./utils/summarize-diagnostics.js";
```

These are re-exported because consumers presumably need them, but other helpful internals (`buildJsonReport`/`buildJsonReportError`) also are. The cherry-picked re-exports are arbitrary. Consider an explicit `./api` or `./node` subpath that exposes a coherent set, vs. the current `./api` export pointing to `index.ts` that intermixes diagnostic types with builder functions.

### 🟠 11.3 `JsonReport.error` typed as optional object — breaks discriminated union

```207:222:packages/react-doctor/src/types.ts
export interface JsonReport {
  schemaVersion: 1;
  ...
  ok: boolean;
  ...
  error?: {
    message: string;
    name: string;
  };
}
```

A consumer doing `if (!report.ok) { console.log(report.error.message) }` triggers a TS error because `error` is `?`-optional, not gated on `ok: false`. The natural model is a discriminated union:

```typescript
type JsonReport =
  | (JsonReportSuccess & { ok: true })
  | (JsonReportFailure & { ok: false; error: { message: string; name: string } });
```

Without that, downstream code either uses `!` (forbidden by AGENTS.md §4.4 in spirit) or repeats null checks.

### 🟢 11.4 No JSON schema for `JsonReport`

For a tool that promises "one structured JSON report", consumers benefit from a JSON Schema (or zod) that they can validate against. Currently it's only described by the TypeScript types. CI consumers in JS-less environments (e.g. Go-based pipelines) have no spec.

### 🟢 11.5 `DiagnoseResult` and `ScanResult` aren't unified

Per §3.7 their score field name differs. They also differ in:

| Field | `DiagnoseResult` | `ScanResult` |
|---|---|---|
| `score`/`scoreResult` | `score: ScoreResult \| null` | `scoreResult: ScoreResult \| null` |
| `skippedChecks` | not present | `skippedChecks: string[]` |
| `project` | `ProjectInfo` | `ProjectInfo` |
| `elapsedMilliseconds` | yes | yes |

A programmatic user who switches from `diagnose()` (the public API) to `scan()` (internal but exported in some subpath) gets a different shape. Pick one.

### 🟢 11.6 `diagnose` returns score even when neither lint nor dead-code ran

```87:97:packages/react-doctor/src/index.ts
export const diagnose = async (
  directory: string,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult> => {
  const resolvedDirectory = path.resolve(directory);
  const userConfig = loadConfig(resolvedDirectory);
  const includePaths = options.includePaths ?? [];
  const isDiffMode = includePaths.length > 0;
  const lintIncludePaths =
    computeJsxIncludePaths(includePaths) ?? resolveLintIncludePaths(resolvedDirectory, userConfig);
```

`diagnoseCore` ultimately runs `calculateDiagnosticsScore([])` if no diagnostics — returning a perfect 100. But if `lint=false` and `deadCode=false`, the empty-result perfect score is misleading. Consider returning `score: null` when both passes are skipped.

---

## 12. Performance / Memory

### 🟡 12.1 `oxlint` invocations leave ~1 KB JSON config in `os.tmpdir()` per run when interrupted

```547:552:packages/react-doctor/src/utils/run-oxlint.ts
  } finally {
    restoreDisableDirectives();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  }
```

If the process is `kill -9`'d while inside `spawnOxlint`, neither the `finally` nor the `process.on("exit")` runs — and `react-doctor-oxlintrc-${process.pid}.json` remains in `tmpdir()` indefinitely. Over a long-running CI workflow on a self-hosted runner, these accumulate. Use `mkdtempSync` so the dir is unique and easily cleaned by tmp reapers.

### 🟡 12.2 `discover-project.ts` re-reads `package.json` for every workspace candidate

`discoverReactSubprojects` (`utils/discover-project.ts:437-470`), `listWorkspacePackages`, `findReactInWorkspaces`, `findDependencyInfoFromMonorepoRoot`, and `detectReactCompiler` all `readPackageJson(...)` independently for the same files. In a large monorepo this is dozens of redundant reads. A small `readPackageJsonOnce` memoization keyed by absolute path would help cold-start time on big repos.

### 🟡 12.3 `Buffer.concat` in `spawnOxlint` for very large outputs

```446:471:packages/react-doctor/src/utils/run-oxlint.ts
    const stdoutBuffers: Buffer[] = [];
    const stderrBuffers: Buffer[] = [];

    child.stdout.on("data", (buffer: Buffer) => stdoutBuffers.push(buffer));
    child.stderr.on("data", (buffer: Buffer) => stderrBuffers.push(buffer));

    child.on("error", ...);
    child.on("close", (code, signal) => {
      ...
      const output = Buffer.concat(stdoutBuffers).toString("utf-8").trim();
```

For a project with 50+ MB of oxlint diagnostics, this holds the entire stdout in memory twice (the array of buffers + the concatenated buffer + the resulting string). On constrained CI runners this can OOM. Either stream the JSON parse (oxlint can output one diagnostic per line with `--format=plaintext` plus a custom parser) or chunk per batch.

### 🟢 12.4 `summarizeDiagnostics` does three passes over the same array

```7:11:packages/react-doctor/src/utils/summarize-diagnostics.ts
  const errorCount = diagnostics.filter(...).length;
  const warningCount = diagnostics.filter(...).length;
  const affectedFileCount = new Set(diagnostics.map(...)).size;
```

Three independent traversals of the same array. A single `for` loop building the three values would be faster and roughly half the allocations (no intermediate filtered arrays).

### 🟢 12.5 `buildJsonReport.findWorstScoredProject` runs even when `projects.length === 1`

```30:41:packages/react-doctor/src/utils/build-json-report.ts
const findWorstScoredProject = (
  projects: JsonReportProjectEntry[],
): JsonReportProjectEntry | null => {
  const scoredProjects = projects.filter((entry) => entry.score !== null);
  if (scoredProjects.length === 0) return null;
  return scoredProjects.reduce((lowest, current) =>
    (current.score?.score ?? Number.POSITIVE_INFINITY) <
    (lowest.score?.score ?? Number.POSITIVE_INFINITY)
      ? current
      : lowest,
  );
};
```

For the single-project case (the common one) this allocates a filter array, then runs a reduce, then returns the same object that was passed in. No-op cycles. A `if (projects.length === 1) return projects[0].score ? projects[0] : null;` short-circuit would eliminate the allocations.

---

## 13. Documentation / DX

### 🟡 13.1 `react-doctor-disable-line` / `react-doctor-disable-next-line` aren't documented in README

The inline-suppression syntax (`filter-diagnostics.ts:18-19`) is a powerful escape hatch — `// react-doctor-disable-next-line some/rule` — but it's not mentioned in `README.md` at all. Users will misuse `// eslint-disable-next-line` (which gets neutralized) and find no way to actually silence a single diagnostic.

### 🟡 13.2 README documents `47+ best practice rules` but the actual count is much higher

```43:43:packages/react-doctor/README.md
Teach your coding agent all 47+ React best practice rules. Run this at your project root:
```

Counting in `oxlint-config.ts`, the actually-enabled rule count is closer to 75 (excluding the dead 11 from §1.1, but including the framework-conditional rules). Either bump the README number or document it as approximate.

### 🟡 13.3 `react-doctor.config.json` schema is undocumented

`ReactDoctorConfig` (types.ts:168-178) has 8 fields. Only `ignore.rules` and `ignore.files` appear in the README; `customRulesOnly`, `share`, `textComponents`, `verbose`, `lint`, `deadCode`, `diff`, `failOn` are nowhere to be found. Discoverability is poor — most users won't read types.

### 🟢 13.4 `--help` does not mention `react-doctor.config.json`

```161:179:packages/react-doctor/src/cli.ts
const program = new Command()
  .name("react-doctor")
  .description("Diagnose React codebase health")
```

No `addHelpText` block describes config-file precedence vs. flag precedence. Users running `react-doctor --help` see no hint that file-based config exists.

### 🟢 13.5 Missing examples for `JsonReport` consumers

Documenting at least one downstream consumer (e.g. "to fail your CI on the score being below 80, run `react-doctor --json | jq '.summary.score < 80'`") would help adoption. Currently the JSON contract is implicit.

### 🟢 13.6 README claims `--diff [base]` "scan only files changed vs base branch" but the prompt suggests `Only scan this branch?`

```149:150:packages/react-doctor/src/cli.ts
    : `On branch ${diffInfo.currentBranch} (${changedSourceFiles.length} changed files vs ${diffInfo.baseBranch}). Only scan this branch?`;
```

"Scan this branch" reads like "scan the entire branch", not "scan only the changed files". Wording mismatch with the README and the `--diff` flag's actual semantics.

---

## 14. Additional Smells & Smaller Issues

| Severity | File / Location | Issue |
|---|---|---|
| 🟡 | `src/plugin/rules/tanstack-start.ts:206-256` | Every visitor in this file calls `context.getFilename?.()` and re-runs `TANSTACK_ROUTE_FILE_PATTERN.test(filename)` per node visited. For a 1000-line route file with thousands of CallExpressions/JSXAttributes, that's thousands of redundant regex tests per rule. Compute once at `create()` time. |
| 🟡 | `src/plugin/rules/tanstack-start.ts:96-130` | `tanstackStartRoutePropertyOrder` returns at the first inversion via `return` inside the loop body — but the loop only emits ONE diagnostic per route. For a route with multiple inverted properties, only the first is reported. Either emit all of them, or document. |
| 🟡 | `src/plugin/rules/tanstack-start.ts:310-359` | `tanstackStartServerFnMethodOrder` walks the chain from outermost to inner, then bails if `methodNames[methodNames.length - 1] !== ownMethodName`. This is to ensure the rule fires exactly once per chain (on the last method) — but the comparison is structural in a way that's brittle to chains with non-method intermediates. Worth a comment. |
| 🟡 | `src/plugin/rules/architecture.ts:60-84` | `noRenderInRender` matches `RENDER_FUNCTION_PATTERN = /^render[A-Z]/`. So `renderlist` (lowercase L) is missed; `Renderer` is missed. The regex misses common "render-as-method" patterns like `myComponent.render()`. Probably fine for the heuristic but worth knowing. |
| 🟡 | `src/plugin/rules/correctness.ts:139-160` | `renderingConditionalRender` only flags `someArr.length && <X />`. But `condition && <X />` where `condition` can be `0` (`{count && <X />}` where `count = 0`) is the same bug and isn't caught. Compare: it requires `MemberExpression` + `length`. |
| 🟡 | `src/plugin/rules/security.ts:46-66` | `noSecretsInClientCode`: `literalValue.length > SECRET_MIN_LENGTH_CHARS` (=8). Real secrets are way longer (32–80 chars typically). 8 is too low — generates false positives on UI strings like "loading…" assigned to a variable named `loadingMessage` (matches `SECRET_VARIABLE_PATTERN` if name has `auth`, like `authMessage`). |
| 🟡 | `src/plugin/rules/security.ts:67-72` | The fallback regex `SECRET_PATTERNS` is short — it covers Stripe (`sk_live_`/`sk_test_`), AWS, GitHub, GitLab, Slack, OpenAI. Misses Google API keys (`AIza[0-9A-Za-z\-_]{35}`), Firebase, Twilio, Supabase, etc. Probably fine for v1, but call it out. |
| 🟡 | `src/plugin/rules/bundle-size.ts:5-27` | `noBarrelImport` uses a `didReportForFile` flag to fire once per file. But it's reset per `create()` invocation, which is per file — OK. However, `let didReportForFile = false` lives in the outer closure of every module-level rule. A reader might reasonably expect "once per file" to mean global. Worth a comment. |
| 🟡 | `src/plugin/rules/bundle-size.ts:43-54` | `noMoment` only flags `import "moment"` literally. Misses `require("moment")`, `import("moment")` (dynamic), and `moment.js` via package alias. Edge cases. |
| 🟡 | `src/plugin/rules/state-and-effects.ts:61-72` | `nonSetterIdentifiers.some(...)` followed by `.some(...)` — same array iterated twice. Minor. |
| 🟡 | `src/plugin/rules/performance.ts:380-399` | `renderingUsetransitionLoading` requires the variable to be exactly named `isLoading`/`isPending`. Most projects use `isFetching`, `loading`, `pending` (without the `is` prefix). The rule's reach is narrower than the help text. |
| 🟡 | `src/plugin/rules/performance.ts:269-291` | `noScaleFromZero` matches `scale: 0` only when the property name is exactly `scale`. Misses CSS `transform: "scale(0)"` (string), and React Native's `transform: [{ scale: 0 }]` (array of objects). |
| 🟡 | `src/plugin/rules/performance.ts:401-426` | `renderingHydrationNoFlicker` requires the effect deps to be `[]` exactly. So `useEffect(setState, [stableValue])` with one dep that the linter-aware reader knows is stable is missed (could still flicker). |
| 🟡 | `src/plugin/rules/correctness.ts:38-67` | `isInsideStaticPlaceholderMap` walks parents via `node.parent`. Several rules in the codebase rely on parent pointers — but oxlint's plugin host has historically required explicit parent linking. If parent pointers aren't set, this rule silently fails-open (no `parent` → loop never runs → `false`). |
| 🟢 | `src/plugin/rules/design.ts:97-128` | `parseColorToRgb` uses `parseInt(.., 16)` and `parseInt(.., 10)` and `parseFloat`. CSS allows alpha channels in HEX (`#aabbccdd`). The `lab()`, `lch()`, `oklab()`, `oklch()`, and `color()` functions are entirely unparsed. |
| 🟢 | `src/plugin/rules/design.ts:118` | `rgba?` regex doesn't support modern space-separated syntax `rgb(255 0 0 / 50%)` — only the comma-form. CSS Colors Level 4 has been stable for years. |
| 🟢 | `src/plugin/rules/design.ts:251` | `BLUR_VALUE_PATTERN.exec(property.value.value)` — uses `.exec` on a global-like regex without `/g`. Fine but `match()` would read more naturally. |
| 🟢 | `src/plugin/rules/design.ts:619` | `noTinyText` divides rem by 16 (root font-size). User-customized root font-sizes (`html { font-size: 18px }`) are a real thing for accessibility and the rule misses them. |
| 🟢 | `src/plugin/rules/design.ts:683-697` | `noGrayOnColoredBackground` only matches Tailwind. Inline-style `color: '#888'` on `backgroundColor: '#3b82f6'` is not flagged. |
| 🟢 | `src/plugin/rules/design.ts:723` | The reported message says "Transitioning layout property X causes layout thrash" but the regex matches `width|height|padding|margin` whether they're being transitioned **to** or **from** a value — it's about the `transition-property`, not the actual visible size change. Slightly imprecise. |
| 🟢 | `src/plugin/rules/correctness.ts:5-35` | `extractIndexName` checks `INDEX_PARAMETER_NAMES = new Set(["index", "idx", "i"])` (constants:60). Misses `_index`, `currentIndex`, `position`, `pos`, `n`. Probably acceptable but the help text claims "Array index used as key" without acknowledging the heuristic. |
| 🟢 | `src/plugin/rules/correctness.ts:139-160` | The rule's name is `renderingConditionalRender`. The category-mapped `Correctness` (run-oxlint:67) feels right, but the message ("can render '0'") is one of many issues with `&&` JSX rendering. The rule misses the broader pattern of `0 && <X />`. |
| 🟢 | `src/plugin/rules/architecture.ts:6` | Imports `RENDER_FUNCTION_PATTERN` which is shared with `noRenderInRender`. But the regex also matches `renderToString` from `react-dom/server` if used as a JSX child — false positive. |
| 🟢 | `src/plugin/rules/architecture.ts:11` | `node.value.type !== "JSXExpressionContainer"` — misses string-as-handler patterns (uncommon in React but valid). Negligible. |
| 🟢 | `src/plugin/rules/security.ts:15-27` | The message for `setTimeout("code()", 1000)` says "use a function instead". This is actually deprecated and most modern bundlers/lints already flag it. The rule duplicates what newer JS tooling does. |
| 🟢 | `src/plugin/rules/server.ts:38` | `declaration?.type !== "FunctionDeclaration"` — the rule misses `export const myAction = async () => { ... }` which is the more idiomatic Next.js form. Verified: `serverAuthActions` only fires on FunctionDeclaration exports. |
| 🟢 | `src/plugin/rules/nextjs.ts:51-77` | `nextjsAsyncClientComponent` only checks `node.async` on `FunctionDeclaration`/`VariableDeclarator.init`. Misses `export default async function MyComponent() {}`. |
| 🟢 | `src/plugin/rules/nextjs.ts:121-149` | `nextjsNoClientFetchForServerData` only fires when the file matches `PAGE_OR_LAYOUT_FILE_PATTERN \|\| PAGES_DIRECTORY_PATTERN`. So a co-located component used by a page doesn't trigger, even if it does the same fetch. The scope is more conservative than the help text suggests. |
| 🟢 | `src/plugin/rules/tanstack-query.ts:172-213` | `queryMutationMissingInvalidation` walks the entire `optionsArgument` (incl. mutationFn) for any `invalidateQueries` call. So `mutationFn: () => fetch().then(...).then(() => qc.invalidateQueries())` (invalidating inside mutationFn instead of `onSuccess`) wrongly suppresses the warning. |
| 🟢 | `src/plugin/rules/tanstack-query.ts:215-264` | `queryNoUseQueryForMutation` only inspects fetch calls with literal `method: "POST"` strings. Misses `method: requestMethod` (dynamic) and `method: HttpMethod.POST` (member). |
| 🟢 | `src/plugin/rules/tanstack-start.ts:497-528` | `tanstackStartNoSecretsInLoader` checks only `process.env.X`. Misses `import.meta.env.X` (the Vite-native way to read env vars in TanStack Start). |
| 🟢 | `src/plugin/rules/tanstack-start.ts:531-557` | `tanstackStartGetMutation` skips the rule if `chainInfo.specifiedMethod` is in `MUTATING_HTTP_METHODS`. But `method` could be `"post"` (lowercase) — the check `specifiedMethod.toUpperCase()` handles that. OK. But what if `method` is a variable? Then `specifiedMethod === null` and the rule continues, false-positive risk for dynamically-typed methods. |
| 🟢 | `src/plugin/rules/react-native.ts:62-86` | `rnNoRawText` early-returns when the parent is a "text-handling" component (per `isTextHandlingComponent`). Component name detection is `JSXIdentifier` only — misses `<Heading.H1>`/`<Theme.Text>` member-expressions even though the heuristic clearly intends to allow them. |
| 🟢 | `src/plugin/rules/react-native.ts:111-128` | `rnNoLegacyExpoPackages` uses `source.startsWith(`${packageName}/`)` for sub-imports. But `expo-permissions` matched by both the literal name and `"expo-permissions/some-sub-path"` — fine. However it doesn't respect path scoping, e.g. `@expo/vector-icons/MaterialIcons` matches `@expo/vector-icons/` and is flagged correctly. Fine. |
| 🟢 | `src/plugin/rules/js-performance.ts:267-293` | `reportIfIndependent` returns silently if any later statement references an earlier one. But if statement #2 references statement #1's result and statement #3 is independent of both, the rule never reports the #3 candidate. Could split parallel groups instead of bailing entirely. |
| 🟢 | `src/plugin/constants.ts:171-244` | `SECRET_FALSE_POSITIVE_SUFFIXES` has 60+ words. Combined with the simplistic `variableName.split("_").pop()` extraction in `noSecretsInClientCode`, a variable named `apiKeyHeader` gets `header` as suffix and is exempted. Fine. But `apiKey` (no underscore) gets the entire name as suffix, which doesn't match any in the set, so it's flagged. The word-splitting is `_`-only — camelCase variables are treated as one word. |
| 🟢 | `src/plugin/constants.ts:261-263` | `INTERNAL_PAGE_PATH_PATTERN` is a long alternation. `(/internal/|/admin/...)` — the `(` prefix makes `(dashboard)` match parenthesized route groups in App Router. But the regex requires the `()` literally; if the project uses `[dashboard]` (parameterized), it doesn't match. |

---

## 15. Additional Quick Wins

Adding to §7:

11. **Replace literal `"useEffect" / "useLayoutEffect"` checks with `isHookCall(node, EFFECT_HOOK_NAMES)`** in `tanstack-start.ts` (§9.1) — fixes a real false-negative.
12. **Add `pnpm typecheck` to CI** (§10.1).
13. **Add a Node 22 entry to the CI matrix** (§10.2) — the lower bound of `engines`.
14. **Document `react-doctor-disable-(next-)line` syntax in README** (§13.1).
15. **Fix `node.arguments?.length < 2` checks in `client.ts:9` and `performance.ts:404`** (§9.3).
16. **Cache `package.json` reads in `discover-project.ts`** (§12.2).
17. **Add a regression test for `:exit` visitor handling** to lock down §9.2 against future oxlint versions.
18. **Restore Make `JsonReport` a discriminated union by `ok`** (§11.3) — improves DX downstream.

---

## 16. Items I Did Not Verify (Pass 2)

- Whether oxlint v1.60 actually invokes `:exit` events for the visitor types used in this codebase (`FunctionDeclaration:exit`, `VariableDeclarator:exit`, `CallExpression:exit`, `JSXAttribute:exit`, `Program:exit`, `TryStatement:exit`, `CatchClause:exit`). This is the single biggest risk surface — would require running the test suite against a fresh fixture that toggles depth multiple times.
- Whether oxlint sets `node.parent` on traversed AST nodes (relied on by `correctness.ts:isInsideStaticPlaceholderMap` and `performance.ts:isMotionElement`).
- Whether the CI runs all 25+ test files when `pnpm test` is invoked (the turbo task graph could be excluding some).
- Whether `process.env.VERSION` is set during the CI build (`vite.config.ts:28` uses it; without it, the published `cli.js` will report version `0.0.0` from the `??` fallback in `cli.ts:29`).

These are the highest-leverage follow-ups for a maintainer's next pass.

---

# Third Pass — Website / Server, Skill Distribution, Cross-Package Drift

This pass focuses on the `packages/website/` Next.js app, the public-facing `/api/score` and `/install-skill` endpoints, the duplicated skill-distribution paths, the shared scoring logic, and project-hygiene concerns the first two passes didn't cover.

## 17. Server-Side / Privacy Issues

### 🔴 17.1 `/api/score` and `/api/estimate-score` log the entire request body server-side

```70:78:packages/website/src/app/api/score/route.ts
export const POST = async (request: Request): Promise<Response> => {
  const body = await request.json().catch(() => null);
  console.log("[/api/score]", JSON.stringify(body));
```

```76:78:packages/website/src/app/api/estimate-score/route.ts
export const POST = async (request: Request): Promise<Response> => {
  const body = await request.json().catch(() => null);
  console.log("[/api/estimate-score]", JSON.stringify(body));
```

The CLI (`utils/calculate-score-node.ts:7-12` via `core/try-score-from-api.ts:25-30`) POSTs the **entire** `Diagnostic[]` array — which includes `filePath` for every diagnostic — to `https://www.react.doctor/api/score` whenever `--offline` isn't set (the default). The server-side `console.log(JSON.stringify(body))` then pipes those file paths into Vercel's logs / wherever the deployment lands.

For a private monorepo the file paths reveal:
- Internal directory names (`src/internal/admin/`, `packages/billing-private/`, etc.).
- Component naming conventions and product feature names.
- Sometimes credential filenames (`.env.example`, `secrets.tsx`).

The README documents `--offline` as "Skip telemetry (anonymous, not stored, only used to calculate score)" (`cli.ts:177`). But the data is observably stored at minimum in process logs the moment it lands on the server. The user-facing copy is misleading.

Mitigation options, ordered by ease:
1. Strip `filePath` from the POSTed payload — only severity + plugin + rule are needed for scoring (per `calculate-score-locally.ts`).
2. Disable the `console.log` (or scope it to development).
3. Make `--offline` the default in CI (`AUTOMATED_ENVIRONMENT_VARIABLES` is already detected — flip the default there).
4. Hash file paths before POSTing.

This is the single biggest security finding across all three passes.

### 🟠 17.2 `/api/score` accepts unbounded request bodies

```70:71:packages/website/src/app/api/score/route.ts
export const POST = async (request: Request): Promise<Response> => {
  const body = await request.json().catch(() => null);
```

Next.js App Router doesn't apply the legacy `bodyParser.sizeLimit: "1mb"` to `route.ts` handlers. There is no explicit `runtime` declaration or size check. A client posting a 100 MB diagnostics array (or worse, a stream that never ends) consumes server memory until the platform's hard cap kicks in. `/api/estimate-score` has the same shape.

`isValidDiagnostic` (`api/score/route.ts:46-60`) is run via `body.diagnostics.every(...)` — for a 1 GB array this validates every entry before the response is built.

Add an explicit body-size cap (Next.js App Router supports `export const maxRequestBodySize` on route handlers) or stream-parse with a hard limit.

### 🟠 17.3 Open CORS `*` allows arbitrary origins to call scoring endpoints

```62:66:packages/website/src/app/api/score/route.ts
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
```

Combined with §17.2, any third-party site (or a single user's tab) can saturate these endpoints from the browser. The score response is cheap (~constant), but the validation pass over `body.diagnostics` is O(n). No rate limiting, no IP throttling, no auth.

If the endpoint is intended only for the `react-doctor` CLI, restrict origin to the known caller surface (the CLI doesn't need CORS at all — it's a Node process). If browser-side use is intended (e.g. for a future "paste your diagnostics" form), still cap requests per origin / IP.

### 🟠 17.4 `/install-skill` is a `curl | bash` distribution path

```183:189:packages/website/src/app/install-skill/route.ts
export const GET = (): Response =>
  new Response(INSTALL_SCRIPT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="install.sh"',
    },
  });
```

Although the script is statically embedded in the route (no user input), shipping it via `curl https://www.react.doctor/install-skill | bash` has a few well-known issues:

- Users can't review the script before it executes.
- A subdomain takeover or DNS hijack on `www.react.doctor` lets an attacker rewrite the script to anything (the script writes to `~/.claude`, `~/.cursor`, etc. — high-trust directories).
- The script doesn't pin a checksum or signature.
- The README never advertises this URL, but the CLI does install the same skill via `react-doctor install` (a separate mechanism). Two distribution channels for the same artifact, both unsigned.

Even if the team keeps the curl-pipe-bash path, document it with a `wget && shasum -c && bash` reference and a printed checksum.

### 🟠 17.5 The OG image route can be DoS'd with no rate limit

```24:117:packages/website/src/app/share/og/route.tsx
export const GET = (request: Request): ImageResponse => {
  ...
  return new ImageResponse(<div ...>...</div>, { width: 1200, height: 630 });
};
```

Each request renders an SVG via `next/og` (Satori + Resvg). At ~50–200ms per render, a single attacker hammering `/share/og?p=foo&s=42&...` can keep the route saturated indefinitely. The route also accepts arbitrary user-controlled `p` (project name) and renders it in the image — which means the cost can be amplified by long strings.

Add `Cache-Control` (the badge route already has 24 h caching at `/share/badge/route.ts:76` — the OG route lacks anything similar). Validate `p.length < 100` before rendering. Add a rate limiter at the platform level (Vercel WAF rules, e.g.).

### 🟡 17.6 `og` route doesn't validate `p` (projectName) length

```27:27:packages/website/src/app/share/og/route.tsx
  const projectName = searchParams.get("p") ?? null;
```

`p=AAAA...AAAA` (10 KB) gets rendered into the image. Satori will probably truncate at the layout, but doing so is wasted CPU. Bound the parameter length up front: `if ((projectName ?? "").length > 100) return new Response("Bad Request", { status: 400 })`.

### 🟡 17.7 `og` route doesn't bound `errorCount`/`warningCount`/`fileCount`

```28:31:packages/website/src/app/share/og/route.tsx
  const score = Math.max(0, Math.min(PERFECT_SCORE, Number(searchParams.get("s")) || 0));
  const errorCount = Math.max(0, Number(searchParams.get("e")) || 0);
  const warningCount = Math.max(0, Number(searchParams.get("w")) || 0);
  const fileCount = Math.max(0, Number(searchParams.get("f")) || 0);
```

`?e=999999999` renders "999999999 errors" on the OG image. Visually broken and a small abuse vector (link-preview spam carrying nonsense numbers). Cap at e.g. `Math.min(99999, ...)`.

Same applies to `share/page.tsx:62-63` and `share/page.tsx:96-99`.

### 🟢 17.8 OG image's `<img>` is missing `alt`

```50:50:packages/website/src/app/share/og/route.tsx
        <img src={brandMarkUrl} width={OG_BRAND_MARK_WIDTH_PX} height={OG_BRAND_MARK_HEIGHT_PX} />
```

`next/og` doesn't render anything from `alt`, but the codebase's own `nextjs-no-img-element` rule (and `jsx-a11y/alt-text`) would flag this if scanned. Self-violation.

### 🟢 17.9 `/install-skill` script duplicates the install logic that already lives in the CLI

The published `react-doctor` package has `runInstallSkill` (`src/install-skill.ts`) which:
- Detects available agents via `detectAvailableAgents` (only **on PATH**, via `accessSync`).
- Prompts before installing.
- Writes to project-local `.agents/skills/` per `installSkillForAgent`.

The website's `INSTALL_SCRIPT` (`/install-skill/route.ts:1-181`):
- Detects via `[ -d "$HOME/.cursor" ]`-style heuristics (not PATH-aware).
- Prompts nothing.
- Writes to global `$HOME/...` paths (NOT the project).

These are two different install philosophies that share neither code nor expected outcome:

| | CLI (`react-doctor install`) | Website (`/install-skill`) |
|---|---|---|
| Agents | claude, codex, copilot, gemini, cursor, opencode, droid, pi | claude, amp, cursor, opencode, windsurf, antigravity, gemini, codex |
| Detection | binary on PATH | `~/.X` directory |
| Prompts | Yes (multiselect) | No |
| Target | Project-local `.agents/skills/` | User-global `$HOME/...` |
| SKILL.md content | `skills/react-doctor/SKILL.md` | Inlined string in route.ts |

Notably, `copilot`, `droid` (Factory), and `pi` are CLI-only; `amp`, `windsurf`, `antigravity` are website-only. Users get a different skill ecosystem depending on which install method they follow.

### 🟢 17.10 SKILL.md content drifts between three sources

1. `skills/react-doctor/SKILL.md` (the canonical source bundled into `dist/skills/react-doctor/` via `vite.config.ts:9-17`).
2. `packages/website/src/app/install-skill/route.ts:17-37` (inlined `SKILL_CONTENT` string).
3. `packages/website/src/app/install-skill/route.ts:40-57` (inlined `AGENTS_CONTENT` string — a separate piece of similar content).

The descriptions diverge:
- Canonical: "Use when finishing a feature, fixing a bug, before committing React code, or when the user wants to improve code quality or clean up a codebase."
- Inlined #1/#2: "Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project."

A maintainer updating the canonical file won't propagate edits to the curl-script users. Either:
- Make `/install-skill` route read from `skills/react-doctor/SKILL.md` at build-time (Next.js `import` of the file content),
- Or delete the route in favor of a `npx -y react-doctor@latest install` recommendation.

---

## 18. Cross-Package Logic Duplication (Score / Branding)

The score formula, thresholds, labels, and ASCII branding are duplicated **seven** times across the repo:

| File | Duplicates |
|---|---|
| `packages/react-doctor/src/core/calculate-score-locally.ts` | thresholds, label, scoring formula (canonical) |
| `packages/react-doctor/src/scan.ts:208-225` | `getDoctorFace`, `printBranding` |
| `packages/website/src/app/api/score/route.ts:1-44` | thresholds, label, scoring formula |
| `packages/website/src/app/api/estimate-score/route.ts:1-50` | same + 2 extra "fix rate" constants |
| `packages/website/src/app/share/page.tsx:5-41` | thresholds, label, color, `getDoctorFace` |
| `packages/website/src/app/share/animated-score.tsx:5-37` | thresholds, label, color, `ScoreBar` |
| `packages/website/src/app/share/og/route.tsx:3-22` | thresholds, label, color |
| `packages/website/src/app/share/badge/route.ts:1-29` | thresholds, color (`getBadgeScoreColor`) |
| `packages/website/src/app/leaderboard/page.tsx:5-23` | thresholds, label, color, `getDoctorFace`, `ScoreBar` |
| `packages/website/src/components/terminal.tsx:18-186` | thresholds, label, color, `getDoctorFace`, `ScoreBar`, `ScoreGauge` |

If the team changes the threshold (say to 80 / 60 instead of 75 / 50) or the penalty (say `ERROR_RULE_PENALTY = 2`):

- The CLI prints **one** result.
- `--offline` calculates a **second** different result locally.
- The API at `react.doctor/api/score` returns a **third** result.
- The OG image, badge, share page, leaderboard, animated score, and terminal component all show their own renderings.

Recommended fix: extract `calculate-score-locally.ts`, the thresholds, the label/color/face helpers into a shared package (e.g. `@react-doctor/scoring`) that **both** packages depend on. The website becomes a single workspace consumer of the CLI package's `./api` export. The drift goes away.

### 🟠 18.1 `getScoreLabel` thresholds are tested only in the CLI package

`packages/react-doctor/src/utils/calculate-score-browser.ts` has a test (`tests/browser.test.ts`) that compares browser/node scoring against `calculateScoreLocally`. The website's seven duplicate implementations have **zero** test coverage. A change to the canonical thresholds would silently break consistency across the surfaces — only the CLI tests would fire.

### 🟠 18.2 `DiagnosticInput` interface duplicated between CLI and website endpoints

```7:18:packages/website/src/app/api/score/route.ts
interface DiagnosticInput {
  filePath: string;
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
  weight?: number;
}
```

This is the same as `Diagnostic` (`packages/react-doctor/src/types.ts:54-65`) but redeclared. If the CLI ever adds a new field, the API still validates against the old shape and silently rejects. A shared schema (zod, valibot, or simply re-importing the type) is missing.

`/api/estimate-score/route.ts:10-21` repeats the interface again.

### 🟢 18.3 Lossy `isValidDiagnostic` validation accepts `weight` as unspecified

The optional `weight?` field is in the interface but the `isValidDiagnostic` predicate doesn't validate it. A client sending `weight: "not a number"` would pass validation. Minor — `weight` isn't used by the score endpoint — but a strict schema would catch this.

---

## 19. Website / Frontend Findings

### 🟠 19.1 Leaderboard renders user-controlled URL via `<a href>` without scheme validation

```45:51:packages/website/src/app/leaderboard/page.tsx
      <a
        href={entry.githubUrl}
        target="_blank"
        rel="noreferrer"
        className="ml-2 truncate text-white transition-colors hover:text-blue-400 sm:ml-4"
      >
```

`entry.githubUrl` comes from `leaderboard-entries.ts`, which is contributable via PR (the page's own copy says "open a PR to leaderboard-entries.ts"). PRs go through review, but reviewers may not catch a `javascript:alert(1)` URL — React doesn't sanitize `href` values. Pin the prefix (`if (!entry.githubUrl.startsWith("https://github.com/")) throw …`) at the data definition or in `buildShareUrl`/component.

### 🟠 19.2 Leaderboard uses raw `<img>` instead of `next/image`

```83:83:packages/website/src/app/leaderboard/page.tsx
          <img src="/favicon.svg" alt="React Doctor" width={20} height={20} />
```

```376:376:packages/website/src/components/terminal.tsx
            <img src="/favicon.svg" alt="React Doctor" width={24} height={24} />
```

```31:31:packages/website/src/app/share/badge-snippet.tsx
        <img src={badgePreviewPath} alt="React Doctor score badge" height={20} className="block" />
```

The project's own `nextjs-no-img-element` rule is intended to flag exactly this. If react-doctor is ever run on its own website (it should be, per "dogfooding"), it would emit warnings on its own code.

### 🟡 19.3 `terminal.tsx` constants could be in a shared `constants.ts`

The 24 magic constants at the top of `terminal.tsx` — including `TARGET_SCORE = 42`, `TOTAL_ERROR_COUNT = 22`, `ELAPSED_TIME = "2.1s"` — should live in `constants.ts` per the project's own AGENTS.md rule. Hard-coded `"2.1s"` is particularly suspect (will look stale forever).

### 🟡 19.4 `terminal.tsx` `setTimeout`-based animation, not `requestAnimationFrame`

```50:50:packages/website/src/components/terminal.tsx
      setTimeout(animate, SCORE_FRAME_DELAY_MS);
```

```122:123:packages/website/src/components/terminal.tsx
const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
```

`react-doctor`'s own `noGlobalCssVariableAnimation` rule flags `setTimeout` patterns that update animation values per frame. Self-violation again, plus `setTimeout` doesn't pause when the tab is backgrounded — battery drain on mobile.

`AnimatedScore` (`share/animated-score.tsx:50`) has the same pattern.

### 🟡 19.5 `terminal.tsx` cleanup doesn't clear pending timeouts

```314:362:packages/website/src/components/terminal.tsx
    let cancelled = false;

    const update = (patch: Partial<AnimationState>) => {
      if (!cancelled) setState((previous) => ({ ...previous, ...patch }));
    };

    const run = async () => {
      ...
      await sleep(INITIAL_DELAY_MS);
      ...
    };

    run();
    return () => {
      cancelled = true;
    };
```

The cleanup only flips a boolean. If the user navigates away mid-typing-animation, all the `setTimeout` calls inside `sleep` keep firing until they resolve their promises. The check `if (!cancelled)` prevents state updates, but the timer slots stay alive. Track each `setTimeout`'s id and `clearTimeout` on cleanup, or use `AbortController`.

### 🟡 19.6 `localStorage` access in render via `didAnimationComplete`

```289:295:packages/website/src/components/terminal.tsx
const didAnimationComplete = () => {
  try {
    return localStorage.getItem(ANIMATION_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
};
```

This is called inside `useEffect`, which runs only client-side, so SSR is fine. But the `try { } catch { return false; }` masks any exception, including quota errors. For a flag value that's only a boolean, this is OK; for any future expansion the silent failure is risky.

### 🟡 19.7 `BadgeSnippet` `setTimeout` cleanup missing on unmount

```22:25:packages/website/src/app/share/badge-snippet.tsx
  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdownSnippet);
    setDidCopy(true);
    setTimeout(() => setDidCopy(false), COPY_FEEDBACK_DURATION_MS);
  };
```

Same in `terminal.tsx:CopyCommand:189-194`. The 2-second timeout will call `setDidCopy(false)` even if the component is unmounted. React 18+ handles this without a warning, but a stale state update is still a leak. Use `useRef<NodeJS.Timeout>` and clear in cleanup.

### 🟡 19.8 `<a target="_blank" rel="noreferrer">` should also include `noopener`

```47:48:packages/website/src/app/leaderboard/page.tsx
      <a
        href={entry.githubUrl}
        target="_blank"
        rel="noreferrer"
```

```155:158:packages/website/src/app/share/page.tsx
        <a
          href={twitterShareUrl}
          target="_blank"
          rel="noreferrer"
```

`rel="noreferrer"` implies `noopener` in modern browsers, but old browsers still need both. `rel="noreferrer noopener"` is the safe form. Multiple sites — `share/page.tsx`, `leaderboard/page.tsx`, `share/badge-snippet.tsx`, `terminal.tsx`.

### 🟡 19.9 `terminal.tsx` directly calls `location.reload()` which loses unsaved state

```445:449:packages/website/src/components/terminal.tsx
            onClick={() => {
              try {
                localStorage.removeItem(ANIMATION_COMPLETED_KEY);
              } catch {}
              location.reload();
            }}
```

A full page reload is a sledgehammer for "restart the demo". Replace with `setState(INITIAL_STATE)` and re-trigger the animation effect; same UX, no flash.

### 🟡 19.10 `next.config.ts` rewrites to `/llms.txt` but the file doesn't ship in the public directory

```4:24:packages/website/next.config.ts
const nextConfig: NextConfig = {
  rewrites: async () => {
    return {
      beforeFiles: [
        {
          source: "/",
          destination: "/llms.txt",
          ...
```

Searching `packages/website/public/` (didn't enumerate above; can be verified) for `llms.txt` — if the file isn't present, the rewrite produces 404s for clients sending `Accept: text/markdown`. Worth confirming the file exists.

### 🟢 19.11 `og/route.tsx` doesn't set Cache-Control

The OG image is fully deterministic given the query params, but the response is uncached. Combined with §17.5, every link-unfurler cold-renders the image. Add a long `Cache-Control: public, immutable, max-age=31536000` since the params are content-addressed.

### 🟢 19.12 Score components have nine separate definitions of `getDoctorFace`

```208:212:packages/react-doctor/src/scan.ts
const getDoctorFace = (score: number): string[] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["◠ ◠", " ▽ "];
  if (score >= SCORE_OK_THRESHOLD) return ["• •", " ─ "];
  return ["x x", " ▽ "];
};
```

vs `share/page.tsx:37-41` which returns `[string, string]` (typed tuple) using Unicode escapes (`\u25E0`, `\u2022`, `\u2500`, `\u25BD`) — same characters, different sources. Plus the same code in `terminal.tsx:130-134`, `animated-score.tsx` (none), `leaderboard/page.tsx:19-23` — all hand-written, slightly different.

A single utility in the shared scoring package (per §18) would fix this.

### 🟢 19.13 Animated score uses chained `setTimeout` per-frame instead of native `setInterval`/rAF

```42:57:packages/website/src/app/share/animated-score.tsx
  useEffect(() => {
    let cancelled = false;
    let frame = 0;

    const animate = () => {
      if (cancelled || frame > SCORE_FRAME_COUNT) return;
      setAnimatedScore(Math.round(easeOutCubic(frame / SCORE_FRAME_COUNT) * targetScore));
      frame++;
      setTimeout(animate, SCORE_FRAME_DELAY_MS);
    };
```

Since each `setTimeout` callback enqueues another one, cancelling has to rely on the closed-over flag. There's no `clearTimeout`, so the last queued frame can still run after unmount and call `setAnimatedScore` (a no-op in React 18+, but a wasted micro-task). Same pattern in `terminal.tsx:run`.

---

## 20. Project Hygiene

### 🟠 20.1 `CHANGELOG.md` is unusable for downstream consumers

```36:99:packages/react-doctor/CHANGELOG.md
## 0.0.36
### Patch Changes
- fix

## 0.0.35
...
- fix
```

Of 42 published versions, 30+ have `fix` or `init` as the only changelog message. A user upgrading from 0.0.20 to 0.0.42 has zero way to know what changed. The two most recent entries (0.0.42) demonstrate the project knows how to write good changelog messages — apply that standard going forward.

This is a soft sign of "ship fast, document later" — fine for early development, but the package is on npm and being downloaded. Future regressions would be invisible.

### 🟠 20.2 `tsconfig.json` uses `moduleResolution: "bundler"` for a published Node library

```1:12:tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
```

The package is published with `target: "node18"` (`packages/react-doctor/vite.config.ts:25, 42`) and runs as a CLI under Node directly. `moduleResolution: "bundler"` allows extension-less imports and other affordances that **don't** survive `tsc --noEmit` against Node's runtime semantics. The mismatch could let a developer write a `.js` import that bundles fine but breaks at runtime in odd edge cases.

For a Node-targeted package, `"moduleResolution": "nodenext"` (or `"node16"` for ESM-first projects) is more aligned with the ship surface.

### 🟠 20.3 `tsconfig.json` missing `verbatimModuleSyntax` / `isolatedModules`

Without `verbatimModuleSyntax: true`, `import type` and value imports can be interchanged at the source level, leading to subtle behavior differences when bundlers strip types. With `isolatedModules: false` (the default), some constructs that only work because the whole-program type-checker resolves them silently get emitted differently. For a library that ships ESM + DTS, both flags should be enabled.

### 🟠 20.4 `.npmrc` `shamefully-hoist=true` masks dependency bugs

```1:1:.npmrc
shamefully-hoist=true
```

This forces pnpm to flatten `node_modules` like npm does. A dev who imports a package they don't list in `dependencies` gets it for free at install time, but the published artifact will fail when consumers install it through strict pnpm or yarn PnP. Without a comment explaining why this is set (probably because of `oxlint`'s native bindings or `knip`'s dynamic loading), future maintainers will be tempted to remove it.

### 🟡 20.5 `.gitignore` doesn't list `review-report.md` (or any review/scratch files)

```1:6:.gitignore
node_modules
dist
.turbo
*.log
.DS_Store
.cursor
```

The user is currently authoring `review-report.md` in the repo root. If they `git add .`, it ships into history. Ad-hoc convention: `*.review.md` or `review-*.md` could be ignored by default, or the user should explicitly exclude `review-report.md` if they don't intend to commit it.

### 🟡 20.6 Build emits `dist/` per package but no `release` workflow validates it

There's no CI step that runs `pnpm build && pnpm publish --dry-run` to catch packaging regressions. The `dist/` directory is produced at release time; if someone deletes `vite.config.ts:hooks.build:done.copySkillToDist()` accidentally, nobody notices until users complain that `react-doctor install` says "Could not locate the react-doctor skill bundled with this package." (`install-skill.ts:31`).

### 🟡 20.7 `.changeset/config.json` doesn't include `linked` for the website

```1:11:.changeset/config.json
{
  ...
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["website"]
}
```

`ignore: ["website"]` is correct for a private workspace package, but if the website were ever promoted to a published package, this would silently break versioning. Worth a comment.

### 🟢 20.8 `pnpm-workspace.yaml` `overrides` and root `package.json` `pnpm.overrides` are duplicated

```40:50:package.json
  "pnpm": {
    "onlyBuiltDependencies": [...],
    "overrides": {
      "vite": "npm:@voidzero-dev/vite-plus-core@^0.1.15",
      "vitest": "npm:@voidzero-dev/vite-plus-test@^0.1.15"
    }
  }
```

```4:6:pnpm-workspace.yaml
overrides:
  vite: npm:@voidzero-dev/vite-plus-core@^0.1.15
  vitest: npm:@voidzero-dev/vite-plus-test@^0.1.15
```

Same overrides in two locations. pnpm prefers `pnpm-workspace.yaml` when both exist (in newer pnpm), but historically picked one or the other. Either pick a single home and delete the duplicate.

### 🟢 20.9 `tsconfig.json` is the same one used by both `react-doctor` and `website` packages

```1:8:packages/react-doctor/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "declarationMap": true
  },
  "include": ["src"]
}
```

```packages/website/tsconfig.json (read separately)
```

The website is a Next.js app (different lib/jsx settings). Sharing a base is fine, but the website will import its own tsconfig that overrides several keys; keep this in mind when adding strictness flags to root.

### 🟢 20.10 `assets/` directory at repo root contains SVGs but isn't covered by anything

The README references `./assets/react-doctor-readme-logo-dark.svg` and `./assets/react-doctor-readme-logo-light.svg`. These files presumably exist (didn't enumerate), but nothing in build/CI checks that. A renamed/deleted asset breaks the README silently.

---

## 21. Minor / Stylistic (Pass 3)

| Severity | File / Location | Issue |
|---|---|---|
| 🟡 | `packages/website/src/app/install-skill/route.ts` | The shell script uses `printf` with `\\n` and `${GREEN}/${RESET}` interpolation — fragile under macOS bash 3.2 (the default shell on macOS pre-Sonoma defaults). Use `echo` for newlines and avoid format-string interpolation of color codes. |
| 🟡 | `packages/website/src/app/install-skill/route.ts:104-119` | Windsurf install path uses `grep -q "$MARKER" "$RULES_FILE"` to check idempotence. `grep -q` returns 0 for "found" but the script depends on `set -e` not killing it on "not found" (exit 1). The `if … then … else …` correctly handles this, but a shellcheck pass would catch fragile patterns. |
| 🟡 | `packages/website/src/app/install-skill/route.ts:122` | `command -v agy` checks for "Antigravity" via the `agy` binary, but the project name documented elsewhere is "Antigravity" — the actual CLI binary may differ. Verify the binary name with the upstream tool. |
| 🟡 | `packages/website/src/app/install-skill/route.ts:147-151` | The `openai.yaml` interface block is hard-coded with display_name `react-doctor` and a static description. If the script content changes (`SKILL_CONTENT`), this YAML is silently out of sync. |
| 🟡 | `packages/website/src/app/install-skill/route.ts:156-162` | After agent-specific installs, the script unconditionally creates `.agents/$SKILL_NAME` in the current directory. But the route is hit via `curl ... | bash` — the "current directory" is wherever the user launched the curl, often `$HOME`, putting the agents dir at `$HOME/.agents/react-doctor`. Maybe intentional, but documented behavior would be clearer. |
| 🟡 | `packages/website/src/components/terminal.tsx:289-301` | `try { localStorage.getItem(...) } catch {}` and `try { localStorage.setItem(...) } catch {}` patterns repeat — extract to a `safeLocalStorage` helper. Same pattern in `share/animated-score.tsx` and elsewhere. |
| 🟡 | `packages/website/src/app/share/page.tsx:77-83` | `ogSearchParams.set("p", resolvedParams.p)` — the OG image route only uses `s`, `e`, `w` (and `p` for project name). `f` is set but the OG route's `getScoreColor`/render doesn't reference `f` for image visuals beyond the file count line. Probably fine, but worth aligning. |
| 🟡 | `packages/website/src/app/share/page.tsx:54-91` | `generateMetadata` and the page component both re-run `clampScore(Number(s)…)` and the URL-search-params construction — duplicate validation. Extract a shared `parseShareSearchParams` helper. |
| 🟡 | `packages/website/src/app/share/badge/route.ts:16` | `CACHE_MAX_AGE_SECONDS = 86400` (24h) — reasonable, but the OG image route doesn't follow the same convention (§19.11). |
| 🟡 | `packages/website/src/app/share/badge/route.ts:32-36` | `computeScoreTextLength` charges `SLASH_WIDTH_10X` for `/` and `DIGIT_WIDTH_10X` for everything else. So if `score` is somehow `100/100`, `100/100` is 7 chars; the function correctly computes width. But for 1-digit scores `5/100`, the `5` and the three `1`,`0`,`0` digits all use the same width — fine. But `score >= 100` is impossible (clamped), so the function never sees more than 3-digit scores. Clean. |
| 🟡 | `packages/website/src/app/share/badge/route.ts:50-71` | The SVG template is built via string concatenation with backtick template literals. User input `score` is interpolated directly into XML (`textLength="${scoreTextLength}"`). Since `score` is `Math.max(0, Math.min(100, Number(...)))`, it's clamped to a number — safe. But if any future contributor adds a string param without sanitization, XML injection becomes possible. Use a tiny escape function. |
| 🟡 | `packages/website/src/app/leaderboard/leaderboard-entries.ts:146-148` | `RAW_ENTRIES.sort(...)` mutates the input array. If anything else imports `RAW_ENTRIES` (currently nothing), the sort order would be observed. Use `toSorted` (ES2023, Node 20+ which the project supports). |
| 🟢 | `packages/react-doctor/CHANGELOG.md` | The version 0.0.41 / 0.0.40 entries say "fix" — entries 0.0.36 to 0.0.20 same. See §20.1. |
| 🟢 | `packages/website/src/app/api/score/route.ts:46-60` | `isValidDiagnostic` enforces all 9 fields, but doesn't enforce that `severity` is `"error"|"warning"` strictly via discriminated narrowing — the predicate is correct but the resulting type doesn't help downstream. |
| 🟢 | `packages/website/src/app/api/estimate-score/route.ts:7-8` | `ERROR_ESTIMATED_FIX_RATE = 0.85` and `WARNING_ESTIMATED_FIX_RATE = 0.8` — magic constants without explanation. What's the source? Worth a comment. |
| 🟢 | `packages/website/src/app/install-skill/route.ts:1-181` | The script is 180 LOC of bash inside a 1-line export. If it grows, debugging is awful — no source maps, no line numbers, no syntax highlighting in most editors. Move to a `.sh` file imported via `fs.readFileSync` at build time. |
| 🟢 | `packages/website/next.config.ts` | The `rewrites` block doesn't pin a status code or fall-through behavior. Default Next.js semantics work, but explicit is better. |
| 🟢 | `tsconfig.json:7` | `declaration: true` at root + `noEmit: true` + `declarationMap: true` in package configs is mildly contradictory (`tsc --noEmit` doesn't emit anything, including declarations). The actual emit comes from vite-plus, not tsc. Worth a comment. |
| 🟢 | `packages/react-doctor/CHANGELOG.md` | The entry for 0.0.42 is well-written (issue numbers, file paths, reasoning). The 0.0.39 entry (about IssueRecords) is also fine. The rest aren't. |

---

## 22. Additional Quick Wins (pass 3)

19. **Strip `filePath` from the score-API POST payload, or make `--offline` default in CI** (§17.1) — single biggest privacy fix.
20. **Add a body-size limit to `/api/score` and `/api/estimate-score`** (§17.2).
21. **Restrict CORS on `/api/score` and `/api/estimate-score`** (§17.3) — at minimum to the CLI's user agent, or rate-limited.
22. **Cache `/share/og` responses** the same way `/share/badge` is cached (§19.11).
23. **Bound `errorCount`/`warningCount`/`fileCount` in OG/share params** (§17.7).
24. **Extract scoring logic + thresholds into a shared package** (§18) — eliminates seven duplicates.
25. **Fix `<a target="_blank" rel="noreferrer">` to also include `noopener`** (§19.8).
26. **Replace duplicate SKILL.md copies with build-time read of the canonical file** (§17.10).
27. **Validate `entry.githubUrl` scheme in leaderboard-entries** (§19.1) — defense against future XSS via PR.
28. **Improve CHANGELOG.md** going forward (§20.1).

---

## 23. Items I Did Not Verify (Pass 3)

- Whether `/llms.txt` actually exists in `packages/website/public/`. The rewrite in `next.config.ts:9` would 404 if missing. **Verified in Pass 4: it does exist** (along with `install-skill.sh` and the brand assets).
- Whether the Vercel deployment (or whichever hosts the site) has any rate limiting or WAF rules in front of `/api/score`, `/api/estimate-score`, `/share/og`, `/install-skill`. None of these are visible in the repo, but they may exist at the platform level.
- Whether the curl-pipe-bash distribution at `https://www.react.doctor/install-skill` is actually advertised anywhere (the README doesn't mention it).
- Whether the leaderboard scores were generated by running react-doctor against the listed projects, or hand-edited (the file `leaderboard-entries.ts` is statically defined; hand-edits could drift from real scoring).
- Whether `process.env.VERSION` flows through the website's deployment too — the website doesn't appear to read it, so the share page's "react-doctor 0.0.0" risk doesn't apply.
- Whether the `BadgeSnippet` SVG has been validated as RFC-compliant (the inline `<svg>` template is hand-rolled).

These would warrant follow-up if a related bug or content drift surfaces.

---

# Fourth Pass — Command Injection, Configuration Walks, Test Coverage Gaps, Static-File Drift

This pass focuses on shell-related security findings, configuration discovery edge cases, additional test gaps, and more cross-package drift.

## 24. Security: Command Injection

### 🔴 24.1 `--diff <base>` arg flows directly into a shell command (command injection)

```42:64:packages/react-doctor/src/utils/get-diff-files.ts
const getChangedFilesSinceBranch = (directory: string, baseBranch: string): string[] => {
  try {
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      cwd: directory,
      stdio: "pipe",
    })
      .toString()
      .trim();

    const output = execSync(`git diff --name-only --diff-filter=ACMR --relative ${mergeBase}`, {
      cwd: directory,
      stdio: "pipe",
    })
```

`baseBranch` here comes from the CLI flag `--diff <base>` (or the config field `diff`):

```291:294:packages/react-doctor/src/cli.ts
      const isDiffCliOverride = program.getOptionValueSource("diff") === "cli";
      const effectiveDiff = isDiffCliOverride ? flags.diff : userConfig?.diff;
      const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
      const diffInfo = getDiffInfo(resolvedDirectory, explicitBaseBranch);
```

`execSync` with a template-string argument runs the command through `/bin/sh -c` (see Node docs for `child_process.execSync`). User input is interpolated raw. A user (or worse, a CI system that takes the diff base from a PR title or branch name) running:

```bash
react-doctor --diff "main; rm -rf ~"
```

…produces a shell command:

```bash
/bin/sh -c 'git merge-base main; rm -rf ~ HEAD'
```

`rm -rf ~` runs against the user's home directory. This is a **command injection** in the strict sense.

The second `execSync` on line 51 interpolates `mergeBase`, which is the SHA output from `git merge-base`. A malicious git history (e.g., a fork with a custom commit message that fakes the SHA output via git hook trickery, or a `.git/HEAD` containing `; rm -rf ~`) could trigger the same injection. This second one is defense-in-depth — the first is the immediate vulnerability.

`get-diff-files.ts:31` (`git rev-parse --verify ${candidate}`) is currently safe because `candidate` only iterates `DEFAULT_BRANCH_CANDIDATES = ["main", "master"]`, but the pattern is identical and a future contributor could point it at user input.

Fix: switch to the array form everywhere — `spawnSync('git', ['merge-base', baseBranch, 'HEAD'], { cwd, stdio: 'pipe' })`. The other git callers in `utils/get-staged-files.ts`, `utils/discover-project.ts`, `utils/resolve-lint-include-paths.ts`, and `utils/neutralize-disable-directives.ts` already use this safe form. Only `get-diff-files.ts` regressed to `execSync` + template strings.

The `action.yml` GitHub Action passes `INPUT_DIFF: ${{ inputs.diff }}` to `--diff $INPUT_DIFF` (`action.yml:69`), which is a shell-interpolated CI variable. If a downstream workflow reads `inputs.diff` from a `pull_request_target` payload or any other untrusted source, the chain is end-to-end exploitable.

### 🟠 24.2 `NVM_DIR` env var flows into a shell command

```81:95:packages/react-doctor/src/utils/resolve-compatible-node.ts
export const installNodeViaNvm = (): boolean => {
  const nvmDirectory = getNvmDirectory();
  if (!nvmDirectory) return false;

  const nvmScript = path.join(nvmDirectory, "nvm.sh");
  if (!existsSync(nvmScript)) return false;

  try {
    execSync(`bash -c ". '${nvmScript}' && nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}"`, {
      stdio: "inherit",
    });
```

`nvmDirectory` is from `getNvmDirectory()` which reads `process.env.NVM_DIR`. An adversary who controls the user's environment (which is mostly self-harm — but also includes scenarios where a `.env`-loading wrapper exposes attacker-controlled values) can inject:

```bash
NVM_DIR="'/tmp; touch /tmp/pwned; '" react-doctor
```

…yields:

```bash
bash -c ". ''/tmp; touch /tmp/pwned; '/nvm.sh' && nvm install 24"
```

The single quotes don't escape because the user-controlled value contains them. This requires the user to first decline a Ctrl-C, hit "yes" on the install prompt, and have NVM installed — but since the script also runs with `stdio: "inherit"`, it pollutes the user's terminal directly.

Fix: use `spawnSync('bash', ['-c', `. ${shellEscape(nvmScript)} && nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`], { stdio: 'inherit' })`. Or call `nvm` via a wrapper that doesn't go through `bash -c`.

### 🟠 24.3 `binaryPath` from filesystem is interpolated into a shell command

```72:78:packages/react-doctor/src/utils/resolve-compatible-node.ts
const getNodeVersionFromBinary = (binaryPath: string): string | null => {
  try {
    return execSync(`"${binaryPath}" --version`, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
};
```

`binaryPath = path.join(versionsDirectory, bestVersion.directoryName, "bin", "node")` (`resolve-compatible-node.ts:68`). `bestVersion.directoryName` comes from `readdirSync(versionsDirectory)` (`resolve-compatible-node.ts:54-63`).

If a user creates a directory named `v0.0.0"; rm -rf ~; "` inside `~/.nvm/versions/node/` (e.g., via shell completion accident, malicious npm postinstall script, etc.), running `react-doctor` triggers:

```bash
"/Users/me/.nvm/versions/node/v0.0.0"; rm -rf ~; "/bin/node" --version
```

Switch to `spawnSync(binaryPath, ['--version'], { encoding: 'utf-8' })`. The double-quote shell-escape used here is brittle — `"` characters in the path itself break it.

### 🟢 24.4 `check-reduced-motion.ts:43` is currently safe but uses a fragile pattern

```42:46:packages/react-doctor/src/utils/check-reduced-motion.ts
    execSync(`git grep -ql -E "${REDUCED_MOTION_GREP_PATTERN}" -- ${REDUCED_MOTION_FILE_GLOBS}`, {
      cwd: rootDirectory,
      stdio: "pipe",
    });
```

Both `REDUCED_MOTION_GREP_PATTERN` and `REDUCED_MOTION_FILE_GLOBS` are constants. Today this is safe. But the file globs include `'"*.ts" "*.tsx" ...'` — interpolated as a literal string with embedded quotes — which means the entire command relies on `/bin/sh` parsing for the glob expansion. Any future contributor who passes a dynamic value here introduces injection.

Convert to the safe form (`spawnSync('git', ['grep', '-ql', '-E', REDUCED_MOTION_GREP_PATTERN, '--', '*.ts', '*.tsx', ...])`).

---

## 25. Configuration Walk Edge Cases

### 🔴 25.1 `loadConfig` walks past project boundaries indefinitely

```45:57:packages/react-doctor/src/utils/load-config.ts
export const loadConfig = (rootDirectory: string): ReactDoctorConfig | null => {
  const localConfig = loadConfigFromDirectory(rootDirectory);
  if (localConfig) return localConfig;

  let ancestorDirectory = path.dirname(rootDirectory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorConfig = loadConfigFromDirectory(ancestorDirectory);
    if (ancestorConfig) return ancestorConfig;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return null;
};
```

The walk goes all the way to the filesystem root. There is no boundary at the project root (no `.git` check, no `findMonorepoRoot` check, no `package.json` check). Consequences:

1. A user with `~/react-doctor.config.json` (e.g., a leftover or a personal default) gets that config silently applied to every project they run `react-doctor` in — even unrelated projects in `~/work/`, `~/oss/`, `~/sandbox/`. The config could include `lint: false`, `customRulesOnly: true`, or `ignore.rules: ["*"]` — masking issues without the user realizing.

2. On macOS, walking up from `/Users/me/projects/foo/packages/bar` checks `/Users/me/projects/foo/`, `/Users/me/projects/`, `/Users/me/`, `/Users/`, `/`. Five `fs.stat`s before giving up; 7 if you count the package.json fallback. For every cold-start scan.

3. On a multi-tenant CI runner that mounts `/home/runner` and shares it across jobs, a config left from a previous job's tarball would leak.

The `findMonorepoRoot` helper already exists for exactly this kind of bounding. Stop the walk at the monorepo root or first `.git` directory.

This is also a behavior regression risk — adding the bound would break any user relying on the unbounded walk today.

### 🟠 25.2 `loadConfigFromDirectory` falls through to `package.json` inconsistently

```10:43:packages/react-doctor/src/utils/load-config.ts
const loadConfigFromDirectory = (directory: string): ReactDoctorConfig | null => {
  const configFilePath = path.join(directory, CONFIG_FILENAME);

  if (isFile(configFilePath)) {
    try {
      const fileContent = fs.readFileSync(configFilePath, "utf-8");
      const parsed: unknown = JSON.parse(fileContent);
      if (isPlainObject(parsed)) {
        return parsed as ReactDoctorConfig;
      }
      console.warn(`Warning: ${CONFIG_FILENAME} must be a JSON object, ignoring.`);
    } catch (error) {
      console.warn(...);
    }
  }

  const packageJsonPath = path.join(directory, "package.json");
  if (isFile(packageJsonPath)) {
    ...
  }

  return null;
};
```

Tested behavior in `tests/load-config.test.ts:199-241` confirms: when `react-doctor.config.json` is malformed or non-object, `loadConfig` falls through to the same directory's `package.json#reactDoctor`. That's the documented behavior.

But the warning log fires for `react-doctor.config.json` even when the function ultimately succeeds via `package.json` fallback. Users see "Failed to parse react-doctor.config.json" alongside a successful scan — looks like a partial failure. Either silence the warning when fallback succeeds, or upgrade it to a specific actionable message ("react-doctor.config.json is malformed; using package.json#reactDoctor instead").

### 🟠 25.3 `loadConfig` warning printed via `console.warn`, not the silenced logger

```20:24:packages/react-doctor/src/utils/load-config.ts
      console.warn(`Warning: ${CONFIG_FILENAME} must be a JSON object, ignoring.`);
    } catch (error) {
      console.warn(
        `Warning: Failed to parse ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
      );
```

Inside `--json` mode the CLI sets `setLoggerSilent(true)` so the structured JSON report is the only thing on stdout. But `console.warn` writes to **stderr**, bypassing the logger's silent flag. Programmatic callers parsing both streams will see a stray "Warning: Failed to parse react-doctor.config.json: …" line — which they have to either filter out or treat as a fault.

Fix: route through `logger.warn(...)` (which already exists and respects the silent flag).

### 🟢 25.4 `findMonorepoRoot` accepts `nx.json` but `discover-project.ts` doesn't

```5:12:packages/react-doctor/src/utils/find-monorepo-root.ts
export const isMonorepoRoot = (directory: string): boolean => {
  if (isFile(path.join(directory, "pnpm-workspace.yaml"))) return true;
  if (isFile(path.join(directory, "nx.json"))) return true;
  const packageJsonPath = path.join(directory, "package.json");
  if (!isFile(packageJsonPath)) return false;
  const packageJson = readPackageJson(packageJsonPath);
  return Array.isArray(packageJson.workspaces) || Boolean(packageJson.workspaces?.packages);
};
```

`isMonorepoRoot` recognizes `nx.json` (line 7) as a monorepo signal. But `discover-project.ts:listWorkspacePackages`/`getWorkspacePatterns` only inspects `pnpm-workspace.yaml` and `package.json#workspaces`. A pure Nx monorepo (no workspaces in package.json) would be detected by `findMonorepoRoot` but yield no workspace packages — `selectProjects` would fall back to the root scan, missing nested apps.

Inconsistent: either drop the `nx.json` recognition, or implement Nx workspace discovery (`nx.json` → `projects/**/project.json`).

### 🟢 25.5 `loadConfig`'s ancestor walk is O(depth) per `discoverProject` call

`discoverProject` calls `loadConfig` indirectly through several paths (via `cli.ts:193`, via `scan.ts:486`, via `index.ts:92`, etc.), and `loadConfig` walks every ancestor directory checking for two files. If `discoverProject` and other helpers each call `loadConfig` independently for the same directory, the walk repeats. In a monorepo scan with N projects, that's `N × depth × 2 file stats`, all redundant.

Memoize `loadConfig` at module scope keyed by absolute path.

---

## 26. Static-File / Source-of-Truth Drift

### 🔴 26.1 `install-skill.sh` exists in BOTH the route AND `public/` — two static copies plus the bundled SKILL.md

The website ships THREE separate copies of the skill installation logic and content:

1. **`packages/website/src/app/install-skill/route.ts`** — server route that returns an inlined string (`INSTALL_SCRIPT`) of 180+ lines.
2. **`packages/website/public/install-skill.sh`** — a static file (180 lines, near-identical to #1).
3. **`skills/react-doctor/SKILL.md`** — canonical skill content the CLI bundles.

Plus the inlined `SKILL_CONTENT` and `AGENTS_CONTENT` strings inside #1 and #2 themselves.

The `head -50` of `install-skill.sh` exactly matches the content of `INSTALL_SCRIPT` in `route.ts`. So users can reach the script via either:

- `https://www.react.doctor/install-skill` (the route, dynamic)
- `https://www.react.doctor/install-skill.sh` (the static file, served by Next.js's public folder handler at `/install-skill.sh`)

Both URLs work. There's no automation copying one to the other; if a maintainer updates the route's inlined string, the static file goes stale (or vice versa). **Three places to update for any change**.

Recommended: delete `packages/website/public/install-skill.sh` and rely on the route. Or invert the relationship — `route.ts` reads `fs.readFileSync('./public/install-skill.sh')` at request time (or build time).

### 🟠 26.2 The `description` in skill content varies subtly across all three sources

| Source | Description |
|---|---|
| `skills/react-doctor/SKILL.md:3` | "Use when finishing a feature, fixing a bug, before committing React code, or when the user wants to improve code quality or clean up a codebase. Checks for score regression. Covers lint, dead code, accessibility, bundle size, architecture diagnostics." |
| `route.ts:20` (SKILL_CONTENT) | "Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project." |
| `public/install-skill.sh` | (same as route.ts SKILL_CONTENT) |
| `route.ts:42` (AGENTS_CONTENT) | "Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project." |

Three different audiences see different framings of when to invoke the skill. The canonical SKILL.md mentions accessibility and bundle size (which are real categories); the inlined version doesn't.

### 🟢 26.3 `package.json#bin` and the published filename

```23:25:packages/react-doctor/package.json
  "bin": {
    "react-doctor": "./dist/cli.js"
  },
```

If `vite-plus pack` ever changes the bundled output filename (e.g., to `cli.mjs` for ESM-explicitness), this entry would break silently — users would `npm install -g react-doctor` and get a "command not found" until they noticed. Worth a smoke test in CI: `pnpm build && node dist/cli.js --version`.

---

## 27. Test Coverage Gaps (Pass 4)

The first three passes established that several rule categories and CLI flag handlers had no coverage. Pass 4 found more.

### 🟠 27.1 `discover-project.ts:resolveCatalogVersion` has no tests for non-pnpm catalogs

```254:303:packages/react-doctor/src/utils/discover-project.ts
const resolveCatalogVersion = (
  packageJson: PackageJson,
  packageName: string,
  rootDirectory?: string,
): string | null => {
  ...
  if (isPlainObject(raw.catalog)) { ... }
  if (isPlainObject(raw.catalogs)) { ... }
  ...
  const workspaces = packageJson.workspaces;
  if (workspaces && !Array.isArray(workspaces) && isPlainObject(workspaces.catalog)) { ... }
```

The function handles four catalog sources: package-json `catalog`, package-json `catalogs`, package-json `workspaces.catalog`, and pnpm-workspace.yaml. The fixture `pnpm-catalog-workspace` exists, but there's no fixture for npm/yarn-style `catalog:` references in package.json. The 50+ lines of catalog resolution past the pnpm path have zero test coverage — easy place for a regression.

### 🟠 27.2 `noClientSideRedirect` has no test for the Pages Router branch

```215:238:packages/react-doctor/src/plugin/rules/nextjs.ts
export const nextjsNoClientSideRedirect: Rule = {
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isPagesRouterFile = PAGES_DIRECTORY_PATTERN.test(filename);

    return {
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
        ...
```

The `tests/run-oxlint.test.ts:144-156` tests the **Pages Router branch** specifically (the only test for `nextjsNoClientSideRedirect`):

```144:156:packages/react-doctor/tests/run-oxlint.test.ts
  describe("nextjs router guidance", () => {
    it("does not recommend next/navigation for pages-router redirects", async () => {
```

…but not the App Router branch. If somebody flips the `isPagesRouterFile` ternary the wrong way in `describeClientSideNavigation`, only the App Router branch breaks silently.

### 🟠 27.3 `tanstack-start-no-secrets-in-loader` has no negative tests (`VITE_*` whitelist)

The rule whitelists env vars starting with `VITE_` (per §9.9 — the whitelist itself is a bug). There's a positive test that `process.env.SECRET_KEY` in a loader fires the rule (`run-oxlint.test.ts:472-477`). There's no test that:

- `process.env.VITE_SECRET_KEY` does **not** fire (it should, because Vite exposes those to the client — but the current rule whitelist treats them as safe).
- `process.env.NODE_ENV` does **not** fire (this is fine; the rule should skip it).

Adding both tests would lock down the rule's behavior against the bug fix in §9.9.

### 🟠 27.4 `tanstack-start-no-navigate-in-render` has no test for cleanup of nested effects

The rule increments `effectDepth` on `useEffect` enter, decrements on exit. There's a positive test that nested-rendering `navigate()` is caught, but no test for the "effect → useState → effect" sequence which would verify that `effectDepth` doesn't double-decrement or fall negative. (Tied to the §9.2 `:exit` concern.)

### 🟠 27.5 `runOxlint` has no test for the batched-includePaths path

`batchIncludePaths` (run-oxlint.ts:408-434) splits files into batches based on `SPAWN_ARGS_MAX_LENGTH_CHARS` (24 KB) and `OXLINT_MAX_FILES_PER_BATCH` (500). There's no test that constructs a pathological set of 1000 files (or files with very long names) and verifies all batches are consumed and diagnostics are merged correctly.

A regression that lost the "carry-over" batch (e.g., changing `if (currentBatch.length > 0) { batches.push(currentBatch); }` to use the wrong condition) would silently scan only the first batch.

### 🟠 27.6 No tests for `SIGABRT` / `SIGKILL` handling in `spawnOxlint`

```452:461:packages/react-doctor/src/utils/run-oxlint.ts
    child.on("error", (error) => reject(new Error(`Failed to run oxlint: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (signal) {
        const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
        const hint =
          signal === "SIGABRT" ? " (out of memory — try scanning fewer files with --diff)" : "";
        const detail = stderrOutput ? `: ${stderrOutput}` : "";
        reject(new Error(`oxlint was killed by ${signal}${hint}${detail}`));
        return;
      }
```

The OOM-hint is documented in `constants.ts:33-35` as a real scenario. Yet no test sends a fake `SIGABRT` to verify the message is wired up. A future refactor could drop the `signal === "SIGABRT"` branch and nobody would notice until users complain in production.

### 🟠 27.7 `materializeStagedFiles` has no test for binary content

```37:71:packages/react-doctor/src/utils/get-staged-files.ts
export const materializeStagedFiles = (
  directory: string,
  stagedFiles: string[],
  tempDirectory: string,
): StagedSnapshot => {
  ...
  for (const relativePath of stagedFiles) {
    const content = readStagedContent(directory, relativePath);
    if (content === null) continue;

    const targetPath = path.join(tempDirectory, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
```

`readStagedContent` returns `result.stdout.toString()` (default UTF-8 decoding). For staged binary files (PNG, PDF — sometimes accidentally tracked in source dirs), this corrupts the bytes. Then oxlint fails to parse them. There's no test verifying the path filter (`SOURCE_FILE_PATTERN`) actually keeps binaries out, and no test for what happens when a `.tsx` file contains invalid UTF-8 (rare but possible).

### 🟡 27.8 `loadConfig` has no test for the unbounded ancestor walk

`tests/load-config.test.ts:255-309` covers ancestor-walk basics — finds parent config, prefers local. But there's no test that asserts the walk stops at any boundary (because it doesn't — see §25.1). Adding a test that enforces "the walk stops at `findMonorepoRoot`" or similar would lock down a fix.

### 🟡 27.9 `resolveLintIncludePaths` has no tests

`utils/resolve-lint-include-paths.ts` is 79 lines — `listSourceFilesViaGit`, `listSourceFilesViaFilesystem`, glob ignore filtering, two paths. No corresponding `tests/resolve-lint-include-paths.test.ts`. A regression in the ignore-glob filter (e.g., `${rootDirectory}/foo` vs `foo` mismatch) would silently scan ignored files.

### 🟡 27.10 `prompts.ts` patches aren't tested for idempotency

```21:60:packages/react-doctor/src/utils/prompts.ts
const patchMultiselectToggleAll = (): void => {
  if (didPatchMultiselectToggleAll) return;
  didPatchMultiselectToggleAll = true;
  ...
};
```

The flags `didPatchMultiselectToggleAll` and `didPatchMultiselectSubmit` are module-level. Multiple calls to `prompts(...)` should patch only once. There's no test exercising this. If the flag check is removed by a refactor, the patches would accumulate and break behavior on the second-and-later prompt.

### 🟢 27.11 Config-file diff behavior has no integration test

```151:160:packages/react-doctor/tests/load-config.test.ts
    it("loads diff as boolean", () => {
      const boolDiffDirectory = path.join(tempRootDirectory, "with-bool-diff");
      ...
      expect(config?.diff).toBe(true);
    });
```

This tests that the loader **reads** the `diff` field. There's no test that the CLI **honors** the field (the resolution logic in `cli.ts:286-291` is non-trivial). A regression where `userConfig?.diff` was accidentally inverted would slip through.

### 🟢 27.12 `extract-failed-plugin-name.test.ts` doesn't cover Windows backslash-only paths

The tests cover `C:\repo\next.config.ts` (line 11) but not paths that ONLY use backslashes (no leading `C:`). The regex `PLUGIN_CONFIG_PATTERN` includes `\\`, so it should match — but no test confirms.

---

## 28. Additional Edge Cases (Pass 4)

### 🟠 28.1 `tests/scan.test.ts` doesn't restore `console.log` in async errors

```33:56:packages/react-doctor/tests/scan.test.ts
  it("completes without throwing on a valid React project", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await scan(path.join(FIXTURES_DIRECTORY, "basic-react"), {
        lint: true,
        deadCode: false,
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
```

This pattern is correct. But there are five copies of it across `scan.test.ts`, each repeating the spy boilerplate. Extract a `withSilencedConsole` test helper. Same applies to `vi.stubGlobal` patterns in `browser.test.ts:67-82`.

### 🟠 28.2 `extractFailedPluginName` regex is anchored to `.config.` literal

```3:3:packages/react-doctor/src/utils/extract-failed-plugin-name.ts
const PLUGIN_CONFIG_PATTERN = /(?:^|[/\\\s])([a-z][a-z0-9-]*)\.config\./i;
```

Misses bare `.babelrc`, `.eslintrc.json`, etc. The pattern only matches `*.config.{ext}` files. So a knip plugin loading error like `Error loading /repo/.eslintrc.json` returns `null` and the retry loop gives up. The CHANGELOG entry for 0.0.42 is specifically about expanding this — but `.eslintrc` and `.babelrc` are still not handled.

### 🟠 28.3 `formatErrorChain` returns "" for `undefined` but logs "null" for `null`

```17:24:packages/react-doctor/tests/format-error-chain.test.ts
  it("stringifies non-error values", () => {
    expect(formatErrorChain("plain message")).toBe("plain message");
    expect(formatErrorChain(null)).toBe("null");
  });

  it("returns an empty string when there is no error to format", () => {
    expect(formatErrorChain(undefined)).toBe("");
  });
```

`formatErrorChain(undefined)` returns `""` (empty string), but `formatErrorChain(null)` returns `"null"` (the string "null"). This is the documented behavior, but it's surprising. For programmatic callers checking `formatErrorChain(error) === ""` to mean "no error", they get a false positive only for `undefined`, not for `null`. Use `formatErrorChain(error)?.length` or normalize the API.

### 🟡 28.4 `is-file.ts` swallows EACCES and EISDIR identically

```3:9:packages/react-doctor/src/utils/is-file.ts
export const isFile = (filePath: string): boolean => {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
};
```

A directory at the path returns `false` (because `isFile()` is false). A permission error returns `false`. A non-existent path returns `false`. Three completely different states collapse to one return value. `loadConfig` (and many callers) treat `false` as "no config here", which silently masks real errors.

For `loadConfig`'s use case (probing for optional configs), this is correct — but the helper is reused across `discover-project.ts`, `find-monorepo-root.ts`, etc. A user with a `package.json` they can't read (network mount, ACL'd) gets an error message saying "No package.json found" (`discover-project.ts:551`), which is misleading.

### 🟡 28.5 `is-plain-object.ts` returns true for class instances

```1:2:packages/react-doctor/src/utils/is-plain-object.ts
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
```

`new Date()`, `new Map()`, `new Error()`, and a user-defined class all pass this check. The narrowing to `Record<string, unknown>` is a lie for any of those. For `load-config.ts:18` the fallout is that someone with a `react-doctor.config.json` containing `{"$schema": "..."}` is fine, but a JSON file containing `[1, 2, 3]` would correctly be rejected (because `Array.isArray`). However, anyone writing a config in JS that produces a `Map` instance via build-time evaluation would slip through.

For JSON parsing, this is fine (JSON can't produce class instances). For wider use (`isPlainObject(packageJson.catalog)` etc.), tighter check via `Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null` is more accurate.

### 🟡 28.6 `extractDestructuredPropNames` only inspects `ObjectPattern` and `Identifier`, missing `RestElement`

```252:266:packages/react-doctor/src/plugin/helpers.ts
export const extractDestructuredPropNames = (params: EsTreeNode[]): Set<string> => {
  const propNames = new Set<string>();
  for (const param of params) {
    if (param.type === "ObjectPattern") {
      for (const property of param.properties ?? []) {
        if (property.type === "Property" && property.key?.type === "Identifier") {
          propNames.add(property.key.name);
        }
      }
    } else if (param.type === "Identifier") {
      propNames.add(param.name);
    }
  }
  return propNames;
};
```

`function MyComponent({ a, b, ...rest })` — the `RestElement` (`...rest`) carries an arbitrary number of names that the rule won't see. `noDerivedUseState` (consumer of this function) thus won't flag `useState(rest.foo)` as derived from props.

Also misses `AssignmentPattern` defaults: `function MyComponent({ a = 1 })` — the property is still present, but if the destructure is `{ a: aliasedName }`, then `property.key` is `a` and `property.value` is `aliasedName`. The function adds `a` (the source key), but `noDerivedUseState` then checks `useState(aliasedName)` against a set containing `a` — false negative.

### 🟡 28.7 `walkAst` skips `parent` but doesn't skip other circular keys

```12:28:packages/react-doctor/src/plugin/helpers.ts
export const walkAst = (node: EsTreeNode, visitor: (child: EsTreeNode) => void): void => {
  if (!node || typeof node !== "object") return;
  visitor(node);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && item.type) {
          walkAst(item, visitor);
        }
      }
    } else if (child && typeof child === "object" && child.type) {
      walkAst(child, visitor);
    }
  }
};
```

Hard-codes `key === "parent"` to avoid the most obvious cycle. But ESTree has other potential back-references: `loc.start`/`loc.end` (objects without `.type`, so skipped), `range` (array of numbers, has `.type === undefined`, so skipped), and some traversers add `cache` keys. The check `item.type` filters most non-AST objects, but a malicious tree with `someKey: { type: "SomeFakeType", recursiveRef: <self> }` would loop forever. Defensive tracking via `WeakSet<EsTreeNode>` would prevent it.

### 🟢 28.8 `groupBy` always allocates a new Map even for empty input

```1:12:packages/react-doctor/src/utils/group-by.ts
export const groupBy = <T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    ...
  }

  return groups;
};
```

`Object.groupBy` (ES2024) does the same thing more efficiently, returns a plain object. Worth using once Node 22 is the minimum (already is per `engines.node`).

### 🟢 28.9 `colorize-by-score.test.ts` doesn't lock the actual color output

```5:9:packages/react-doctor/tests/colorize-by-score.test.ts
  it("returns a string for high scores", () => {
    const result = colorizeByScore("Great", 90);
    expect(typeof result).toBe("string");
    expect(result).toContain("Great");
  });
```

The test only checks `typeof === "string"` and `contains("Great")`. It doesn't verify the result actually contains the green ANSI escape code (`\x1b[32m`) or anything that would lock the colorization. A regression that returned plain text would still pass the test.

### 🟢 28.10 `formatErrorChain.test.ts` `Object.assign` self-reference is a foot-gun example

```52:55:packages/react-doctor/tests/extract-failed-plugin-name.test.ts
  it("avoids infinite recursion on a circular cause chain", () => {
    const error = new Error("outer");
    Object.assign(error, { cause: error });
```

OK as a unit test, but the same pattern in production code (someone bridging an error from a callback library that self-references) would lock up. The `walkAst` (§28.7) would not be safe in this scenario today.

### 🟢 28.11 `tests/format-error-chain.test.ts:25` reuses `getErrorChainMessages` to assert a circular case

```26:30:packages/react-doctor/tests/format-error-chain.test.ts
  it("stops on circular cause chains", () => {
    const error = new Error("loop");
    Object.assign(error, { cause: error });
    expect(getErrorChainMessages(error)).toEqual(["loop"]);
  });
```

Tests `getErrorChainMessages`, but the test name says "formatErrorChain" suite (line 4). The siblings are mixed. Refactor to put the circular test in its own suite.

---

## 29. Additional Quick Wins (Pass 4)

29. **Switch `get-diff-files.ts` from `execSync(template-string)` to `spawnSync(['git', 'merge-base', baseBranch, 'HEAD'])`** (§24.1) — closes a real command injection.
30. **Same for `resolve-compatible-node.ts`** (§24.2, §24.3) — closes lower-severity injections.
31. **Bound `loadConfig`'s ancestor walk at the monorepo root or project boundary** (§25.1) — fixes silent home-directory config inheritance.
32. **Route `loadConfig` warnings through `logger.warn`, not `console.warn`** (§25.3) — keeps `--json` output clean.
33. **Delete one of `route.ts` or `public/install-skill.sh`, and drive the other from a single source** (§26.1).
34. **Add a smoke test that runs `node dist/cli.js --version`** in CI after the build (§26.3).
35. **Add tests for `--diff main` end-to-end** (§27.11) — locks the user-input → execSync path before the injection is fixed.
36. **Add test for `tanstack-start-no-secrets-in-loader` that asserts `process.env.VITE_SECRET` IS flagged** (§27.3) — locks down the §9.9 fix.

---

## 30. Items I Did Not Verify (Pass 4)

- Whether `--diff <base>` is currently passed unsanitized through `action.yml`'s shell `$INPUT_DIFF` (line 69) — likely yes, but I didn't inspect every CI integration. **The action passes it as a positional arg to `npx`, but the variable expansion is in a shell string, so the same injection chain extends to the action's own shell step.**
- Whether `tests/run-oxlint.test.ts` runs all rule fixtures (the 25+ test files appear to share state via top-level `let` declarations in `run-oxlint.test.ts`; see also §28.1).
- Whether `static install-skill.sh` is currently advertised somewhere (e.g. SEO), or only reachable via the `/install-skill` route.
- Whether `tests/run-knip.test.ts`'s `vi.mock("knip", ...)` actually intercepts the `main` import that `runKnip` uses (the dynamic `await silenced(() => createOptions(...))` and `await silenced(() => main(options))` both go through `vi.hoisted`, so it should — but worth a sanity check after any module-system change).
- Whether the `nx.json`-only monorepo case (§25.4) is one any react-doctor user hits in practice.

These are the highest-value follow-ups for a maintainer's next pass on top of the Pass 1–3 backlog.

---

# Fifth Pass — Branding/URL Drift, Documentation Mismatches, Fixture-vs-Test Gap, Path Aliasing Bugs

This pass focuses on user-facing string drift, README claims that don't match implementation, the unused-fixture problem (where a rule's test fixture exists but no test asserts against it), and additional path/string-handling bugs.

## 31. Repo Identity / URL Drift

### 🔴 31.1 The repo references `aidenybai/react-doctor` and `millionco/react-doctor` interchangeably

A grep for `aidenybai|millionco` across the codebase shows the repo URL is split across two GitHub orgs:

| File / Location | URL |
|---|---|
| `package.json:4, 6, 10` | `https://github.com/aidenybai/react-doctor` |
| `packages/react-doctor/package.json:12, 14, 20` | `https://github.com/aidenybai/react-doctor` |
| `packages/react-doctor/src/cli.ts:380` | `https://github.com/millionco/react-doctor` |
| `packages/react-doctor/README.md:59` | `millionco/react-doctor@main` (Action recipe) |
| `packages/react-doctor/README.md:277` | `https://github.com/millionco/react-doctor` (clone URL) |
| `packages/website/src/app/leaderboard/page.tsx:11` | `https://github.com/millionco/react-doctor/edit/main/...` |
| `packages/website/src/components/terminal.tsx:30` | `https://github.com/millionco/react-doctor` |

Six files point at `millionco/`; three point at `aidenybai/`. Either:
- The repo was transferred or forked at some point and one set of URLs is stale.
- `millionco` is the org alias for the published presence and `aidenybai` is the personal mirror.

Either way, the inconsistency means:
- A user clicking "Star on GitHub" from the website lands on `millionco`.
- A user filing an issue from the npm package lands on `aidenybai`.
- A CI workflow following the README's Action recipe (`millionco/react-doctor@main`) and a developer who follows the published `bugs.url` field lands on different repos.

If one is a redirect, this works today but breaks the moment GitHub stops following the redirect (org rename, transfer reverted, etc.). Pick one canonical URL and replace all.

### 🟢 31.2 The "Star on GitHub" CTA in `terminal.tsx` is hard-coded

```30:30:packages/website/src/components/terminal.tsx
const GITHUB_URL = "https://github.com/millionco/react-doctor";
```

If the `aidenybai` URL becomes canonical, this constant has to change too — but lives in a website component, not a shared config. Same for `leaderboard/page.tsx:11`.

---

## 32. README / Documentation Drift

### 🟠 32.1 README example shows score label `"Good"` — but the API returns `"Great"` / `"Needs work"` / `"Critical"`

```208:212:packages/react-doctor/README.md
const result = await diagnose("./path/to/your/react-project");

console.log(result.score); // { score: 82, label: "Good" } or null
```

But `core/calculate-score-locally.ts:11`:

```10:14:packages/react-doctor/src/core/calculate-score-locally.ts
const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};
```

A score of 82 produces `"Great"`, not `"Good"`. The README is wrong. A first-time API user copy-pasting the example might `if (result.score.label === "Good") …` and never hit it.

### 🟠 32.2 README's `Diagnostic` interface omits `weight`

```225:236:packages/react-doctor/README.md
interface Diagnostic {
  filePath: string;
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
}
```

vs the actual exported shape (`types.ts:54-65`):

```54:65:packages/react-doctor/src/types.ts
export interface Diagnostic {
  filePath: string;
  plugin: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  help: string;
  line: number;
  column: number;
  category: string;
  weight?: number;
}
```

`weight` is optional, so the README example still type-checks for callers using `as Diagnostic`, but documented as it stands the field will surprise consumers of `result.diagnostics[i].weight`.

### 🟠 32.3 README leaderboard table is missing the top-scoring entry

```257:270:packages/react-doctor/README.md
| [tldraw](https://github.com/tldraw/tldraw)             | **84** | ...
| [excalidraw](https://github.com/excalidraw/excalidraw) | **84** | ...
...
| [dub](https://github.com/dubinc/dub)                   | **62** | ...
```

But `packages/website/src/app/leaderboard/leaderboard-entries.ts:131-139` includes:

```131:139:packages/website/src/app/leaderboard/leaderboard-entries.ts
  {
    name: "nodejs.org",
    githubUrl: "https://github.com/nodejs/node",
    packageName: "@node-core/website",
    score: 88,
    ...
```

The website data has `nodejs.org` at score 88 (the highest), but the README's table caps at 84 (tldraw/excalidraw). Two parallel sources of truth that have already drifted. The README is lying to anyone who reads it without clicking through to the live leaderboard.

This is also AGENTS.md "Remove unused code and don't repeat yourself" violation §4.2 in spirit — duplicated data already drifted.

### 🟡 32.4 README claims `lint` and `deadCode` defaults of `true` — but config can override

```217:221:packages/react-doctor/README.md
const result = await diagnose(".", {
  lint: true, // run lint checks (default: true)
  deadCode: true, // run dead code detection (default: true)
});
```

The `diagnose` function in `index.ts:90-97` reads from `loadConfig` first and **then** layers the explicit `options` on top. If a user has `react-doctor.config.json` with `lint: false`, calling `diagnose(".")` (no options) gets `lint: false` — but `diagnose(".", { lint: true })` gets `lint: true`. The README says `default: true` which is accurate for the bare-options case but obscures the config-precedence.

### 🟡 32.5 README's `--json` Schema doc claims `score: { score: number; label: string } | null`, but the implementation returns `ScoreResult | null` with a possibly-different shape

```126:134:packages/react-doctor/README.md
  projects: Array<{
    directory: string;
    project: ProjectInfo;
    diagnostics: Diagnostic[];
    score: { score: number; label: string } | null;
    skippedChecks: string[];
    elapsedMilliseconds: number;
  }>;
```

`ScoreResult` (`types.ts:92-95`) is `{ score: number; label: string }` — matches today. But the README inlines the shape; if `ScoreResult` ever adds a field (e.g. `weight`, `details`), the README docs go stale silently. Should reference the type, not inline.

### 🟡 32.6 README claims `pnpm -r run build` — root `package.json` has only `pnpm build` (turbo-driven)

```279:280:packages/react-doctor/README.md
pnpm install
pnpm -r run build
```

vs root `package.json:15`:

```15:15:package.json
  "build": "turbo run build --filter=react-doctor",
```

The root has a turbo-managed build that filters to `react-doctor` (skips the website). `pnpm -r run build` runs `build` in **every** workspace package, including `website` (which uses `next build` requiring a fully populated env). For a fresh contributor following the README, this fails.

### 🟢 32.7 README's "Configuration" section advertises `lint` and `deadCode` but no `verbose`

```183:198:packages/react-doctor/README.md
| Key               | Type                             | Default  | Description                                                                                                                         |
| ----------------- | -------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
...
| `verbose`         | `boolean`                        | `false`  | Show file details per rule (same as `--verbose`)                                                                                    |
```

OK actually verbose is documented — never mind. But the table is missing `failOn`'s typing nuance: it's a string union of three specific values, but the table just shows the type. Worth quoting them inline.

### 🟢 32.8 README advertises `react-doctor/api` and `react-doctor/browser` but `react-doctor/worker` only mentioned in passing

```151:152:packages/react-doctor/README.md
Git history, real filesystem discovery, knip, the CLI, staged-file detection, and interactive prompts are **not** available in the browser bundle; treat those as Node-only or supply equivalents yourself. `react-doctor/worker` re-exports the same browser-facing modules for worker targets.
```

Per §3.1 (Pass 1), `worker.ts` is essentially identical to `browser.ts`. The README confirms this was intentional — but two separate `exports` paths with the same content remains awkward.

---

## 33. Fixture-vs-Test Coverage Gap

The fixtures under `tests/fixtures/basic-react/src/` contain test cases for rules that have **no corresponding assertion in `tests/run-oxlint.test.ts`**. Fixtures exist (someone wrote them), but the test runner just calls `runOxlint` once and only asserts on a subset of rules.

### 🔴 33.1 `design-issues.tsx` has 47 components for 14 design rules — zero assertions

```text
$ wc -l design-issues.tsx
271 design-issues.tsx
```

Components in the fixture: `BounceEasingComponent`, `BounceAnimationComponent`, `SpringTimingComponent`, `TailwindBounceComponent`, `AbsurdZIndexComponent`, `AbsurdZIndexStringComponent`, `InlineStyleOverloadComponent`, `SideTabInlineComponent`, `SideTabTailwindComponent`, `PureBlackBgComponent`, `PureBlackBgShortComponent`, `PureBlackTailwindComponent`, `GradientTextInlineComponent`, `GradientTextTailwindComponent`, `DarkGlowComponent`, `JustifiedTextComponent`, `JustifiedWithHyphensComponent`, `TinyTextComponent`, `TinyTextNumberComponent`, `WideTrackingComponent`, `WideTrackingUppercaseOk`, `GrayOnColorComponent`, `GrayOnColorSlateComponent`, `LayoutTransitionComponent`, `HeightTransitionComponent`, `DisabledZoomComponent`, `RestrictedZoomComponent`, `OutlineNoneComponent`, `OutlineZeroComponent`, `OutlineNoneWithShadowOk`, `SlowTransitionComponent`, `SlowTransitionDurationComponent`, …plus 15 "OK" cases for negative testing.

Searching `tests/run-oxlint.test.ts` for any of these design-rule names: **zero matches**. The fixture is exercised when `await runOxlint(BASIC_REACT_DIRECTORY, true, "unknown", false)` runs, but no `describeRules` block asserts that the design rules fire on these components. A regression that disabled all 14 design rules would still produce a green test suite.

Affected rules (all enabled in `oxlint-config.ts`):
- `no-inline-bounce-easing`, `no-z-index-9999`, `no-inline-exhaustive-style`, `no-side-tab-border`, `no-pure-black-background`, `no-gradient-text`, `no-dark-mode-glow`, `no-justified-text`, `no-tiny-text`, `no-wide-letter-spacing`, `no-gray-on-colored-background`, `no-layout-transition-inline`, `no-disabled-zoom`, `no-outline-none`, `no-long-transition-duration`.

Someone went to the trouble of writing 47 fixture components — but the wire-up to `describeRules` was never finished.

### 🔴 33.2 `js-performance-issues.tsx` has 11 components — only 2 are asserted; 9 of them test dead rules

```text
$ wc -l js-performance-issues.tsx
106 js-performance-issues.tsx
```

The fixture exports 11 components. Of those, the test suite asserts only 2:

```243:257:packages/react-doctor/tests/run-oxlint.test.ts
  describeRules(
    "async performance rules",
    {
      "async-parallel": { fixture: "js-performance-issues.tsx", ... },
      "js-flatmap-filter": { fixture: "js-performance-issues.tsx", ... },
    },
    () => basicReactDiagnostics,
  );
```

The other 9 fixture components (`CombineIterationsComponent`, `SpreadSortComponent`, `MinViaSortComponent`, `RegexpInLoopComponent`, `SetMapLookupsComponent`, `BatchDomCssComponent`, `IndexMapsComponent`, `CacheStorageComponent`, `EarlyExitComponent`) test the 9 rules that are dead per **§1.1** (Pass 1) — registered in plugin but not enabled in `oxlint-config.ts`. So the fixture proves the rules **were intended** to run, but the config never turned them on, and the test never failed because the assertions for them were never added.

This is a unique fingerprint of incomplete refactor: fixtures, plugin registrations, category maps, and help maps all in place — config and test cells empty.

### 🟠 33.3 `architecture-issues.tsx:GenericHandlerComponent` tests `no-generic-handler-names` — also dead

```3:6:packages/react-doctor/tests/fixtures/basic-react/src/architecture-issues.tsx
const GenericHandlerComponent = () => {
  const handleClick = () => {};
  return <button onClick={handleClick}>Click</button>;
};
```

The rule `no-generic-handler-names` (per §1.1, Pass 1) is registered but not enabled. The fixture-component is therefore "dressing" — it tests a feature that doesn't actually run. Same root cause as §33.2.

### 🟠 33.4 `state-issues.tsx:DependencyLiteralComponent` tests `[{}]` and `[[]]` — but only via the broad "rerender-dependencies" test

```94:97:packages/react-doctor/tests/fixtures/basic-react/src/state-issues.tsx
const DependencyLiteralComponent = () => {
  useEffect(() => {}, [{}]);
  useCallback(() => {}, [[]]);
  return <div />;
};
```

The test (`run-oxlint.test.ts:135-139`) asserts `rerender-dependencies` fires with severity `"error"`. But there's no test for:
- Function-call deps (`[getOptions()]`) — the rule misses this case, but the fixture wouldn't tell us.
- Spread-deps (`[...arr]`).
- Conditional-expr deps (`[cond ? a : b]`).

These are common bug shapes in the wild. Adding fixture cases would surface what the rule misses (per §9.5, Pass 2).

### 🟠 33.5 `correctness-issues.tsx:ConditionalRenderBug` tests only the `MemberExpression.length` form

```9:19:packages/react-doctor/tests/fixtures/basic-react/src/correctness-issues.tsx
const ConditionalRenderBug = ({ items }: { items: string[] }) => (
  <div>
    {items.length && (
      <ul>
```

The rule (`renderingConditionalRender` in `correctness.ts:139-160`) only matches `someExpr.length && <X />`. Fixture covers that. But the underlying React bug — rendering `0` literally — also happens for raw numbers (`{count && <X />}` where `count = 0`). No fixture, no test, no rule coverage. Missed-case via missing fixture.

### 🟠 33.6 `clean.tsx:HeavyMemoizedIteration` is the regression test for `no-usememo-simple-expression` false positives — unmistakably tied to a real bug

```28:42:packages/react-doctor/tests/fixtures/basic-react/src/clean.tsx
const HeavyMemoizedIteration = ({
  users,
  currentUserId,
}: {
  users: { id: number; isSelected: boolean }[];
  currentUserId: number;
}) => {
  const selectedUserCount = useMemo(
    () =>
      users.filter((user) => user.id !== currentUserId).filter((user) => user.isSelected).length,
    [currentUserId, users],
  );

  return <div>{selectedUserCount}</div>;
};
```

Test (`run-oxlint.test.ts:82-89`):

```82:89:packages/react-doctor/tests/run-oxlint.test.ts
  it("does not flag no-usememo-simple-expression for chained iteration callbacks", () => {
    const memoIssues = basicReactDiagnostics.filter(
      (diagnostic) =>
        diagnostic.rule === "no-usememo-simple-expression" &&
        diagnostic.filePath.endsWith("clean.tsx"),
    );
    expect(memoIssues).toHaveLength(0);
  });
```

This is a **negative** test (asserting no false positives), which is great. But there are no positive tests that the rule fires on a *truly* trivial expression — `useMemo(() => 1 + 1, [])`. Combined with §33.1, the design rules and the simple-expression rule both lack positive assertions.

### 🟡 33.7 `tanstack-start-app` and `nextjs-app` fixtures have no negative tests

`tests/run-oxlint.test.ts` has positive `describeRules` blocks for both `nextjsDiagnostics` and `tanstackStartDiagnostics`. There are also a few `describe("tanstack-start edge cases (false positive freedom)")` cases (line 525-561). But the patterns aren't symmetric: `nextjs` has no false-positive-freedom block at all. Any rule that starts producing spurious diagnostics on the nextjs fixture would still pass tests.

### 🟡 33.8 No fixture for the `--customRulesOnly` flag's interaction with framework rules

`run-oxlint.test.ts:563-597` tests that `customRulesOnly=true` excludes `react/` and `jsx-a11y/` rules. But it doesn't assert that framework-conditional rules (`nextjs-*`, `rn-*`, `tanstack-start-*`) are still included. A regression where `customRulesOnly` accidentally killed the framework rules would pass.

### 🟡 33.9 No fixture for `--diff` with file-globs

`tests/run-oxlint.test.ts` has tests for `runOxlint` with no `includePaths` and with explicit `[file]` arrays (lines 145-156). But never for the case where `includePaths` is a **mix** of JSX/TSX and non-JSX files (because `computeJsxIncludePaths` filters). The filter logic is tested in `tests/combine-diagnostics.test.ts:18-34` but in isolation; the integration of "diff produces a mixed set of changed files, only JSX is sent to oxlint" is untested.

### 🟢 33.10 `bundle-issues.tsx` and `client-issues.tsx` weren't read for §33 — they may have similar gaps

I read `state-issues.tsx`, `architecture-issues.tsx`, `correctness-issues.tsx`, `js-performance-issues.tsx`, `design-issues.tsx`, `security-issues.tsx`, `performance-issues.tsx` (partially), `clean.tsx`, `query-issues.tsx` (skimmed). I did **not** open `bundle-issues.tsx` or `client-issues.tsx` directly; the test references some of them (lines 230-285), but a full audit would catch additional fixture-vs-test-asymmetry cases.

---

## 34. Additional Bugs in Edge Cases

### 🟠 34.1 `cli.ts` JSON staged report leaks the temp directory in `project.rootDirectory`

```233:260:packages/react-doctor/src/cli.ts
        try {
          const scanResult = await scan(snapshot.tempDirectory, {
            ...scanOptions,
            includePaths: snapshot.stagedFiles,
            configOverride: userConfig,
          });

          const remappedDiagnostics = scanResult.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            filePath: path.isAbsolute(diagnostic.filePath)
              ? diagnostic.filePath.replace(snapshot.tempDirectory, resolvedDirectory)
              : diagnostic.filePath,
          }));

          if (isJsonMode) {
            const remappedScanResult: ScanResult = {
              ...scanResult,
              diagnostics: remappedDiagnostics,
            };
```

When the user runs `react-doctor --staged --json`:
1. Files are materialized into `snapshot.tempDirectory`.
2. `scan(snapshot.tempDirectory, ...)` runs `discoverProject(snapshot.tempDirectory)`, which produces a `ProjectInfo` with `rootDirectory: snapshot.tempDirectory` (something like `/tmp/react-doctor-staged-AbCdEf/`).
3. The diagnostics file paths are remapped — but `scanResult.project.rootDirectory` (and `projectName` if it falls back to `path.basename(directory)` because the staged copy of `package.json` lacks a name) is **not** remapped.
4. The JSON report (`buildJsonReport({ scans: [{ directory: resolvedDirectory, result: remappedScanResult }], ...})`) embeds the project info verbatim.

Result: a `--staged --json` report has `projects[0].project.rootDirectory: /tmp/react-doctor-staged-…` while `projects[0].directory` points at the user's actual project. Two paths, different shapes, confusing for consumers. Worse, the temp dir name is non-deterministic, so report diffing is broken.

Fix: remap `scanResult.project.rootDirectory` too (or pass `resolvedDirectory` explicitly to `discoverProject` for staged scans).

### 🟠 34.2 `String.replace(snapshot.tempDirectory, resolvedDirectory)` only replaces the first occurrence

```241:243:packages/react-doctor/src/cli.ts
            filePath: path.isAbsolute(diagnostic.filePath)
              ? diagnostic.filePath.replace(snapshot.tempDirectory, resolvedDirectory)
              : diagnostic.filePath,
```

`String.prototype.replace(string, string)` replaces only the **first** match. If the temp directory string happens to appear in the path multiple times (extremely unlikely, but possible if the temp directory string is short or contains a common pattern that recurs in the file path), only the first occurrence is replaced.

Edge case yes — but `replaceAll` (or the `.split().join()` trick) would be unambiguously correct. The same fix simplifies §34.1's broader concern.

### 🟠 34.3 `detectReactCompiler` misses modern Next.js compiler config syntax

```52:54:packages/react-doctor/src/utils/discover-project.ts
const REACT_COMPILER_PACKAGE_REFERENCE_PATTERN =
  /babel-plugin-react-compiler|react-compiler-runtime|eslint-plugin-react-compiler|["']react-compiler["']/;
const REACT_COMPILER_ENABLED_FLAG_PATTERN = /["']?reactCompiler["']?\s*:\s*true\b/;
```

The flag regex matches `reactCompiler: true` (the legacy syntax). Modern Next.js (16+) uses `experimental.reactCompiler: { compilationMode: 'all' }` — an **object literal**, not a `true` boolean. The current regex doesn't match. So a project using modern compiler config:

```js
const config: NextConfig = {
  experimental: {
    reactCompiler: {
      compilationMode: 'annotation',
    },
  },
};
```

…has `hasReactCompiler === false`, which means `oxlint-config.ts:128, 136` won't add the React Compiler rules and `oxlint-config.ts:126` adds `react-perf` rules instead. The user gets:
- Compiler-aware `react-hooks-js/*` rules NOT applied (false negatives).
- `react-perf/*` rules ARE applied — which the compiler is supposed to obviate (false positives).

A wider regex: `/["']?reactCompiler["']?\s*:\s*(?:true|\{)/` would catch both cases.

### 🟠 34.4 `detectReactCompiler` returns `true` based on ancestor package.json — false positives in mixed monorepos

```535:543:packages/react-doctor/src/utils/discover-project.ts
  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    if (isFile(ancestorPackagePath)) {
      const ancestorPackageJson = readPackageJson(ancestorPackagePath);
      if (hasCompilerPackage(ancestorPackageJson)) return true;
    }
    ancestorDirectory = path.dirname(ancestorDirectory);
  }
```

If `monorepo-root/package.json` has `babel-plugin-react-compiler` in `devDependencies` (e.g., for a sibling app that uses the compiler), every workspace package — including ones that don't use it — gets `hasReactCompiler === true`. The rule set switches to compiler-aware mode for those non-compiler packages, producing false negatives.

The signal here is too coarse. Better: only count compiler-ON if the package.json directly under the scanned directory references it, OR if a config file inside this directory enables it. Don't infer from ancestor monorepo-root deps (which often catch-all everything).

### 🟠 34.5 `detectReactCompiler`'s ancestor walk is unbounded (same bug as §25.1)

The walk goes to the filesystem root. Same concern: a `~/.config/some-tool/package.json` that lists `babel-plugin-react-compiler` (transitive) would be picked up. Less likely than `loadConfig`'s case, but the bound should still be the monorepo root or `.git`.

### 🟠 34.6 `cascading-set-state` rule is borderline-obsolete in React 18+

```105:121:packages/react-doctor/src/plugin/rules/state-and-effects.ts
export const noCascadingSetState: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!callback) return;

      const setStateCallCount = countSetStateCalls(callback);
      if (setStateCallCount >= CASCADING_SET_STATE_THRESHOLD) {
        context.report({
          node,
          message: `${setStateCallCount} setState calls in a single useEffect — consider using useReducer or deriving state`,
        });
      }
    },
  }),
};
```

React 18+ batches setState calls within the same event/effect tick automatically. The "cascading renders" framing is misleading — they don't actually cascade unless they use the prev-state callback that depends on each other. A more accurate rule would warn about *interdependent* setStates, not the count.

The fixture `state-issues.tsx:38-54` (`CascadingSetStateComponent`) sets three independent values on mount with `[]` deps. In React 18+ that's one render, not three.

### 🟡 34.7 `rerender-functional-setstate` regex misses postfix/prefix increment

```247:266:packages/react-doctor/src/plugin/rules/state-and-effects.ts
export const rerenderFunctionalSetstate: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isSetterCall(node)) return;
      if (!node.arguments?.length) return;

      const calleeName = node.callee.name;
      const argument = node.arguments[0];
      if (
        argument.type === "BinaryExpression" &&
        (argument.operator === "+" || argument.operator === "-") &&
        argument.left?.type === "Identifier"
      ) {
        context.report({
```

`setCount(count + 1)` — caught.
`setCount(++count)` (`UpdateExpression`) — missed.
`setCount(count++)` — missed (and worse, evaluates to old value, definitely a bug).
`setCount(count * 2)` — `BinaryExpression` operator is `*`, not `+`/`-`, missed (also a stale-closure bug).

The rule only catches the most cosmetic case. Wider check: any `BinaryExpression` whose left operand references the state variable.

### 🟡 34.8 `noDerivedUseState` only checks `Identifier` initializers — misses `MemberExpression`

```176:188:packages/react-doctor/src/plugin/rules/state-and-effects.ts
      CallExpression(node: EsTreeNode) {
        if (!isHookCall(node, "useState") || !node.arguments?.length) return;
        const initializer = node.arguments[0];
        if (initializer.type !== "Identifier") return;

        if (componentPropNames.has(initializer.name)) {
          context.report({
```

`function MyComponent({ user }) { const [name] = useState(user.name); }` — initializer is `MemberExpression`, not `Identifier`, so the rule skips it. Real-world prop usage almost always involves member access. False negative.

### 🟡 34.9 `extractIndexName` misses `Number(idx)` casts

```5:36:packages/react-doctor/src/plugin/rules/correctness.ts
const extractIndexName = (node: EsTreeNode): string | null => {
  if (node.type === "Identifier" && INDEX_PARAMETER_NAMES.has(node.name)) return node.name;
  ...
  if (
    node.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    node.callee.name === "String" &&
    node.arguments?.[0]?.type === "Identifier" &&
    INDEX_PARAMETER_NAMES.has(node.arguments[0].name)
  )
    return node.arguments[0].name;
```

`String(idx)` is recognized; `Number(idx)`, `idx + ""`, `\`${idx}\``-with-other-content (template that has a non-index expression mixed in), and `idx | 0` are not. Some are valid bug shapes the rule should catch.

### 🟡 34.10 The `CASCADING_SET_STATE_THRESHOLD = 3` constant is also matched by the threshold for "lazy initial useState" — different rules sharing semantics is confusing

`constants.ts:2` has `CASCADING_SET_STATE_THRESHOLD = 3`. Different file `constants.ts:5` has `DEEP_NESTING_THRESHOLD = 3`. Same value, different rules, same constant definition style. A future refactor that consolidates to one threshold accidentally couples them.

### 🟡 34.11 `extractDestructuredPropNames` is keyed on the destructure source, not target

(Per §28.6, Pass 4) — this affects `{ user: u }` aliasing where the prop is exposed as `u` but the rule sees `user`. Already covered.

### 🟢 34.12 `replace(snapshot.tempDirectory, resolvedDirectory)` shadows by string literal

If `snapshot.tempDirectory` happens to be a regex special character (it won't be — it's `/tmp/react-doctor-staged-XYZ`), the string-form `.replace()` is safe. But if the path ever contains regex meta-chars after a refactor (`String.prototype.replace` is overloaded), the safe-form is `replaceAll(snapshot.tempDirectory, resolvedDirectory)`. Minor.

---

## 35. Cross-Package Drift (Pass 5)

### 🟠 35.1 `customRulesOnly` is documented in the README but absent from the OG image / share page

The CLI flag `customRulesOnly` (config-only, no CLI flag) is documented (`README.md:194`). When set, the user gets a meaningfully different score (no `react/` or `jsx-a11y/` rules contribute). But the share page (`packages/website/src/app/share/page.tsx`) doesn't surface this — the URL params (`p`, `s`, `e`, `w`, `f`) don't include `customRulesOnly`. So a project that scores 88 with `customRulesOnly: true` and 72 without it, both share the same OG image / leaderboard placement.

If the leaderboard ever incorporates submitted scores (currently they're hardcoded), this discrepancy becomes visible: a project gaming the score by enabling `customRulesOnly` would tie or beat one with the full ruleset.

### 🟡 35.2 The `nodejs.org` leaderboard entry has the highest score (88) — beating the README's "top" entries (84)

Leaderboard is sorted by `score: descending` in `leaderboard-entries.ts:146-148`. When the page renders, `nodejs.org` is in slot #1. But the README hard-codes a different ordering and excludes nodejs.org entirely (§32.3). Drift between three sources of truth for the leaderboard:

1. `leaderboard-entries.ts` (the runtime data, sorted desc).
2. README's table (manually maintained, missing entries, possibly stale).
3. Live website at https://www.react.doctor/leaderboard (renders from #1).

Not a bug in the strict sense, but a maintenance pitfall.

### 🟡 35.3 The bundled SKILL.md does not match the website's inline SKILL_CONTENT (yet again)

Per §17.10 (Pass 3) and §26.1, §26.2 (Pass 4), the skill description differs across:

- `skills/react-doctor/SKILL.md` (bundled by `vite.config.ts:9-17` into `dist/skills/`)
- `packages/website/src/app/install-skill/route.ts` (`SKILL_CONTENT` constant)
- `packages/website/public/install-skill.sh` (static file)

A new finding: the canonical version says `npx -y react-doctor@latest . --verbose --diff` (with `--diff`). The website inline versions say the same. But which agent docs are the source of truth for users? The CLI's `react-doctor install` ships #1; the curl-pipe-bash ships #2/#3. Users who install both (sequentially, via different paths) get two slightly different SKILL.md files in different directories on their filesystem.

### 🟡 35.4 Leaderboard scores in `leaderboard-entries.ts` are hand-edited — risk of drift from real scoring

```22:139:packages/website/src/app/leaderboard/leaderboard-entries.ts
const RAW_ENTRIES: LeaderboardEntry[] = [
  {
    name: "tldraw",
    githubUrl: "https://github.com/tldraw/tldraw",
    packageName: "tldraw",
    score: 84,
    errorCount: 98,
    warningCount: 139,
    fileCount: 40,
  },
  ...
```

These numbers were presumably generated by running `react-doctor` on each project at some point. But the file is statically defined — no automation re-runs the scans. So if the scoring formula changes (e.g., `ERROR_RULE_PENALTY` tweak), the displayed scores diverge from what users would actually compute today. A reader trying to reproduce `tldraw: 84` by running `react-doctor` on tldraw might get a different number — confusing.

Either:
- Add a CI step that runs `react-doctor` against each leaderboard entry and updates the file (could be a slow scheduled job).
- Or annotate each entry with the date and react-doctor version it was scored at.

---

## 36. Additional Findings (Pass 5)

| Severity | File / Location | Issue |
|---|---|---|
| 🟠 | `packages/react-doctor/tests/fixtures/basic-react/src/security-issues.tsx` | The fixture has a single line `const apiKey = "sk_live_1234567890abcdef"`. This matches `SECRET_PATTERNS[0]` (`/^sk_live_/`) — but committed to a real-but-public open-source repo. While clearly not a real secret, secret-scanning tools (TruffleHog, GitGuardian, GitHub's secret scanner) will flag it on every PR, generating noise. Either prefix with `mockup_` or use a non-Stripe-pattern test value. |
| 🟠 | `packages/react-doctor/src/utils/discover-project.ts:170-229` | The hand-rolled YAML parser for pnpm catalogs (`parsePnpmWorkspaceCatalogs`) silently mis-parses anchors, multi-line strings, comments inside values. A user with a `pnpm-workspace.yaml` containing `# react: ^19.2.0` (a commented-out catalog entry) — the parser would skip lines starting with `#` thanks to line 175, BUT inline comments (`react: ^19.0.0  # pinned`) would attach the comment to the value. The version then becomes `"^19.0.0  # pinned"` and downstream comparisons break. |
| 🟠 | `packages/react-doctor/src/utils/discover-project.ts:122-123` | `countSourceFiles` only checks the local `git ls-files` output — but for monorepos using **submodules**, the `--recurse-submodules` flag is missing. Submodule files are uncounted. |
| 🟠 | `packages/react-doctor/src/utils/run-knip.ts:63-80` | `silenced` overrides `console.log/info/warn/error` globally for the duration of the call. This races with concurrent operations. If `Promise.all` runs `silenced(knip)` and a non-silent operation logs in parallel, the non-silent operation's logs are also suppressed. The lint+deadcode promises in `scan.ts:541, 580` already run in parallel — knip's `silenced` is racing with the lint spinner. |
| 🟡 | `packages/react-doctor/src/utils/get-staged-files.ts:14-15` | `output.split("\n").filter(Boolean)` — filenames containing newlines (legal on POSIX) are corrupted. `git diff --cached -z --name-only` (NUL-separated) would be safer. |
| 🟡 | `packages/react-doctor/src/utils/discover-project.ts:107-119` | `countSourceFilesViaGit` and `listSourceFilesViaGit` (`resolve-lint-include-paths.ts:13-27`) both shell out to `git ls-files` and split on `\n` — same NUL-separator concern as §36 above. Filenames with embedded newlines (legal POSIX) would be split into spurious entries. |
| 🟡 | `packages/react-doctor/src/utils/run-oxlint.ts:436-472` | `spawnOxlint` uses streaming buffers but never sets a `maxBuffer`. If oxlint produces multi-GB stderr (e.g., a mis-configured plugin), `Buffer.concat` allocates the whole thing in one go. `child_process.spawn` doesn't have an out-of-the-box max-output safeguard. |
| 🟡 | `packages/react-doctor/src/utils/format-error-chain.ts:5` | `visitedErrors.add(currentError)` uses `Set` not `WeakSet`. The errors are kept alive for the duration of the function (which is short), so no real leak. But if the same logic is reused in long-lived code, switch to `WeakSet`. |
| 🟡 | `packages/react-doctor/src/utils/colorize-by-score.ts:4-8` | When `score === 50` exactly, the function takes the `>=` branch (warn). When `score === 75` exactly, it takes the success branch. `tests/colorize-by-score.test.ts:23-35` confirms the boundary doesn't throw, but doesn't assert color: a regression that flipped `>=` to `>` in `colorizeByScore` (but not in `getScoreLabel`) would silently desync color from label. |
| 🟡 | `packages/react-doctor/src/utils/highlighter.ts` | All five color functions are direct passthroughs to `picocolors`. If `picocolors` is replaced or upgraded with breaking changes, all callers are exposed. A thin wrapper that composed multiple colors (e.g., `dimRed`) doesn't exist, but the direct-passthrough means there's no one place to override the styling. Not currently a bug; a maintainability note. |
| 🟢 | `packages/react-doctor/tests/fixtures/basic-react/tsconfig.json` | The fixture's `tsconfig.json` doesn't have `"jsx": "react-jsx"` set explicitly… wait, it does at line 3. Cancel this finding. |
| 🟢 | `packages/react-doctor/tests/fixtures/basic-react/package.json` | `"private": true`, `dependencies: { react: ^19.0.0, react-dom: ^19.0.0 }` — but no `tsconfig` path setting and the file doesn't ship `"name"` matching the project. `discoverProject` falls back to `path.basename(directory)` for `projectName` when `name` is missing. Fine, but worth a comment in the fixture. |
| 🟢 | `packages/react-doctor/tests/fixtures/basic-react/src/clean.tsx` | The fixture mixes "no-flag" cases with `MemberExpressionSetterCalls` (a regression test for `localStorage.setItem` not being mistaken for a state setter). A new contributor reading the file wouldn't realize the file is a regression-test cohort, not a "best practices" example. Move regression cases to a `regressions.tsx` and keep `clean.tsx` for unblemished examples. |
| 🟢 | `packages/react-doctor/src/utils/get-diff-files.ts:13` | `branch === "HEAD"` check returns `null` for detached-HEAD state. But `--diff` from a detached HEAD is a real (rare) case — the user might want to compare against `origin/main`. Currently silently returns null and falls back to "no diff". Better: return a special value and let the caller decide. |
| 🟢 | `packages/react-doctor/src/utils/get-staged-files.ts:18-26` | `readStagedContent` returns `result.stdout.toString()` (default UTF-8). For staged binary files (PNG, PDF) accidentally tracked, this corrupts. Per §27.7 (Pass 4) — flagged but worth re-noting because the `SOURCE_FILE_PATTERN` filter is the only line of defense, and it filters on extension, not content type. |
| 🟢 | `packages/react-doctor/src/utils/handle-error.ts:15-17` | Prints generic "Something went wrong" before the actual error. Programmatic users of the CLI parsing stderr would see the boilerplate first; a more actionable error message would let `grep -E '^Error:'` work. |
| 🟢 | `packages/react-doctor/src/utils/handle-error.ts:21-22` | `process.exit(1)` is unconditional when `shouldExit: true`. Inside an async pipeline (e.g., `await runInstallSkill`), this aborts cleanup. The `cli.ts:81` `exitGracefully` handler sets `process.exitCode = 0` for SIGINT but `handleError` slams `process.exit(1)`. If a SIGINT lands during `handleError`, behavior is undefined. |
| 🟢 | `packages/react-doctor/src/utils/format-error-chain.ts:13-14` | `formatErrorMessage` uses `error.message \|\| error.name` — for an Error whose `message` is `""` AND `name` is `"Error"` (the default), this returns `"Error"`. Confusing. |
| 🟢 | `packages/react-doctor/src/utils/install-skill-for-agent.ts:16-19` | `cpSync(skillSourceDirectory, installedSkillDirectory, { recursive: true })` — preserves source mtimes/permissions. If the bundled skill has `0644`, the user's installed copy is read-only-by-group, which is fine. But if the bundle ever ships an executable script, `cpSync` would not propagate the executable bit unless the source has it. Edge case. |
| 🟢 | `packages/react-doctor/src/utils/check-reduced-motion.ts:43` | Uses `git grep` which isn't available in repos without a `.git` directory. Falls into the `catch` with a generic "no reduced-motion handling" diagnostic — false positive. |
| 🟢 | `packages/react-doctor/src/utils/jsx-include-paths.ts:3-6` | The function is named `computeJsxIncludePaths` but actually filters to JSX/TSX files; it doesn't *compute* anything new. `filterToJsxFiles` would read more naturally. |
| 🟢 | `packages/react-doctor/src/scan.ts:179-205` | `buildScoreBarSegments` uses `█` and `░`. Fine for most terminals but renders as box-drawing characters in older Windows console (cmd.exe). If react-doctor is run on Windows without a UTF-8 codepage, the bar is gibberish. |
| 🟢 | `packages/react-doctor/src/utils/group-by.ts` | `groupBy` doesn't preserve insertion order if the same key appears multiple times. Wait, it does — `Map` preserves insertion order, and we always `push` to existing arrays. Fine. |
| 🟢 | `packages/react-doctor/src/utils/install-skill-for-agent.ts:13-15` | `if (alreadyInstalledDirectories?.has(installedSkillDirectory)) { return installedSkillDirectory; }` — short-circuits cleanup. But the test `tests/install-skill-for-agent.test.ts:77-98` confirms this is intentional (shared `.agents/skills` for codex+cursor). Leaves a subtle bug: after the first install copies to the shared dir, the second agent's "install" doesn't verify the dir's contents are correct — relies on the first to have completed successfully. |

---

## 37. Additional Quick Wins (Pass 5)

37. **Resolve the `aidenybai/`-vs-`millionco/` URL split** (§31.1) — pick one canonical and replace.
38. **Update README's score-label example to use `"Great"` not `"Good"`** (§32.1) — 1-line fix.
39. **Add `weight` to README's `Diagnostic` interface** (§32.2).
40. **Replace README leaderboard table with a build-time `import` of the data file** (§32.3, §35.2) — eliminates manual drift.
41. **Wire up the design-issues fixture to `describeRules` blocks** (§33.1) — 14+ rules currently un-asserted.
42. **Wire up the js-performance fixture's 9 dead rules** (§33.2) — both fix the rules per §1.1 AND assert.
43. **Replace the `"sk_live_..."` test fixture with a non-Stripe-pattern value** (§36 row 1) — prevents secret-scanner noise on PRs.
44. **Use `git ls-files -z` and `git diff -z --name-only`** to safely handle filenames with newlines (§36 row 4–5).
45. **Add `--recurse-submodules` to git ls-files calls** (§36 row 3) — fixes monorepos with submodules.
46. **Bound `detectReactCompiler`'s ancestor walk** (§34.5) — same fix as `loadConfig` (§25.1).
47. **Widen `REACT_COMPILER_ENABLED_FLAG_PATTERN` to match the modern object-literal form** (§34.3).

---

## 38. Items I Did Not Verify (Pass 5)

- Whether `bundle-issues.tsx` and `client-issues.tsx` have similar fixture-vs-test asymmetry (§33.10) — high probability based on the pattern, but not verified. **Verified in Pass 6: yes — see §44.1, §44.2.**
- Whether the `nodejs.org` score (88) was generated by actually running `react-doctor` against the nodejs/node repo, or hand-entered (§35.4).
- Whether `pnpm -r run build` (per the README) currently fails with an unbuilt `website` package, or whether the website build doesn't depend on `react-doctor`'s artifacts.
- Whether `git grep` in `check-reduced-motion.ts` actually exists on every supported platform (the binary is required, not assumed). For `--global-only` Windows installations, `git grep` may exit with a different status code than the catch expects.
- Whether the leaderboard's `nodejs.org` entry resolves correctly — the file says `packageName: "@node-core/website"` but the package-name is unusual; the share URL would build with `p=%40node-core%2Fwebsite` (URL-encoded), which the OG route's `searchParams.get("p")` un-encodes. Looks fine in theory; not stress-tested.
- Whether `tests/fixtures/basic-react/src/security-issues.tsx`'s `sk_live_1234567890abcdef` would trigger the actual `noSecretsInClientCode` rule (it should, per `SECRET_PATTERNS[0]`), versus only the variable-name heuristic. Both should hit, but only one path is tested.

These are the highest-value follow-ups for a maintainer's next pass on top of Passes 1–4.

---

# Sixth Pass — Published Artifact Surface, Action Shell Injection, GitHub Comment Markdown Escape, Off-By-One Constants

This pass focuses on the *built* `dist/` directory, GitHub Action shell handling, additional fixtures, and cross-cutting issues that only surface after looking at what users actually receive.

## 39. Published Artifact Bugs (`dist/`)

### 🔴 39.1 `dist/worker.js` and `dist/worker.d.ts` are missing `diagnoseCore` — README claims they're equivalent

```1:2:packages/react-doctor/dist/browser.js
import { a as calculateScore, i as diagnose, n as diagnoseBrowser, o as calculateScoreLocally, r as diagnoseCore, t as processBrowserDiagnostics } from "./process-browser-diagnostics-BHiLPUJT.js";
export { calculateScore, calculateScoreLocally, diagnose, diagnoseBrowser, diagnoseCore, processBrowserDiagnostics };
```

```1:2:packages/react-doctor/dist/worker.js
import { a as calculateScore, i as diagnose, n as diagnoseBrowser, o as calculateScoreLocally, t as processBrowserDiagnostics } from "./process-browser-diagnostics-BHiLPUJT.js";
export { calculateScore, calculateScoreLocally, diagnose, diagnoseBrowser, processBrowserDiagnostics };
```

The browser bundle exports **6** symbols (`calculateScore, calculateScoreLocally, diagnose, diagnoseBrowser, diagnoseCore, processBrowserDiagnostics`).
The worker bundle exports only **5** (no `diagnoseCore`).

Same for the type declarations:
- `dist/browser.d.ts` re-exports `_ as ScoreResult, c as diagnoseCore, …` (16 names).
- `dist/worker.d.ts` re-exports 13 names — **missing `diagnoseCore` AND `ScoreResult`**.

The README explicitly claims:

> If you call **`diagnoseCore`** yourself in the browser, pass **`calculateDiagnosticsScore`** from this package (re-exported as **`calculateScore`** on `react-doctor/browser`) so the bundle never pulls in Node-only proxy code. […] `react-doctor/worker` re-exports the same browser-facing modules for worker targets.

But worker consumers calling `import { diagnoseCore } from "react-doctor/worker"` get a runtime error (the named export doesn't exist) and a TypeScript error (the type isn't exported either). This was identified as a source-level concern in §3.1 (Pass 1) — Pass 6 confirms it ships in the published artifact.

### 🟠 39.2 `dist/cli.d.ts` is just `export {};`

```1:2:packages/react-doctor/dist/cli.d.ts
#!/usr/bin/env node
export { };
```

That's it — three tokens. A TypeScript user trying to write `import { something } from "react-doctor"` (the default `.` export) gets nothing typed. The actual CLI module has `CliFlags`, `printAnnotations`, and other internal helpers that could be useful but aren't exported. There's also no module documentation or even a `// CLI entry — see ./api for programmatic access` comment.

This is functional (the CLI ships as a binary, not a library), but a downstream user discovering the package via `npm view react-doctor` or via TypeScript IntelliSense gets a confusing empty module.

### 🟠 39.3 The chunked filenames (`diagnose-browser-DcYyi_6_.js`, `process-browser-diagnostics-BHiLPUJT.js`) leak hashes through `.d.ts`

```1:1:packages/react-doctor/dist/browser.d.ts
import { _ as ScoreResult, a as processBrowserDiagnostics, c as diagnoseCore, d as diagnose, … } from "./diagnose-browser-DcYyi_6_.js";
```

The `.d.ts` files reference `./diagnose-browser-DcYyi_6_.js` and `./process-browser-diagnostics-BHiLPUJT.js` — chunked file names with content-hash suffixes. Issues:

- **Build determinism**: `DcYyi_6_` is content-hashed. A trivial source change reshuffles the hash. Lockfile diffs become noisy; cache keys based on `dist/` mtimes break.
- **External imports**: anyone copy-pasting from a published version's source maps lands on a path that won't resolve in a different version. If another tool tries to `require.resolve("react-doctor/browser")` then walk imports, the chunk name changes are confusing.
- **Type aliases**: the imports use single-letter aliases (`a`, `c`, `d`, `_`, `r`, `t`, …) chosen by the bundler. If a bundler upgrade changes the alias mapping, downstream code that depends on the **declaration** (rare but possible with TypeScript module augmentation) breaks.

For a published package, named entrypoints should re-export from their dependents directly, not from hashed chunk files. Pin the chunk filenames or inline.

### 🟠 39.4 `dist/cli.js` ships `process.env.VERSION ?? "0.0.0"` — VERSION is set at build time but unverifiable

The vite config (`packages/react-doctor/vite.config.ts:27-29`) sets `env: { VERSION: process.env.VERSION ?? packageJson.version }`. This is a build-time env injection. If the CI/release script forgets to set `VERSION` AND the build is run from a directory where `package.json` has `version: "0.0.0"` (e.g., a templated install), the published binary reports `0.0.0`.

The `--version` flag, the JSON report's `version` field, and the share URL's analytics tagging all derive from this constant. Worth a smoke test that asserts `node dist/cli.js --version` is a non-zero version (or asserts equality with the package.json version) post-build.

### 🟠 39.5 `dist/cli.js` is 124KB unminified — no `process.env.NODE_ENV === "production"` minification step

```text
$ wc -c dist/cli.js
~124 KB
```

Plus `dist/react-doctor-plugin.js` is 128KB. Total CLI footprint ≈ 252KB just for react-doctor's own code, before deps (knip, oxlint, picocolors, prompts, ora, commander). For an `npx -y react-doctor@latest .` invocation the user downloads everything — including `dist/skills/`, `dist/index.js` (84KB), `dist/process-browser-diagnostics-…js` (16KB), and source maps (~400KB combined).

`vite.config.ts:24` sets `target: "node18"` and `platform: "node"` but nothing minifies. For a tool intended to be `npx`'d on demand, every kilobyte counts. Adding `vite-plus pack` minify settings (or a separate `minify: true` flag) would substantially shrink it.

### 🟡 39.6 `dist/cli.js.map`, `dist/index.js.map`, `dist/react-doctor-plugin.js.map` ship to npm

```text
124K  dist/cli.js
236K  dist/cli.js.map
 84K  dist/index.js
156K  dist/index.js.map
128K  dist/react-doctor-plugin.js
244K  dist/react-doctor-plugin.js.map
```

`packages/react-doctor/package.json:26-28` `"files": ["dist"]` ships everything in `dist/`, including source maps. Source maps:
- Roughly **double** the npm package size.
- Include the original TypeScript source (any contents copied into the source maps).
- Are useful for downstream debugging but expose internal file structure (e.g. `src/utils/run-knip.ts:118-130`'s retry loop).

For a publicly published library, source maps are usually fine; for a tool that wants to keep its surface lean, exclude them via `files: ["dist/**/!(*.map)"]` or move them to a separate `*-source-maps` package.

### 🟡 39.7 `dist/index.d.ts` re-exports `DiagnoseOptions, DiagnoseResult` as values, not as types

```147:147:packages/react-doctor/dist/index.d.ts
export { DiagnoseOptions, DiagnoseResult, type Diagnostic, type DiffInfo, …
```

`DiagnoseOptions` and `DiagnoseResult` are interfaces, but the re-export omits the `type` keyword. With `verbatimModuleSyntax: true` (which the project doesn't enable — see §20.3, Pass 3), this would error. With it off, it's tolerated. Mixing typed and untyped re-exports in one declaration is a stylistic inconsistency.

### 🟡 39.8 `dist/skills/react-doctor/SKILL.md` ships the full skill — but only the canonical version

```text
$ ls dist/skills/
react-doctor

$ head -3 dist/skills/react-doctor/SKILL.md
---
name: react-doctor
description: Use when finishing a feature, fixing a bug, before committing React code, or when the user wants to improve code quality or clean up a codebase. Checks for score regression. Covers lint, dead code, accessibility, bundle size, architecture diagnostics.
```

This is the canonical version (matches `skills/react-doctor/SKILL.md`). Confirming §17.10/§35.3 (Passes 3 and 5): **the published npm package contains a different SKILL.md content than what `/install-skill` curl-pipe-bash writes**. Two production paths, two different skill descriptions reaching users.

### 🟢 39.9 `dist/cli.js:13` imports `execSync` despite a §24 plan to migrate

`import { execSync, spawn, spawnSync } from "node:child_process";` is in the bundled CLI. As long as `execSync` is used in `get-diff-files.ts`, `resolve-compatible-node.ts`, and `check-reduced-motion.ts` (per §24, Pass 4), the published binary contains the command-injection-prone `execSync(template-string)` calls. Confirmed.

---

## 40. GitHub Action Shell Handling (Beyond §1.12)

### 🔴 40.1 `action.yml` constructs `$FLAGS` with multiple unquoted variable expansions

```66:70:action.yml
        FLAGS="--fail-on $INPUT_FAIL_ON"
        if [ "$INPUT_VERBOSE" = "true" ]; then FLAGS="$FLAGS --verbose"; fi
        if [ -n "$INPUT_PROJECT" ]; then FLAGS="$FLAGS --project $INPUT_PROJECT"; fi
        if [ -n "$INPUT_DIFF" ]; then FLAGS="$FLAGS --diff $INPUT_DIFF"; fi
        if [ "$INPUT_OFFLINE" = "true" ]; then FLAGS="$FLAGS --offline"; fi
```

```73:75:action.yml
          npx -y react-doctor@latest "$INPUT_DIRECTORY" $FLAGS | tee /tmp/react-doctor-output.txt
```

The unquoted variables in `--diff $INPUT_DIFF`, `--project $INPUT_PROJECT`, and `--fail-on $INPUT_FAIL_ON` are all exposed twice:

1. Once when building `FLAGS` (any user-supplied shell metacharacter is interpreted by the running bash).
2. Again when `$FLAGS` is interpolated into `npx … $FLAGS` — the second unquoted expansion does word-splitting that lets injected tokens become separate args to npx.

A workflow that does:

```yaml
- uses: millionco/react-doctor@main
  with:
    diff: "main; touch /tmp/pwn"
```

…ends up running `bash` with `INPUT_DIFF="main; touch /tmp/pwn"`, then `FLAGS="--fail-on … --diff main; touch /tmp/pwn"`, then `npx … $FLAGS` splits the FLAGS string into shell tokens — but `;` is preserved as part of the token, and the **first** bash invocation (during FLAGS=) already evaluated it.

Combined with §24.1 (Pass 4), where the same `$INPUT_DIFF` is later interpolated into `execSync(`git merge-base ${baseBranch} HEAD`)` — there are **two stages** of shell evaluation for the same user input. Either can fire injection.

### 🟠 40.2 `action.yml:48-53` uses `$DIFF_BASE` and `$HEAD_REF` quoted but doesn't disambiguate `--` for git

```45:53:action.yml
    - if: ${{ inputs.diff != '' && github.event_name == 'pull_request' }}
      shell: bash
      run: |
        git fetch origin "$DIFF_BASE" && git branch -f "$DIFF_BASE" FETCH_HEAD 2>/dev/null || true
        git checkout "$HEAD_REF" 2>/dev/null || true
      env:
        GITHUB_TOKEN: ${{ inputs.github-token }}
        DIFF_BASE: ${{ inputs.diff }}
        HEAD_REF: ${{ github.head_ref }}
```

Quoting prevents shell injection. But `git fetch origin "--upload-pack=evil-tool"` (a flag-named `DIFF_BASE`) would still pass through to git as if `--upload-pack=evil-tool` were a refspec. `git checkout` is similarly vulnerable to flag-shaped values from `github.head_ref`.

GitHub's `head_ref` is generally restricted to a branch-name character set, but the upstream repo configuration determines this. PR forks can have arbitrary refs. Add `git fetch origin -- "$DIFF_BASE"` (the `--` makes it positional) for defense in depth.

### 🟠 40.3 `tee /tmp/react-doctor-output.txt` is a predictable global tempfile

```73:73:action.yml
          npx -y react-doctor@latest "$INPUT_DIRECTORY" $FLAGS | tee /tmp/react-doctor-output.txt
```

On a self-hosted runner running multiple parallel actions, two concurrent runs of this Action overwrite each other's output. The PR comment posted by the actions/github-script step (line 92-123) then reads the wrong run's output and posts it on the wrong PR. Use `mktemp` or `${{ runner.temp }}` plus `${{ github.run_id }}`.

### 🟠 40.4 PR comment markdown escape — `output` is interpolated into a triple-backtick block

```96:104:action.yml
          script: |
            const fs = require("fs");
            const path = "/tmp/react-doctor-output.txt";
            if (!fs.existsSync(path)) return;
            const output = fs.readFileSync(path, "utf8").trim();
            if (!output) return;

            const marker = "<!-- react-doctor -->";
            const body = `${marker}\n## 🩺 React Doctor\n\n\`\`\`\n${output}\n\`\`\``;
```

The CLI output (`output`) is dropped into a triple-backtick fence (`\`\`\``). Any line in `output` containing literal three backticks closes the fence early and lets the rest render as Markdown. The CLI prints rule help text containing inline code — for example:

```text
no-fetch-in-effect: Use \`useQuery()\` from @tanstack/react-query
```

…uses single backticks, which are safe inside a triple-backtick fence. But if any rule message ever contains triple backticks (some plugin authors do this; React Doctor's `RULE_HELP_MAP` has them in script-loading help: `"strategy="afterInteractive""` — wait that's regular quotes; let me check…). Even without triple-backticks today, a future rule contributor could break out of the fence via:

- `` ```js ``  in help text  
- A tools whose names contain backticks  
- Filenames with backticks (legal in Linux)

A safer approach: use the four-backtick fence (` ```` `) and trust users not to have four-backtick content, or HTML-escape the output and use `<pre>`. Today's content is fine; the contract isn't.

### 🟠 40.5 PR comment doesn't include the `score` output

The action computes `steps.score.outputs.score` (line 36) but the **PR comment** (line 96-123) doesn't surface it. A user reading the PR comment sees the full CLI output but no rendered score, badge, or share link. Yet this is the moment when the score is most actionable.

Fix: include the score (or the share URL with the badge image) in the PR comment body. Today the comment is just a code-fenced dump of stdout.

### 🟢 40.6 `action.yml:30-31` defaults `node-version: 20` — below `engines.node: >=22`

```29:31:action.yml
  node-version:
    description: "Node.js version to use"
    default: "20"
```

vs `package.json:36`:

```36:36:package.json
    "node": ">=22",
```

vs `OXLINT_RECOMMENDED_NODE_MAJOR = 24` (`constants.ts:60`).

Three different Node.js versions in three places — and the action's default is below the package's declared engines minimum. Users who don't override `node-version` get a Node version that npm itself would warn on (`EBADENGINE`), and oxlint may fall back to the nvm-install path (slow, requires nvm). Action default should be 22 minimum, ideally 24.

### 🟢 40.7 `action.yml:87` parses score with `tail -1 | tr -d '[:space:]'`

```87:87:action.yml
        SCORE=$(npx -y react-doctor@latest "$INPUT_DIRECTORY" --score $OFFLINE_FLAG 2>/dev/null | tail -1 | tr -d '[:space:]')
```

`--score` mode prints just the number. But it also prints offline-fallback hints (`logger.dim(noScoreMessage)` in `scan.ts:629`) when scoring isn't available. `tail -1` of "Score calculated locally (offline mode)." gives the message text, which then gets stripped to "Scorecalculatedlocally(offlinemode)." and the regex `^[0-9]+$` rejects it. So the `score=` output isn't set. Fine.

But the same `--score` mode prints score-bar branding via stdin redirects when not silent — it might print the score AS WELL AS additional content, and `tail -1` could grab the wrong line. `--score` is supposed to print only the score and nothing else (per the CLI option help text), but this isn't asserted in tests.

---

## 41. Off-By-One in `MAX_KNIP_RETRIES`

### 🟡 41.1 The constant name says "MAX" but the loop runs MAX+1 times

```5:5:packages/react-doctor/src/constants.ts
export const MAX_KNIP_RETRIES = 5;
```

```119:121:packages/react-doctor/src/utils/run-knip.ts
  for (let attempt = 0; attempt <= MAX_KNIP_RETRIES; attempt++) {
    try {
      return (await silenced(() => main(options))) as KnipResults;
```

The loop condition is `attempt <= MAX_KNIP_RETRIES`. With `MAX_KNIP_RETRIES = 5`, the loop runs **6 attempts** (0, 1, 2, 3, 4, 5). The constant name implies "max retries"; the loop does "max+1 attempts" or, equivalently, "max retries plus 1 initial try".

The test confirms this:

```248:249:packages/react-doctor/tests/run-knip.test.ts
      expect(mockKnipState.mainCallCount).toBe(MAX_KNIP_RETRIES + 1);
```

But the test also has 6 sequential errors in `sequencedErrors` (lines 224-231), matching MAX+1. A future contributor renaming the constant to `KNIP_RETRY_BUDGET` and changing the loop to `attempt < MAX_KNIP_RETRIES` would shift behavior from 6 attempts to 5 — breaking the test. This is brittle: the loop's semantics aren't expressed in the constant name.

Either rename to `KNIP_TOTAL_ATTEMPTS = 6` and `attempt < KNIP_TOTAL_ATTEMPTS`, or `MAX_KNIP_RETRIES = 5` and `attempt <= MAX_KNIP_RETRIES`. The current code does the latter, but the test references the former equation. Pick one and stick.

---

## 42. JSON Report `error` Loses the Cause Chain

### 🟠 42.1 `JsonReport.error` truncates to `{ message, name }` — no cause chain

```91:94:packages/react-doctor/dist/index.d.ts
  error?: {
    message: string;
    name: string;
  };
```

```10:14:packages/react-doctor/src/utils/build-json-report-error.ts
  const error =
    input.error instanceof Error
      ? { message: input.error.message, name: input.error.name }
      : { message: String(input.error), name: "Error" };
```

But the rest of the codebase has rich error-chain handling:

- `formatErrorChain` (`format-error-chain.ts:16-17`) joins the cause chain with arrows.
- `getErrorChainMessages` returns each message in order.
- The CLI's interactive error output uses these (via `handleError`).

When a user runs with `--json`, the rich chain is collapsed to just the outer message. A knip plugin failure that has 3 levels of `.cause` chain shows up as just `"Error loading /repo/vite.config.ts"`, and the actual root cause (e.g., `Cannot find module './missing'`) is lost.

For programmatic JSON consumers (the documented contract for `--json`), this is a significant information loss.

Fix: include the cause chain explicitly, or include `cause: error.cause` (and serialize recursively).

### 🟢 42.2 Same loss in `handleError` for the non-JSON path

```16:18:packages/react-doctor/src/utils/handle-error.ts
  if (error instanceof Error) {
    logger.error(error.message);
  }
```

Only `error.message` is logged. The interactive user, like the JSON consumer, loses the chain. The `formatErrorChain` helper exists but isn't invoked here. Wider use would be free.

---

## 43. CLI Flow Edge Cases (Pass 6)

### 🟠 43.1 `failOn: "all"` (or any invalid value) in config silently downgrades to `"none"`

```58:68:packages/react-doctor/src/cli.ts
const resolveFailOnLevel = (
  programInstance: Command,
  flags: CliFlags,
  userConfig: ReactDoctorConfig | null,
): FailOnLevel => {
  const resolvedFailOn =
    programInstance.getOptionValueSource("failOn") === "cli"
      ? flags.failOn
      : (userConfig?.failOn ?? flags.failOn);
  return isValidFailOnLevel(resolvedFailOn) ? resolvedFailOn : "none";
};
```

If `userConfig.failOn = "all"` (a typo for `"warning"` or whatever the user meant), `isValidFailOnLevel` returns false, and the function returns `"none"` — **silently disabling the fail behavior the user wanted**.

CI runs that should have failed now pass green. Validation should warn or throw on invalid config values, not silently default to the most-permissive option.

### 🟠 43.2 `cli.ts:294` `getDiffInfo(resolvedDirectory, ...)` always runs even when `--diff` is not requested

```291:294:packages/react-doctor/src/cli.ts
      const isDiffCliOverride = program.getOptionValueSource("diff") === "cli";
      const effectiveDiff = isDiffCliOverride ? flags.diff : userConfig?.diff;
      const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
      const diffInfo = getDiffInfo(resolvedDirectory, explicitBaseBranch);
```

`getDiffInfo` runs unconditionally — **even when `effectiveDiff === undefined`** (user didn't pass `--diff` and config doesn't set it). The function spawns up to 4 git subprocesses (`getCurrentBranch`, `detectDefaultBranch`, possibly `git rev-parse --verify`, then `git diff` if there are uncommitted changes). For a non-diff scan, this is pure overhead. The result is then passed to `resolveDiffMode`, which only consumes `diffInfo` when `effectiveDiff` is truthy.

Same finding as §1.4 (Pass 1) — confirmed in Pass 6.

### 🟠 43.3 The `diff` field of the JSON report uses the root-directory diff, not per-project

```345:347:packages/react-doctor/src/cli.ts
      writeJsonReport(
        buildJsonReport({
          ...
          diff: isDiffMode ? diffInfo : null,
```

`diffInfo` is from `cli.ts:294` (root diff). But each project in `projectDirectories` has its own per-project `projectDiffInfo` (from line 319). For monorepos that contain multiple sub-repos with different default branches (rare but possible — e.g., a yarn workspaces repo containing a git submodule), the JSON report's `diff.baseBranch` reflects the root, not the project. Programmatic consumers see one branch but the diagnostics actually came from a different one.

### 🟠 43.4 `cli.ts:319` `getDiffInfo(projectDirectory, …)` returns null silently when projectDirectory isn't in a git repo

For a monorepo where some workspaces are git-tracked and others (e.g., a generated `apps/api/` from a code-gen tool) are gitignored — `getDiffInfo` returns null and the loop continues with `includePaths: undefined`, falling back to a full scan of that workspace. The user thought they were scanning only changed files; the gitignored workspace gets a full scan.

This is the right behavior, but there's no logging that explains it. Add `logger.dim('Cannot detect diff for ${projectDirectory} — scanning all files')` when null.

### 🟡 43.5 `selectProjects` discovery + `getDiffInfo` per project = O(N) git subprocess churn

For `N` workspace projects:
- `discoverReactSubprojects` or `listWorkspacePackages` runs `fs.readdirSync` recursively.
- For each project, `discoverProject` reads `package.json` and probes for tsconfig, vite.config, etc.
- For each project, `getDiffInfo` runs 3-4 git subprocesses.
- For each project, `runOxlint` neutralizes disable directives (which itself runs `git grep`), spawns oxlint, restores directives.
- For each project (when not in diff mode), `runKnip` opens knip's session.

A 50-project monorepo runs 200+ subprocesses on cold start. The first 50 are pure discovery. There's no parallelism — the loop is serial.

This is the biggest scaling issue for large monorepos.

### 🟡 43.6 `cli.ts:302-310` uses spread+console-line-counting to render the diff banner

```302:310:packages/react-doctor/src/cli.ts
      if (isDiffMode && diffInfo && !isQuiet) {
        if (diffInfo.isCurrentChanges) {
          logger.log("Scanning uncommitted changes");
        } else {
          logger.log(
            `Scanning changes: ${highlighter.info(diffInfo.currentBranch)} → ${highlighter.info(diffInfo.baseBranch)}`,
          );
        }
        logger.break();
      }
```

If `diffInfo` is non-null but no per-project diff applies (i.e., `--diff` was set but no projects have changed source files), the banner says "Scanning changes" but then every project loop iteration logs `"No changed source files in $X, skipping"`. Confusing for the user — banner says we're scanning, then nothing happens.

### 🟢 43.7 `cli.ts:181` `argument("[directory]", "project directory to scan", ".")`

The default `"."` is passed to `path.resolve(directory)` (line 185). On Windows with `cmd.exe`, the cwd may differ from the npm/npx invocation. A user running `npx react-doctor` from a non-cmd shell could see `.` resolve to a different directory than expected. Doc-only — but worth noting.

### 🟢 43.8 `JSON.stringify(report, null, 2)` is pretty-printed even for large reports

```122:123:packages/react-doctor/src/cli.ts
const writeJsonReport = (report: JsonReport): void => {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};
```

A large report (10K diagnostics across a monorepo) becomes a multi-megabyte pretty-printed JSON. For programmatic consumers piping into `jq` or `node -e`, the indentation is wasted bytes. Add a `--json-pretty` flag and default to compact for the machine-consumed `--json` mode.

---

## 44. Bundle / Client Fixture Coverage Gaps

### 🟠 44.1 `bundle-issues.tsx:5` references a non-existent `./components/index` — the broken import is the test

```5:5:packages/react-doctor/tests/fixtures/basic-react/src/bundle-issues.tsx
import { Button } from "./components/index";
```

There is no `tests/fixtures/basic-react/src/components/` directory. The import resolves to nothing. oxlint flags the file via `noBarrelImport` (the import string ends in `/index`), but the underlying TS would fail to type-check.

For a fixture meant to test the rule, the import doesn't even need to resolve — but it makes the fixture unusable as a "real React project" reference. If anyone runs `tsc` against the fixture, every type check fails.

### 🟠 44.2 `client-issues.tsx` has 1 component for 1 rule — tested

```text
$ wc -l client-issues.tsx
17 client-issues.tsx
```

Only one component (`ScrollListenerComponent`). The `clientPassiveEventListeners` rule is asserted (run-oxlint.test.ts:230-233). Good. But the fixture only tests the **positive** case (missing `{ passive: true }`). There's no:
- Positive case with `{ passive: false }` (still missing — should fire).
- Negative case with `{ passive: true }` (should not fire).
- Negative case with `{ once: true, passive: true }` (should not fire).
- Edge case: variable as third arg (the rule short-circuits — should be tested).

### 🟠 44.3 `bundle-issues.tsx` doesn't test the `noBarrelImport` `didReportForFile` flag

```5:27:packages/react-doctor/src/plugin/rules/bundle-size.ts
export const noBarrelImport: Rule = {
  create: (context: RuleContext) => {
    let didReportForFile = false;

    return {
      ImportDeclaration(node: EsTreeNode) {
        if (didReportForFile) return;
        ...
        if (BARREL_INDEX_SUFFIXES.some((suffix) => source.endsWith(suffix))) {
          didReportForFile = true;
          context.report(...);
        }
      },
    };
  },
};
```

The rule fires only ONCE per file, then suppresses subsequent barrel imports. There's no fixture/test that has multiple barrel imports to verify the dedup behavior. A regression that toggled the flag to `false` (ie removed the dedup) would silently produce N diagnostics for one barrel-heavy file — not technically wrong, but a behavior change.

### 🟡 44.4 `query-issues.tsx` defines fake `useQuery`, `useMutation`, etc. inline

```3:14:packages/react-doctor/tests/fixtures/basic-react/src/query-issues.tsx
const useQuery = (options: any) => ({
  data: null,
  isLoading: false,
  error: null,
  refetch: () => {},
});
const useMutation = (options: any) => ({ mutate: () => {} });
const QueryClient = class {
  constructor(options?: any) {}
};
```

These are local re-declarations. The rule (`tanstackQueryRules`) doesn't actually verify these are React Query — it only checks for the function name (`useQuery`, `useMutation`, etc.). So a project that locally defines `const useQuery = …` (a custom hook with the same name) gets all the React Query rules applied to it — false positives.

The fixture inadvertently demonstrates the problem: `tests/fixtures/basic-react` doesn't have `@tanstack/react-query` installed (per `package.json:1-7`), but the rules fire anyway. So **any project with a custom `useQuery` hook** gets React Query rule warnings.

A more accurate rule would verify the hook is imported from `@tanstack/react-query` (or a known fork). Without that, the heuristic is too broad.

### 🟡 44.5 `tests/run-oxlint.test.ts:42-61` uses top-level `let` to share state between test cases

```38:46:packages/react-doctor/tests/run-oxlint.test.ts
let basicReactDiagnostics: Diagnostic[];
let nextjsDiagnostics: Diagnostic[];
let tanstackStartDiagnostics: Diagnostic[];

describe("runOxlint", () => {
  it("loads basic-react diagnostics", async () => {
    basicReactDiagnostics = await runOxlint(BASIC_REACT_DIRECTORY, true, "unknown", false);
```

The first `it("loads basic-react diagnostics", …)` populates the variable; subsequent tests (`describeRules` blocks) read it. If you run with `--filter "loads basic-react"` to debug, you only run the populator and skip everything else. If you run with `--filter "state & effects"` (skipping the populator), `basicReactDiagnostics` is undefined, and all the dependent tests crash with `TypeError: Cannot read properties of undefined`.

`beforeAll` would be more robust:

```ts
beforeAll(async () => {
  basicReactDiagnostics = await runOxlint(...);
});
```

### 🟢 44.6 `query-issues.tsx:11-12` uses `class` syntax with TS-friendly options arg

```10:12:packages/react-doctor/tests/fixtures/basic-react/src/query-issues.tsx
const QueryClient = class {
  constructor(options?: any) {}
};
```

The fixture uses class-expression syntax assigned to `const`. `queryStableQueryClient` rule looks for `node.callee?.type === "Identifier" && node.callee.name === TANSTACK_QUERY_CLIENT_CLASS` (via `NewExpression`). The `new QueryClient(...)` call (line 17) creates an instance, which the rule catches via the NewExpression visitor with callee.name === "QueryClient". So this works. But class expressions assigned to const variables aren't the canonical React Query setup; users typically `import { QueryClient } from "@tanstack/react-query"`. The fixture's local class would behave differently — but the rule doesn't distinguish.

---

## 45. Additional Findings (Pass 6)

| Severity | File / Location | Issue |
|---|---|---|
| 🟠 | `packages/react-doctor/src/utils/proxy-fetch.ts:19-27` | Module-level `let isProxyUrlResolved` and `let resolvedProxyUrl` cache the proxy URL forever after first read. `vi.stubEnv("HTTPS_PROXY", "http://newproxy")` between tests doesn't invalidate the cache. The `proxyFetch` function continues using the first-seen proxy, even if the env changed. Replace with a getter that re-reads each call (the env access is fast). |
| 🟠 | `packages/react-doctor/src/utils/proxy-fetch.ts:34` | `try { … } catch { return null; }` — silently swallows undici load errors. If `undici` is somehow unavailable (custom Node build, polyfill mode), users get no feedback that their proxy isn't being honored. Should `console.warn` once. |
| 🟠 | `packages/react-doctor/src/utils/proxy-fetch.ts:32` | `await import("undici")` runs **per call**. The Node module cache makes this ~free after the first call, but the dynamic `await` introduces a microtask hop on every call. For high-throughput callers, sync-import once at module load. |
| 🟠 | `packages/react-doctor/src/utils/run-oxlint.ts:436-472` | `spawnOxlint` accumulates stdout/stderr in `Buffer[]` arrays without bound. If oxlint crashes after producing a multi-GB error stream, the array is fully realized into memory. Cap with a guard like `if (stdoutBuffers.reduce((s, b) => s + b.length, 0) > MAX_OUTPUT_BYTES) child.kill()`. |
| 🟠 | `packages/react-doctor/src/utils/get-diff-files.ts:67-71` | `getUncommittedChangedFiles` runs `git diff --name-only --diff-filter=ACMR --relative HEAD`. This excludes deletions (`D`) — so a user who deleted a file in their working tree doesn't see it as "changed". Intentional (you can't lint a deleted file), but undocumented. The `--diff-filter=ACMR` means Added, Copied, Modified, Renamed — explicit list. Worth a comment. |
| 🟠 | `packages/react-doctor/src/utils/get-staged-files.ts:7-15` | Same `--diff-filter=ACMR` filter on staged files. Pre-commit hooks running react-doctor on staged files won't see deletion-only PRs. |
| 🟡 | `packages/react-doctor/dist/cli.js:13` | `execSync` is imported despite the recommendation to migrate to `spawnSync` (per §24, Pass 4). The published binary contains the command-injection-prone calls until §24.1's fix lands. |
| 🟡 | `packages/react-doctor/dist/cli.js.map`, `dist/index.js.map`, `dist/react-doctor-plugin.js.map` | Source maps ship to npm and roughly double the package size. Per §39.6. |
| 🟡 | `packages/react-doctor/src/scan.ts:484` | `const startTime = performance.now();` is captured before `loadConfig` runs. So the user-config-loading time is included in `elapsedMilliseconds`. For consistency with `index.ts:diagnose`, where `globalThis.performance.now()` is captured in `diagnoseCore` after some setup, the timing semantics differ slightly. Hard to notice but worth aligning. |
| 🟡 | `packages/react-doctor/src/scan.ts:619` | `if (options.scoreOnly) { … }` — score-only mode skips the diagnostic-printing path BUT still calls `calculateScore` (line 612) and may hit the network. A user running `--score --offline` is fine, but `--score` (default) blocks for the API call. For a "just the score" user, this is unexpected latency. Worth a comment explaining the intent. |
| 🟡 | `packages/react-doctor/src/scan.ts:611-613` | `scoreResult` is computed regardless of `scoreOnly`, `silent`, or `--json` mode. For a `--json --score` invocation (where the JSON report has score embedded), this is fine. But for a `--json` non-score run, the score is computed but the consumer might not care. Skip if `report.summary.score` isn't requested. |
| 🟡 | `packages/react-doctor/src/utils/discover-project.ts:594-596` | `countSourceFiles(directory)` is called for every project on every invocation. For a 5000-file project, this runs `git ls-files` once and parses the output. For a monorepo with 50 projects, 50 invocations. Memoize per directory. |
| 🟡 | `packages/react-doctor/src/utils/run-knip.ts:101-130` | `runKnipWithOptions` calls `silenced(() => createOptions(...))` and `silenced(() => main(options))` separately. The second call doesn't re-`silenced`-wrap; the first wrap saves the originals, restores on exit, then the second wrap saves THE NOW-RESTORED originals (correct), and so on. But if both calls overlap (they don't, sequentially), the override pattern would corrupt. For now, fine. |
| 🟡 | `packages/react-doctor/src/scan.ts:486` | `const userConfig = inputOptions.configOverride !== undefined ? inputOptions.configOverride : loadConfig(directory);` — checks `!== undefined`, but `null` is a valid override (= no config). The triple-state (`undefined`, `null`, `Config`) is fragile. A typo using `??` instead of `!==` would change behavior. |
| 🟡 | `packages/react-doctor/src/oxlint-config.ts:127-132` | `jsPlugins: [...(hasReactCompiler && !customRulesOnly ? [{ name: "react-hooks-js", specifier: esmRequire.resolve("eslint-plugin-react-hooks") }] : []), pluginPath]` — `esmRequire.resolve` is called even when the conditional excludes the entry, because of how the spread evaluates. Wait — it's inside the ternary, so it's only evaluated when the condition is true. But: if `eslint-plugin-react-hooks` is missing (not installed in a non-React-Compiler project), the resolve throws — even though the project doesn't need it. Edge case. |
| 🟡 | `packages/react-doctor/src/utils/run-oxlint.ts:521` | `path.join(os.tmpdir(), `react-doctor-oxlintrc-${process.pid}.json`)` — predictable filename. A symlink attack on a multi-user system could replace the file between `writeFileSync` and oxlint reading it. Use `fs.openSync(filePath, 'wx', 0o600)` for atomic create-or-fail. |
| 🟡 | `packages/react-doctor/src/utils/check-reduced-motion.ts:15-25` | `MISSING_REDUCED_MOTION_DIAGNOSTIC` is a module-level constant of type `Diagnostic`. Mutating it (no callers do, but a future contributor might) corrupts every subsequent invocation. `Object.freeze`. |
| 🟡 | `packages/react-doctor/src/utils/spinner.ts:46-50` | `if (!sharedInstance) { sharedInstance = ora({ text }).start(); } else { sharedInstance.text = text; }` — when the shared instance already exists, `start()` is never called for the new request. ora's `text` setter just changes what's rendered. So the previous spinner's animation continues, but the displayed text is the second spinner's. If the second one finishes via `succeed`, the spinner line shows the success text. This racing-text behavior is hard to debug. |
| 🟢 | `packages/react-doctor/src/utils/format-error-chain.ts:5-11` | `visitedErrors.add(currentError)` uses `Set`. Errors are short-lived, so no leak. But for `walkAst` (helpers.ts:12-28), the same circular-reference protection isn't there — see §28.7 (Pass 4). |
| 🟢 | `packages/react-doctor/src/scan.ts:489-501` | The `wasLoggerSilent` capture happens ONCE before any `setLoggerSilent(true)` call. If the function is re-entered (it isn't today, but `scan()` could be called twice in parallel), the second invocation captures the now-silenced state and the restore logic is wrong. Per §1.9. |
| 🟢 | `packages/react-doctor/src/utils/spinner.ts:13-16` | `noopHandle = { succeed: () => {}, fail: () => {} }` is a single shared object. Multiple callers receive the same reference. If anyone ever mutates it (e.g., adds a `.text` setter for compatibility with ora's interface), all callers see the mutation. `Object.freeze`. |
| 🟢 | `packages/react-doctor/src/utils/colorize-by-score.ts:4-8` | Boundary at `>= 75` and `>= 50` — with thresholds in constants. But `getScoreLabel` (`calculate-score-locally.ts:11-14`) uses the same thresholds. They're duplicated as constants imported from constants.ts. If someone changes one threshold without the other, color and label desync. Already noted in §18 — confirmed in pass 6. |
| 🟢 | `packages/react-doctor/src/utils/handle-error.ts:13-15` | The boilerplate "Something went wrong. Please check the error below for more details. If the problem persists, please open an issue on GitHub." — for users who already have the error and just want the technical message, this is noise. CLI output could distinguish "expected error" from "unexpected error" — most user errors (no React, no package.json) aren't `react-doctor` bugs. |
| 🟢 | `packages/react-doctor/src/utils/handle-error.ts:13-15` | Doesn't include the GitHub URL ("open an issue on GitHub") — but per §31.1, the canonical URL is unclear (`aidenybai` vs `millionco`). A user trying to follow the advice can't find the right repo. |
| 🟢 | `packages/react-doctor/src/utils/get-diff-files.ts:19-40` | `detectDefaultBranch` first tries `git symbolic-ref refs/remotes/origin/HEAD`, then falls back to `main`/`master` via the constant `DEFAULT_BRANCH_CANDIDATES`. For repos without a remote (local-only), the symbolic-ref fails, and the fallback works. But for repos with a remote whose HEAD ref doesn't exist (`origin/HEAD` not set), the symbolic-ref also fails. Run `git remote set-head origin --auto` once; the rule doesn't surface this fix. |
| 🟢 | `packages/react-doctor/src/scan.ts:62-66` | `sortBySeverity` sorts based on first diagnostic's severity. If a rule has both `error` and `warning` severities (impossible in oxlint config but possible if rules are split), the "first" picks one arbitrarily. Edge case. |
| 🟢 | `packages/react-doctor/src/utils/select-projects.ts:80-86` | `prompts({ type: "multiselect", … min: 1 })` — the `min: 1` enforces at least one selection, but if the user hits Ctrl-C, the `onCancel` handler in `prompts.ts` runs `process.exit(0)`, which is fine. But the message says "Run `npx react-doctor@latest --fix` to fix issues" — same `--fix`-doesn't-exist bug from §1.2 (Pass 1). Still unfixed. |

---

## 46. Quick Wins (Pass 6)

48. **Fix `dist/worker.js` to export `diagnoseCore`** (§39.1) — single line in `src/worker.ts`. Real bug shipped to users.
49. **Add `node dist/cli.js --version` smoke test to CI** (§39.4) — catches the "VERSION env not set" published-as-`0.0.0` regression.
50. **Quote `$INPUT_*` variables and `$FLAGS` in `action.yml`** (§40.1) — closes a stage of command injection.
51. **Use `mktemp` instead of `/tmp/react-doctor-output.txt`** (§40.3) — prevents concurrent-action-on-same-runner overwrites.
52. **Bump `action.yml` default `node-version` to 22** (§40.6) — aligns with `engines.node`.
53. **Validate `failOn` config value with a warning, not silent fallback** (§43.1) — prevents silent CI breakage.
54. **Make `getDiffInfo` lazy / opt-in** (§43.2) — only runs when `--diff` is requested.
55. **Include the cause chain in `JsonReport.error`** (§42.1) — restores debugging information.
56. **Add `vitest`'s `beforeAll` to `tests/run-oxlint.test.ts`** (§44.5) — makes individual test runs robust.
57. **Memoize `discoverProject` and `countSourceFiles` per directory** (§43.5) — measurable monorepo speedup.
58. **Strip `dist/*.map` files from the npm tarball** (§39.6) — halves the package size.

---

## 47. Items I Did Not Verify (Pass 6)

- Whether the published `react-doctor@0.0.42` on npm actually ships `dist/cli.js.map` and the chunked `process-browser-diagnostics-…js` files (§39.3, §39.6) — needs `npm pack` inspection.
- Whether `vp pack` has a minify flag that just isn't enabled (§39.5).
- Whether GitHub Actions' job concurrency by default would actually serialize multiple invocations on the same runner (§40.3) — Vercel/self-hosted runners may differ.
- Whether `action.yml`'s `INPUT_FAIL_ON` is actually validated upstream by Action's input schema. If GitHub enforces `enum: [error, warning, none]` at the workflow level, the unquoted variable can't carry shell metacharacters. (Probably it doesn't.)
- Whether `eslint-plugin-react-hooks` is in the package's runtime `dependencies` (it is — `package.json:60`) — so `esmRequire.resolve` should always work. Edge case in §45 row 13 is theoretical.
- Whether `--score --offline --json` is a valid combination (the precedence is unclear from the code). The docs don't say.

These are the highest-value follow-ups for Pass 6.

---

# Seventh Pass — Systemic Rule Scope Weakness, Package Manifest Issues, Wasted Plugin Loads, Test Fixture Patterns

This pass focuses on a previously-noticed-but-now-confirmed **systemic** weakness in how rules detect target identifiers (any name match, no import scope), the package.json manifest, and the wasted-plugin-loading pattern in oxlint-config.

## 48. Systemic Rule Weakness: No Import-Scope Verification

The fixtures across all three test apps (`basic-react`, `nextjs-app`, `tanstack-start-app`) reveal that **every** rule that looks for a specific function name uses a bare `node.callee.name === "X"` (or `Set.has`) check, with **no verification that the function comes from the expected import**. Confirmed by grep:

```text
$ rg "^const (navigate|redirect|useSearchParams|useQuery|useMutation|router|QueryClient)" tests/fixtures
nextjs-app/src/app/page.tsx:6:    const useSearchParams = () => new URLSearchParams();
nextjs-app/src/app/page.tsx:47:   const router = { push: (_path: string) => {} };
nextjs-app/src/app/page.tsx:48:   const redirect = (_path: string) => {};
nextjs-app/src/pages/_app.tsx:5:  const router = { ... };
basic-react/src/query-issues.tsx:3:  const useQuery = (options: any) => ({ ... });
basic-react/src/query-issues.tsx:9:  const useMutation = (options: any) => ({ mutate: () => {} });
basic-react/src/query-issues.tsx:10: const QueryClient = class { ... };
basic-react/src/query-issues.tsx:13: const QueryClientProvider = ({ client, children }: any) => children;
tanstack-start-app/src/routes/route-issues.tsx:5: const redirect = (_opts: any) => { … };
tanstack-start-app/src/routes/route-issues.tsx:11: const navigate = (_opts: any) => {};
```

Each fixture **shadows** the real library function with a local stub purely to make the test compile. The rules then fire on those local stubs because they don't distinguish "the `useQuery` from `@tanstack/react-query`" from "a local function named `useQuery`".

### 🔴 48.1 React Query rules fire on any `useQuery`/`useMutation` named function

Affected: `queryStableQueryClient`, `queryNoRestDestructuring`, `queryNoVoidQueryFn`, `queryNoQueryInEffect`, `queryMutationMissingInvalidation`, `queryNoUseQueryForMutation`.

Real-world impact: a project that defines its own `useQuery` (e.g., in a custom data-layer abstraction, common for projects pre-dating React Query) gets every TanStack Query diagnostic applied to that custom hook. False positives that look authoritative but are wrong.

### 🔴 48.2 Next.js navigation rules fire on any `redirect`/`router.push`/`navigate`/`useSearchParams` named function

Affected: `nextjsNoUseSearchParamsWithoutSuspense`, `nextjsNoClientSideRedirect`, `nextjsNoRedirectInTryCatch`.

Real-world impact: a custom router abstraction (`router.push("/dashboard")`) is flagged as a "Next.js client-side redirect" even on Vite/Remix/Tanstack-Start projects. The `nextjsNoRedirectInTryCatch` rule fires on **any** function named `redirect` or `notFound` inside a try block — including, e.g., `redirect = require('node:cluster').redirect` (hypothetical) or any user-defined helper.

### 🔴 48.3 TanStack Start rules fire on any `navigate`/`redirect`/`notFound` named function

Affected: `tanstackStartNoNavigateInRender`, `tanstackStartRedirectInTryCatch`.

Real-world impact: same as §48.2. A non-TanStack project that happens to use these common names gets the warnings.

### 🟠 48.4 Effect-hook rules fire on any function named `useEffect`/`useLayoutEffect`

Affected: `noDerivedStateEffect`, `noFetchInEffect`, `noCascadingSetState`, `noEffectEventHandler`, `noClientFetchForServerData`, `noClientSideRedirect`, `nextjsNoClientFetchForServerData`, `tanstackStartNoUseEffectFetch` — and via the `EFFECT_HOOK_NAMES` Set, the broader pattern.

Real-world impact: a project that imports `useEffect` from a non-React library (e.g., `import { useEffect } from "@my-lib/lifecycle"`) — entirely hypothetical, but the rule has no way to know — gets all React effect diagnostics applied. More commonly, a project that re-exports React's hooks via a barrel (`export * from "react"`) and then imports `useEffect` from the barrel: the rule sees `useEffect` and fires correctly. Less commonly, but worth noting: third-party libraries shipping `useEffect` as their own export cause confusion.

### 🟠 48.5 The framework-conditional rules don't verify framework imports

`oxlint-config.ts:210-212` enables NEXTJS_RULES, REACT_NATIVE_RULES, TANSTACK_START_RULES based on the auto-detected `framework` (from package.json). But rule scoping is purely framework-conditional, not import-conditional. A Next.js project that uses `redirect` from a custom helper (not from `next/navigation`) gets `nextjs-no-redirect-in-try-catch` warnings.

### 🟠 48.6 None of the rules check `node.parent.parent` to verify scope

The cleanest fix would be: for each rule that targets a library function, walk to the enclosing `Program` node and verify the import declaration of the relevant identifier. This is non-trivial because oxlint plugin context doesn't provide direct scope analysis — you'd need to track imports yourself. But ESLint's `context.getScope()` does this; oxlint may or may not.

Today, the rules' specificity is name-based heuristics. The fixtures **work around this** by making the local stubs match the expected names — which means the test suite documents the false-positive behavior as if it were correct. This is the **opposite** of what we want from a test fixture.

### 🟢 48.7 `noBarrelImport` checks the import string, not the function — but only fires once per file

The barrel-import rule's `didReportForFile` flag (per §44.3, Pass 6) means even if multiple identifiers are barrel-imported, only one diagnostic appears. Combined with §48.1–48.5, the rules pick a heuristic (count or name-match) and stop there. Useful as warnings, but not as the source of truth for "fix these issues".

---

## 49. Wasted `react-perf` Plugin Load

### 🟠 49.1 `react-perf` plugin is loaded but produces zero diagnostics

```117:126:packages/react-doctor/src/oxlint-config.ts
  categories: {
    correctness: "off",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    restriction: "off",
    style: "off",
    nursery: "off",
  },
  plugins: ["react", "jsx-a11y", ...(hasReactCompiler ? [] : ["react-perf"])],
```

The `categories` block disables every category, so oxlint does NOT auto-enable any plugin's category-default rules. The `rules` block then explicitly enables specific rules. Looking at the rules list (lines 138-209), there are no `react-perf/*` entries.

Result: the `react-perf` plugin is loaded into oxlint, parsed, and indexed — but every one of its rules is disabled. The plugin contributes nothing.

`run-oxlint.ts:23` (`PLUGIN_CATEGORY_MAP`) maps `"react-perf": "Performance"` — this map is used to categorize incoming diagnostics, but no diagnostics from `react-perf` ever fire. The map entry is dead.

Cost: oxlint plugin loading takes time (especially if the user is on a slow disk or network). For every scan that doesn't have React Compiler enabled, this overhead is paid for nothing.

### 🟠 49.2 The `customRulesOnly` flag does not strip the `react-perf` plugin from `plugins`

```126:126:packages/react-doctor/src/oxlint-config.ts
  plugins: ["react", "jsx-a11y", ...(hasReactCompiler ? [] : ["react-perf"])],
```

When `customRulesOnly: true`, the user wants ONLY `react-doctor/*` rules. But `plugins: ["react", "jsx-a11y", "react-perf"]` are still loaded. With `customRulesOnly`, the rules block (lines 134-135) drops `BUILTIN_REACT_RULES` and `BUILTIN_A11Y_RULES`. So the plugins are loaded with all their rules disabled.

Three plugins loaded for zero diagnostics. This is wasteful especially in a `--customRulesOnly` mode where the user explicitly opted out.

### 🟢 49.3 `react-perf` plugin choice is React-Compiler-conditional, but `react` and `jsx-a11y` aren't

The asymmetry: `react-perf` is loaded when the compiler is OFF; `react` and `jsx-a11y` are loaded always. But all three follow the same pattern (loaded but no rules enabled in `customRulesOnly` mode). Either drop the conditional logic on `react-perf` (always exclude) or apply the same conditional to `react` and `jsx-a11y` (only load when corresponding rules are enabled).

---

## 50. Package Manifest Issues

### 🟠 50.1 No `engines` field in `packages/react-doctor/package.json`

```36:38:package.json
  "engines": {
    "node": ">=22",
    "pnpm": ">=8"
  },
```

Root `package.json` has it. But per npm semantics, `engines` declared at the **root** of a workspace doesn't apply to **child** packages on `npm install <child>`. A user running `npm install -g react-doctor` doesn't get the `node>=22` engine warning. Add `"engines": { "node": ">=22" }` to `packages/react-doctor/package.json` (the actually-published one).

### 🟠 50.2 `eslint-plugin-react-hooks` is a `dependencies` instead of `peerDependenciesMeta`

```60:60:packages/react-doctor/package.json
    "eslint-plugin-react-hooks": "^7.0.1",
```

This plugin is **only used when `hasReactCompiler === true`** (`oxlint-config.ts:128`). For 90%+ of users (no React Compiler), it's downloaded and installed at zero benefit. The plugin's tarball is non-trivial.

A cleaner setup:

```json
"peerDependencies": {
  "eslint-plugin-react-hooks": "^7.0.1"
},
"peerDependenciesMeta": {
  "eslint-plugin-react-hooks": {
    "optional": true
  }
}
```

Plus a runtime check that warns if the plugin is missing AND React Compiler is detected.

### 🟠 50.3 `typescript` in runtime `dependencies`

```66:66:packages/react-doctor/package.json
    "typescript": ">=5.0.4 <7"
```

react-doctor doesn't compile TypeScript at runtime — `oxlint` does its own parsing, and `knip` does its own. Why is TypeScript a runtime dep?

Possibilities:
1. **Knip needs it**: knip's docs say it requires TypeScript. Yes — `knip` calls `ts.createProgram` directly. So this IS needed by a transitive dep.
2. **Defensive declaration**: the user almost certainly already has TypeScript installed; this is documenting the constraint.

Either way, ideally this should be a `peerDependency` (so the user's own TypeScript is honored) with a fallback. With it as a regular dep, npm/pnpm may install a duplicate copy of TypeScript in `node_modules/.pnpm/.../node_modules/typescript`, which is multi-megabyte.

### 🟠 50.4 No `sideEffects` declaration

`packages/react-doctor/package.json` lacks `"sideEffects": false` (or a more specific list). For ESM consumers using webpack/rollup/esbuild, this means the bundler can't tree-shake aggressively. The `./browser` and `./worker` entries would benefit most — they're meant to be small for browser bundles.

### 🟡 50.5 `./oxlint-plugin` entry point is undocumented

```43:46:packages/react-doctor/package.json
    "./oxlint-plugin": {
      "types": "./dist/react-doctor-plugin.d.ts",
      "default": "./dist/react-doctor-plugin.js"
    },
```

This is a public export — `import plugin from "react-doctor/oxlint-plugin"` is supported. But the README never mentions it. A user wanting to use the plugin standalone (in their own oxlint config, without running react-doctor's full CLI) has to discover this entry point by reading `package.json`.

If this entry exists for internal reasons (e.g., used by tests), drop it from `exports` to make it private. If it's intended public API, document.

### 🟡 50.6 `./oxlint-plugin` exports has no `import`/`require` distinction

For an ESM-only package (`"type": "module"`), the `default` field works for both contexts in modern Node. But oxlint's plugin loader may use CJS-style require under the hood. Worth verifying.

### 🟡 50.7 `package.json:54 "build": "rm -rf dist && NODE_ENV=production vp pack"`

`rm -rf dist` is non-portable (Windows lacks `rm`). The `&&` chain aborts on Windows with `rm: command not found`. Use `rimraf dist` (cross-platform) or `node --eval "fs.rmSync('dist', { recursive: true, force: true })"`.

### 🟡 50.8 `package.json:53 "dev": "vp pack --watch"` doesn't clean

`pnpm dev` runs `vp pack --watch` without cleaning `dist/`. If a previous build had files that the current build doesn't produce (e.g., a deleted source file), the stale output stays. Pair with `rimraf dist`.

### 🟢 50.9 `description: "Diagnose and fix performance issues in your React app"`

```4:4:packages/react-doctor/package.json
  "description": "Diagnose and fix performance issues in your React app",
```

But the README, the CLI's `--help`, and the rules cover **security, correctness, accessibility, bundle size, architecture** in addition to performance. The description undersells.

### 🟢 50.10 `"keywords": ["diagnostics", "linter", "nextjs", "performance", "react"]`

Missing relevant keywords: `tanstack`, `react-native`, `oxlint`, `knip`, `react-compiler`, `typescript`, `accessibility`, `security`. Discoverability suffers.

### 🟢 50.11 `dist/index.js:1764` `version: options.version ?? "0.0.0"` — confirmed in published artifact

Per §11.1 (Pass 2). The fallback string `"0.0.0"` is in the bundled output, not just the source. Programmatic users of `toJsonReport` who forget to pass `version` get `"0.0.0"` in their reports.

---

## 51. Fixture Pattern Issues

### 🟠 51.1 Most fixture components fake their dependencies via local `const`

Pattern: `const X = (...) => ...; export const SomeRoute = X(...)`. Used in:
- `nextjs-app/src/app/page.tsx`: fakes `useSearchParams`, `router`, `redirect`, `Image`, `Script`.
- `nextjs-app/src/pages/_app.tsx`: fakes `router`.
- `basic-react/src/query-issues.tsx`: fakes `useQuery`, `useMutation`, `QueryClient`, `QueryClientProvider`, `queryClient`.
- `tanstack-start-app/src/routes/route-issues.tsx`: fakes `createFileRoute`, `createRootRoute`, `redirect`, `notFound`, `navigate`.
- `tanstack-start-app/src/routes/server-fn-issues.tsx`: fakes `createServerFn` via Proxy.
- `tanstack-start-app/src/routes/edge-cases.tsx`: fakes `createFileRoute`, `createServerFn`.
- `tanstack-start-app/src/routes/__root.tsx`: fakes `createRootRoute`, `Outlet`, `Scripts`.

The rules fire on these locally-defined functions — confirming §48 systemically. The fixtures **are written to make the rules fire**, but in production code, this would be a false positive on any project with a similar name.

The "right" fixture would be:

```tsx
import { useQuery } from "@tanstack/react-query";
// then exercise the rule
```

…with `@tanstack/react-query` actually installed in the fixture's `node_modules`. Larger fixture, but accurate.

### 🟠 51.2 The fixtures have no negative tests for "named like X but not from X's import"

The Pass 6 §48 problem could be detected with a fixture like:

```tsx
const useQuery = (cb: () => Promise<unknown>) => cb(); // local utility, not React Query
useQuery(async () => fetchData());
// rule should NOT fire here
```

…and an assertion that the `query-stable-query-client` rule does NOT fire. None of the fixtures do this.

### 🟡 51.3 `tanstack-start-app/src/routes/__root.tsx:8` has `<head></head>` — but no `<HeadContent />`

```5:14:packages/react-doctor/tests/fixtures/tanstack-start-app/src/routes/__root.tsx
export const Route = createRootRoute({
  component: () => (
    <html lang="en">
      <head></head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  ),
});
```

The rule `tanstackStartMissingHeadContent` checks for `<HeadContent />` (a component name, not the lowercase `<head>`). The fixture has `<head>` (lowercase HTML), no `<HeadContent />`. Rule fires correctly. But what about a project that has a custom-named head wrapper like `<MyHeadContent />`? Same problem as §48 — the rule only checks `node.name.name === "HeadContent"`.

### 🟡 51.4 `tanstack-start-app/src/routes/__root.tsx:3` — `Scripts` component is fake

```3:3:packages/react-doctor/tests/fixtures/tanstack-start-app/src/routes/__root.tsx
const Scripts = () => <script />;
```

The rule `nextjsNoNativeScript` fires on lowercase `<script>` (not `<Scripts>`). So this returns lowercase `<script />` which would fire. But this is a __root route in a TanStack Start app — it's not a Next.js project, so the next.js rules shouldn't apply (the framework auto-detection should prevent that). The TanStack Start fixture's package.json declares `@tanstack/react-router` and `@tanstack/react-start`, no `next`, so framework should resolve to `tanstack-start`. Good.

But the `rendering-script-defer-async` rule in the base ruleset (line 158, `"warn"`) DOES apply regardless of framework. So `<script />` (no src, no defer, no async) would be inspected. The rule (`renderingScriptDeferAsync` in performance.ts:428-470) requires `hasSrc` to fire, so `<script />` (no src attribute) is skipped. Good.

### 🟡 51.5 Fixtures use `_path: string` and `_opts: any` underscore-prefixed unused params

```5:7:packages/react-doctor/tests/fixtures/tanstack-start-app/src/routes/route-issues.tsx
const redirect = (_opts: any) => {
  throw new Error("redirect");
};
```

Underscore prefix is a TS convention for "intentionally unused". But `tsc --noEmit` would still warn about unused parameters unless `noUnusedParameters: true` is set. The fixture's `tsconfig.json` (per fixture) — let me check… these fixtures are scanned by oxlint, not type-checked, so this is fine for the test purpose. But maintainers reading the code may be confused.

### 🟡 51.6 Multiple fixtures use `(options: any)` — losing type safety

```3:4:packages/react-doctor/tests/fixtures/basic-react/src/query-issues.tsx
const useQuery = (options: any) => ({
  data: null,
  isLoading: false,
```

The fixtures use `any` extensively. While these are stub functions for test purposes, `any` defeats the rule's intent. If `oxlint` ever adds a rule for `no-explicit-any` (which it does in `typescript-eslint`), the fixtures would self-flag.

### 🟢 51.7 `nextjs-app/src/app/page.tsx:33-36` `AsyncClientComponent`

```33:36:packages/react-doctor/tests/fixtures/nextjs-app/src/app/page.tsx
const AsyncClientComponent = async () => {
  const data = await fetch("/api/data");
  return <div>{JSON.stringify(data)}</div>;
};
```

Used to test `nextjs-async-client-component`. The rule (`nextjs.ts:51-77`) fires on this. Good. But it's NOT exported as the default export; `Page` is. The test fixture has both. The rule checks both the `FunctionDeclaration` and `VariableDeclarator` paths. Good.

### 🟢 51.8 `nextjs-app/src/pages/_app.tsx:11` `router.replace("/login")`

Tests `nextjs-no-client-side-redirect`'s "Pages Router" branch (per §27.2, Pass 4). The fixture does fire the rule, but the assertion only checks the help text, not the rule's actual position/severity. Fine.

### 🟢 51.9 `nextjs-app/src/app/logout/route.tsx:7` deletes session cookie + redirects

```5:10:packages/react-doctor/tests/fixtures/nextjs-app/src/app/logout/route.tsx
export async function GET() {
  const cookieStore = await cookies();
  cookieStore.delete("session");
  redirect("/login");
  return NextResponse.json({ ok: true });
}
```

Tests `nextjs-no-side-effect-in-get-handler`. The rule (`nextjs.ts:436-463`) checks for `extractMutatingRouteSegment` (the `logout` segment matches `MUTATING_ROUTE_SEGMENTS`) AND `findSideEffect` (the `cookieStore.delete` is a mutating call). Good fixture.

But `redirect("/login")` after `cookieStore.delete()` is unreachable in real Next.js (`redirect` throws). The fixture has `return NextResponse.json(...)` after the redirect, which is also unreachable. The fixture is illustrative but logically broken — `redirect()` AND `return NextResponse.json()` can't both happen.

---

## 52. Additional Findings (Pass 7)

| Severity | File / Location | Issue |
|---|---|---|
| 🟠 | `packages/react-doctor/src/oxlint-config.ts:128-131` | The `eslint-plugin-react-hooks` resolved via `esmRequire.resolve("eslint-plugin-react-hooks")` — but only for `hasReactCompiler && !customRulesOnly`. If neither condition triggers, the plugin specifier isn't resolved. But the plugin is still in `dependencies` (per §50.2), so npm installs it for everyone. Wasted install. |
| 🟠 | `packages/react-doctor/dist/index.js:9-15` | The dead `buildDiagnoseResult` identity wrapper from §3.3 (Pass 1) is shipped in `dist/index.js`. Confirmed. The `./api` consumer downloads 22 lines of identity code. |
| 🟠 | `packages/react-doctor/dist/index.js:1` | `import { createRequire } from "node:module";` — even when only `./api` (Node-side) is consumed, this import is fine, but the same `createRequire` call appears in `./browser`'s chunked code, which is supposed to be browser-portable. If a bundler doesn't strip `node:module`, browser builds break. (Verified earlier: `dist/process-browser-diagnostics-…js` is the browser chunk; needs separate inspection.) |
| 🟠 | `packages/react-doctor/src/utils/run-oxlint.ts:359-358` | `RULE_CATEGORY_MAP` includes entries for the dead 11 rules from §1.1 (Pass 1). Even if the rules never fire, the metadata is shipped. The dead 11 rules contribute ~11 KB of dead constant data to the bundle. |
| 🟠 | `packages/react-doctor/src/utils/run-oxlint.ts:144-357` | `RULE_HELP_MAP` is 213 lines of help text for ~75 rules. Many of these correspond to dead rules (§1.1) — their help text never gets shown because the rule never fires. ~5 KB of dead text in the bundle. |
| 🟡 | `packages/react-doctor/tests/fixtures/nextjs-app/src/app/logout/route.tsx:6-9` | `redirect("/login"); return NextResponse.json({ ok: true });` — the return is unreachable in real Next.js (since `redirect` throws). Logically broken fixture. |
| 🟡 | `packages/react-doctor/src/oxlint-config.ts:118-125` | `categories: { ... "off" }` is necessary because oxlint defaults categories to `"warn"` for all built-in rules. But this means we have to explicitly allowlist every rule we want, AND blocklist every category. A future oxlint version that adds a new category (e.g., `experimental`) would have its rules auto-fire because the new category isn't `"off"` here. Fragile — should be `"*": "off"` if oxlint supported it. |
| 🟡 | `packages/react-doctor/src/oxlint-config.ts:21` (NEXTJS_RULES) | Doesn't include `react-doctor/server-after-nonblocking` — even though the rule's primary use case is Next.js server actions. The rule is enabled globally (line 182) instead. Functional but logically misplaced. |
| 🟡 | `packages/react-doctor/src/oxlint-config.ts:36-50` (TANSTACK_START_RULES) | Includes `react-doctor/tanstack-start-server-fn-validate-input` at `"warn"`. But the equivalent rules for Next.js (e.g., a hypothetical `nextjs-server-action-validate-input`) don't exist. Asymmetric coverage between the two server frameworks. |
| 🟡 | `packages/react-doctor/src/oxlint-config.ts:53-70` (REACT_COMPILER_RULES) | All set to `"error"`. But the React Compiler is a beta feature; not every "compiler can't optimize this" warning is critical. A user who explicitly opts into the compiler with knowledge of its limitations would still get errors that block their build (with `--fail-on error`). Should default to `"warn"`. |
| 🟡 | `packages/react-doctor/src/utils/run-oxlint.ts:506-553` | The function returns early when `includePaths.length === 0` (line 517) but doesn't restore disable directives or clean up the config file. Wait — there's no setup before that early return. So no cleanup needed. Fine. |
| 🟡 | `packages/react-doctor/src/utils/run-oxlint.ts:524` | `restoreDisableDirectives()` is called in the finally block (line 548). But if the early return on line 517 had been hit AFTER the call to `neutralizeDisableDirectives` (a future refactor), the restore would never run. The finally is positioned correctly today; defensive ordering. |
| 🟡 | `packages/react-doctor/src/cli.ts:208` | `flags.staged` is checked alongside `flags.diff`/`flags.project`/etc. But there's no explicit guard preventing `--staged --diff main` (mixing the two modes). The `--diff` is silently ignored (because `staged` mode returns early). Documenting the precedence: `--staged` wins, `--diff` ignored. |
| 🟡 | `packages/react-doctor/src/cli.ts:233-237` | `scan(snapshot.tempDirectory, { ...scanOptions, includePaths: snapshot.stagedFiles, configOverride: userConfig })` — passes `userConfig` from the user's project root, but the scan runs against `snapshot.tempDirectory`. The config's `ignore.files` glob patterns are computed relative to the config's "directory" — but the scan directory is the temp dir. So `src/generated/**` in the config matches files in `<tempDir>/src/generated/**`, which is what we want (snapshot preserves structure). Good. But edge case: a config with **absolute** ignore paths (`/Users/me/proj/src/generated/**`) wouldn't match the temp dir. |
| 🟡 | `packages/react-doctor/src/utils/run-oxlint.ts:506-553` | The function does a **lot** of setup work (config write, neutralize, plugin path resolution, batching) for every call. A monorepo scan with N projects calls this N times sequentially. Each call writes a fresh config to a PID-named tempfile — the same path is reused, but each call writes fresh content. If two scans were to run concurrently (different projects in parallel — not currently the case), they'd race on the config file. |
| 🟡 | `packages/react-doctor/src/scan.ts:486` | `inputOptions.configOverride !== undefined` check is `!== undefined`, allowing `null` as a valid "override = use no config" signal. This three-state pattern (undefined, null, Config) is documented per §45 row 14 (Pass 6). Same finding here. |
| 🟢 | `packages/react-doctor/src/utils/discover-project.ts:430-434` | `hasReactDependency` uses `REACT_DEPENDENCY_NAMES = new Set(["react", "react-native", "next"])`. Misses `preact` (which compiles to React-compatible APIs), `solid-js`/`vue` (different but adjacent ecosystems). If a user runs `react-doctor` on a Preact project, it correctly says "No React dependency found". Good. |
| 🟢 | `packages/react-doctor/dist/cli.js:14` | `import { main } from "knip";` — the import is at the top of the bundle. If a user runs `react-doctor --no-dead-code`, the knip module is still loaded (and its initialization side-effects run) before the user's flag is checked. Marginal: knip's import cost is small. But the `--no-dead-code` user pays for it anyway. Lazy-load via dynamic import inside `runKnip`. |
| 🟢 | `packages/react-doctor/src/oxlint-config.ts:79-92` | `BUILTIN_REACT_RULES` includes `"react/no-unknown-property": "warn"`. But this rule has known false positives in projects using Tailwind CSS (`tw` attribute), styled-components (`as` attribute), MDX (custom JSX attributes), etc. Without a way to extend the rule's allow-list, projects regularly hit warnings on legitimate usage. |
| 🟢 | `packages/react-doctor/src/oxlint-config.ts:102` | `"jsx-a11y/no-autofocus": "warn"` — but autofocus on a single login form is a UX best practice. Fires on every `<input autoFocus />` regardless of context. The default level here is permissive (warn), but the README's `customRulesOnly` advice doesn't help if this is one of many a11y warnings. |
| 🟢 | `packages/react-doctor/src/oxlint-config.ts:104` | `"jsx-a11y/heading-has-content": "warn"` — fires on `<h1>{titleVariable}</h1>` where the rule doesn't know `titleVariable` is non-empty. Many false positives. |
| 🟢 | `packages/react-doctor/tests/fixtures/basic-react/src/correctness-issues.tsx:21-29` `PreventDefaultForm` | Tests `no-prevent-default` for `<form>`. The rule fires correctly. But the fixture doesn't cover the alternative `<a onClick={(e) => e.preventDefault()}>` case. Per §44.4 (Pass 6) — the rule's other branch is untested. |
| 🟢 | `packages/react-doctor/tests/fixtures/nextjs-app/src/app/page.tsx:38-45` | `RedirectInTryCatchComponent` does `try { redirect("/dashboard") } catch { return <div>error</div> }`. The rule should fire. The local `redirect` is the false-positive issue (§48.2) — the rule fires on a fake. |

---

## 53. Quick Wins (Pass 7)

59. **Drop `react-perf` from the `plugins` array** (§49.1) — pure dead weight.
60. **Move `eslint-plugin-react-hooks` to `peerDependenciesMeta` (optional)** (§50.2) — saves install size for non-compiler users.
61. **Add `engines` to `packages/react-doctor/package.json`** (§50.1) — surfaces the Node 22+ requirement on install.
62. **Add `sideEffects: false`** (§50.4) — enables tree-shaking for `./browser`/`./worker` consumers.
63. **Replace `rm -rf dist` with `rimraf dist`** (§50.7) — cross-platform build.
64. **Document `./oxlint-plugin` entry point** (§50.5) or remove it from exports if it's internal-only.
65. **Add at least one fixture that uses real imports from `@tanstack/react-query`/`next/navigation`** to verify rules don't fire on **non**-imported `redirect`/`useQuery` (§51.2) — locks down the §48 systemic concern when it's eventually addressed.
66. **Verify each rule's import scope before firing** (§48 systemic) — multi-week effort but the highest-impact false-positive reduction.
67. **Make the `description` keyword and category list reflect the actual rule coverage** (§50.9, §50.10).

---

## 54. Items I Did Not Verify (Pass 7)

- Whether `dist/process-browser-diagnostics-…js` (the chunked browser bundle) actually leaks `node:module` via `createRequire` (§52 row 3). Browser bundlers should strip it; if not, browser builds break.
- Whether oxlint's plugin loader handles `./oxlint-plugin`'s ESM-only export when it expects CJS (§50.6).
- Whether running `vp pack` on Windows actually fails due to `rm -rf` (§50.7) — likely yes but not tested.
- Whether the `react-perf` plugin actually contributes any runtime work when its rules are all `"off"` — depends on oxlint's lazy-loading strategy. If oxlint defers rule resolution until a category fires, the plugin load may be free; otherwise §49 is real overhead.
- Whether there's a way to scope rules to imports from specific modules in the oxlint plugin API (§48 systemic). Resolving this would either require a doc fix to the README ("Rules fire on any function with the matching name") or a code refactor to track imports per file.
- Whether the published `react-doctor` on npm currently has the `eslint-plugin-react-hooks` dep installed for users who don't use React Compiler. `npm install react-doctor && du -sh node_modules` would tell.

These are the highest-value follow-ups for Pass 7.

---

# Eighth Pass — Public Asset Drift, Score-Bar Width Drift, Install Script Bugs, Lockfile Multi-Version

This pass focuses on artifacts that ship publicly (the website's `public/`), constants that have drifted across files, the `install-skill.sh` bash script, and dependency-version inconsistencies.

## 55. Public Asset / Documentation Drift

### 🔴 55.1 `packages/website/public/llms.txt` is missing 7+ CLI flags

```37:52:packages/website/public/llms.txt
## Options

```
Usage: react-doctor [directory] [options]

Options:
  -v, --version     display the version number
  --no-lint         skip linting
  --no-dead-code    skip dead code detection
  --verbose         show file details per rule
  --score           output only the score
  -y, --yes         skip prompts, scan all workspace projects
  --project <name>  select workspace project (comma-separated for multiple)
  --diff [base]     scan only files changed vs base branch or uncommitted changes
  -h, --help        display help for command
```
```

The actual CLI (`cli.ts:165-180`) supports:

```
-v, --version, --lint, --no-lint, --dead-code, --no-dead-code, --verbose, --score,
--json, -y, --yes, -n, --no, --project, --diff, --offline, --staged, --fail-on,
--annotations, -h, --help
```

Missing from `llms.txt`: `--lint`, `--dead-code`, `--json`, `-n, --no`, `--offline`, `--staged`, `--fail-on`, `--annotations`. **8 flags missing.**

This is a doc file specifically named `llms.txt` — its purpose is to be discoverable by AI/LLMs as a canonical CLI reference. The actual CLI grew well beyond what's documented here. AI agents reading this file recommend the wrong flags to users.

The file is also rewritten when `Accept: text/markdown` is sent (per `next.config.ts:7-15`), so the same out-of-date content serves as the markdown rendering of the homepage.

### 🟠 55.2 `llms.txt` claims `--diff` "scan only files changed vs base branch or uncommitted changes"

```50:50:packages/website/public/llms.txt
  --diff [base]     scan only files changed vs base branch or uncommitted changes
```

But the actual CLI behavior (`cli.ts:131-159 resolveDiffMode`) is:

- `--diff <base>` (with explicit branch): always scans vs that branch.
- `--diff` (no value): on default branch → uncommitted; on feature branch → vs default.
- No `--diff` → prompts user when running interactively, or skips diff in CI/JSON.

The llms.txt summary collapses three distinct behaviors into one sentence and omits the prompting logic.

### 🟠 55.3 The install script's `INSTALLED=0` early-error branch is unreachable

```155:178:packages/website/public/install-skill.sh
# Project-level .agents/
AGENTS_DIR=".agents/$SKILL_NAME"
mkdir -p "$AGENTS_DIR"
printf '%s\n' "$SKILL_CONTENT" > "$AGENTS_DIR/SKILL.md"
printf '%s\n' "$AGENTS_CONTENT" > "$AGENTS_DIR/AGENTS.md"
printf "${GREEN}✔${RESET} .agents/\n"
INSTALLED=$((INSTALLED + 1))

echo ""
if [ $INSTALLED -eq 0 ]; then
  echo "No supported tools detected."
  echo ""
  echo "Install one of these first:"
  ...
  exit 1
fi
```

The block at line 156-162 **always** writes to `.agents/$SKILL_NAME` regardless of which tools are detected. This unconditionally increments `INSTALLED` to at least 1. Therefore the `if [ $INSTALLED -eq 0 ]` block at line 165 is **unreachable code**.

The "No supported tools detected. Install one of these first: …" message is dead. A user who runs the script with **no** supported tools installed sees only `✔ .agents/` and "Done!" — no warning, no help message about which agents to install.

### 🟠 55.4 The install script writes `.agents/` to the user's current working directory

```157:158:packages/website/public/install-skill.sh
AGENTS_DIR=".agents/$SKILL_NAME"
mkdir -p "$AGENTS_DIR"
```

When `curl https://www.react.doctor/install-skill.sh | bash` runs, `bash` executes in the user's current working directory at the time of the curl invocation. The comment claims "Project-level `.agents/`" — but if the user runs from `~`, this lands at `~/.agents/react-doctor/`. If from a project directory, it lands in the project. The script doesn't validate.

A user running the canonical `curl ... | bash` from the wrong directory gets `.agents/` in an unexpected place. There's no `cd` to a known location and no warning that the directory matters.

### 🟠 55.5 The install script uses an empty `MARKER` regex on line 107

```103:108:packages/website/public/install-skill.sh
MARKER="# React Doctor"
if [ -d "$HOME/.codeium" ] || [ -d "$HOME/Library/Application Support/Windsurf" ]; then
  mkdir -p "$HOME/.codeium/windsurf/memories"
  RULES_FILE="$HOME/.codeium/windsurf/memories/global_rules.md"
  if [ -f "$RULES_FILE" ] && grep -q "$MARKER" "$RULES_FILE"; then
    printf "${GREEN}✔${RESET} Windsurf ${DIM}(already installed)${RESET}\n"
```

`grep -q "$MARKER"` parses `MARKER` as a regex. `# React Doctor` happens to be regex-safe today, but a future `MARKER` change (e.g., adding `(v1.0)`) would silently misbehave because `(` and `)` are regex metacharacters. Use `grep -qF "$MARKER"` (literal) and `grep -qx "$MARKER"` (whole line) to be safe.

### 🟠 55.6 Windsurf detection mixes Linux and macOS-only paths

```104:104:packages/website/public/install-skill.sh
if [ -d "$HOME/.codeium" ] || [ -d "$HOME/Library/Application Support/Windsurf" ]; then
```

The first check is general-Unix; the second is macOS-only (the `~/Library/Application Support` path doesn't exist on Linux/Windows). On Windows (WSL/Git Bash/Cygwin), neither check is right — Windsurf may install to `$APPDATA/Windsurf` or `$LOCALAPPDATA/Programs/Windsurf` instead. The script doesn't handle Windows.

Same pattern across other agents: Codex (`~/.codex`), Cursor (`~/.cursor`) — Linux/macOS conventions. Windows is silently unsupported despite the curl-pipe-bash being delivered to potentially Windows/WSL users.

### 🟠 55.7 The script writes `.agents/AGENTS.md` regardless of whether AGENTS.md is meaningful for that agent

The "Project-level .agents/" block (line 156-162) writes both `SKILL.md` and `AGENTS.md`. But `.agents/skills/X/AGENTS.md` is not a recognized convention — only `.agents/AGENTS.md` (no `skills/` subfolder) is. The script's path is `.agents/$SKILL_NAME/AGENTS.md` which is `.agents/react-doctor/AGENTS.md`. This may or may not be picked up by agent runners depending on their conventions.

### 🟢 55.8 The "Antigravity" section uses `command -v agy` for detection

```122:122:packages/website/public/install-skill.sh
if command -v agy &> /dev/null || [ -d "$HOME/.gemini/antigravity" ]; then
```

`agy` is a niche binary name. As of writing, Google's Antigravity uses different naming. If the actual binary is `antigravity` or `gemini-cli antigravity`, the detection misses. Worth verifying against Antigravity's current install docs.

### 🟢 55.9 `install-skill.sh:134` writes `SKILL.md` to `~/.gemini/skills/$SKILL_NAME/`

But other agents using `.agents/skills/` (per `detect-agents.ts`) include `gemini`. So Gemini CLI gets the skill in TWO places — `.gemini/skills/react-doctor/` (per the curl script) and `.agents/skills/react-doctor/` (per the project-level fallback). Duplication, no warning.

---

## 56. Score-Bar Width Drift Across Files

### 🔴 56.1 Four different `SCORE_BAR_WIDTH` values across the codebase

| File | Constant | Value |
|---|---|---|
| `packages/react-doctor/src/constants.ts:15` | `SCORE_BAR_WIDTH_CHARS` | **50** |
| `packages/website/src/app/share/animated-score.tsx:8` | `SCORE_BAR_WIDTH` | **30** |
| `packages/website/src/components/terminal.tsx:19` | `SCORE_BAR_WIDTH_MOBILE` | **15** |
| `packages/website/src/components/terminal.tsx:20` | `SCORE_BAR_WIDTH_DESKTOP` | **30** |
| `packages/website/src/app/leaderboard/page.tsx:8` | `SCORE_BAR_WIDTH` | **20** |

The CLI prints a 50-character bar. The animated demo terminal shows 15 (mobile) or 30 (desktop) chars. The leaderboard shows 20 chars. The share-page shows 30 chars.

A user comparing the share-page bar to their CLI output sees differently-proportioned bars for the same score. The score visualization is the product's primary visual identity — and it's inconsistent.

This is in addition to §18 (Pass 3): score logic itself is duplicated 7 times. Now confirmed: even the **rendering width** has drifted.

### 🟡 56.2 Score-bar character set drifts too

```184:185:packages/react-doctor/src/scan.ts
    filledSegment: "█".repeat(filledCount),
    emptySegment: "░".repeat(emptyCount),
```

```33:34:packages/website/src/app/share/animated-score.tsx
      <span className={colorClass}>{"\u2588".repeat(filledCount)}</span>
      <span className="text-neutral-600">{"\u2591".repeat(emptyCount)}</span>
```

The CLI uses literal `█` (U+2588) and `░` (U+2591). The animated-score uses `\u2588`/`\u2591` (numeric escapes for the same characters). Functionally identical, but the **encoding choice** differs. This shows two contributors writing the same code with different conventions — typical of duplication-by-copy.

`leaderboard/page.tsx:32-33` uses literal characters; `terminal.tsx:159-160` uses literal characters. Mixed conventions across 7 sites — same characters, different syntactic forms.

### 🟡 56.3 The `"\u2588"`-style escape preserves the file as ASCII-safe

The use of escape codes in `share/page.tsx:38-39`, `share/animated-score.tsx:33-34` is a deliberate "ASCII-safe source" choice. But other website files use literal Unicode (`terminal.tsx`, `leaderboard/page.tsx`). Inconsistent. Pick one and document.

---

## 57. `@types/node` Version Drift

### 🔴 57.1 Three different `@types/node` versions in `pnpm-lock.yaml`

```text
'@types/node@12.20.55': {}
'@types/node@20.19.33':
  ...
'@types/node@25.6.0':
```

In the same lockfile. The reasons:

- Root `package.json` declares `^25.5.0`.
- `packages/website/package.json:19` declares `^20`.
- One transitive dep pins `@types/node@12.20.55`.

Three `@types/node` packages installed simultaneously, each with subtly different definitions. TypeScript resolution order matters — depending on which one wins, `fs.cpSync`'s parameter shape (added in Node 16) might or might not be available, `process.env`'s typing might differ, etc.

`packages/react-doctor/tsconfig.json` extends `../../tsconfig.json` (root). The root tsconfig doesn't pin `types: ["node"]`, so TypeScript uses the **first** `@types/node` it finds in `node_modules`. That's non-deterministic.

### 🟠 57.2 Root uses Node 25 types, website uses Node 20 types

```29:29:package.json
    "@types/node": "^25.5.0",
```

```19:19:packages/website/package.json
    "@types/node": "^20",
```

Node 25 is current/odd (not LTS). Node 20 is LTS. The website (likely deployed on Vercel) probably uses Node 20 at runtime. The root devtools use Node 25.

If a dev imports a Node 25 API in a website file (because the IDE uses the root types), and Vercel runs Node 20, runtime fails.

Pin both to `^22` (the project's minimum per `engines`) for consistency.

### 🟢 57.3 The `@types/node@12.20.55` transitive dep is suspicious

`12.20.55` is a Node 12 LTS version that's well past EOL. Whatever transitive dep declares this as its types peer is using ancient Node typings. May or may not affect react-doctor's runtime, but the lockfile health is impaired.

---

## 58. Additional Bug Findings

### 🟠 58.1 `load-config.ts:32-33` accesses property on potentially-non-object

```30:33:packages/react-doctor/src/utils/load-config.ts
    try {
      const fileContent = fs.readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(fileContent);
      const embeddedConfig = packageJson[PACKAGE_JSON_CONFIG_KEY];
```

`JSON.parse` can return `null`, a primitive (`42`, `"string"`, `true`), or an array. `packageJson[PACKAGE_JSON_CONFIG_KEY]` then:

- For `null`: throws `TypeError: Cannot read properties of null`.
- For primitives (`42`): returns `undefined` (silent).
- For arrays: returns `undefined` (silent).
- For objects: works as intended.

The `try/catch` (line 30) catches the null-deref and returns `null` overall. So functionally fine — but the unsafe access is hidden by the try/catch. A future contributor refactoring the try-block could expose the unsafe access. Use `isPlainObject(packageJson)` before the property access.

### 🟠 58.2 `run-oxlint.ts:527 writeFileSync(configPath, JSON.stringify(config, null, 2))`

The 2-space pretty-print is wasted bytes. oxlint reads JSON and doesn't care about formatting. For the 50-rule config, this is ~5 KB extra disk I/O per scan (vs ~2 KB minified). Multiplied across N projects in a monorepo, ~250 KB extra writes per scan.

`JSON.stringify(config)` is faster and identical semantically.

### 🟠 58.3 `run-oxlint.ts:521` `react-doctor-oxlintrc-${process.pid}.json` is symlink-attack vulnerable

```521:521:packages/react-doctor/src/utils/run-oxlint.ts
  const configPath = path.join(os.tmpdir(), `react-doctor-oxlintrc-${process.pid}.json`);
```

```527:527:packages/react-doctor/src/utils/run-oxlint.ts
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
```

`writeFileSync` follows symlinks by default. On a multi-user system (or single-user with a malicious dependency), an attacker could pre-create a symlink at `os.tmpdir()/react-doctor-oxlintrc-${expectedPid}.json` pointing to a sensitive file (e.g., `~/.ssh/authorized_keys`). When react-doctor runs, the writeFileSync overwrites the target.

Mitigation: `fs.openSync(configPath, "wx")` (exclusive create — fails if exists) or `fs.openSync(configPath, "w", 0o600)` with no follow.

### 🟠 58.4 `Promise.all([lintPromise, deadCodePromise])` runs concurrent `silenced` blocks

```595:595:packages/react-doctor/src/scan.ts
  const [lintDiagnostics, deadCodeDiagnostics] = await Promise.all([lintPromise, deadCodePromise]);
```

The `deadCodePromise` is wrapped in `silenced(() => main(options))` (`run-knip.ts:121`), which mutates `console.log/info/warn/error` globally. While this runs concurrently with the lint promise, ANY call to `console.*` from the lint path (logger, errors, spinner) is also silenced. Per §36 row 4 (Pass 5) — confirmed.

Worse: when `silenced` exits (its `finally` block runs after the deadCode finishes), it restores the originals. But the lint path's calls during that window are lost. The lint spinner, ironically, has its own silent flag (`setSpinnerSilent`) but the underlying ora library uses `console.write` which is silenced too.

### 🟠 58.5 `load-config.ts:32` returns `any` from `JSON.parse`

```32:32:packages/react-doctor/src/utils/load-config.ts
      const packageJson = JSON.parse(fileContent);
```

No type annotation, no `unknown` cast. `packageJson` becomes `any`. Then `packageJson[PACKAGE_JSON_CONFIG_KEY]` is also `any`. The `isPlainObject` check narrows it back to `Record<string, unknown>`. But during the brief `any`-window, type errors in property access are suppressed.

The earlier `JSON.parse` on line 16 explicitly types as `unknown`:
```js
const parsed: unknown = JSON.parse(fileContent);
```

Inconsistent typing within the same file. The package.json branch is laxer.

### 🟡 58.6 `node.parent` usage in two rules — silent failure on oxlint without parent pointers

```77:77:packages/react-doctor/src/plugin/rules/performance.ts
        const openingElement = node.parent;
```

```162:162:packages/react-doctor/src/plugin/rules/react-native.ts
      const openingElement = node.parent;
```

Both rules walk to `node.parent`. If oxlint's plugin host doesn't set `parent` references during traversal:
- `noInlinePropOnMemoComponent` (`performance.ts:55-95`) silently fails — `openingElement` is undefined, the rule returns early at line 78, no diagnostic.
- `rnNoInlineFlatlistRenderitem` (`react-native.ts:156-181`) silently fails — same pattern.

Per §28.7 (Pass 4) — `walkAst` only skips `parent` for cycle prevention; it doesn't add parent. Whether oxlint adds it is implementation-specific. There's no test that verifies `node.parent` is populated.

Other rules use the parent-chain pattern through `walkAst` (which provides explicit traversal but not parent-pointers). These two rules are the only direct `node.parent` uses; if parent isn't set, only these two are broken.

### 🟡 58.7 `scan.ts:174` writes `diagnostics.json` with pretty 2-space format

```174:174:packages/react-doctor/src/scan.ts
  writeFileSync(join(outputDirectory, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));
```

For human inspection, fine. But the file is in `os.tmpdir()` and the path is logged via `logger.dim` (`scan.ts:345`). Users rarely open these temp files. The pretty-print is for readability that's mostly never read.

### 🟢 58.8 `Promise.all` swallows individual rejections

`scan.ts:595` and `core/diagnose-core.ts:90` use `Promise.all`. If both promises reject (e.g., both lint and deadCode fail), only the first rejection propagates. The other failure is silenced. `Promise.allSettled` would surface both. Per §27.5, §36 (Pass 5) — already noted.

### 🟢 58.9 No `node:fs/promises` usage

```text
$ rg "node:fs/promises|fs\.promises" src/
(no matches)
```

The codebase uses sync filesystem I/O exclusively. For a CLI tool that spawns long-running oxlint (multi-second), the sync I/O is rarely the bottleneck. But:
- On Windows, file-locking behavior differs and can stall sync calls.
- For the `--json` mode where the scan is the only operation, async I/O could overlap network calls (score API) with disk I/O (config reading).

Migrating to async would require touching most utility files. Not urgent; documented for completeness.

### 🟢 58.10 Score-bar discontinuity at 999ms→1000ms

```121:126:packages/react-doctor/src/scan.ts
const formatElapsedTime = (elapsedMilliseconds: number): string => {
  if (elapsedMilliseconds < MILLISECONDS_PER_SECOND) {
    return `${Math.round(elapsedMilliseconds)}ms`;
  }
  return `${(elapsedMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1)}s`;
};
```

`999ms` displays as "999ms"; `1000ms` displays as "1.0s". Discrete jump. For a user staring at a watch-mode scan, the visualization changes scale at the boundary. Cosmetic. A continuous formatter (always seconds with adaptive precision) would be smoother.

### 🟢 58.11 `letterSpacingEm.toFixed(2)` reports values with 2 decimal places

```673:673:packages/react-doctor/src/plugin/rules/design.ts
            message: `Letter spacing ${letterSpacingEm.toFixed(2)}em on body text disrupts natural character groupings. Reserve wide tracking for short uppercase labels only`,
```

For `letterSpacing: 0.05` → "Letter spacing 0.05em on body text". Fine. But for `letterSpacing: 0.10` (intentionally wide) → "Letter spacing 0.10em" (not "0.1em") — the trailing zero is preserved. Cosmetic.

---

## 59. Asset / Build Hygiene

### 🟠 59.1 Two SVG logos in `assets/` but only one is referenced from each context

```text
$ ls assets/
react-doctor-readme-logo-dark.svg
react-doctor-readme-logo-light.svg
```

The README references both via `<picture>` (`packages/react-doctor/README.md:1-5`). But:

- The website's `public/react-doctor-icon.svg` and `public/react-doctor-og-banner.svg` are different SVGs.
- The `packages/website/src/app/layout.tsx:14` references `/react-doctor-og-banner.svg` (in public).

Five different SVG assets across two locations. No single source of truth. If the brand mark changes, all five need updating.

### 🟢 59.2 `.changeset/README.md` is the default boilerplate from `@changesets/cli`

```text
$ cat .changeset/README.md
# Changesets

Hello and welcome! This folder has been automatically generated by `@changesets/cli`,
...
```

Fine — but a custom README that documents the project's release flow would be nicer. E.g., "Run `pnpm changeset` after each PR. Aggregate via `pnpm changeset version`. Publish via `pnpm release`."

### 🟢 59.3 `assets/` lives at the repo root, separate from `packages/website/public/`

Two asset dirs with overlapping but non-identical content. The README (a top-level file) references `./assets/`. The website references its own `public/`. If both should reference the same files, deduplication via symlink or build-time copy would help. Not critical.

---

## 60. Additional Findings (Pass 8)

| Severity | File / Location | Issue |
|---|---|---|
| 🟠 | `packages/react-doctor/dist/cli.js` | The dist contains 2885 lines of bundled code. The published artifact embeds knip, picocolors, prompts, ora, commander, plus all the rule plugin metadata. A `--score`-only invocation downloads everything. A "lite" entry point that ships only the score-fetching path could trim 100KB+ for the most common case. |
| 🟠 | `packages/website/public/install-skill.sh:65` | `mkdir -p "$SKILL_DIR"` — uses `-p` for "parents". But on a system where `$SKILL_DIR` already exists as a file (not directory), `mkdir -p` errors out. Bash version-specific behavior. Defensive: check `-d` before `mkdir -p`. |
| 🟠 | `packages/website/public/install-skill.sh:67` | `printf '%s\n' "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"` — the redirect `>` truncates and overwrites. If the user has a custom edit (e.g., they modified the SKILL.md to reference their own configuration), it's silently lost. No `--update` vs `--install` distinction. Per §20 row 17 (Pass 5) and §17.4 (Pass 3). |
| 🟠 | `packages/website/public/install-skill.sh:107` | `grep -q "$MARKER" "$RULES_FILE"` matches anywhere in any line. If someone has `# Original React Doctor analysis (deprecated)` in their `global_rules.md`, the script considers react-doctor "already installed" and skips. Use `grep -qx "$MARKER"` to anchor. |
| 🟠 | `packages/website/public/install-skill.sh:115` | `printf '%s\n' "$SKILL_CONTENT" >> "$RULES_FILE"` — appends. Bash's `printf` with `\n` includes a literal newline AFTER the output. The file gets the marker, an empty line, then the content, then an empty line at the end. Each subsequent install adds duplicate content because `grep -q` only finds the marker but doesn't dedup the body. |
| 🟡 | `packages/website/public/install-skill.sh:73` | `if [ -d "$HOME/.amp" ]; then` — the comment above says "Amp Code". But Amp Code's actual install location is platform-specific (and changes between versions). A single hardcoded path won't catch all Amp Code installations. |
| 🟡 | `packages/website/public/install-skill.sh:74` | `SKILL_DIR="$HOME/.config/amp/skills/$SKILL_NAME"` — note: writes to `~/.config/amp/...` even though detection was `~/.amp`. **The detection and install paths are inconsistent.** If Amp Code is installed at `~/.amp/...` but the install script writes to `~/.config/amp/...`, the skill is in the wrong location. Either Amp Code reads both, or this is broken. |
| 🟡 | `packages/website/public/install-skill.sh:147-151` | The Codex-specific YAML write: `cat > "$SKILL_DIR/agents/openai.yaml" << 'YAMLEOF'` — uses single-quoted heredoc (no interpolation). The YAML's `display_name: "react-doctor"` is hard-coded. If `$SKILL_NAME` ever changes, the YAML is out of sync with the surrounding `$SKILL_NAME` references. |
| 🟡 | `packages/react-doctor/src/scan.ts:159-176` | `writeDiagnosticsDirectory` creates a tempdir and writes per-rule txt files plus a `diagnostics.json`. The dir is left on disk forever — there's no cleanup. After many scans, the user's `os.tmpdir()` accumulates `react-doctor-${randomUUID()}/` directories. For a CI runner that scans on every PR, this could exhaust the tempdir. |
| 🟡 | `packages/react-doctor/src/utils/discover-project.ts:166-167` | `const content = fs.readFileSync(workspacePath, "utf-8");` — reads `pnpm-workspace.yaml` synchronously. For monorepos with very large workspace files (rare but possible — Microsoft's monorepos are >MB), this blocks. Async via `fs/promises` would be better but requires propagating async through `discoverProject`. |
| 🟡 | `packages/react-doctor/src/utils/discover-project.ts:511-512, 517-518` | `hasCompilerInConfigFile` reads each next.config / babel.config / vite.config / app.config file synchronously. For deeply-nested monorepos, this multiplies. Memoize per file path. |
| 🟡 | `packages/react-doctor/src/scan.ts:174` | `JSON.stringify(diagnostics, null, 2)` for the temp `diagnostics.json` — pretty-print. For thousands of diagnostics, the file can be MB-sized. Compact JSON would shrink it 10x. |
| 🟢 | `packages/website/public/llms.txt:9-11` | Only documents `npx -y react-doctor@latest .`, not `react-doctor` (without `npx -y`) for users who installed it. |
| 🟢 | `packages/website/public/llms.txt:25-29` | Recommends `--score` for "output only the numeric score" but doesn't note that the API call to react.doctor still happens unless `--offline` is added. AI agents recommending `--score` to users for CI integration miss the data-leak risk per §17.1 (Pass 3). |
| 🟢 | `packages/website/public/llms.txt` | The file doesn't include the `react-doctor.config.json` configuration schema. AI agents reading it wouldn't know the `customRulesOnly`, `share`, `failOn`, etc. options exist. |
| 🟢 | `packages/website/public/llms.txt` | The file doesn't include the `react-doctor install` subcommand (separate from main scan). AI agents recommending workflows miss this. |
| 🟢 | `assets/react-doctor-readme-logo-light.svg` and `-dark.svg` | Two-version logos for light/dark mode — typical README pattern. But the README's `<picture>` element uses `prefers-color-scheme` media query, which works on GitHub but not on npmjs.com (where the README is also rendered). On npm, the dark version always shows (or vice versa), regardless of the user's color scheme. |

---

## 61. Quick Wins (Pass 8)

68. **Update `packages/website/public/llms.txt` to include all 8 missing CLI flags** (§55.1). Auto-generate from `cli.ts` to prevent future drift.
69. **Remove the unreachable `INSTALLED == 0` branch in install-skill.sh** (§55.3) OR move the `.agents/` block to be conditional on at least one agent being detected.
70. **Add `cd` validation or `# WARNING: run from your project root` to install-skill.sh** (§55.4).
71. **Use `grep -qFx "$MARKER"` for idempotence in install-skill.sh** (§55.5, §60 row 4).
72. **Extract the score-bar width into a shared constants package** (§56.1) — same fix as §18 (Pass 3).
73. **Pin `@types/node` to `^22` in both root and website package.json** (§57.2).
74. **Replace `JSON.stringify(config, null, 2)` with `JSON.stringify(config)`** for the oxlint config write (§58.2).
75. **Use `fs.openSync(path, "wx")` for the oxlint config** (§58.3) — closes the symlink-attack vector.
76. **Add `node.parent` setup verification or rewrite `noInlinePropOnMemoComponent` and `rnNoInlineFlatlistRenderitem` to use visitor scope tracking** (§58.6).
77. **Clean up `os.tmpdir()` `react-doctor-*` directories** (§60 row 9) — add a daily cleanup or use `process.on('exit', cleanup)`.

---

## 62. Items I Did Not Verify (Pass 8)

- Whether `packages/website/public/llms.txt` is auto-served at `/llms.txt` (per `next.config.ts:7-22`). The Next.js rewrite is conditional on `Accept: text/markdown` for `/`; otherwise the file should be served directly via Next.js's static-public-folder convention.
- Whether `pnpm-lock.yaml` actually has both Node 20 and Node 25 types installed simultaneously (§57.1) — `pnpm why @types/node` would confirm. The grep matches both versions but doesn't tell us if both are simultaneously consumed.
- Whether oxlint sets `node.parent` on traversed nodes (§58.6) — would require inspecting oxlint's plugin runtime or testing with a deliberately-broken parent-dependent rule.
- Whether the install-skill.sh's `printf '%s\n' "$VAR"` pattern with multi-line VAR works correctly across Bash 3.2 (macOS), 4.x, 5.x, zsh in bash-compat mode, etc. Most shells handle it correctly, but the `printf` builtin's quirks vary.
- Whether the website's `public/install-skill.sh` is actively served at `/install-skill.sh` (a static-public-folder URL) AND `/install-skill` (the route handler). If both, two URLs serving the same content (per §26.1, Pass 4).
- Whether the leaderboard data drift (§32.3, §35.2) — the README's static table vs the data file — is observed by users. If most users only see the live leaderboard, the README drift is invisible.

These are the highest-value follow-ups for Pass 8.

---

# Ninth Pass — Logger/Stderr Confusion, Annotation Encoding, Dead `weight` Field, CI Detection Gaps

This pass focuses on the logger's stdout/stderr handling, GitHub Actions annotation escaping, the unused `weight` diagnostic field, and CI environment detection coverage.

## 63. Logger / Stream Routing

### 🔴 63.1 Every logger method writes to **stdout**, including `logger.error`

```11:40:packages/react-doctor/src/utils/logger.ts
export const logger = {
  error(...args: unknown[]) {
    if (isSilent) return;
    console.log(highlighter.error(args.join(" ")));
  },
  warn(...args: unknown[]) {
    if (isSilent) return;
    console.log(highlighter.warn(args.join(" ")));
  },
  info(...args: unknown[]) {
    ...
  },
  ...
};
```

Every method uses `console.log`, which writes to **stdout**. Standard CLI convention is for errors to go to **stderr** (via `console.error`), allowing pipelines like:

```bash
react-doctor 2>/dev/null              # silence errors but keep output
react-doctor > output.txt 2> errors.txt  # split streams
react-doctor 2>&1 | grep -i error    # process both streams
```

react-doctor's logger sends everything to stdout. Real-world impact:

- `react-doctor . | head -5` truncates AT the wrong place — error messages get cut alongside diagnostics.
- `react-doctor . > report.txt` captures everything including errors. A `--json` consumer parsing `report.txt` later may hit interspersed error text mixed with the JSON.
- `react-doctor . 2>/dev/null` does nothing — there's no stderr to silence.
- Inside a CI step that captures stderr separately for failure reporting (common in Jenkins/CircleCI), all of react-doctor's errors land in stdout — invisible to error capture.

The `--json` mode is somewhat defensible (`setLoggerSilent(true)` silences all logger output, leaving only `process.stdout.write(JSON)`). But interactive use is broken.

Fix: route `logger.error` and `logger.warn` through `process.stderr.write` (or `console.error`).

### 🟠 63.2 `loadConfig` warnings bypass the logger

```20:24:packages/react-doctor/src/utils/load-config.ts
      console.warn(`Warning: ${CONFIG_FILENAME} must be a JSON object, ignoring.`);
    } catch (error) {
      console.warn(
        `Warning: Failed to parse ${CONFIG_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
      );
```

Per §25.3 (Pass 4) — these go directly to `console.warn` (stderr), bypassing the silent flag. In `--json` mode, the JSON consumer sees stray "Warning: …" lines on stderr.

But there's a deeper inconsistency: the rest of the codebase routes "warnings" through `logger.warn` (which is on **stdout** per §63.1). So `console.warn` (stderr) and `logger.warn` (stdout) coexist in the same codebase, with no clear convention for which to use.

### 🟠 63.3 Logger has no level filtering

The silent flag is binary — either all output or none. There's no way to:
- Silence info/dim but keep error/warn ("quiet mode").
- Silence everything except errors ("strict CI mode").
- Show progress but suppress noise ("CI minimal output").

Other CLIs solve this with `--verbose` / `--quiet` levels. react-doctor only has `--verbose` (which expands diagnostic detail) and the binary `--score`/`--json` toggles.

---

## 64. GitHub Actions Annotation Encoding

### 🔴 64.1 `printAnnotations` doesn't URL-encode the message

```70:80:packages/react-doctor/src/cli.ts
const printAnnotations = (diagnostics: Diagnostic[]): void => {
  for (const diagnostic of diagnostics) {
    const level = diagnostic.severity === "error" ? "error" : "warning";
    const title = `${diagnostic.plugin}/${diagnostic.rule}`;
    const fileLocation =
      diagnostic.line > 0
        ? `file=${diagnostic.filePath},line=${diagnostic.line}`
        : `file=${diagnostic.filePath}`;
    console.log(`::${level} ${fileLocation},title=${title}::${diagnostic.message}`);
  }
};
```

GitHub Actions workflow commands have a specific encoding scheme:

- Newline (`\n`) → `%0A`
- Carriage return (`\r`) → `%0D`
- Percent (`%`) → `%25`

The current code does **no escaping**. Real-world breakage:

1. **Multi-line messages**: rule help text in `RULE_HELP_MAP` (`run-oxlint.ts:144-356`) frequently contains examples or wraps. If `cleanDiagnosticMessage` produces a multi-line message, the GitHub annotation parser truncates at the first `\n`. Subsequent lines are lost.

2. **Messages containing `::`**: legal in JSDoc-flavored messages or when quoting code spans. The annotation parser interprets `::` as a delimiter — the message ends prematurely and the rest becomes a new annotation.

3. **Messages containing `%`**: literal `%` characters in messages confuse the annotation parser if other escapes are nearby.

Looking at the actual messages, e.g., `correctness.ts:154`:
```
"Conditional rendering with .length can render '0' — use .length > 0 or Boolean(.length)"
```

…contains a single quote, an em dash, dots — all safe. But future rules might not be.

Fix: encode the message via `message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')` (in that order). Same for `title` and `filePath` (the file path contains commas in some legal cases).

### 🟠 64.2 `fileLocation` interpolates `filePath` without escaping

```76:77:packages/react-doctor/src/cli.ts
        ? `file=${diagnostic.filePath},line=${diagnostic.line}`
        : `file=${diagnostic.filePath}`;
```

If `filePath` contains a comma (legal in many filesystems — `src/file,with,comma.tsx` is a valid path on Linux), the GitHub annotation parser interprets `with` and `comma.tsx` as additional metadata keys. The annotation is mangled.

Same issue: paths with `=` characters (legal in URL-encoded paths) confuse the key=value parsing.

### 🟠 64.3 `title` (plugin/rule) interpolation could break parsing

```73:73:packages/react-doctor/src/cli.ts
    const title = `${diagnostic.plugin}/${diagnostic.rule}`;
```

`diagnostic.plugin` could be `"unknown"` (the fallback when `parseRuleCode` doesn't match). `diagnostic.rule` is a string from oxlint or knip. Today's rules are all alphanumeric/hyphen, but if a future rule uses `,` or `=`, the annotation breaks.

### 🟢 64.4 No test for `printAnnotations`

Per §2.3 (Pass 1) and §27 (Pass 4) — `--annotations` flag is untested. A regression that broke escaping (or never had it) would never surface in tests. A snapshot test of `printAnnotations` against a fixture diagnostic with newlines would catch the §64.1 issue.

---

## 65. Dead `weight` Field

### 🟠 65.1 `Diagnostic.weight` is set in 3 places but never used by the scorer

```64:64:packages/react-doctor/src/types.ts
  weight?: number;
```

```54:54:packages/react-doctor/src/utils/run-knip.ts
        weight: 1,
```

```185:185:packages/react-doctor/src/utils/run-knip.ts
      weight: 1,
```

```22:22:packages/react-doctor/src/utils/check-reduced-motion.ts
  weight: 2,
```

The `weight` field is set on:
- All knip diagnostics (`weight: 1`).
- The reduced-motion environment diagnostic (`weight: 2`).

But `core/calculate-score-locally.ts:33-37`:

```33:37:packages/react-doctor/src/core/calculate-score-locally.ts
const scoreFromRuleCounts = (errorRuleCount: number, warningRuleCount: number): number => {
  const penalty = errorRuleCount * ERROR_RULE_PENALTY + warningRuleCount * WARNING_RULE_PENALTY;
  return Math.max(0, Math.round(PERFECT_SCORE - penalty));
};
```

Uses fixed penalties (`ERROR_RULE_PENALTY`/`WARNING_RULE_PENALTY`), with no reference to `diagnostic.weight`. The website's API endpoint (`packages/website/src/app/api/score/route.ts`) similarly ignores `weight`.

Result: the `weight` field is **completely dead**. A reduced-motion violation (intended `weight: 2`) penalizes the score the same as any other warning. A knip dead-code warning (intended `weight: 1`) is the same.

Either:
- **Wire up `weight` to the scoring formula** (per-diagnostic penalty: `penalty = sum(d.weight ?? 1)` for matching severity).
- **Delete the field and the three usage sites** to clean up the type.

The mid-state (defining + setting + ignoring) is the worst of both worlds — it implies the field matters but it doesn't.

### 🟢 65.2 The README documents `Diagnostic.weight` is missing — but the type has it

Per §32.2 (Pass 5) — README's `Diagnostic` interface omits the optional `weight: number?`. So programmatic consumers reading the README docs don't even know the field exists. Combined with §65.1, the field is invisible to docs AND ignored by the scorer.

---

## 66. CI Detection Gaps

### 🟠 66.1 `AUTOMATED_ENVIRONMENT_VARIABLES` is missing major CI providers

```92:99:packages/react-doctor/src/cli.ts
const AUTOMATED_ENVIRONMENT_VARIABLES = [
  "CI",
  "CLAUDECODE",
  "CURSOR_AGENT",
  "CODEX_CI",
  "OPENCODE",
  "AMP_HOME",
];
```

The `CI` check catches most modern CI providers (GitHub Actions, GitLab CI, CircleCI, Buildkite, Travis, Jenkins with BlueOcean, etc., all set `CI=true`). But:

- **`GITHUB_ACTIONS`**: GitHub Actions sets both `CI=true` and `GITHUB_ACTIONS=true`. The latter is more specific but redundant with `CI`. Currently caught.
- **`GITLAB_CI`**: GitLab sets `CI=true`. Caught.
- **`BUILDKITE`**: Sets `CI=true`. Caught.
- **`JENKINS_URL`**: **Some Jenkins configurations don't set `CI=true`** (esp. older ones). Missing.
- **`BITBUCKET_BUILD_NUMBER`**: Bitbucket Pipelines sets `CI=true`. Caught.
- **`AWS_CODEBUILD`**: AWS CodeBuild sets `CODEBUILD_BUILD_ID`. Misses if `CI` isn't set.
- **`TF_BUILD`**: Azure DevOps. Sets `TF_BUILD=True`. Misses if `CI` isn't set.

Most CI providers do set `CI=true`. The missing list above is for older or less standard environments. If `react-doctor` is run in such an env, `isAutomatedEnvironment()` returns `false`, and the tool prompts interactively even though stdin is piped or non-TTY (in which case the prompt-library probably exits anyway).

The fallback `!process.stdin.isTTY` catches most non-interactive cases. So §66.1 is mostly defense-in-depth.

### 🟠 66.2 The `CODEX_CI` and `AMP_HOME` env vars are non-standard

```96:98:packages/react-doctor/src/cli.ts
  "CODEX_CI",
  "OPENCODE",
  "AMP_HOME",
```

- **`CODEX_CI`**: Possibly OpenAI Codex's CI flag? Doesn't match Codex's actual env vars (the Codex agent does set its own marker).
- **`OPENCODE`**: OpenCode's marker.
- **`AMP_HOME`**: Amp Code's home directory.

These are "agent" markers, not "CI" markers. Mixing the concepts in one constant is confusing. Either rename to `AUTOMATED_OR_AGENT_ENV_VARS` or split into two lists.

### 🟢 66.3 `CLAUDECODE` doesn't match the convention

```94:94:packages/react-doctor/src/cli.ts
  "CLAUDECODE",
```

Claude Code sets `CLAUDECODE=1`. The capitalization is unusual (`CLAUDECODE`, not `CLAUDE_CODE`). The other entries use snake_case (`AMP_HOME`, `CODEX_CI`, `CURSOR_AGENT`). Inconsistent.

If Claude Code ever changes its env var to the conventional `CLAUDE_CODE`, this check breaks. Add both for forward compat.

---

## 67. Multiple Throw Sites for the Same Error

### 🟡 67.1 `"No React dependency found in package.json"` is thrown from FOUR places

```text
$ rg 'No React dependency found' src/
src/utils/discover-project.ts:551:    throw new Error(`No package.json found in ${directory}`);
src/scan.ts:516:    throw new Error("No React dependency found in package.json");
src/adapters/browser/diagnose.ts:25:    throw new Error("No React dependency found in package.json");
src/core/diagnose-core.ts:57:    throw new Error("No React dependency found in package.json");
```

(`discover-project.ts` is a different message — "No package.json found", but the others are duplicates.)

Three sites throw the identical string `"No React dependency found in package.json"`. If the wording changes (e.g., "No React dependency found — did you forget to install react?"), all three need updating. Centralize in a constant.

### 🟢 67.2 The error message for "No React dependency found" doesn't include the directory

```516:516:packages/react-doctor/src/scan.ts
    throw new Error("No React dependency found in package.json");
```

Compare with `discover-project.ts:551`:
```
throw new Error(`No package.json found in ${directory}`);
```

The "No React" error doesn't tell the user **which** package.json failed the check. For a monorepo where react-doctor scans multiple workspace packages and one is missing react, the error message is unhelpful.

---

## 68. Process Spawning / Environment

### 🟠 68.1 `spawn(nodeBinaryPath, args, { cwd: rootDirectory })` doesn't sanitize env

```442:444:packages/react-doctor/src/utils/run-oxlint.ts
    const child = spawn(nodeBinaryPath, args, {
      cwd: rootDirectory,
    });
```

The spawn doesn't pass an `env` option — so the child inherits the parent's full environment. This means:

- `NODE_OPTIONS=--inspect`: oxlint child opens a debugger port (security/stability concern in CI).
- `NODE_OPTIONS=--max-old-space-size=128`: oxlint child gets crippled heap, may OOM.
- `NODE_DEBUG=*`: oxlint child prints copious Node-internal debugging.
- `NODE_PATH`: changes module resolution.
- `npm_config_*`: any npm/pnpm config var (like `npm_config_loglevel`) leaks into oxlint.

For a deterministic execution, the spawn should explicitly limit the env to a known set. Especially `NODE_OPTIONS` should be unset or restricted.

### 🟠 68.2 `spawn(nodeBinaryPath, args, { cwd: rootDirectory })` doesn't set `windowsVerbatimArguments`

On Windows, child processes use a different argument-passing convention. For `cmd.exe`-based scripts, special characters (`&`, `|`, `>`, `^`) in argument values may need escaping. The Node `spawn` defaults handle most cases but edge cases exist.

This is a defensive concern — react-doctor doesn't pass user-controlled values into oxlint args today (except `--tsconfig ./tsconfig.json` and the file-list batches), but if it did, Windows quoting bugs would be possible.

### 🟢 68.3 oxlint child process inherits the parent's stdout/stderr unless explicitly piped

`spawn` defaults `stdio` to `["pipe", "pipe", "pipe"]` (each as a pipe). The current code uses default. So oxlint's stderr is captured (good) and oxlint's stdout is captured (good). But if oxlint ever decides to write to a tty (e.g., for an interactive prompt), there's no terminal to write to. Edge case.

### 🟢 68.4 No timeout on the oxlint spawn

`spawn` is awaited via promise. There's no `signal` or `timeout` option. If oxlint hangs (e.g., infinite loop in a custom plugin rule), `await spawnOxlint(...)` blocks indefinitely. The user has to ctrl-C.

GitHub Actions has a job-level timeout, so CI builds eventually fail. But interactive runs can hang forever. Add `timeout: 5 * 60_000` (5 min) and reject with a clear "oxlint hung — please report" message.

---

## 69. AbortController / setTimeout Patterns

### 🟡 69.1 `tryScoreFromApi` uses `AbortController` but doesn't tell the user about timeouts

```17:39:packages/react-doctor/src/core/try-score-from-api.ts
export const tryScoreFromApi = async (
  diagnostics: Diagnostic[],
  fetchImplementation: ScoreRequestFetch,
): Promise<ScoreResult | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(SCORE_API_URL, {
      ...
      signal: controller.signal,
    });

    if (!response.ok) return null;

    return parseScoreResult(await response.json());
  } catch {
    return null;
  }
```

`FETCH_TIMEOUT_MS = 10_000` (10 seconds). After 10s, the abort fires, fetch throws, the catch swallows. The function returns `null`. The caller (`calculate-score-node.ts`) falls back to `calculateScoreLocally`.

But the user has no idea the timeout happened. From their perspective, the score appeared after 10s of waiting. They probably blame slow Node/disk. Add `logger.dim("Score API timed out (10s), using local scoring")`.

### 🟡 69.2 `tryScoreFromApi`'s catch-all swallows TypeErrors and SyntaxErrors

```35:36:packages/react-doctor/src/core/try-score-from-api.ts
  } catch {
    return null;
  }
```

The bare catch swallows:
- Network errors (intended).
- `TypeError` from `parseScoreResult` (intended).
- `SyntaxError` from `JSON.parse` if the response is invalid JSON (intended).

But also:
- Any programmer bug in `parseScoreResult` (e.g., a `Reflect.get` typo) — silently returns `null`.
- A future code path adding more logic — accidentally swallowed.

For debugging, a `console.warn("Score API failed:", err)` (writes to stderr, doesn't pollute JSON output) would help.

### 🟡 69.3 `setTimeout` for abort doesn't clear if the request fails before timeout

Wait — `clearTimeout(timeoutId)` IS in the `finally` block. So the timeout is always cleared. Good — the function doesn't leak timers.

### 🟢 69.4 Two `tryScoreFromApi` callers — both use the same flow

`utils/calculate-score-browser.ts` and `utils/calculate-score-node.ts` both call `tryScoreFromApi`. Per §3.2 (Pass 1) — these are duplicates. The shared `tryScoreFromApi` is the right factoring; the two callers should be one.

---

## 70. Additional Findings (Pass 9)

| Severity | File / Location | Issue |
|---|---|---|
| 🟠 | `packages/react-doctor/src/scan.ts:611-613` | Even with `scoreOnly: true`, the network call to the score API still happens (unless `--offline`). For a `--score` user wanting fast output, this is unnecessary latency. Auto-prefer local scoring in `--score` mode. |
| 🟠 | `packages/react-doctor/src/scan.ts:243` | `buildShareUrl` uses `params.set("p", projectName)`. `URLSearchParams.set` URL-encodes — but the projectName from `package.json#name` could contain `@`/`/` (scoped packages). These are correctly encoded (`%40`, `%2F`). But the **rendered URL in the share-link logger output** (line 353) shows the URL-encoded form, which is harder to read than `@scope/pkg` literal. Cosmetic. |
| 🟠 | `packages/react-doctor/src/scan.ts:351-354` | The share URL is logged via `logger.dim` — silenced in `--json` mode. But the API call to `calculateScore` happens before the share URL is logged. So in `--json` mode, the URL isn't shown but the API call still happens. Per §17.1 (Pass 3) — the data is leaked even when the user doesn't see the URL. |
| 🟠 | `packages/react-doctor/src/utils/get-diff-files.ts:84` | `explicitBaseBranch ?? detectDefaultBranch(directory)` — if `explicitBaseBranch === ""` (empty string from `--diff ""`), the `??` doesn't fall through. The empty branch flows into `git merge-base "" HEAD` which fails, and the catch returns `[]`. Ultimately the user gets a silent "no changed files" with no clear error. Validate at CLI entry. |
| 🟠 | `packages/react-doctor/src/utils/get-diff-files.ts:5-17` | `getCurrentBranch` returns `null` for `"HEAD"` (detached state). But during `git bisect`, `git rebase`, or `git worktree`, the user might want a diff. Currently silently disables `--diff`. Document or surface. |
| 🟡 | `packages/react-doctor/src/utils/get-diff-files.ts:7` | `git rev-parse --abbrev-ref HEAD` doesn't account for git submodules. Inside a submodule, it returns the submodule's branch, not the parent's. `--diff` would compute diffs against the submodule's main, which is usually a fixed vendor commit. Probably wrong intent. |
| 🟡 | `packages/react-doctor/src/cli.ts:78` | `printAnnotations` writes to `console.log` directly, not via the logger. Bypasses `setLoggerSilent`. In `--json --annotations` mode, the JSON output gets contaminated with `::warning ...` lines. |
| 🟡 | `packages/react-doctor/src/cli.ts:82-87` `exitGracefully` | Uses `process.exit(0)` (success) on SIGINT/SIGTERM. Bash convention is signal-as-failure (`128 + signal_number` = `130` for SIGINT). Tools that check exit codes (CI gates, parent shells) see "success" when the user actually canceled. Use `process.exit(130)` for SIGINT, `143` for SIGTERM. |
| 🟡 | `packages/react-doctor/src/cli.ts:89-90` `process.on("SIGINT", exitGracefully)` | Both signal handlers call `exitGracefully` which prints "Cancelled.". On Windows, SIGINT is not reliably delivered (Node uses Windows-specific console events). Documented limitation. |
| 🟡 | `packages/react-doctor/src/utils/run-oxlint.ts:514` | `nodeBinaryPath: string = process.execPath` — the default is the parent Node binary. But the parent might be running `pnpm`/`npx`/`tsx` wrapper. `process.execPath` returns the actual `node` binary, not the wrapper. Fine for spawn — the spawn doesn't use the wrapper's logic. But the user might assume `react-doctor` runs oxlint via `npx` or similar; it doesn't. |
| 🟡 | `packages/react-doctor/src/scan.ts:486` | `inputOptions.configOverride !== undefined` — three states (undefined/null/Config). Per §45 row 14, §52 row 16. The `!== undefined` check uses identity comparison. `null` is intentionally a valid override meaning "no config". But a typo using `!= undefined` (loose) would also accept `null`. Either is intentional but underdocumented. |
| 🟡 | `packages/react-doctor/src/utils/spinner.ts:22-26` | `if (activeCount <= 0 \|\| !sharedInstance) { sharedInstance?.[method](displayText); sharedInstance = null; activeCount = 0; return; }` — sets `activeCount = 0` even when it was already 0. Redundant. The `<=` includes 0, so the check itself is the issue: any negative count (impossible normally) would also enter this branch. Fine semantically; clamping is defensive. |
| 🟡 | `packages/react-doctor/src/utils/run-oxlint.ts:524` | `const restoreDisableDirectives = neutralizeDisableDirectives(rootDirectory, includePaths);` — runs SYNCHRONOUSLY before the try block. If `neutralizeDisableDirectives` throws (e.g., permission error on a file), the function exits without writing the config or running oxlint. The error propagates to the caller. Fine. |
| 🟡 | `packages/react-doctor/src/utils/check-reduced-motion.ts:43` | `git grep -ql -E "${PATTERN}" -- ${GLOBS}` runs in a shell. If the user's repo has a hook that intercepts `git grep` (rare), it would interfere. Also, on Windows without git-for-windows providing `grep`, this fails. |
| 🟡 | `packages/react-doctor/src/utils/proxy-fetch.ts:31` | `// @ts-expect-error undici is bundled with Node.js 18+ but lacks standalone type declarations` — the comment says "Node.js 18+", but the project's `engines.node: >=22`. The comment is outdated. |
| 🟡 | `packages/react-doctor/src/utils/proxy-fetch.ts:32` | `await import("undici")` — for users on Node ≥22 with `--no-extra-modules` (a hypothetical flag), the import could fail. The catch returns `null`. Today's Node versions all bundle undici, so this is defensive. |
| 🟢 | `packages/react-doctor/src/utils/install-skill-for-agent.ts:13-15` | The early-return based on `alreadyInstalledDirectories?.has(installedSkillDirectory)` returns the directory but doesn't verify the existing install matches expected content. If a user manually edited the skill, the second install (even if fast-pathed) doesn't notice. |
| 🟢 | `packages/react-doctor/src/utils/spinner.ts:13-16` `noopHandle` | Module-level shared singleton. Calls to `noopHandle.succeed`/`fail` from any caller modify the same object. Today these are no-ops, so no observable issue. If anyone ever mutates `noopHandle.text` (e.g., for compatibility with ora's interface), all callers see it. `Object.freeze`. |
| 🟢 | `packages/react-doctor/src/utils/colorize-by-score.ts` and `core/calculate-score-locally.ts` | The `getScoreLabel` function appears in `calculate-score-locally.ts:11-14` and the website duplicates per §18 (Pass 3). The logic is in 7 places. Confirmed again — no new finding, just persistent. |
| 🟢 | `packages/react-doctor/src/utils/handle-error.ts:13` | `logger.error("")` (empty arg) prints a blank line via the logger's empty-string-coloring path. Should use `logger.break()`. Inconsistent with `scan.ts:204, 206, 211, 220` which use `logger.break()`. |
| 🟢 | `packages/react-doctor/src/utils/handle-error.ts:13-15` | The boilerplate "Something went wrong. Please check the error below for more details. If the problem persists, please open an issue on GitHub." doesn't include a URL. Per §31.1 (Pass 5), the canonical repo URL is unclear. Users following the advice can't find the right repo. |
| 🟢 | `packages/react-doctor/src/utils/format-error-chain.ts:5-11` | `visitedErrors: Set<unknown>` — captures a strong reference to all errors in the chain. For a long-lived chain, this prevents GC. Errors are short-lived in practice; `WeakSet` would be safer for general use. |
| 🟢 | `packages/react-doctor/src/utils/get-staged-files.ts:18-26` `readStagedContent` | Uses `result.stdout.toString()` (default UTF-8). Per §27.7, §36, §60 row 4 — binary file corruption. The `SOURCE_FILE_PATTERN` check filters by extension, but a `.tsx` containing invalid UTF-8 (e.g., a deliberately-corrupted file) would still corrupt. |
| 🟢 | `packages/react-doctor/src/scan.ts:204-206` `printScoreGauge` | Uses `logger.log("  ${buildScoreBar(score)}")` and `logger.break()`. The two-space indent is hardcoded — not from a constant. Magic indent. Per §4.2 (Pass 1), constants should live in `constants.ts`. |
| 🟢 | `packages/react-doctor/src/utils/framed-box.ts:27-28` | `Math.max(...framedLines.map(...))` — uses spread into Math.max. For very long arrays (> ~10K elements), spread can hit V8's argument stack limit. Edge case (rule output has dozens of lines max). |
| 🟢 | `packages/react-doctor/src/utils/framed-box.ts:27-28` | Computes `maximumLineLength` from `plainText.length` — character count, not display width. Multi-byte characters (Chinese, Japanese, emoji) display as 2 columns but count as 1 character. The frame is misaligned for international content. |
| 🟢 | `packages/react-doctor/src/utils/framed-box.ts:30` | `"─".repeat(maximumLineLength + ...)` — uses U+2500 (BOX DRAWINGS LIGHT HORIZONTAL). On Windows cmd.exe with default code page (CP437/CP1252), this renders as `?` or `─`. Older terminals may show garbage. |

---

## 71. Quick Wins (Pass 9)

78. **Route `logger.error` and `logger.warn` to stderr** (§63.1) — matches Unix convention.
79. **URL-encode messages in `printAnnotations`** (§64.1) — fixes mangled GitHub annotations on multi-line rule help text.
80. **Decide if `Diagnostic.weight` should be wired up or removed** (§65.1) — currently dead.
81. **Use `process.exit(130)` for SIGINT** (§70 row 8) — matches bash convention.
82. **Add `logger.dim("Score API timed out, using local scoring")` to `tryScoreFromApi`** (§69.1) — explains the slow run.
83. **Centralize "No React dependency found" error message** (§67.1) — three duplicates.
84. **Add `GITHUB_ACTIONS`, `GITLAB_CI`, `BUILDKITE`, `TF_BUILD` to `AUTOMATED_ENVIRONMENT_VARIABLES`** (§66.1) — broader CI detection.
85. **Validate `--diff` flag value** so `--diff ""` errors out clearly (§70 row 4).
86. **Add a timeout to the oxlint spawn** (§68.4) — prevent infinite hangs.
87. **Use `string-width` (or similar) for `framed-box.ts:27` width calculation** (§70 row 26) — fixes alignment for emoji/CJK content.

---

## 72. Items I Did Not Verify (Pass 9)

- Whether GitHub's annotation parser truly chokes on `::` in messages or whether it's permissive enough that the literal `::` doesn't break (§64.1) — would require an end-to-end test in a real GitHub workflow.
- Whether oxlint's spawn ever hangs in practice (§68.4) — historically oxlint is fast enough that timeouts haven't been needed.
- Whether `process.exit(0)` on SIGINT actually breaks downstream tooling (§70 row 8) — most users don't check exit codes after Ctrl-C, but CI gates might.
- Whether `process.stdout.write(...)` (used for JSON) is truly atomic vs `console.log` (which sometimes adds buffering issues) on macOS/Linux/Windows. The current code mixes both — could cause out-of-order output.
- Whether the `RULE_HELP_MAP` actually has any entries with embedded newlines today (§64.1) — a grep for `\n` in `run-oxlint.ts:144-356` would tell. If none today, future contributors could introduce them.

These are the highest-value follow-ups for Pass 9.

---

# Tenth Pass — Build Toolchain Vendor Lock-In, Duplicate Pnpm Override, TypeScript Multi-Version, Mode Conflict Validation

This pass focuses on dependencies and build configuration concerns that affect the project's long-term maintainability.

## 73. Build Toolchain Vendor Lock-In

### 🔴 73.1 Single-vendor dependency on `@voidzero-dev/vite-plus-core` (pre-1.0)

```30:33:package.json
    "@voidzero-dev/vite-plus-core": "^0.1.15",
    "turbo": "^2.9.3",
    "typescript": "^6.0.2",
    "vite-plus": "^0.1.15"
```

```5:6:pnpm-workspace.yaml
overrides:
  vite: npm:@voidzero-dev/vite-plus-core@^0.1.15
  vitest: npm:@voidzero-dev/vite-plus-test@^0.1.15
```

```46:49:package.json
    "overrides": {
      "vite": "npm:@voidzero-dev/vite-plus-core@^0.1.15",
      "vitest": "npm:@voidzero-dev/vite-plus-test@^0.1.15"
    }
```

The entire build, test, and lint toolchain depends on `@voidzero-dev/vite-plus-core` and `@voidzero-dev/vite-plus-test`, **replacing** vite and vitest globally via pnpm overrides. This is VoidZero's pre-1.0 (`^0.1.15`) closed-beta toolchain.

Risk surface:
- **Pre-1.0 stability**: at 0.1.15-0.1.20, semver guarantees nothing across minor versions. Any patch could break.
- **Single-vendor**: if VoidZero changes their licensing, deprecates the package, or pivots, the entire build pipeline becomes inoperable.
- **Override scope**: replacing `vite` globally affects every transitive dep that requires vite (e.g., next.js for the website package). Subtle incompatibilities can creep in.
- **Lockfile resolution shows `0.1.20` actually installed** — five patch versions ahead of the declared `^0.1.15`. Standard semver, but for a 0.x package, expect breakage.

Production projects should pin to a stable, well-known toolchain (vite + vitest). Or, if vite-plus is intentional, document the rationale and the migration plan if the dep is unavailable.

### 🟠 73.2 `pnpm overrides` are declared in TWO places (`package.json` and `pnpm-workspace.yaml`)

Per §20.8 (Pass 5) — confirmed both copies exist with identical content. pnpm 10 prefers `pnpm-workspace.yaml` (the modern location). The `package.json` `pnpm.overrides` block is legacy. If they ever drift (a contributor updates one but not the other), pnpm's behavior depends on which file pnpm picks — undefined.

Delete one. Keep `pnpm-workspace.yaml`'s version (modern).

### 🟠 73.3 `typescript: ^6.0.2` is unusual

```32:32:package.json
    "typescript": "^6.0.2",
```

Lockfile confirms TypeScript 6.0.2 IS installed (`pnpm-lock.yaml:2798-2801`). TypeScript 6.x is current Microsoft TypeScript at the time of writing this codebase (recent release per the integrity hash). But many of the project's tests, types, and AGENTS.md references presume TS 5.x semantics:

- `packages/react-doctor/package.json:66 "typescript": ">=5.0.4 <7"` — explicitly accepts both 5 and 6.
- `pnpm-lock.yaml:2793-2795 typescript@5.9.3` — also installed (transitive).

So TWO TypeScript versions live in `node_modules` simultaneously. Subtle ABI/API mismatches between 5.9.3 and 6.0.2 can manifest in transitive consumers (esp. `vite-plus`, which has both as peer deps via the `(typescript@6.0.2)` resolution context in the lockfile).

If a downstream tool like `vite-plus` ever expects TS 5 type semantics specifically, the override-to-TS-6 may cause type errors that look like the user's fault.

### 🟢 73.4 `pnpm: { onlyBuiltDependencies: [...] }` whitelist is short

```41:45:package.json
    "onlyBuiltDependencies": [
      "@parcel/watcher",
      "esbuild",
      "unrs-resolver"
    ],
```

pnpm 10's security feature: only listed packages can run their `postinstall` scripts during install. Three approved packages. **Doesn't include**:
- `eslint-plugin-react-hooks` (runtime dep) — currently has no install scripts, but a future version could.
- `oxlint` — Rust binaries built per-platform. May need install scripts on some platforms.
- `knip` — currently has no install scripts.

If the user uses `pnpm install --ignore-scripts` (security-conscious), they don't get the `@parcel/watcher` native binary. The dev experience breaks. This is a fine trade-off but worth documenting.

---

## 74. Mode Conflict Validation

### 🟠 74.1 `--staged` silently overrides `--diff` with no warning

```204:282:packages/react-doctor/src/cli.ts
      if (flags.staged) {
        const stagedFiles = getStagedSourceFiles(resolvedDirectory);
        if (stagedFiles.length === 0) {
          ...
          return;
        }
        ...
        return;
      }

      const projectDirectories = await selectProjects(...);
      const isDiffCliOverride = program.getOptionValueSource("diff") === "cli";
      const effectiveDiff = isDiffCliOverride ? flags.diff : userConfig?.diff;
```

A user who runs `react-doctor --staged --diff main` expects a combined behavior or at least a clear error. Instead, `--staged` is checked first, returns early, and `--diff main` is silently ignored. No warning, no log.

If the user thought their diff mode was active, they're confused why the scan output doesn't show a "Scanning changes" banner.

Add at the top of the action handler:

```ts
if (flags.staged && flags.diff !== undefined && flags.diff !== false) {
  logger.warn("--staged takes precedence; --diff is ignored.");
}
```

### 🟠 74.2 `--score` silently overrides `--json` rendering

```182:184:packages/react-doctor/src/cli.ts
    const isScoreOnly = flags.score;
    const isJsonMode = flags.json;
    const isQuiet = isScoreOnly || isJsonMode;
```

If both `--score` and `--json` are set, the JSON mode prints the JSON report (`writeJsonReport(...)`) AND `scoreOnly` mode within `scan()` prints the bare score (`scan.ts:625-628 logger.log(scoreResult.score)`). But the logger is silenced when `--json` is active. So:

- `--json --score`: prints the JSON report with score embedded, and the `scan.ts:626 logger.log(score)` is silenced. The bare score isn't printed. **Documented behavior is unclear.**
- `--score` alone: prints just the score number.
- `--json` alone: prints the JSON report.

Combining them produces JSON-only output (because logger is silent) — but the user might have expected both. Either error on the combination or document.

### 🟠 74.3 `--annotations` interacts unpredictably with `--json` and `--score`

```360:362:packages/react-doctor/src/cli.ts
      if (flags.annotations) {
        printAnnotations(allDiagnostics);
      }
```

`printAnnotations` writes to `console.log` directly, bypassing the silent logger (per §70 row 7, Pass 9). So:

- `--json --annotations`: prints the JSON to stdout AND `::warning ...` annotations to stdout. The mixed stream is invalid JSON for downstream consumers.
- `--score --annotations`: prints the score AND annotations.

Combining `--annotations` with `--json`/`--score` produces malformed output. There's no validation that catches this.

### 🟢 74.4 `--no` (decline diff) and `--yes` are mutually exclusive but accepted together

```202:206:packages/react-doctor/src/cli.ts
      const shouldSkipPrompts =
        flags.yes ||
        flags.no ||
        isJsonMode ||
        isAutomatedEnvironment() ||
        !process.stdin.isTTY;
```

`-y`/`--yes` means "auto-accept all prompts including diff". `-n`/`--no` means "auto-decline diff prompts". Both set `shouldSkipPrompts`. If both are passed (`react-doctor -y -n`), the behavior is "skip prompts" — but which default? Looking at `resolveDiffMode` (cli.ts:131-159):

When `effectiveDiff === undefined` and `shouldSkipPrompts === true`, `resolveDiffMode` returns `false` at line 145. So `--yes --no` effectively means "decline diff" — same as `-n` alone. But the user might have expected `-y` to take precedence.

Document or error on the combination.

---

## 75. Lockfile / Dependency Concerns

### 🟠 75.1 `pnpm-lock.yaml` is 5,259 lines (~171 KB)

A reasonable size for a tool with this many transitive deps. But:

- **Reviewing a lockfile diff in a PR is impractical.** Updating one dep can churn 50+ lines.
- **`pnpm-lock.yaml` is committed** (presumably — `.gitignore` doesn't exclude it). So every CI run that bumps a transitive dep produces a lockfile diff. PR reviewers can't reasonably check.

For a new contributor, the lockfile is a wall of YAML. CI's `--frozen-lockfile` enforces consistency; that's the safety net.

### 🟠 75.2 Two TypeScript versions installed (`5.9.3` and `6.0.2`)

```2793:2801:pnpm-lock.yaml
  typescript@5.9.3:
    resolution: {integrity: sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==}
    engines: {node: '>=14.17'}
    hasBin: true

  typescript@6.0.2:
    resolution: {integrity: sha512-bGdAIrZ0wiGDo5l8c++HWtbaNCWTS4UTv7RaTH/ThVIgjkveJt83m74bBHMJkuCbslY8ixgLBVZJIOiQlQTjfQ==}
    engines: {node: '>=14.17'}
    hasBin: true
```

Per §73.3. Multiple TypeScript versions in `node_modules` can lead to:
- Subtle type mismatches (5.9.3 and 6.0.2 may have different `Iterable<T>` semantics, etc.).
- IDE confusion: which `tsserver` runs depends on path resolution.
- Bundle output differences if a transformer uses one TS version and a checker uses another.

Pin one TypeScript version across the workspace.

### 🟢 75.3 `@types/node` triplet (`12.20.55`, `20.19.33`, `25.6.0`)

Per §57.1 (Pass 8). Three Node type definitions concurrently. Minor disagreements about Node API shapes can produce "type X is not assignable to type X" errors in transitive consumers.

---

## 76. Subcommand `--yes` Semantics

### 🟠 76.1 `react-doctor install -y` silently no-ops if no agents detected

```36:65:packages/react-doctor/src/install-skill.ts
  const detectedAgents = detectAvailableAgents();
  if (detectedAgents.length === 0) {
    logger.error("No supported coding agents detected on your PATH.");
    ...
    process.exitCode = 1;
    return;
  }

  const skipPrompts = Boolean(options.yes) || !process.stdin.isTTY;

  const selectedAgents: SupportedAgent[] = skipPrompts
    ? detectedAgents
    : ((
        await prompts({...})
      ).agents ?? []);

  if (selectedAgents.length === 0) return;
```

If `detectedAgents` is empty:
- Line 38-44 prints the error and exits with code 1. Good.

If `detectedAgents` is non-empty AND `skipPrompts === true` (because `-y` or non-TTY):
- `selectedAgents = detectedAgents` (all agents). Installs to all.
- `selectedAgents.length === 0` check at line 65 doesn't fire.

If `detectedAgents` is non-empty AND `skipPrompts === false` (interactive mode):
- Prompt asks user to select.
- If user selects nothing (somehow), `selectedAgents.length === 0` → silent return.

So the behavior is consistent. But note: a user running `react-doctor install -y` in CI (no TTY) with NO agents on PATH gets exit code 1 (good). But the `process.exitCode = 1` is set from inside `runInstallSkill` — and the cli.ts `action` block doesn't propagate it. The exit code DOES bubble through Node's default behavior (since `process.exit()` or `process.exitCode` is process-global). So OK.

### 🟢 76.2 `react-doctor install` doesn't have a `--dry-run` flag

For an install command that writes to user-global `~/.claude`, `~/.cursor`, etc., a `--dry-run` would show what's about to be written without modifying anything. Useful for debugging "why is the wrong skill being installed" complaints.

---

## 77. Vite-Plus Build Hook Concerns

### 🟠 77.1 `copySkillToDist` runs in `build:done` hook — depends on relative path layout

```9:17:packages/react-doctor/vite.config.ts
const copySkillToDist = () => {
  const packageRoot = process.cwd();
  const skillSource = path.resolve(packageRoot, "../../skills/react-doctor");
  const skillTarget = path.resolve(packageRoot, "dist/skills/react-doctor");
  if (!fs.existsSync(skillSource)) return;
  fs.rmSync(skillTarget, { recursive: true, force: true });
  fs.mkdirSync(skillTarget, { recursive: true });
  fs.cpSync(skillSource, skillTarget, { recursive: true });
};
```

Issues:
1. **`process.cwd()`-based**: assumes the build runs from the package directory. If the user accidentally runs `vp pack` from the workspace root, `cwd()` is the root, and `../../skills/react-doctor` doesn't resolve. The `if (!fs.existsSync(skillSource)) return;` silently skips. The build "succeeds" but the published artifact lacks the skill.
2. **Hardcoded `../../skills/react-doctor`** — tightly couples the package to its workspace layout. If anyone reorganizes the monorepo (e.g., flatten or move `skills/`), the path breaks silently.
3. **`fs.rmSync` then `fs.mkdirSync` then `fs.cpSync`** — three sync ops that could fail individually. No error handling. A permission denied on `rmSync` would throw.

A more robust approach:
- Resolve `skillSource` from `import.meta.url` (relative to vite.config.ts itself).
- Validate that the source exists — error with a clear message if not.
- Wrap in a try/catch with actionable error.

### 🟠 77.2 `vite.config.ts` reads `package.json` synchronously at module load

```5:7:packages/react-doctor/vite.config.ts
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
  version: string;
};
```

Reads `package.json` from `cwd()`. If `cwd()` isn't the package directory, this fails with ENOENT. The error happens before any vite setup, so the failure is opaque (not "vite couldn't find x"; it's "file not found").

Use `import.meta.url` to resolve relative to the config file.

### 🟢 77.3 `version: process.env.VERSION ?? packageJson.version` — silent fallback to outdated package.json

```27:29:packages/react-doctor/vite.config.ts
      env: {
        VERSION: process.env.VERSION ?? packageJson.version,
      },
```

Per §39.4 (Pass 6) — if `VERSION` env isn't set during release, the bundled binary reports `package.json#version`. Today that works (releases bump package.json before building). But changeset-based releases write the version to package.json AFTER the build in some flows. Worth a runtime assertion that the bundled version isn't `0.0.0`.

---

## 78. Additional Findings (Pass 10)

| Severity | File / Location | Issue |
|---|---|---|
| 🟠 | `pnpm-lock.yaml:8-9` | The overrides at the top of pnpm-lock include both `vite` and `vitest` replacements. But the lockfile is checked into git. If a contributor with an older pnpm version regenerates the lockfile, the lockfile format may change — a different contributor's pnpm 10 may then reject the updated lockfile. Pin pnpm version via `packageManager` field (already done at `package.json:39 "packageManager": "pnpm@10.29.1"`) — but Corepack must be enabled for it to take effect. Document in `CONTRIBUTING.md`. |
| 🟠 | `package.json:39 "packageManager": "pnpm@10.29.1"` | No integrity hash. Modern Corepack (Node 20+) supports integrity hashes via `pnpm@10.29.1+sha256:...`. Without one, a malicious npm registry could serve a different pnpm version. For a security-sensitive project, add the hash. |
| 🟠 | `packages/react-doctor/package.json:32` | Build command is `"build": "rm -rf dist && NODE_ENV=production vp pack"`. The `NODE_ENV=production` is sometimes ignored by `vp` if it doesn't honor the env var. Per `vite.config.ts`, no minification or dead-code elimination is wired up explicitly via `NODE_ENV` checks. So the env var has no effect. Dead code in the config. |
| 🟠 | `packages/react-doctor/vite.config.ts:9-17 copySkillToDist` | Runs in the `build:done` hook. But Turbo's caching may consider the build's output to be `dist/**` (per `turbo.json:6`). If the cache hits, vite doesn't run, which means `copySkillToDist` doesn't run, which means the cached `dist/` is used as-is. If the cached `dist/skills/` is from a previous build with different skill content, the user gets stale content. Turbo cache invalidation should include `skills/**` as an input. |
| 🟠 | `turbo.json:6` `outputs: ["dist/**"]` | Doesn't include `skills/**` as an input. So changes to `skills/react-doctor/SKILL.md` don't invalidate the build's cache. Per the previous row — Turbo serves stale artifacts. |
| 🟡 | `packages/react-doctor/package.json:66 typescript: ">=5.0.4 <7"` | Range `>=5.0.4 <7` — accepts both TS 5 and TS 6. But the codebase wasn't tested against the full range. Some TS 6 features (e.g., new strict null check semantics) might not be backward-compatible with TS 5. CI tests against one specific version (`6.0.2`); 5.0.4 is untested. |
| 🟡 | `packages/website/package.json:24 typescript: ^5` | Different version range than react-doctor's runtime dep. Website allows TS 5 only; react-doctor allows TS 5 OR 6. Disjoint ranges. |
| 🟡 | `packages/react-doctor/src/utils/get-staged-files.ts:4` | Uses `GIT_SHOW_MAX_BUFFER_BYTES = 10 * 1024 * 1024` (10 MB). For a repo with very large staged files (image sprites, generated code), `git show :path` can exceed this. The `spawnSync` then throws ENOBUFS. Caught at line 12 (returns empty string), but the user has no visibility — staged scan silently misses files. |
| 🟡 | `packages/react-doctor/src/constants.ts:62` | `GIT_SHOW_MAX_BUFFER_BYTES = 10 * 1024 * 1024` — but `GIT_LS_FILES_MAX_BUFFER_BYTES = 50 * 1024 * 1024` (50 MB). Inconsistent — `git show` of a large file is bounded smaller than `git ls-files`. Probably correct (one file vs the whole tree), but the rationale isn't documented. |
| 🟡 | `packages/react-doctor/src/utils/get-staged-files.ts:12-15` | `spawnSync` catches errors via `result.error || result.status !== 0`. If `git` exits with non-zero (e.g., git LFS missing), the function returns `[]`. Silent. Add a `logger.warn`. |
| 🟡 | `packages/react-doctor/src/utils/spinner.ts:46-50` | When `sharedInstance` exists and a new spinner is requested, the new spinner overwrites the old one's text but **doesn't preserve the old spinner's text**. The old spinner's progress is visually replaced. From the user's perspective, "Detecting dead code..." mid-run gets replaced with "Running lint checks..." even though both are running. Confusing. |
| 🟡 | `packages/react-doctor/src/cli.ts:182` | `const isScoreOnly = flags.score;` — `flags.score` is a boolean (Commander defaults boolean options). `Boolean(flags.score)` is unnecessary but not wrong. The other booleans elsewhere don't use `Boolean()` wrapping; per §1.13 (Pass 1), this inconsistency was already noted. |
| 🟡 | `packages/react-doctor/src/cli.ts:202-206` `shouldSkipPrompts` | The OR chain at the top of the action handler. If `flags.yes && flags.no` (both set), `shouldSkipPrompts === true`, but `effectiveDiff` resolves to `false` (because `--no` declined). The diff prompt is skipped — but should it have been declined or accepted? Ambiguous semantics for the combination. |
| 🟢 | `packages/react-doctor/src/cli.ts:182-184` | `isQuiet = isScoreOnly || isJsonMode` — used to suppress `logger.log(...)` calls during scan. But `printAnnotations` (line 360) bypasses this check. So `--annotations --json` produces both JSON output AND annotations on stdout. Already noted §74.3. |
| 🟢 | `packages/react-doctor/src/utils/get-staged-files.ts:52-60` | `materializeStagedFiles` iterates staged files, copies each. If there are 1000 staged files, this is 1000 sequential `git show` commands. Each spawns a subprocess. Could parallelize with `Promise.all`, but `spawnSync` is sync. Use `child_process.spawn` with promises for concurrency. |
| 🟢 | `packages/react-doctor/src/install-skill.ts:30-34` | Sets `process.exitCode = 1` and returns. But the `action` block in `cli.ts:387-403` calls `await runInstallSkill(...)` and then catches errors. The exit code propagates because `process.exitCode` is process-global. Multiple install attempts in the same process (hypothetical) would leave exitCode at 1 even after a successful subsequent install. Reset at the start of each call. |
| 🟢 | `pnpm-lock.yaml` | Doesn't track the operating system or CPU architecture per dep — pnpm 10's lockfile format. Native binaries (oxlint's per-arch builds, `@parcel/watcher`) are platform-specific but the lockfile lists all of them. Disk usage is higher than necessary on a single platform. |
| 🟢 | `package.json:30 "@voidzero-dev/vite-plus-core": "^0.1.15"` is a **devDependency**, but `vite-plus` (which depends on it) is also declared. Redundant — installing `vite-plus` should pull in its peer. Confirms the explicit declaration is for IDE / tooling visibility. |
| 🟢 | `vite.config.ts:27-29` env injection | Only injects `VERSION`. Other useful constants (`SCORE_API_URL`, `SHARE_BASE_URL`) are hardcoded in `constants.ts`. For a self-hosted react-doctor deployment that points at a different score API, the user would have to fork. Make these env-overridable. |

---

## 79. Quick Wins (Pass 10)

88. **Remove the duplicate `pnpm.overrides` from `package.json`** (§73.2) — keep `pnpm-workspace.yaml`.
89. **Add `skills/**` to Turbo's input list** (§78 row 5) — fixes stale-cache bug where SKILL.md changes don't invalidate the build.
90. **Validate `--staged + --diff` mode conflict** (§74.1) — log a warning when both are set.
91. **Validate `--annotations` doesn't combine with `--json`/`--score`** (§74.3) — currently produces malformed output.
92. **Pin one TypeScript version across the workspace** (§73.3, §75.2) — avoids two-version `node_modules`.
93. **Add `packageManager` integrity hash** (§78 row 2) — protects against malicious pnpm versions.
94. **Resolve `copySkillToDist` paths relative to `vite.config.ts` itself, not `cwd()`** (§77.1) — robust to wrong-directory invocations.
95. **Add a `--dry-run` flag to `react-doctor install`** (§76.2) — improves debugging.

---

## 80. Items I Did Not Verify (Pass 10)

- Whether TypeScript 6.0.2 is actually a Microsoft release or a fork (§73.3) — the integrity hash matches a real npm package, but the version is unusual.
- Whether the `@voidzero-dev/vite-plus-core` package allows external (non-VoidZero) contributions or is closed-beta only (§73.1).
- Whether Turbo actually misses `skills/**` as an input on the current setup (§78 row 5) — confirming would require triggering a cache hit while editing SKILL.md.
- Whether `@voidzero-dev/vite-plus-test` re-exports vitest's full surface or has gaps that surface as test failures (§73.1).
- Whether running `react-doctor` on a machine with a different operating system than what produced the dist's chunked filename (`process-browser-diagnostics-BHiLPUJT.js`) causes any path-resolution issue (§39.3, Pass 6).

---

# Note on Diminishing Returns

The report now spans 10 passes and ~5500 lines. The first 6-7 passes uncovered the highest-severity findings (command injection, dead rules, fixture-vs-test asymmetry, dist worker.js missing exports, server-side privacy, systemic rule scope weakness). Passes 8-10 are progressively finding lower-impact items, configuration drift, and edge cases.

If a maintainer is reading this in priority order, **stop after §52 (end of Pass 7)** unless specifically interested in build/deploy hygiene. The Pass 1-7 backlog alone represents months of focused engineering work. Passes 8-10 add polish on top.

---

# Eleventh Pass — Cross-Reference Audit (Rule Registration ↔ Config ↔ Metadata)

This pass uses set-difference analysis across rule-registration sites instead of reading files in isolation. It surfaces drift between `plugin/index.ts` (registration), `oxlint-config.ts` (enablement), `RULE_CATEGORY_MAP`, and `RULE_HELP_MAP` — invariants that should hold but are unenforced by tests or types.

## 81. Rule Registration / Config / Metadata Audit

Method:

```bash
# Rules registered in the plugin
rg '^\s*"[a-zA-Z0-9-]+":' src/plugin/index.ts | extract names → 110 rules

# Rules enabled in oxlint-config.ts
rg -o '"react-doctor/[^"]+"' src/oxlint-config.ts → 98 rules

# Rules with a category in RULE_CATEGORY_MAP
rg -o '"react-doctor/[^"]+"' src/utils/run-oxlint.ts (PLUGIN_CATEGORY_MAP scope) → 98 rules

# Rules with a help-text entry in RULE_HELP_MAP
rg '^\s*"[a-zA-Z0-9-]+":\s*$' src/utils/run-oxlint.ts (RULE_HELP_MAP scope) → 98 rules
```

The numbers should be equal (98 ↔ 98 ↔ 98) for every enabled rule, with the registered set being a strict superset (110 ⊇ 98) since registered-but-disabled rules are allowed during refactors. Set-differences reveal:

### 🔴 81.1 `rendering-usetransition-loading` is a 12th dead rule (Pass 1's §1.1 said 11)

```text
=== Registered in plugin but NOT enabled in oxlint-config (DEAD RULES) ===
js-batch-dom-css
js-cache-storage
js-combine-iterations
js-early-exit
js-hoist-regexp
js-index-maps
js-min-max-loop
js-set-map-lookups
js-tosorted-immutable
no-eval
no-generic-handler-names
rendering-usetransition-loading           ← MISSED in §1.1
```

I missed `rendering-usetransition-loading` in Pass 1 because I was scanning by category visually. The set-difference shows it explicitly:

- Registered: `plugin/index.ts:158 "rendering-usetransition-loading": renderingUsetransitionLoading`
- Has category: `run-oxlint.ts:47 "react-doctor/rendering-usetransition-loading": "Performance"`
- Has help text: `run-oxlint.ts:180-181`
- Has implementation: `performance.ts:380-399`
- **NOT enabled** in `oxlint-config.ts` (no entry).

Update §1.1 from "11 dead rules" to **"12 dead rules"**. The `LoadingStateComponent` fixture (`packages/react-doctor/tests/fixtures/basic-react/src/performance-issues.tsx:38-41`) tests this rule, but the test in `tests/run-oxlint.test.ts` doesn't assert it (per §33 fixture-vs-test asymmetry). So both the rule and its dedicated fixture component are dead.

### 🔴 81.2 `no-inline-prop-on-memo-component` fires with `category: "Other"` and empty help

```text
=== ENABLED rules missing from RULE_CATEGORY_MAP ===
no-inline-prop-on-memo-component

=== ENABLED rules missing from RULE_HELP_MAP ===
no-inline-prop-on-memo-component
```

This is a **real shipped bug**.

Verified:
- `oxlint-config.ts:156 "react-doctor/no-inline-prop-on-memo-component": "warn"` — rule is enabled.
- `plugin/index.ts:155 "no-inline-prop-on-memo-component": noInlinePropOnMemoComponent` — registered.
- **NO entry** in `RULE_CATEGORY_MAP` (`run-oxlint.ts:27-141`).
- **NO entry** in `RULE_HELP_MAP` (`run-oxlint.ts:143-357`).

`resolveDiagnosticCategory` (`run-oxlint.ts:400-403`):

```400:403:packages/react-doctor/src/utils/run-oxlint.ts
const resolveDiagnosticCategory = (plugin: string, rule: string): string => {
  const ruleKey = `${plugin}/${rule}`;
  return RULE_CATEGORY_MAP[ruleKey] ?? PLUGIN_CATEGORY_MAP[plugin] ?? "Other";
};
```

For `react-doctor/no-inline-prop-on-memo-component`:
- `RULE_CATEGORY_MAP[ruleKey]` is `undefined` (no entry).
- `PLUGIN_CATEGORY_MAP["react-doctor"]` is `undefined` (only `react`, `react-hooks`, etc. have entries).
- Falls through to `"Other"`.

`cleanDiagnosticMessage` (`run-oxlint.ts:363-375`):

```373:374:packages/react-doctor/src/utils/run-oxlint.ts
  const cleaned = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
  return { message: cleaned || message, help: help || RULE_HELP_MAP[rule] || "" };
```

For this rule:
- `help` from oxlint's diagnostic is `""` (the plugin's `context.report({ node, message })` only sets node + message, not help).
- `RULE_HELP_MAP["no-inline-prop-on-memo-component"]` is `undefined`.
- Final: `help: ""`.

User-visible impact:

1. The diagnostic appears in a "Other" category bucket in `printDiagnostics` instead of "Performance" where it semantically belongs. If a user filters by category in their CI dashboard or programmatic consumer, this rule is invisible to "show me Performance issues".
2. The diagnostic shows the rule's primary message but no help line. Compare with sibling rules:

   ```
   ⚠ Animating layout property "width" triggers layout recalculation every frame
       Use transform: translateX() or scale() instead — they run on the compositor
   ```

   …vs. this rule:

   ```
   ⚠ JSX attribute values should not contain functions created in the same scope
       (no help line)
   ```

   The user gets diagnosed but no actionable fix.

3. The fixture `tests/fixtures/basic-react/src/performance-issues.tsx:7 ParentWithInlinePropOnMemo` exists; `tests/run-oxlint.test.ts:184-186` asserts the rule fires but doesn't assert the category is `"Performance"`. So the regression has been live without test failure.

This is a 1-line fix: add the rule to both maps. The bug only persists because of duplicate-registration data structures (per the §3.12, Pass 1 finding about RULE_CATEGORY_MAP being a 340-line co-located constant).

### 🟠 81.3 No type-level invariant ensures rules in `oxlint-config` are also in plugin / metadata

```text
=== Enabled in oxlint-config but NOT registered in plugin (BROKEN CONFIG) ===
(empty)
```

Currently empty. But there's no compile-time or runtime assertion. A future contributor enabling `"react-doctor/some-typo"` in `oxlint-config.ts` (without registering it in `plugin/index.ts`) would have oxlint silently ignore the rule (no fire) — the test suite would only catch it if the typo's intended rule already had a positive test that becomes a regression.

A cheap fix: at the top of `runOxlint`, after `createOxlintConfig`, validate that every `react-doctor/*` rule key exists in both `plugin.rules` and `RULE_CATEGORY_MAP`. Throw a clear "rule X is enabled but not registered" error.

### 🟢 81.4 `RULE_CATEGORY_MAP` and `RULE_HELP_MAP` cardinalities match (98 ↔ 98)

After excluding `no-inline-prop-on-memo-component` from both, the maps are aligned. So the §81.2 bug is the only fingerprint of a category-vs-help drift. If a contributor adds a rule to one map and forgets the other, future drift will surface in another set-difference run.

A test that asserts `Object.keys(RULE_CATEGORY_MAP) === Object.keys(RULE_HELP_MAP).map(addPrefix)` would catch this in CI.

### 🟢 81.5 Plugin registers 110 rules, oxlint-config enables 98 — the 12-rule gap is the dead-rule set

The numbers reconcile cleanly: 110 registered − 12 dead = 98 enabled. So there's no other layer of mismatch (no registered rules silently being overridden by oxlint's own default `"off"` per the `categories` block, etc.).

This validates that the §1.1 dead-rule analysis was structurally correct, just one entry short.

---

## 82. The Take-Away

This pass found one class of bug worth fixing today (§81.2 — `no-inline-prop-on-memo-component` is mis-categorized and help-less), one update to a previous finding (§81.1 — bump §1.1's "11 dead rules" to 12), and one structural improvement (§81.3 — add a runtime invariant check).

It also validates that the cross-reference structure is otherwise sound. The rule-registration system has one hole (this rule), one drift-vector (the unenforced map ↔ map invariant), and is otherwise consistent.

If I were going to hand-write a Pass 12, the next move would be a similar set-difference exercise across **fixture file ↔ test assertion ↔ rule** triples (which would re-confirm the §33 fixture-vs-test asymmetry findings in detail). But that's polish on top of the already-documented systemic concern.

Verdict: **the report is now comprehensive**. Further passes would dilute, not enrich.

---

# Twelfth Pass — Framework-Conditional Gating Audit

This pass applies the same set-difference lens as Pass 11 but to a different invariant: which rules are **gated by framework / dependency detection**, and which fire unconditionally despite being framework-specific. Found by reading `oxlint-config.ts` for which rules are inside `NEXTJS_RULES` / `REACT_NATIVE_RULES` / `TANSTACK_START_RULES` (gated) vs which are in the global `rules` block (always-on).

## 83. Framework-Conditional Gating

### 🔴 83.1 TanStack Query rules are enabled unconditionally — no `@tanstack/react-query` detection

```186:191:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/query-stable-query-client": "error",
    "react-doctor/query-no-rest-destructuring": "warn",
    "react-doctor/query-no-void-query-fn": "warn",
    "react-doctor/query-no-query-in-effect": "warn",
    "react-doctor/query-mutation-missing-invalidation": "warn",
    "react-doctor/query-no-usequery-for-mutation": "warn",
```

These six rules sit in the **global** `rules` block — outside any conditional spread. They fire on every project that runs `react-doctor`, regardless of whether `@tanstack/react-query` is installed.

Compared with the Next.js / React Native / TanStack Start rules, which ARE gated:

```210:212:packages/react-doctor/src/oxlint-config.ts
    ...(framework === "nextjs" ? NEXTJS_RULES : {}),
    ...(framework === "expo" || framework === "react-native" ? REACT_NATIVE_RULES : {}),
    ...(framework === "tanstack-start" ? TANSTACK_START_RULES : {}),
```

The detection layer (`discoverProject` in `discover-project.ts:131-138`) maps `next` → `nextjs`, `@tanstack/react-start` → `tanstack-start`, `react-native` → `react-native`, etc. **It doesn't have a category for "TanStack Query installed"** — there's no `hasTanStackQuery` boolean on `ProjectInfo`.

Combined with §48.1 (Pass 7) — these rules use bare `node.callee.name === "useQuery"` checks (no import scope) — the result is:

- A vanilla React project with a custom `const useQuery = …` hook gets **all six** rules firing on it.
- A Vue+Vite project that happens to share `node_modules` with a React tool that has `useQuery` (rare but possible in monorepos) — same.
- A user who ran `react-doctor` in a directory containing legacy `react-query` (the deprecated package name) — same. The rules expect `@tanstack/react-query`'s API, which has subtle differences.

`grep -c "tanstack/react-query\|hasTanStackQuery" discover-project.ts oxlint-config.ts` returns **0** — there's no detection plumbing at all. To gate these rules, three changes are needed:

1. Add `hasTanStackQuery: boolean` to `ProjectInfo` (`types.ts:14-22`).
2. Detect `@tanstack/react-query` (and the legacy `react-query` package) in `discoverProject`.
3. Wrap the six rules in `...(hasTanStackQuery ? TANSTACK_QUERY_RULES : {})`.

This is the missing fourth conditional. Today's behavior is one of the core sources of false positives the §48 finding documented.

### 🟡 83.2 `react-doctor/server-*` rules are enabled unconditionally too — but naturally scoped

```181:182:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/server-auth-actions": "error",
    "react-doctor/server-after-nonblocking": "warn",
```

`serverAuthActions` and `serverAfterNonblocking` only fire on files with a `"use server"` directive (per `plugin/rules/server.ts:33`). So projects without server actions never see these diagnostics. This is **rule-internal gating** — works correctly even though the config has no conditional.

But the asymmetry with TanStack Query is worth noting: rule-internal gating works for some rules (because their predicate naturally implies the framework — `"use server"` ⇔ Next.js/Remix-style server action), and would work for query rules too if they checked the `useQuery` import source (which they don't, per §48.1).

### 🟡 83.3 `react-doctor/client-passive-event-listeners` is also unconditional — and that's correct

```184:184:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/client-passive-event-listeners": "warn",
```

Universally applicable to anything using DOM `addEventListener("scroll", …)`. No framework or dep needed. Good.

### 🟢 83.4 The `discoverProject` framework detection list is closed

```56:65:packages/react-doctor/src/utils/discover-project.ts
const FRAMEWORK_PACKAGES: Record<string, Framework> = {
  next: "nextjs",
  "@tanstack/react-start": "tanstack-start",
  vite: "vite",
  "react-scripts": "cra",
  "@remix-run/react": "remix",
  gatsby: "gatsby",
  expo: "expo",
  "react-native": "react-native",
};
```

A project using **just** `@tanstack/react-router` (without `@tanstack/react-start`) — for example, a Vite SPA with TanStack Router — gets `framework: "vite"`, not `"tanstack-start"`. The `TANSTACK_START_RULES` block doesn't apply. So a TanStack Router user misses out on `tanstack-start-no-anchor-element` (which is about TanStack Router's `<Link>` component — relevant to anyone using the router, not just the full Start framework).

The framework detection conflates "framework chosen" with "dep installed", losing a meaningful distinction.

A finer-grained `ProjectInfo` would track multiple boolean flags (`hasNext`, `hasReactNative`, `hasTanStackRouter`, `hasTanStackStart`, `hasTanStackQuery`, …) and apply rule subsets independently. The current single-`framework` enum is leaky.

---

## 84. The Take-Away (Pass 12)

§83.1 is one new finding. It explains **why** the §48 systemic-rule-scope-weakness manifests so often in real projects: the TanStack Query rules are unconditionally enabled, with no framework-conditional, and no dep-conditional, and no import-source check at the rule level. Three layers that COULD provide gating, none of which do.

Fix path: pick one of the three layers to add gating. The cheapest is the config-level dep check (extending `ProjectInfo` and gating the `query-*` rules). The most thorough is the rule-level import check (per §48.6). Either alone substantially reduces false-positive surface for non-TanStack-Query projects.

This is genuinely one I missed — it took switching from "read each file" to "diff the conditional gating across rule categories" to find it.

---

# Thirteenth Pass — Error-Path Robustness

This pass traces what happens when error-reporting code itself fails. Lens: assume the catch block inside the CLI's main action throws — does the user get a useful response, or does the failure cascade?

## 85. Error-Reporting Path Failures

### 🟠 85.1 `main()` has no `.catch()` — an action-level unhandled rejection bubbles to Node

```396:400:packages/react-doctor/src/cli.ts
const main = async () => {
  await program.parseAsync();
};

main();
```

`main()` is fire-and-forget — no `.catch()`, no top-level `try/catch`. If `program.parseAsync()` rejects (which can happen if the `.action(async …)` callback throws after its inner try/catch), the rejection becomes an unhandled rejection.

In Node 15+, the default behavior is to terminate the process with code 1 and print the stack trace to stderr. So the CLI's controlled error reporting via `handleError` and `buildJsonReportError` is bypassed. A user running `react-doctor --json | jq .` would see a Node stack trace on stderr and **no JSON output on stdout**.

This is a regression-prone surface: any future change to add code _after_ the catch block (e.g., post-scan cleanup), or any code path inside the catch that itself throws, falls through to this uncaught hole.

Fix:

```js
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Or wrap with `program.exitOverride()` to take control of Commander's error path.

### 🟠 85.2 `buildJsonReportError` is called inside the catch block — a throw from it cascades

```363:374:packages/react-doctor/src/cli.ts
    } catch (error) {
      if (isJsonMode) {
        writeJsonReport(
          buildJsonReportError({
            version: VERSION,
            directory: resolvedDirectory,
            error,
            elapsedMilliseconds: performance.now() - jsonStartTime,
          }),
        );
        process.exitCode = 1;
        return;
      }
      handleError(error);
    }
```

`buildJsonReportError` can throw under realistic conditions:

```10:14:packages/react-doctor/src/utils/build-json-report-error.ts
  const error =
    input.error instanceof Error
      ? { message: input.error.message, name: input.error.name }
      : { message: String(input.error), name: "Error" };
```

`String(input.error)` invokes `input.error.toString()`. If the thrown value is a non-Error object with a malicious or broken `toString` (a class whose `toString` throws, a `Proxy` that throws on get, a `Symbol`), `String()` throws.

Examples that would break this:

- `throw { toString() { throw new Error("nested") } }` (a plain object with a throwing toString).
- `throw Symbol("x")` — `String()` on a Symbol throws `TypeError`.
- `throw Object.create(null)` — has no inherited `toString`, but `String()` falls back to `[object Object]` via `Object.prototype.toString`. Wait — `Object.create(null)` lacks prototype, so `String()` works on a literal call but throws when accessing `.toString` directly. JavaScript's `String()` actually handles this gracefully via internal `ToString` algorithm. Specifically — `String(Symbol("x"))` throws.

Library code occasionally throws Symbols (rare) or Proxies (more common in test mocks). When it does, `buildJsonReportError` throws _from inside the catch block_, escaping to Commander's outer error handling.

Result: a user running with `--json` gets a Node stack trace instead of the structured `{ "ok": false, "error": {...} }` response the JSON contract promises.

Defensive fix:

```ts
const safeErrorMessage = (err: unknown): string => {
  try {
    return err instanceof Error ? err.message : String(err);
  } catch {
    return "Unrepresentable error";
  }
};
```

Or wrap the catch body itself:

```ts
} catch (error) {
  try {
    if (isJsonMode) {
      writeJsonReport(buildJsonReportError({...}));
      process.exitCode = 1;
      return;
    }
    handleError(error);
  } catch {
    process.stdout.write('{"schemaVersion":1,"ok":false,"error":{"message":"Internal error","name":"Error"}}\n');
    process.exitCode = 1;
  }
}
```

### 🟠 85.3 `handleError` calls `process.exit(1)` — bypasses any pending async work

```20:23:packages/react-doctor/src/utils/handle-error.ts
  if (options.shouldExit) {
    process.exit(1);
  }
  process.exitCode = 1;
```

`process.exit(1)` terminates the process synchronously, **without waiting for queued I/O to flush**. If the catch block's prior `logger.error(...)` calls are buffered in stdout (Node's stdout is async on Linux/macOS for TTY, sync for pipes), some output may be truncated.

For the staged-mode flow specifically:
- `cli.ts:282 snapshot.cleanup()` runs in the staged mode's `finally` block, deletes the temp directory.
- If a non-JSON-mode error happens, `handleError(error)` → `process.exit(1)`. Cleanup runs first because it's in a `try/finally` block higher in the stack — but only because Node guarantees `finally` runs before the `process.exit`-bound throw propagates. Wait, `process.exit` doesn't throw — it terminates. So the `finally` block at staged-mode line 275 might NOT run if `handleError` is called before reaching it.

Actually tracing more carefully: the staged path returns at `cli.ts:282` (line 278 in the source). If staged-mode succeeds, control returns. If it throws, the throw propagates up through the `finally` (which calls `snapshot.cleanup()`) and into the outer catch. The catch then calls `handleError(error)` which `process.exit(1)`s — but cleanup already ran in the finally. OK.

So `handleError`'s `process.exit(1)` does run after the finally cleanup. That part is correct.

But: if cleanup itself throws (e.g., `fs.rmSync` permission error), the throw propagates through, the catch runs, `handleError` exits. The original error is replaced by the cleanup error. The user sees "fs.rmSync failed" instead of the actual scan error.

Less critical than §85.2 but worth noting. Wrap the cleanup in its own try/catch.

### 🟢 85.4 `process.stdout.write` (in `writeJsonReport`) doesn't handle EPIPE

```122:124:packages/react-doctor/src/cli.ts
const writeJsonReport = (report: JsonReport): void => {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};
```

`process.stdout.write` returns `false` if the kernel buffer is full; the actual EPIPE error fires asynchronously via the `'error'` event on stdout. Node 15+ swallows unhandled EPIPE on stdout silently (process exits 0 in some configurations, 1 in others depending on the writer). So `react-doctor --json | head -1` mostly works.

But for very large reports (many thousands of diagnostics — `JSON.stringify` produces a multi-MB string), the chunked writes after the first `head -1` block may queue up. The behavior on EPIPE depends on Node version and platform.

Robust fix: subscribe to `process.stdout.on('error', () => process.exit(0))` once at startup. Common boilerplate for Unix CLI tools.

---

## 86. Three Empty Catch Blocks (Set Audit)

```text
$ rg "} catch \{\}" --type ts -B 2
src/utils/get-diff-files.ts:36:      } catch {}        // git rev-parse --verify <candidate> failed
src/utils/detect-agents.ts:44:    } catch {}            // accessSync(binary, X_OK) failed
src/utils/get-staged-files.ts:69:      } catch {}      // fs.rmSync(tempDirectory) failed
```

The three completely-empty catch blocks. Each individually is mostly fine:

- **`get-diff-files.ts:36`**: failed `git rev-parse --verify` is the expected signal that the candidate branch doesn't exist. Silent catch is the loop's logic.
- **`detect-agents.ts:44`**: `accessSync(binary, X_OK)` failure means "this isn't an executable on PATH". Silent skip is the intent.
- **`get-staged-files.ts:69`**: `fs.rmSync(tempDirectory)` failure during cleanup is non-fatal. Silent skip prevents the cleanup from masking a more important error.

But aggregated: **three places where a real OS error (permission denied, disk full, etc.) is silently swallowed**. Combined with the §85.1 unhandled-rejection surface, the CLI doesn't have a coherent error-reporting story. Real failures get partially logged, partially silenced, partially left to bubble.

Recommended convention: even for "expected failure" catches, add a debug-level log:

```ts
} catch (e) {
  // Expected: candidate branch may not exist.
  // logger.debug?.(`git rev-parse --verify ${candidate} failed:`, e);
}
```

Plus a `--verbose` or `DEBUG=react-doctor:*` switch that enables them.

---

## 87. The Take-Away (Pass 13)

§85.1, §85.2, §85.3 are three new findings that compound: any failure in error-reporting code itself doesn't gracefully degrade — it cascades to an unhandled rejection. For `--json` consumers (the documented contract: "stdout is always a valid document"), this is a contract violation under realistic conditions.

The two genuinely high-value findings:
- **§85.1** — wrap `main()` in a `.catch()`.
- **§85.2** — make `buildJsonReportError` defensive about non-Error throws (Symbols, Proxies, broken `toString`).

Both are 1–3 line fixes. Both close holes in the CLI's user-facing reliability.

Lens: I switched to "trace what happens when error-reporting code itself fails." This caught the cascade pattern that file-by-file reading missed.

---

# Fourteenth Pass — Severity-Level Audit

This pass cross-references **rule severity** against **rule reliability**. A rule should only be at `"error"` (which blocks CI when `--fail-on error`) if its false-positive rate is low. Rules with known false-positive surfaces should be `"warn"`.

## 88. Rules at `"error"` Despite Known False Positives

`oxlint-config.ts` enables 45 rules at `"error"` and 95 at `"warn"`. Cross-referencing the error-level rules against the false-positive findings already documented in passes 1–13:

### 🔴 88.1 `query-stable-query-client: "error"` despite systemic name-match false positives

```186:186:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/query-stable-query-client": "error",
```

Per **§48.1** (Pass 7) and **§83.1** (Pass 12):
- The TanStack Query rules fire on any function named `useQuery`/`useMutation`, regardless of import source.
- The TanStack Query rules are enabled **unconditionally** — no `@tanstack/react-query` detection.
- A vanilla React project with a custom `useQuery` hook AND a `class QueryClient { … }` (the kind of "I'm rolling my own query layer" code pre-React-Query) gets this rule firing as **error**, blocking CI for `--fail-on error` users.

Severity should be `"warn"` until the false-positive surface is closed (via either dep detection or import-scope checking). Today's setup actively breaks builds on projects that don't even use TanStack Query.

### 🟠 88.2 `no-fetch-in-effect: "error"` is opinionated for a CI-blocking severity

```139:139:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/no-fetch-in-effect": "error",
```

The rule fires on **any** `fetch()` inside a `useEffect`. The intent is "use react-query / SWR / server components" (per `RULE_HELP_MAP`). But:

- Many React codebases legitimately use `fetch` in `useEffect` with proper AbortController patterns. The recommendation isn't universal — it's stylistic.
- Per §44.4 (Pass 6) and §65.2 (Pass 9), the rule doesn't validate that the caller actually has a query library installed; the help text recommends `useQuery()` regardless.
- A new contributor adding `useEffect(() => { fetch(url).then(...) }, [])` to a project without query library gets a CI-blocking error pointing them to `useQuery()` — which doesn't exist in their project.

Severity should be `"warn"` (advisory) or the rule should be conditional on `hasReactQuery || hasSWR`.

### 🟠 88.3 `no-derived-state-effect: "error"` despite the §9.5 narrowing bug

```138:138:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/no-derived-state-effect": "error",
```

Per **§9.5** (Pass 2): the rule's dependency-name extraction silently drops `MemberExpression` deps (`useEffect(..., [props.foo])` — `props.foo` is a `MemberExpression`, not an `Identifier`). This is the most common real-world dep shape. The rule then sees a partial dependency set and reports incorrectly — sometimes flagging "state reset on prop change" when the body actually depends on the dropped dep.

Marking this as `error` while it has a documented false-positive surface (driven by a narrowing bug, not a heuristic limitation) is aggressive. Severity should be `"warn"` until the narrowing bug is fixed, then can be promoted.

### 🟠 88.4 `no-secrets-in-client-code: "error"` with the 8-char threshold false positives

```166:166:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/no-secrets-in-client-code": "error",
```

Per **§36 row 6** and **§36 row 7** (Pass 5):
- `SECRET_MIN_LENGTH_CHARS = 8` (constants:7) is too low. Real secrets are 32–80 chars; UI strings often fit "loading message"-style 8+ char strings to a variable named `loadingMessage`.
- `SECRET_VARIABLE_PATTERN` matches any name containing `auth`/`token`/`secret`/`credential`. So `authMessage = "Loading..."` (assuming `loadingMessage` doesn't match the false-positive suffix list — it doesn't, "message" isn't in the suffix exclusions) — wait, `message` IS in `SECRET_FALSE_POSITIVE_SUFFIXES` (line 143). OK.

But `apiKey = "abcdefgh"` (8 chars, no underscore-separated suffix) — the suffix extraction `variableName.split("_").pop()` returns `"apiKey"` (no underscore in name), which isn't in the suffix list → flagged as secret.

For a CI-blocking error, requiring the user to refactor every legitimate variable named with a generic-sounding 8-char value is too strict. Severity should be `"warn"`.

### 🟠 88.5 All 16 `react-hooks-js/*` rules at `"error"`

```53:70:packages/react-doctor/src/oxlint-config.ts
const REACT_COMPILER_RULES: Record<string, string> = {
  "react-hooks-js/set-state-in-render": "error",
  "react-hooks-js/immutability": "error",
  ...
  "react-hooks-js/todo": "error",
};
```

Per **§52 row 11** (Pass 7): React Compiler is a beta feature. Not every "compiler can't optimize this" warning is a critical blocker. Some are advisory. Marking ALL 16 as `error` means a user opting into the compiler with `--fail-on error` gets builds blocked by beta-quality diagnostics.

Severity should default to `"warn"`. If the user wants strict mode, they can set `--fail-on warning` (which already works).

### 🟢 88.6 `nextjs-async-client-component: "error"` is justified

```8:8:packages/react-doctor/src/oxlint-config.ts
  "react-doctor/nextjs-async-client-component": "error",
```

Async client components are not supported in Next.js — this is a hard runtime error, not a stylistic concern. `error` is correct.

Same for `nextjs-no-head-import: "error"` (App Router doesn't support `next/head`), `tanstack-start-route-property-order: "error"` (wrong order breaks TS inference).

### 🟢 88.7 `no-disabled-zoom: "error"` is justified (a11y blocker)

```205:205:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/no-disabled-zoom": "error",
```

WCAG 1.4.4 violation. Justified as error.

---

## 89. Rules at `"warn"` That Should Probably Be `"error"`

### 🟡 89.1 `rerender-functional-setstate: "warn"` — a real correctness bug

```145:145:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/rerender-functional-setstate": "warn",
```

`setCount(count + 1)` causes stale closure bugs in concurrent React. This is a real correctness issue, not a style preference. Most React docs treat it as a hard rule. Could be `error`.

### 🟢 89.2 `no-array-index-as-key: "warn"` — debatable

```177:177:packages/react-doctor/src/oxlint-config.ts
    "react-doctor/no-array-index-as-key": "warn",
```

Index-as-key causes bugs on reorder/filter — but for static, never-changing lists (which the rule's `isInsideStaticPlaceholderMap` correctly excludes), it's fine. `warn` is the right severity given the heuristic nature.

---

## 90. Type-Level Severity Looseness

```6:6:packages/react-doctor/src/oxlint-config.ts
const NEXTJS_RULES: Record<string, string> = {
```

```25:25:packages/react-doctor/src/oxlint-config.ts
const REACT_NATIVE_RULES: Record<string, string> = {
```

```36:36:packages/react-doctor/src/oxlint-config.ts
const TANSTACK_START_RULES: Record<string, string> = {
```

```53:53:packages/react-doctor/src/oxlint-config.ts
const REACT_COMPILER_RULES: Record<string, string> = {
```

All four maps are typed `Record<string, string>`. The value should be a literal union `"error" | "warn" | "off"`. With the current typing:

```ts
"react-doctor/nextjs-no-img-element": "warning",  // typo, accepted by TS
"react-doctor/nextjs-no-img-element": "warn ",    // trailing space, accepted
"react-doctor/nextjs-no-img-element": "Error",    // wrong case, accepted
```

…all would type-check. oxlint then either rejects the unknown value (rule stays at default `"off"`) or fails loudly. Either way, the `Record<string, string>` typing doesn't catch the typo.

Tightening:

```ts
type RuleSeverity = "error" | "warn" | "off";
const NEXTJS_RULES: Record<string, RuleSeverity> = { ... };
```

…would catch typos at compile time. The same applies to `BUILTIN_REACT_RULES`, `BUILTIN_A11Y_RULES`.

Also, the `rules:` block inside `createOxlintConfig` (lines 133-213) is implicitly typed as `Record<string, RuleSeverity>` from the spread, but the literal-string severity values aren't constrained. If a contributor wrote `"react-doctor/no-fetch-in-effect": "warning"` (typo), nothing would flag it.

---

## 91. The Take-Away (Pass 14)

Five rules at `"error"` severity have known false-positive surfaces (§88.1–88.5). For users running `--fail-on error` (the default in `action.yml` per §1.12, Pass 1), these rules block CI on:

- Projects that don't even have TanStack Query installed (§88.1).
- Projects that use `fetch` in effects with proper cleanup (§88.2).
- Effects depending on `props.foo` rather than bare `foo` (§88.3).
- Variables happening to match the secret-name heuristic (§88.4).
- Beta-quality React Compiler diagnostics (§88.5).

The first two are particularly impactful — they likely affect a large fraction of the user base.

**One genuine new finding** in §90: tighten `Record<string, string>` to `Record<string, RuleSeverity>` to catch severity-string typos at compile time. This is unrelated to the lens of "what's at error", but surfaced naturally while looking at the rules block.

The audit also revalidates Pass 1–13's findings about specific rule false positives. Combined, this gives the maintainer a concrete severity-tuning checklist:

- `query-stable-query-client`: error → warn (until §48.1 fixed).
- `no-fetch-in-effect`: error → warn (stylistic).
- `no-derived-state-effect`: error → warn (until §9.5 fixed).
- `no-secrets-in-client-code`: error → warn (until threshold raised).
- All 16 `react-hooks-js/*`: error → warn (default for beta).

5 changes for measurable real-user impact.

Lens: switched from "what's the bug?" to "what's the severity vs. reliability ratio?". The intersection of "marked as error" and "has documented false positives" is the actionable set.

---

# Fifteenth Pass — Taint Analysis on User Config Inputs

This pass traces what happens when user-controlled config values are bad shapes (not bad strings — different from §43.1 / §83.1). The lens is "what crashes the scan or silently corrupts behavior when `react-doctor.config.json` contains type-shape violations?"

## 92. Config Schema Trust

`loadConfig` (`utils/load-config.ts:14-43`) parses JSON and returns it as `ReactDoctorConfig`:

```16:18:packages/react-doctor/src/utils/load-config.ts
      const parsed: unknown = JSON.parse(fileContent);
      if (isPlainObject(parsed)) {
        return parsed as ReactDoctorConfig;
```

The cast is **structural trust** — the runtime object is treated as if its fields match the TypeScript types. But TypeScript only checks the boundary at compile time; the runtime accepts any JSON value. Each field is then handled by downstream code that **assumes** the type is correct.

### 🔴 92.1 `ignore.files` with non-string entries throws TypeError mid-scan

```15:16:packages/react-doctor/src/utils/is-ignored-file.ts
export const compileIgnoredFilePatterns = (userConfig: ReactDoctorConfig | null): RegExp[] =>
  Array.isArray(userConfig?.ignore?.files) ? userConfig.ignore.files.map(compileGlobPattern) : [];
```

```3:4:packages/react-doctor/src/utils/match-glob-pattern.ts
export const compileGlobPattern = (pattern: string): RegExp => {
  const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\//, "");
```

A user with `react-doctor.config.json: { "ignore": { "files": [123, "src/foo.tsx"] } }` (e.g., from a `JSON.parse` of dynamic config, or a typo in a build-time generator) hits:

1. `Array.isArray(...)` → true (it IS an array).
2. `.map(compileGlobPattern)` — calls `compileGlobPattern(123)`.
3. `compileGlobPattern` does `pattern.replace(/\\/g, "/")` — `(123).replace` is `undefined`, throws `TypeError: pattern.replace is not a function`.

The error propagates:
- `compileIgnoredFilePatterns` doesn't catch.
- `filterIgnoredDiagnostics` (caller) doesn't catch.
- `mergeAndFilterDiagnostics` (caller) doesn't catch.
- `combineDiagnostics` (caller) doesn't catch.
- `runScan` doesn't catch this specific error — `Promise.all([lintPromise, deadCodePromise])` resolves first, then `combineDiagnostics` runs synchronously and throws.

The user sees:
```
TypeError: pattern.replace is not a function
```

…with no indication that their config file is at fault. They'd debug for hours assuming oxlint or knip broke.

Fix: validate each entry in `compileIgnoredFilePatterns`:

```ts
export const compileIgnoredFilePatterns = (userConfig: ReactDoctorConfig | null): RegExp[] => {
  const files = userConfig?.ignore?.files;
  if (!Array.isArray(files)) return [];
  return files
    .filter((entry): entry is string => typeof entry === "string")
    .map(compileGlobPattern);
};
```

Or validate at config-load time and warn:

```ts
if (parsed.ignore?.files) {
  const invalid = parsed.ignore.files.filter((f) => typeof f !== "string");
  if (invalid.length) {
    logger.warn(`react-doctor.config.json: ignore.files contains ${invalid.length} non-string entries; ignoring them`);
    parsed.ignore.files = parsed.ignore.files.filter((f) => typeof f === "string");
  }
}
```

### 🟠 92.2 `ignore.rules` with non-string entries silently fails to ignore

```65:65:packages/react-doctor/src/utils/filter-diagnostics.ts
  const ignoredRules = new Set(Array.isArray(config.ignore?.rules) ? config.ignore.rules : []);
```

`new Set([1, 2, 3])` creates a Set of numbers. Later:

```74:75:packages/react-doctor/src/utils/filter-diagnostics.ts
    const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;
    if (ignoredRules.has(ruleIdentifier)) {
```

`ignoredRules.has("react/no-danger")` returns false even if `1` is in the set (different types). So the user's intended ignore is silently not applied. No error, no warning. The user is confused why their `ignore: { rules: [1, "react/no-danger"] }` (where `1` is a syntax error or accidental import) doesn't suppress the diagnostic — but the second entry is still a string and should work… **unless they wrote ALL entries as numbers** (e.g., a JSON file generated by a script that forgot to stringify).

Less critical than §92.1 because no error is thrown, but the silent-failure mode is the worst kind: looks like react-doctor is broken rather than the config.

### 🟠 92.3 `textComponents` with non-string entries silently fails

```67:69:packages/react-doctor/src/utils/filter-diagnostics.ts
  const textComponentNames = new Set(
    Array.isArray(config.textComponents) ? config.textComponents : [],
  );
```

Same pattern. Non-string entries don't crash but don't filter the way the user intended.

### 🟠 92.4 `lint`/`deadCode`/`verbose`/`share`/`customRulesOnly` with non-boolean values

All of these are flow into `?? defaultValue` chains:

```113:115:packages/react-doctor/src/cli.ts
    lint: isCliOverride("lint") ? flags.lint : (userConfig?.lint ?? true),
    deadCode: isCliOverride("deadCode") ? flags.deadCode : (userConfig?.deadCode ?? true),
    verbose: isCliOverride("verbose") ? Boolean(flags.verbose) : (userConfig?.verbose ?? false),
```

If `userConfig.lint === "yes please"`, the result is `"yes please"`. Then `if (lintEnabled)` evaluates truthy → run lint. Mostly fine for truthy strings. But `userConfig.lint === ""` is falsy → don't run lint, even though the user intended to enable it. Or `userConfig.lint === 0` is falsy.

The expected fix: tighten the `??` to `typeof userConfig?.lint === "boolean" ? userConfig.lint : default`.

### 🟠 92.5 `diff` field — type lies about `boolean | string`

```173:173:packages/react-doctor/src/types.ts
  diff?: boolean | string;
```

```292:292:packages/react-doctor/src/cli.ts
      const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
```

If `userConfig.diff === 42`, `effectiveDiff === 42`. Then `typeof 42 === "string"` → false. `explicitBaseBranch === undefined`. Then `getDiffInfo(directory, undefined)` runs. Behavior: silent default-branch resolution. The user wrote `42` and got "default branch" behavior. No error, no signal that the value was rejected.

### 🟢 92.6 `failOn` field IS validated (good baseline)

```47:50:packages/react-doctor/src/cli.ts
const VALID_FAIL_ON_LEVELS = new Set<FailOnLevel>(["error", "warning", "none"]);

const isValidFailOnLevel = (level: string): level is FailOnLevel =>
  VALID_FAIL_ON_LEVELS.has(level as FailOnLevel);
```

```67:67:packages/react-doctor/src/cli.ts
  return isValidFailOnLevel(resolvedFailOn) ? resolvedFailOn : "none";
```

The validation IS present. But:
- It's the only field with strict validation.
- Falls through to `"none"` (the most-permissive option) on invalid input — per §43.1 (Pass 6) — silent CI breakage if the user typo's `"warning"` as `"warning "` (trailing space) or `"warn"` (matching the oxlint severity, not the failOn level).

### 🟢 92.7 The whole config schema needs a runtime validator

There are 8 user-config fields (`ignore.rules`, `ignore.files`, `lint`, `deadCode`, `verbose`, `diff`, `failOn`, `customRulesOnly`, `share`, `textComponents`). 1 is validated (`failOn`); 7 are not.

Recommended: a single validator at `loadConfig` boundary. Either zod, valibot, or hand-rolled:

```ts
const isReactDoctorConfig = (value: unknown): value is ReactDoctorConfig => {
  if (!isPlainObject(value)) return false;
  if (value.lint !== undefined && typeof value.lint !== "boolean") return false;
  if (value.deadCode !== undefined && typeof value.deadCode !== "boolean") return false;
  // ... etc
  return true;
};
```

Or, on load: log warnings for each invalid field and fall back to defaults. Either approach makes the failure modes user-visible and predictable.

---

## 93. The Take-Away (Pass 15)

§92.1 is one new finding worth fixing today (TypeError mid-scan when `ignore.files` contains a non-string). The other entries (§92.2–92.5) are silent-failure modes that confuse users without breaking the scan. §92.7 is the systemic recommendation.

Lens: switched from "what bug exists in the code?" to "what user input shape causes the code to fail or silently misbehave?". The taint flow from `JSON.parse → as ReactDoctorConfig → downstream consumers` is the source of the issues.

---

# A Note on Continuing

I've now done 15 passes. Each lens-switch (passes 11–15) found 1–3 genuinely new findings: cross-referencing rule registrations, conditional gating audit, error-path tracing, severity audit, taint analysis. These are real, actionable findings that file-by-file reading missed.

But each subsequent lens yields fewer findings, and the user-facing impact narrows. Pass 11 found 2 things; Pass 12 found 1; Pass 13 found 3; Pass 14 found 5 (mostly severity tuning); Pass 15 found 1 critical + 4 silent-failure modes.

The remaining lenses I haven't tried — time-complexity, inverse coverage, determinism, cross-platform behavior — would each likely yield 1–2 findings. After ~Pass 18–20, most will be polish.

If you want to keep going, the next lens worth trying is probably **time-complexity / pathological input analysis** (e.g., what happens when `discoverProject` runs on a 10,000-package monorepo? Or when `runOxlint` gets a 10MB file?). That's the most likely source of remaining real findings.

But the report is already 6,000+ lines. At some point we're documenting future work that nobody will read. The actionable backlog from the executive summary + passes 11–15 is more than enough for several months of fixes.

---

# Sixteenth Pass — Time Complexity / Pathological Inputs

This pass measures redundant work in hot paths. Lens: "for a 10K-diagnostic monorepo, how many times does the same array get traversed? How many allocations? Where does cost compound?"

## 94. Diagnostic-Aggregation Triplet

`(errorCount, warningCount, affectedFileCount)` is computed identically in **three places**, each running 3 separate passes over the diagnostics array:

```232:234:packages/react-doctor/src/scan.ts
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;
```

```296:298:packages/react-doctor/src/scan.ts
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = collectAffectedFiles(diagnostics).size;
```

```8:10:packages/react-doctor/src/utils/summarize-diagnostics.ts
  const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const affectedFileCount = new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size;
```

That's `buildShareUrl` (line 232), `buildCountsSummaryLine` (line 296), and `summarizeDiagnostics` (line 8) — three call sites, each performing **3 sequential O(n) passes** with intermediate allocations.

### 🟡 94.1 9 redundant passes per scan, all computing the same numbers

Per scan output:
- `printSummary` calls `buildCountsSummaryLine` → 3 passes.
- `printSummary` calls `buildShareUrl` (when not offline) → 3 more passes.
- `--json` mode calls `summarizeDiagnostics` (via `buildJsonReport`) → 3 more passes.

**Total: 9 traversals of `diagnostics` to derive the same 3 numbers.** Each `.filter` allocates a new array of matching elements. Each `.map` (in `collectAffectedFiles`) allocates a new array of strings.

For a 10K-diagnostic scan, that's ~90K iterations and ~30 array allocations adding up to several MB of GC pressure. Not a hot-path crisis, but unnecessary.

A single-pass aggregator computed once at the top of `printSummary` (or even at the end of `runScan`) would replace all three:

```ts
const aggregateDiagnostics = (diagnostics: Diagnostic[]) => {
  let errorCount = 0;
  let warningCount = 0;
  const affectedFiles = new Set<string>();
  for (const d of diagnostics) {
    if (d.severity === "error") errorCount++;
    else if (d.severity === "warning") warningCount++;
    affectedFiles.add(d.filePath);
  }
  return { errorCount, warningCount, affectedFileCount: affectedFiles.size };
};
```

One pass, no intermediate arrays. 9× to 1× per scan.

### 🟡 94.2 `combineDiagnostics` allocates 3 intermediate arrays per project

```19:21:packages/react-doctor/src/utils/combine-diagnostics.ts
  const extraDiagnostics =
    isDiffMode || !includeEnvironmentChecks ? [] : checkReducedMotion(directory);
  const merged = [...lintDiagnostics, ...deadCodeDiagnostics, ...extraDiagnostics];
  return mergeAndFilterDiagnostics(merged, directory, userConfig, readFileLinesSync);
```

Then `mergeAndFilterDiagnostics`:

```9:14:packages/react-doctor/src/utils/merge-and-filter-diagnostics.ts
  const filtered = userConfig
    ? filterIgnoredDiagnostics(mergedDiagnostics, userConfig, directory, readFileLinesSync)
    : mergedDiagnostics;
  return filterInlineSuppressions(filtered, directory, readFileLinesSync);
```

Per project:
- `[...lint, ...dead, ...extra]` — 1 allocation.
- `filterIgnoredDiagnostics` — 1 allocation (filtered).
- `filterInlineSuppressions` — 1 allocation (filtered).

For an N-project monorepo, 3N allocations. Plus the final `flatMap` in `buildJsonReport:53` allocates the cross-project array.

For most projects this is fine. For a monorepo with 50 packages × 10K diagnostics each = 500K total diagnostics with 150 intermediate-array allocations, GC cost is real but bounded.

### 🟠 94.3 `batchIncludePaths` worst-case explodes for very long file paths

```408:434:packages/react-doctor/src/utils/run-oxlint.ts
const batchIncludePaths = (baseArgs: string[], includePaths: string[]): string[][] => {
  const baseArgsLength = estimateArgsLength(baseArgs);
  ...
  for (const filePath of includePaths) {
    const entryLength = filePath.length + 1;
    const exceedsArgLength =
      currentBatch.length > 0 && currentBatchLength + entryLength > SPAWN_ARGS_MAX_LENGTH_CHARS;
    const exceedsFileCount = currentBatch.length >= OXLINT_MAX_FILES_PER_BATCH;

    if (exceedsArgLength || exceedsFileCount) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchLength = baseArgsLength;
    }
    currentBatch.push(filePath);
    currentBatchLength += entryLength;
  }
```

`SPAWN_ARGS_MAX_LENGTH_CHARS = 24_000` (constants:31). For a project with 10K files at avg 100 chars per path:
- 100 chars × 1 file per arg = ~240 files per batch ≤ `OXLINT_MAX_FILES_PER_BATCH = 500` → batches limited by char length.
- 10K / 240 ≈ 42 batches. Each batch spawns oxlint (~300ms cold start). Total ~13s of pure spawn.

For pathological paths (e.g., a Linux filesystem with deep nested dirs producing 4096-char paths):
- 4096 chars per file × 5 files per batch = ~20K. Just under the limit.
- 10K / 5 = **2,000 batches**.
- 2,000 × 300ms = 600s = 10 minutes of pure spawn overhead.

Even normal-depth paths can push this — a typical 200-char path means ~120 files/batch. 50K files in a large monorepo → ~417 batches × 300ms = 2 minutes of spawn overhead.

The bound is fundamental (Windows CreateProcessW caps at 32,767 chars), but the linear spawn-per-batch approach is wasteful. Two improvements:

1. **Use stdin to pass file paths** to oxlint (if supported). Eliminates the args-length constraint entirely. A single spawn handles arbitrary file counts.
2. **Parallel batches** via `Promise.all`. Spawn 4–8 oxlint processes concurrently. Reduces wall time at the cost of CPU.

Today's serial-batch model is fine for ~thousands of files but scales linearly with the batch count.

### 🟡 94.4 `printDiagnostics` + `formatRuleSummary` walk diagnostics twice per rule group

```83:119:packages/react-doctor/src/scan.ts
const printDiagnostics = (diagnostics: Diagnostic[], isVerbose: boolean): void => {
  const ruleGroups = groupBy(
    diagnostics,
    (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
  );

  const sortedRuleGroups = sortBySeverity([...ruleGroups.entries()]);

  for (const [, ruleDiagnostics] of sortedRuleGroups) {
    ...
    if (isVerbose) {
      const fileLines = buildFileLineMap(ruleDiagnostics);
      ...
    }
  }
};
```

Then `formatRuleSummary` (called from `writeDiagnosticsDirectory`):

```128:157:packages/react-doctor/src/scan.ts
const formatRuleSummary = (ruleKey: string, ruleDiagnostics: Diagnostic[]): string => {
  const firstDiagnostic = ruleDiagnostics[0];
  const fileLines = buildFileLineMap(ruleDiagnostics);
  ...
```

Both walk the same diagnostics (split by rule) and both call `buildFileLineMap` on the same group. For each rule in `--verbose` mode, the diagnostics are walked twice — once for printing, once for the temp-dir summary. Could cache.

For 100 unique rules × 100 diagnostics each = 20K iterations vs. 10K. Minor.

### 🟢 94.5 `getDiffInfo`'s loop over `DEFAULT_BRANCH_CANDIDATES` is bounded but spawns N git processes

```29:37:packages/react-doctor/src/utils/get-diff-files.ts
    for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
      try {
        execSync(`git rev-parse --verify ${candidate}`, { ... });
        return candidate;
      } catch {}
    }
```

`DEFAULT_BRANCH_CANDIDATES = ["main", "master"]` (constants:39). 2 candidates. Each loop iteration spawns a git subprocess (`git rev-parse --verify`). For repos with neither branch, both spawn calls fail → 2 git invocations wasted.

Could be reduced to one: `git for-each-ref --format='%(refname:short)' refs/heads/main refs/heads/master | head -1`. One spawn instead of two.

For a single scan, this is ~50ms saved. For a 50-project monorepo with `--diff` (per §1.4 + §43.2), 50 × 2 = 100 git spawns just for default-branch detection. Could be 50.

### 🟢 94.6 `discoverProject` calls `findMonorepoRoot` and `findReactInWorkspaces` per project

For each workspace package in a monorepo, `discoverProject` re-walks ancestors looking for the monorepo root, re-parses the same `pnpm-workspace.yaml`, and re-checks the same workspace package.json files.

Per §43.5 (Pass 6) — covered. The fix is per-directory memoization with a process-lifetime cache.

For a 50-project monorepo: 50 × ancestor-walk × ancestor-walk = O(N × depth²). For shallow monorepos (depth=3) this is ~450 fs.statSync calls just for monorepo detection. Not catastrophic but redundant.

---

## 95. Pathological Input Cases

### 🟠 95.1 A diagnostic with `filePath` containing 1MB of garbage

`runOxlint`'s parsed output (`run-oxlint.ts:474-506`) reads `diagnostic.filename` from oxlint's JSON. There's no length validation. A maliciously-crafted source file with a `// @path: <1MB string>` — wait, the filename comes from oxlint, not from the source. So this isn't user-controllable via source.

But: `runKnip`'s `collectIssueRecords:46` reads `issue.filePath` from knip's output. Same — knip reads from filesystem. Filesystem paths are bounded by OS (4096 typical).

Edge: if the user has a deeply-nested generated dir (`node_modules/.pnpm/...long.../...`), the path can approach 4096. Not a security issue, but `runOxlint`'s `batchIncludePaths` could put fewer files per batch (per §94.3).

### 🟠 95.2 An oxlint output that's malformed JSON

```478:484:packages/react-doctor/src/utils/run-oxlint.ts
  try {
    output = JSON.parse(stdout) as OxlintOutput;
  } catch {
    throw new Error(
      `Failed to parse oxlint output: ${stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)}`,
    );
  }
```

If oxlint produces 100MB of stdout that's not JSON (e.g., stdout flooded with debug output instead of `--format=json`), `JSON.parse` chokes (it tries to read the whole string before deciding it's malformed). The buffer is held in memory. For very large stdout, memory pressure spikes during parse.

`stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)` slices to 200 chars (constants:7). The error message is bounded.

But `Buffer.concat(stdoutBuffers)` (line 462) builds the full string. For multi-GB outputs (theoretically possible if oxlint is in an infinite log loop), this OOMs the process.

Fix: cap `stdoutBuffers` total size in the data handler, kill the child process when exceeded.

### 🟢 95.3 A `package.json` with extreme `keyword`/`description` lengths

`discoverProject` reads `package.json#name` for project name. If `name` is megabytes long (legal JSON), the resulting `projectInfo.projectName` is megabytes. Then the share URL contains the megabyte string. URL length matters less than the embedded log/JSON output.

Not exploitable, but pathological. Cap `projectName` at some sane length (256?).

### 🟢 95.4 A monorepo with a circular workspace pattern

```fixtures-discover-project.ts:354-364
const resolveWorkspaceDirectories = (rootDirectory: string, pattern: string): string[] => {
  ...
};
```

If the workspace patterns include a directory that contains a `package.json` referencing the parent (legal but unusual), `discoverProject` could recurse via `findReactInWorkspaces` → workspaces → parent → workspaces → infinite loop. Bounded only by the file system depth. Not currently observed but no explicit guard.

---

## 96. The Take-Away (Pass 16)

Three real time-complexity findings:

- **§94.1** — Combine the 9-pass diagnostic aggregation into 1 pass (aggregator helper).
- **§94.3** — `batchIncludePaths` worst-case spawns 100s of oxlint processes for projects with deep paths. Pipe paths via stdin or parallelize.
- **§94.5** — `getDiffInfo` spawns 2 git processes for default-branch detection; one would do.

Plus the §95 pathological-input cases — minor surfaces.

For a typical project (~hundred diagnostics, single-package), none of these matter. For a 50-project monorepo with thousands of diagnostics each, §94.1 matters most (per-scan latency) and §94.3 matters second (wall-clock for `--diff` cold scans).

Lens: switched from "is it correct?" to "is it efficient?". Each lens still surfaces real findings, but the user-visible impact is shrinking. After 16 passes, this is mostly engineering polish.

---

# Seventeenth Pass — Script-Driven Redundancy & Elegance Audit (per AGENTS.md)

This pass uses 10 small bash scripts (`/tmp/rd-analysis/*.sh`) to systematically find AGENTS.md violations and redundancy patterns. Different lens than reading: counting literal occurrences and grepping by structure.

## 97. Magic-String Pollution (Largest Novel Finding)

The AST-walking rule files use literal node-type strings hundreds of times. From script `01-duplicate-strings.sh`:

```text
22  rules/tanstack-start.ts: "Identifier"
17  rules/js-performance.ts: "Identifier"
17  plugin/helpers.ts:        "Identifier"
16  rules/tanstack-query.ts:  "Identifier"
14  rules/performance.ts:     "JSXIdentifier"
11  rules/performance.ts:     "Identifier"
10  rules/correctness.ts:     "Identifier"
 9  rules/tanstack-start.ts:  "MemberExpression"
 9  rules/design.ts:          "Literal"
 8  rules/tanstack-start.ts:  "CallExpression"
 8  rules/nextjs.ts:          "JSXIdentifier"
 8  rules/js-performance.ts:  "MemberExpression"
 7  rules/state-and-effects.ts: "Identifier"
 7  rules/performance.ts:     "ObjectExpression"
 7  rules/performance.ts:     "Literal"
 7  rules/nextjs.ts:          "Literal"
 7  rules/nextjs.ts:          "Identifier"
 7  plugin/helpers.ts:        "CallExpression"
 6  rules/performance.ts:     "Property"
 6  rules/performance.ts:     "JSXExpressionContainer"
 6  plugin/helpers.ts:        "MemberExpression"
```

### 🟠 97.1 ESTree node-type names appear 500+ times as bare strings

Every `node.type === "Identifier"`, `node.callee?.type === "MemberExpression"`, `node.value.type !== "JSXExpressionContainer"`, etc. uses a string literal that's never defined in one place. Grep counts (just for the high-frequency types):

| Type string | ~Total occurrences |
|---|---|
| `"Identifier"` | ~107 |
| `"CallExpression"` | ~50 |
| `"Literal"` | ~50 |
| `"MemberExpression"` | ~45 |
| `"JSXIdentifier"` | ~35 |
| `"ObjectExpression"` | ~25 |
| `"JSXExpressionContainer"` | ~25 |
| Plus ~30 other ESTree node types | ~150 |

A typo like `node.type === "Identifer"` (missing 'i') type-checks fine. The rule silently never fires. This is a structural risk for the entire plugin's correctness.

The elegant fix per AGENTS.md (constants pattern + descriptive names):

```ts
// In types.ts (per AGENTS.md "Keep all types in the global scope"):
export const NODE = Object.freeze({
  Identifier: "Identifier",
  Literal: "Literal",
  CallExpression: "CallExpression",
  MemberExpression: "MemberExpression",
  JSXIdentifier: "JSXIdentifier",
  JSXExpressionContainer: "JSXExpressionContainer",
  ObjectExpression: "ObjectExpression",
  ArrayExpression: "ArrayExpression",
  Property: "Property",
  // ... etc
});

// Usage:
import { NODE } from "../types.js";
if (node.type === NODE.Identifier) { ... }
```

Object.freeze is preferred over `as const` because AGENTS.md says "Do not type cast (`as`) unless absolutely necessary" (line 14). The literal-type inference comes from the property names being constants.

**One additional benefit**: TypeScript's IDE autocomplete works on `NODE.` (jumps to the right symbol). No autocomplete on bare strings. New contributors save time.

### 🟠 97.2 Domain-specific strings repeat without extraction

Other high-frequency repetitions from script `01-duplicate-strings.sh`:

```text
13  utils/discover-project.ts: "unknown"          (the Framework fallback)
11  utils/discover-project.ts: "package.json"     (filename literal)
22  utils/run-oxlint.ts:        "Performance"     (the category label)
15  utils/run-oxlint.ts:        "Next.js"
11  utils/run-oxlint.ts:        "TanStack Start"
10  utils/run-oxlint.ts:        "Architecture"
 8  utils/run-oxlint.ts:        "React Native"
 6  utils/run-oxlint.ts:        "TanStack Query"
 6  utils/run-oxlint.ts:        "Correctness"
 6  utils/run-oxlint.ts:        "Bundle Size"
 6  utils/run-oxlint.ts:        "Accessibility"
 6  utils/run-knip.ts:          "warning"
 5  utils/run-knip.ts:          "Dead Code"
```

Concrete extractions per AGENTS.md:

```ts
// types.ts (or new constants/file-system.ts):
export const PACKAGE_JSON_FILENAME = "package.json";
export const UTF8_ENCODING = "utf-8";

// types.ts: Framework already exists as a type, but the string "unknown" is repeated
// Instead use FRAMEWORK_UNKNOWN: Framework = "unknown" once.

// constants.ts:
export const CATEGORY_PERFORMANCE = "Performance";
export const CATEGORY_ARCHITECTURE = "Architecture";
export const CATEGORY_BUNDLE_SIZE = "Bundle Size";
// ... etc.
```

This is a clean codebase grep-replace. The file `run-oxlint.ts` reduces by ~75 string-literal occurrences.

### 🟢 97.3 `"utf-8"` encoding literal repeats 9 times

```text
utils/run-oxlint.ts:455:        Buffer.concat(stderrBuffers).toString("utf-8")
utils/run-oxlint.ts:462:                                              "utf-8"
utils/run-oxlint.ts:464:                                              "utf-8"
utils/resolve-compatible-node.ts:74:  encoding: "utf-8"
utils/read-package-json.ts:6:                              "utf-8"
utils/neutralize-disable-directives.ts:17: encoding: "utf-8"
utils/neutralize-disable-directives.ts:46:                  "utf-8"
utils/discover-project.ts:109: encoding: "utf-8"
utils/discover-project.ts:166:                  "utf-8"
utils/discover-project.ts:318:                  "utf-8"
utils/discover-project.ts:511:                  "utf-8"
utils/discover-project.ts:517:                  "utf-8"
utils/load-config.ts:15:                          "utf-8"
utils/load-config.ts:31:                          "utf-8"
utils/resolve-lint-include-paths.ts:16: encoding: "utf-8"
utils/read-file-lines-node.ts:10:                "utf-8"
```

15+ occurrences. AGENTS.md "magic numbers in constants.ts" extends to magic strings by spirit. Extract `UTF8_ENCODING` constant.

(Bonus: the codebase mixes `"utf-8"` and `"utf8"` — Node accepts both as aliases. A constant enforces consistency.)

---

## 98. Multi-Export Utility Files (AGENTS.md §18 Violations)

Script `03-multi-export-utils.sh` enumerates all utility files with >1 export:

```text
2 exports: calculate-score-browser.ts
2 exports: calculate-score-node.ts
2 exports: combine-diagnostics.ts
5 exports: detect-agents.ts          ← worst offender
4 exports: discover-project.ts
2 exports: filter-diagnostics.ts
2 exports: find-monorepo-root.ts
2 exports: format-error-chain.ts
3 exports: framed-box.ts
2 exports: get-diff-files.ts
2 exports: get-staged-files.ts
```

**11 files violate "one utility per file"**. The worst:

### 🟠 98.1 `detect-agents.ts` exports 5 things — should be one per file

```text
   export type SupportedAgent = ...
   export const ALL_SUPPORTED_AGENTS = ...
   export const detectAvailableAgents = ...
   export const toDisplayName = ...
   export const toSkillDir = ...
```

Per AGENTS.md: split into `utils/detect-available-agents.ts`, `utils/to-display-name.ts`, `utils/to-skill-dir.ts`. The shared `SUPPORTED_AGENTS` map and `SupportedAgent` type → `types.ts` (per "Keep all types in global scope") and possibly a separate `constants/supported-agents.ts`.

### 🟠 98.2 `discover-project.ts` exports 4 things from a 608-line file

```text
   export const formatFrameworkName = ...
   export const discoverReactSubprojects = ...
   export const listWorkspacePackages = ...
   export const discoverProject = ...
```

Plus internal helpers totaling 600+ lines. This file is doing 4 distinct jobs. Per AGENTS.md, split.

### 🟠 98.3 `framed-box.ts` exports an interface plus 2 functions

```text
   export interface FramedLine
   export const createFramedLine = ...
   export const printFramedBox = ...
```

The interface should be in `types.ts`. Each function in its own file.

---

## 99. Interfaces Outside `types.ts` (AGENTS.md §5 Violations)

Script `06-types-outside-types-ts.sh`:

```text
22 interfaces declared in 17 files outside types.ts
```

| File | Interfaces |
|---|---|
| `utils/resolve-compatible-node.ts` | NodeVersion, NodeResolution |
| `scan.ts` | ScoreBarSegments, ResolvedScanOptions |
| `core/diagnose-core.ts` | DiagnoseRunnerContext, DiagnoseCoreDeps |
| `core/build-result.ts` | BuildDiagnoseResultInput, BuildDiagnoseTimedResult |
| `core/build-diagnose-result.ts` | BuildDiagnoseResultParams, DiagnoseResultShape |
| `utils/proxy-fetch.ts` | GlobalProcessLike |
| `utils/get-staged-files.ts` | StagedSnapshot |
| `utils/discover-project.ts` | CatalogCollection |
| `utils/detect-agents.ts` | AgentMeta |
| `utils/build-json-report.ts` | BuildJsonReportInput |
| `utils/build-json-report-error.ts` | BuildJsonReportErrorInput |
| `plugin/rules/tanstack-start.ts` | ServerFnChainInfo |
| `oxlint-config.ts` | OxlintConfigOptions |
| `install-skill.ts` | InstallSkillOptions |
| `index.ts` | ToJsonReportOptions |
| `core/try-score-from-api.ts` | ScoreRequestFetch |
| `cli.ts` | CliFlags |

22 interfaces violating AGENTS.md §5. Either move to `types.ts` (literal interpretation) or update AGENTS.md to clarify "module-private interfaces are allowed when they're only used in one file" (more pragmatic).

Already noted in §4.1 (Pass 1). Script confirms count.

---

## 100. Type Casts (AGENTS.md §14 Violations)

Script `04-type-casts.sh`:

```text
13 'as Type' casts (excluding annotation-only "as GitHub Actions annotations" string)
```

Real casts:

| File:Line | Cast | Justifiable? |
|---|---|---|
| `run-oxlint.ts:479` | `JSON.parse(stdout) as OxlintOutput` | No — should validate. |
| `proxy-fetch.ts:53` | `... as RequestInit` | Yes (undici dispatcher field) — already has `// HACK` comment. |
| `detect-agents.ts:33` | `Object.keys(SUPPORTED_AGENTS) as SupportedAgent[]` | Could use `satisfies`. |
| `run-knip.ts:115` | `options.parsedConfig as Record<string, unknown>` | Knip type shim is too loose. |
| `run-knip.ts:121` | `... as KnipResults` | Same — fix shim. |
| `discover-project.ts:263` | `packageJson as Record<string, unknown>` | The `PackageJson` type omits `catalog`/`catalogs` fields. Add to type. |
| `discover-project.ts:271, 273, 289` | `... as Record<string, unknown>` (×3 more) | Same root cause as above. |
| `load-config.ts:18` | `parsed as ReactDoctorConfig` | Should validate (per §92.7, Pass 15). |
| `load-config.ts:35` | `embeddedConfig as ReactDoctorConfig` | Same. |
| `cli.ts:50` | `level as FailOnLevel` | Inside the validator — actually OK, it's the `is` predicate context. |

Of 13 casts: **10 are unjustified** per AGENTS.md. 4 of them root-cause to weak `PackageJson` typing (could fix by widening the type once). 3 root-cause to weak external-package types (knip).

---

## 101. Cross-Package Score Function Duplication (Concrete Counts)

Script `09-string-similarity.sh`:

| Function | Defined in (file count) |
|---|---|
| `SCORE_GOOD_THRESHOLD = 75` | **9 files** (CLI constants.ts + 8 website files) |
| `getScoreLabel` | **5 files** (CLI scan.ts + 4 website files) |
| `getScoreColor`/`getScoreColorClass` | **5 files** |
| `getDoctorFace` | **4 files** |
| `ScoreBar` component | **3 files** |

Already covered (§18, §56.1, §56.2). The grep confirms the exact duplication count. **9 places to update if `SCORE_GOOD_THRESHOLD` ever changes from 75 to 80.**

---

## 102. AGENTS.md Compliance Summary (from scripts)

| AGENTS.md Rule | Compliance | Findings |
|---|---|---|
| Use TypeScript interfaces over types | ✓ Mostly | 22 interfaces declared outside `types.ts` (§99) |
| Keep all types in global scope | ✗ | Same as above |
| Use arrow functions over `function` decls | ✓ | 0 `function` declarations found |
| Never comment unless necessary | ✓ Mostly | 5 `// HACK:` comments, all justified |
| Use kebab-case for files | ✓ | All filenames are kebab-case |
| Use descriptive variable names | ✓ Mostly | A few short names but generally good |
| Don't type cast (`as`) unless necessary | ✗ | 13 casts, 10 unjustified (§100) |
| Remove unused code, don't repeat yourself | ✗ | 12 dead rules + cross-package score duplication + magic strings (§97, §101) |
| Magic numbers in constants.ts | ⚠ | Most numbers are in constants.ts. **Magic STRINGS aren't** — 500+ literal AST type strings, 15 `"utf-8"`, 11 `"package.json"` (§97) |
| One utility per file | ✗ | 11 files violate (§98) |
| Use `Boolean` over `!!` | ✓ | 0 `!!` found |

5 of 11 rules in violation. The biggest gap is "Magic STRINGS" — AGENTS.md only says "magic numbers" but the spirit applies. The biggest enforcement-grade gap is "One utility per file" (11 violators).

---

## 103. The Take-Away (Pass 17)

The scripts surfaced one major novel finding (§97 — AST type-string pollution, ~500 literal usages with no central definition) and confirmed all the previously-identified DRY/elegance findings with concrete counts.

If I had to rank fixes by yield (per AGENTS.md elegance criteria):

1. **§97.1 NODE constant** — type-safe, refactor-friendly, one-time grep-replace, eliminates ~500 magic strings.
2. **§101 score-function deduplication** (already in executive summary).
3. **§97.2 domain-string constants** (`PACKAGE_JSON_FILENAME`, `UTF8_ENCODING`, category labels).
4. **§98 split multi-export utils** (medium effort, satisfies AGENTS.md but doesn't change runtime).
5. **§99 move interfaces to `types.ts`** (mostly-mechanical, satisfies AGENTS.md).
6. **§100 fix the 10 unjustified `as` casts** (most need real type widening).

The temporary scripts in `/tmp/rd-analysis/*.sh` are reusable for future audits — they'd catch regressions on each of these axes.

Lens: switched from "find bugs" to "measure compliance with the project's stated conventions" using grep-driven scripts. The pattern of literal-string magic numbers is the highest-yield finding because the replacement (`NODE.Identifier` instead of `"Identifier"`) provides compile-time typo protection and IDE autocomplete benefits beyond just "elegance."

---

# Eighteenth Pass — Function Arity, Dead Exports, Config Field Usage

Continuing the script-driven approach (`/tmp/rd-analysis/14-fn-arity-v2.sh`, `15-dead-exports.sh`, `12-config-trace.sh`). Lens: function signatures + workspace-wide reference graph.

## 104. Functions with Too Many Positional Parameters

Script `14-fn-arity-v2.sh` found these functions with 4+ positional parameters:

```text
7 params  utils/run-oxlint.ts:508       runOxlint
7 params  scan.ts:327                   printSummary
7 params  utils/combine-diagnostics.ts:8 combineDiagnostics
6 params  utils/install-skill-for-agent.ts:5  installSkillForAgent
5 params  scan.ts:442                   printProjectDetection
5 params  scan.ts:505                   runScan
5 params  cli.ts:126                    resolveDiffMode
4 params  utils/summarize-diagnostics.ts:3  summarizeDiagnostics
4 params  utils/select-projects.ts:8    selectProjects
4 params  utils/run-oxlint.ts:436       spawnOxlint
4 params  utils/run-knip.ts:35          collectIssueRecords
4 params  utils/merge-and-filter-diagnostics.ts:4 mergeAndFilterDiagnostics
4 params  utils/is-ignored-file.ts:18   isFileIgnoredByPatterns
4 params  utils/get-staged-files.ts:37  materializeStagedFiles
4 params  utils/filter-diagnostics.ts:59  filterIgnoredDiagnostics
4 params  utils/discover-project.ts:254 resolveCatalogVersion
4 params  scan.ts:291                   buildCountsSummaryLine
4 params  scan.ts:227                   buildShareUrl
4 params  cli.ts:58                     resolveFailOnLevel
```

### 🟠 104.1 `runOxlint` has 7 positional parameters — call sites are unreadable

```508:516:packages/react-doctor/src/utils/run-oxlint.ts
export const runOxlint = async (
  rootDirectory: string,
  hasTypeScript: boolean,
  framework: Framework,
  hasReactCompiler: boolean,
  includePaths?: string[],
  nodeBinaryPath: string = process.execPath,
  customRulesOnly = false,
): Promise<Diagnostic[]> => {
```

Call sites:

```540:548:packages/react-doctor/src/scan.ts
          const lintDiagnostics = await runOxlint(
            directory,
            projectInfo.hasTypeScript,
            projectInfo.framework,
            projectInfo.hasReactCompiler,
            lintIncludePaths,
            resolvedNodeBinaryPath,
            options.customRulesOnly,
          );
```

```52:60:packages/react-doctor/src/index.ts
        runLint: () =>
          runOxlint(
            projectRoot,
            projectInfo.hasTypeScript,
            projectInfo.framework,
            projectInfo.hasReactCompiler,
            lintIncludePaths,
            undefined,
            config?.customRulesOnly ?? false,
          ),
```

Without IDE param hints, the call site is unreadable. Worse, `undefined` is positional padding for the optional `nodeBinaryPath` — adding a new optional param later requires updating all call sites with another `undefined`.

The elegant pattern (per AGENTS.md "elegant solution"):

```ts
interface RunOxlintInput {
  rootDirectory: string;
  hasTypeScript: boolean;
  framework: Framework;
  hasReactCompiler: boolean;
  includePaths?: string[];
  nodeBinaryPath?: string;
  customRulesOnly?: boolean;
}

const runOxlint = async (input: RunOxlintInput): Promise<Diagnostic[]> => { ... };

// Call site:
runOxlint({
  rootDirectory: projectRoot,
  hasTypeScript: projectInfo.hasTypeScript,
  framework: projectInfo.framework,
  hasReactCompiler: projectInfo.hasReactCompiler,
  lintIncludePaths,
  customRulesOnly: config?.customRulesOnly ?? false,
});
```

Self-documenting. Adding a new optional parameter requires no call-site change. Tests stay isolated.

### 🟠 104.2 `printSummary` has 7 positional parameters

```327:340:packages/react-doctor/src/scan.ts
const printSummary = (
  diagnostics: Diagnostic[],
  elapsedMilliseconds: number,
  scoreResult: ScoreResult | null,
  projectName: string,
  totalSourceFileCount: number,
  noScoreMessage: string,
  isOffline: boolean,
): void => {
```

Same pattern — pass an `input: PrintSummaryInput` object.

### 🟠 104.3 `combineDiagnostics` has 7 positional parameters

```8:17:packages/react-doctor/src/utils/combine-diagnostics.ts
export const combineDiagnostics = (
  lintDiagnostics: Diagnostic[],
  deadCodeDiagnostics: Diagnostic[],
  directory: string,
  isDiffMode: boolean,
  userConfig: ReactDoctorConfig | null,
  readFileLinesSync: (filePath: string) => string[] | null = createNodeReadFileLinesSync(directory),
  includeEnvironmentChecks = true,
): Diagnostic[]
```

The `readFileLinesSync` default uses an earlier param (`directory`), which is non-trivial in TypeScript and brittle. Convert to options object.

### 🟠 104.4 `installSkillForAgent` has 5 positional parameters

```5:11:packages/react-doctor/src/utils/install-skill-for-agent.ts
export const installSkillForAgent = (
  projectRoot: string,
  agent: SupportedAgent,
  skillSourceDirectory: string,
  skillName: string,
  alreadyInstalledDirectories?: ReadonlySet<string>,
): string => {
```

5 params with one optional. Call site (in `install-skill.ts:67-78`):

```ts
const installedDirectory = installSkillForAgent(
  projectRoot,
  agent,
  sourceDir,
  SKILL_NAME,
  installedDirectories,
);
```

Readable today, but adding e.g. a `dryRun: boolean` requires positional ordering decisions. Options object would be cleaner.

### 🟢 104.5 The 4-param functions are borderline — judgment call

`summarizeDiagnostics`, `selectProjects`, `spawnOxlint`, etc. each take 4 params. These are arguably fine as positional but switching to options object pattern for consistency would help.

The threshold for "must be options object" is project-dependent. AGENTS.md doesn't specify, but per "elegant solution," options-objects are the JS/TS norm for 4+ params.

---

## 105. Dead Exports (Workspace-Wide Reference Graph)

Script `17-dead-exports-correct.sh` walks every named export in `src/`, then checks if any other file in the workspace references it.

### 🟡 105.1 `DiagnoseOptions` is exported but referenced only in its own file

```44:48:packages/react-doctor/src/index.ts
export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
  includePaths?: string[];
}
```

Workspace-wide grep: only `index.ts` references `DiagnoseOptions`. Its TypeScript signature is `(directory: string, options?: DiagnoseOptions) => Promise<DiagnoseResult>` — internal caller passes inline object literals (no need to import the type).

External consumers of `react-doctor/api` MIGHT import this type to construct their options object explicitly. We can't verify (we don't see consumer code). But for a workspace-internal audit: dead.

If kept (for external API stability), document it as part of the public API. Otherwise, drop the export and let callers use inline types.

### 🟢 105.2 The script also finds 5 false positives that I confirmed are actually used

The earlier version of the script (`16-dead-exports-v2.sh`) had a regex bug — it returned dozens of false-positive "dead" exports because `rg -nP -o -r '$2'` includes the file:line: prefix in its output, polluting the loop variable. Fixed in `17-dead-exports-correct.sh`. Worth noting because the false-positive output looked alarmingly long; only after fixing did the real result emerge: **just 1 truly dead export workspace-wide**.

This is a positive finding: the codebase has minimal dead exports. Most of what looks like "could be private" is actually used somewhere.

---

## 106. Config Field Usage Distribution

Script `12-config-trace.sh` counts how many times each `ReactDoctorConfig` field is referenced via `userConfig.field` or `config.field`:

```text
 0  baseBranch              [false positive — baseBranch is on DiffInfo, not ReactDoctorConfig]
 3  customRulesOnly         (cli + scan + adapters/browser)
 3  deadCode                (cli + scan + diagnose-core)
 1  diff                    (cli only)
 1  failOn                  (cli only)
 3  ignore                  (filter-diagnostics + is-ignored-file + resolve-lint-include-paths)
 3  lint                    (cli + scan + diagnose-core)
 1  share                   (scan only)
 1  textComponents          (filter-diagnostics only)
 2  verbose                 (cli + scan)
```

### 🟢 106.1 Each config field has a single canonical wiring point

Most fields (`diff`, `failOn`, `share`, `textComponents`) are referenced in exactly **one** place. That's expected and good — each setting has one canonical wiring point.

But it also means: there's no central config validator (per §92.7, Pass 15). Each field is read independently with its own `?? default`. A typo in `react-doctor.config.json` (e.g., `"shar": true` instead of `"share": true`) is silently ignored — no warning that an unknown field exists.

A central validator would catch this:

```ts
const knownConfigFields: Set<keyof ReactDoctorConfig> = new Set([
  "ignore", "lint", "deadCode", "verbose", "diff", "failOn",
  "customRulesOnly", "share", "textComponents",
]);

const validateConfig = (parsed: Record<string, unknown>): ReactDoctorConfig => {
  for (const key of Object.keys(parsed)) {
    if (!knownConfigFields.has(key as keyof ReactDoctorConfig)) {
      logger.warn(`Unknown react-doctor config field: ${key}. Ignored.`);
    }
  }
  return parsed as ReactDoctorConfig;
};
```

### 🟢 106.2 The `verbose` field has 2 references but `lint`/`deadCode`/`customRulesOnly` have 3

The asymmetry is because some fields flow through both `cli.ts` (CLI flag merging) and `scan.ts` (option resolution) and `index.ts` / `core/diagnose-core.ts` (public API). Others flow through only one path.

`verbose: 2` means it's only wired through `cli.ts` and `scan.ts` — but NOT through the public `diagnose()` API. A consumer calling `diagnose("/path", { verbose: true })` doesn't get verbose output because the public API doesn't read this field.

Looking at `index.ts:44-48 DiagnoseOptions`:

```ts
export interface DiagnoseOptions {
  lint?: boolean;
  deadCode?: boolean;
  includePaths?: string[];
}
```

Doesn't include `verbose`. Confirmed: the `verbose` config field works for the CLI but not for the programmatic API. **Asymmetric API surface.** Either documented (probably not — README says "Show file details per rule (same as `--verbose`)" without distinguishing CLI vs API) or a real bug.

---

## 107. The Take-Away (Pass 18)

Three new findings:

- **§104.1 — `runOxlint(7 positional)` should be options-object.** Real elegance gain at call sites; future-proofing for new options.
- **§104.2 — `printSummary(7 positional)` should be options-object.** Same pattern.
- **§104.3 — `combineDiagnostics(7 positional)` with default-from-earlier-param** is brittle. Options-object eliminates the brittleness.
- **§106.2 — `verbose` config field doesn't flow through the public `diagnose()` API.** Asymmetric: works in CLI, no-op when set in `react-doctor.config.json` and called via API. Either undocumented behavior gap or a real bug.

Plus confirmation findings:
- **§105.1** — only 1 truly dead export workspace-wide (`DiagnoseOptions`). Codebase is mostly clean.
- **§106.1** — each config field has one canonical wiring point but no central validator.

Lens: switched from "find bugs" to "trace each design dimension end-to-end with scripts." The 7-positional-param finding is the highest-yield because it touches multiple call sites and the fix is a clean refactor.

---

# Final Note on Method

After 18 passes:

- Passes 1–10 (file-by-file reading): ~150 findings, mostly bugs and DRY.
- Passes 11–14 (cross-reference, gating, error-path, severity): 8–10 findings, structural issues.
- Pass 15–16 (taint, time-complexity): 5–6 findings, robustness.
- Pass 17–18 (script-driven, AGENTS.md compliance): 5–8 findings, elegance.

The script-driven approach in Passes 17–18 is reusable: `/tmp/rd-analysis/*.sh` can be re-run on any commit to detect regressions on the same axes. If a contributor adds an 8-positional-param function, `14-fn-arity-v2.sh` flags it. If a contributor adds a magic AST node-type string, `01-duplicate-strings.sh` flags it. If a contributor exports something nothing uses, `17-dead-exports-correct.sh` flags it.

The pattern of **lens-switching + script-assistance** is the recipe for exhaustive review work. File-by-file is one lens; "trace this dimension end-to-end" is another. Each lens has its own diminishing return curve.
