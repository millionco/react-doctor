# react-doctor

## 0.6.1

### Patch Changes

- Updated dependencies [[`5f60bef`](https://github.com/millionco/react-doctor/commit/5f60befa8f954d3daf6e790670be8a170683e708), [`6885698`](https://github.com/millionco/react-doctor/commit/6885698cda0bc35446a13a1af7327f62c9c68025)]:
  - oxlint-plugin-react-doctor@0.6.1
  - deslop-js@0.6.1

## 0.6.0

### Minor Changes

- [#955](https://github.com/millionco/react-doctor/pull/955) [`e2393c4`](https://github.com/millionco/react-doctor/commit/e2393c4a6b842efc72d5c225273c0de918a13450) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add `react-doctor ci <install|upgrade|config>`, a dedicated command for managing React Doctor in CI.

  - `ci install` adds a workflow that scans every pull request. It auto-detects the provider (GitHub Actions or GitLab CI), bakes a gate from `--blocking`/`--scope`/`--comment`/`--review-comments`/`--commit-status`, and can open a pull request with `--pr`.
  - `ci config` walks you through the gate, scan scope, and pull-request reporting interactively (with a plain-language recap of what each setting does), or applies the same flags non-interactively. It edits any workflow that contains the React Doctor action step in place — preserving your other steps, jobs, inputs, and comments — and only prints a paste snippet when the file has no React Doctor step.
  - `ci upgrade` bumps the GitHub Action to its current floating major.

  GitHub Actions is fully supported; GitLab CI gets a gate-only scaffold. The `install` command's CI setup is unchanged; `ci` is the focused home for managing CI on its own.

### Patch Changes

- [#936](https://github.com/millionco/react-doctor/pull/936) [`ba2af1b`](https://github.com/millionco/react-doctor/commit/ba2af1b7faa5ef4e1ae39e6c3b786259fba23f1f) Thanks [@aidenybai](https://github.com/aidenybai)! - Update the license to MIT with additional restrictions: the software may not be used as training, fine-tuning, or evaluation data for machine-learning models or AI systems, nor sold or resold as a commercial product or service (e.g. a paid API, SaaS, or hosted/managed service) whose value derives substantially from the software, without prior written permission (contact founders@million.dev). Each version's additional restrictions expire on the second anniversary of its release, after which that version is available under the standard MIT License (an FSL-style grant of future license). Each published package now ships its own up-to-date `LICENSE` file so the terms travel with the tarball.

  The `react-doctor` CLI also now prints a one-time notice (once per run) when it detects it is running inside an AI/ML training pipeline or agent sandbox, pointing to the license terms.

- [#1019](https://github.com/millionco/react-doctor/pull/1019) [`88a5c3c`](https://github.com/millionco/react-doctor/commit/88a5c3cb49dded93128ea61b8fc352039ee82913) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Surface when a compare (PR-introduced-issues) scan couldn't reach the base and fell back to reporting every issue in the changed files.

  - The JSON report now carries `baselineDegraded: true` (schemaVersion 1) when a `changed`-scope run intended a baseline comparison but couldn't compute it — most often a shallow CI checkout with no merge base. Previously the run silently degraded to a plain diff with no signal in the report or the PR comment.
  - The scaffolded GitHub Actions workflow (`react-doctor ci install` / `install`) now checks out with `fetch-depth: 0`, so PR runs have the full history needed to find the merge base and report only the issues the PR introduces instead of all pre-existing ones.

- [#1020](https://github.com/millionco/react-doctor/pull/1020) [`2af7322`](https://github.com/millionco/react-doctor/commit/2af7322f897aaa938445805871a9112b4e9baa56) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix category-level severities silently force-enabling opt-out rules. A config that only re-stamps category severities (e.g. `categories: { "Maintainability": "warn" }`) no longer activates `defaultEnabled: false` rules such as `forbid-component-props`, `react-in-jsx-scope`, `no-danger`, or `design-no-redundant-size-axes` in that category — enabling an opt-out rule now requires pinning the rule itself (or a legacy alias key) to `"warn"`/`"error"` under `rules`, matching the documented contract. Category severities still re-stamp the severity of already-enabled rules, and `react-doctor rules` now previews the same behavior.

- [#1014](https://github.com/millionco/react-doctor/pull/1014) [`d241e51`](https://github.com/millionco/react-doctor/commit/d241e5105e36297be9eebc5796f1d59ae9905c7d) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - CLI audit fixes:

  - Windows agent hooks no longer report false findings on every edit (cmd.exe's exit 9009 falls through, the local bin is probed as the runnable `.cmd` shim, 16 MiB output buffer, guarded output read).
  - Legacy `.sh` agent hooks (≤0.5.8) are upgraded to the current Node hook by a once-per-repo migration on your next interactive scan (and on re-install) instead of scanning every edit twice; the cleanup is anchored to the exact legacy install paths and never touches unrelated hook groups in your settings.
  - `ci upgrade --pr` restores the workflow file and explains an already-open React Doctor PR instead of silently claiming success; `ci config` bails to the apply-by-hand snippet on YAML syntax errors instead of crashing.
  - The action-pin migration only rewrites `millionco/react-doctor` refs (in any owner casing) — a fork's `@main` is no longer rewritten to a tag that may not exist on the fork.
  - Baseline and `--staged` scans resolve `config.plugins` from the real config directory, so custom-plugin findings are no longer mislabeled as newly introduced.
  - A workspace module's `noScore: true` survives workspace scans, and the multi-project share prompt honors each project's merged `noScore`/`share` — any opted-out project now suppresses the aggregate share link.
  - Degraded baseline results are no longer cached, and older binaries treat a newer CLI state schema as read-only (reads never rewrite the state file).

- [#1011](https://github.com/millionco/react-doctor/pull/1011) [`8232e96`](https://github.com/millionco/react-doctor/commit/8232e967238ff7943c0cac0d0b2a2f9d349c89dd) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Make file discovery deterministic and artifact-free, and add `--max-duration` for graceful partial results on slow scans.

  - File discovery is now identical between the git-tracked path (`git ls-files`) and the filesystem walk: the walk descends into non-ignored dot-directories (e.g. `.dumi`, `.storybook`) instead of skipping every dot-directory, and its output is sorted. Repeated scans of the same tree produce the same file set regardless of which discovery path runs.
  - Committed build output (`dist/`, `build/`, `out/`, `.next/`, `coverage/`, `storybook-static/`, …) is excluded from both discovery paths by path-segment filtering. Previously `git ls-files` listed tracked bundles (gitignore only hides untracked files), so bundled artifacts like `ai/dist/mcp-server.js` were linted.
  - New `--max-duration <seconds>` flag: when the budget is spent, remaining lint batches and the dead-code pass are skipped and the scan returns partial results with the skipped files reported explicitly, instead of a SIGTERM'd empty `{"ok":false,"projects":[]}` report. The budget applies once to the whole invocation — every project of a workspace scan shares it — and a scan whose dead-code pass failed or was truncated reports a `null` score rather than one computed from an incomplete diagnostic set.

- [#941](https://github.com/millionco/react-doctor/pull/941) [`5774deb`](https://github.com/millionco/react-doctor/commit/5774debe1e912b109ca4d9e4093a92426c221218) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Speed up cold scans and bound dead-code memory on multi-project workspaces.

  - Overlap the project security scan with the lint pass instead of running it synchronously beforehand. The content-regex security sweep (shipped artifacts, dotenv, SQL — files lint never parses) was the single heaviest CPU phase on real repos and blocked the event loop the whole time. It now runs on a cooperative background fiber that yields between file chunks, so its cost hides under the subprocess-bound lint pass and stops starving a multi-project scan's concurrent git/network work. Cold scans are measurably faster (~30% on a mid-size project and workspace in local benchmarks); diagnostics are byte-identical.
  - Cap concurrent dead-code (deslop) workers by a memory budget so a multi-project scan can't oversubscribe memory with many simultaneous worker processes on a small CI runner. On a roomy machine the cap exceeds the project count, so nothing serializes and scan time is unchanged.

- [#929](https://github.com/millionco/react-doctor/pull/929) [`5f2bd72`](https://github.com/millionco/react-doctor/commit/5f2bd7254362109555194e43a019824478cb9ab5) Thanks [@skoshx](https://github.com/skoshx)! - fix: validate string array config fields (projects, textComponents, etc.)

  Non-string entries in `config.projects` caused `selectProjects` to crash with `requestedName.trim is not a function`. The validator now filters non-string entries from `projects`, `textComponents`, `rawTextWrapperComponents`, and `serverAuthFunctionNames` with warnings instead of crashing.

  Fixes [#921](https://github.com/millionco/react-doctor/issues/921) (Sentry REACT-DOCTOR-1R)

- [#940](https://github.com/millionco/react-doctor/pull/940) [`441e6af`](https://github.com/millionco/react-doctor/commit/441e6afb55ee154e70e56f10a79565b9fd1f3295) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop a scan from crashing when a git subprocess fails synchronously (fixes REACT-DOCTOR-1E, REACT-DOCTOR-1P, REACT-DOCTOR-20). Unlike a missing binary (`ENOENT`, which arrives on the catchable `'error'` event), `child_process.spawn` **throws synchronously** when the working directory isn't a directory (`ENOTDIR`) or the argument list exceeds the OS command-line limit (`ENAMETOOLONG` — e.g. `--scope lines` on a 1,000+-file diff on Windows). That throw escaped Effect's error channel entirely and took down the whole scan (reported to Sentry as a raw `spawn` error). The git runner now pre-flights both conditions and fails on its normal channel, so the existing fallbacks recover instead: a bad working directory degrades like an unavailable git, and an over-long `--scope lines` diff degrades to file-level scope.

- [#966](https://github.com/millionco/react-doctor/pull/966) [`bd0f465`](https://github.com/millionco/react-doctor/commit/bd0f465e61ffb93b5716cd056b0e288365cb32ea) Thanks [@skoshx](https://github.com/skoshx)! - Fix Cursor agent handoff on Windows. Cursor installs its CLI as a PowerShell-wrapped `.cmd` that Node's `spawn()` cannot execute without `shell: true` (which would mangle the multi-line handoff prompt). The launcher now resolves Cursor's bundled `node.exe` + `index.js` under `%LOCALAPPDATA%\cursor-agent\versions\<latest>\` and spawns it directly — preserving argv integrity and bypassing the PowerShell hop. Closes [#964](https://github.com/millionco/react-doctor/issues/964).

- [#974](https://github.com/millionco/react-doctor/pull/974) [`b6d1a87`](https://github.com/millionco/react-doctor/commit/b6d1a87cb86113a7caae072f5c9c2e1ba8ca3e31) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Show staged findings in the pre-commit hook instead of swallowing them

  The generated pre-commit hook captured react-doctor's output to a temp file and
  deleted it before printing, so a failing scan showed only a generic "found
  staged regressions" notice — never the actual findings ([#969](https://github.com/millionco/react-doctor/issues/969)). The hook now
  writes the scan output to stderr before cleanup, in both the raw hook and the
  hook-manager command. It stays non-blocking by design (the commit still
  proceeds); the diagnostics are simply visible now so you know what to fix.

- [#1017](https://github.com/millionco/react-doctor/pull/1017) [`c2af308`](https://github.com/millionco/react-doctor/commit/c2af3082bfcb85c97e4bfa0d0d71f20478cebe9b) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix four false positives found by React Doctor reviewing real, idiomatic React code (the Ink TUI in [#979](https://github.com/millionco/react-doctor/issues/979)):

  - `no-derived-state` no longer flags state accumulators — a `setState` inside an effect whose functional updater computes the new value from its own parameter (`setKeys((previous) => new Set(previous).add(key))`, `setTotal((prev) => prev + count)`, `setItems((prev) => [...prev, item])`). Accumulated history is by definition not derivable from the current props/state. The spread-only object merge (`setForm((prev) => ({ ...prev, field: <derived> }))`) still reports.
  - `no-array-index-as-key` no longer flags positional rendering of string fragments (characters, lines, tokens): `[...str]` and `Array.from(str)` where the source is provably a string (literal, template, `String()` call, or a binding/prop typed `string` in the same file), plus any `str.split(...)` receiver (only strings have `.split`, so no proof is needed) — including a local binding initialized from one (`const parts = line.split(" "); parts.map(...)`). Fragment position is the stable identity there — nothing reorders, filters, or carries per-item state. Data lists still report.
  - `prefer-useReducer` now requires an actual co-update signal instead of merely counting `useState` calls: it reports only when the threshold number of distinct setters are called together as sibling statements of one handler/effect block. Independent state updated from separate handlers or separate keyboard-handler branches stays quiet, and the message no longer claims each `useState` "can trigger a separate render" (wrong since React 18 automatic batching) — it now explains the real rationale: state that changes together is easier to keep consistent as a single reducer action.
  - `jsx-no-jsx-as-prop` only claims what it can prove: when the receiving component is not resolvable in the current file (imported), the message uses conditional wording ("If this child is memoized, …") instead of asserting a memo bailout that may not exist. Same-file components provably wrapped in `memo()` (or MobX `observer()`) keep the assertive message; provably plain function components already stayed quiet.
  - `lazy()` / `React.lazy()` components are no longer treated as memoized — `lazy` defers loading but does not skip re-renders. `jsx-no-jsx-as-prop` now uses the conditional wording for them, and the memoised-consumer-gated rules (`jsx-no-new-object-as-prop`, `jsx-no-new-array-as-prop`, `jsx-no-new-function-as-prop`, `prefer-stable-empty-fallback`) no longer report fresh-reference props passed to a `lazy()` component, matching their premise of a provably defeated memo bailout.

- [#963](https://github.com/millionco/react-doctor/pull/963) [`03b7a5f`](https://github.com/millionco/react-doctor/commit/03b7a5f79e50d42f1d4f1aaddb2587605c8edde0) Thanks [@skoshx](https://github.com/skoshx)! - Exclude TypeScript 6.x to fix bunx installation crash

  TypeScript 6.0.3 has an internal circular dependency with its `Comparison` enum
  that triggers a known Bun module loader bug, causing `bunx react-doctor install`
  to crash with "ReferenceError: Cannot access 'Comparison' before initialization".
  Narrow the dependency range to `>=5.0.4 <6` until Bun fixes enum initialization
  order (see oven-sh/bun#12805).

  The constraint covers both `react-doctor` (whose CLI imports `typescript` at
  startup) and `deslop-js` (loaded by the dead-code scan, which can run under bun),
  so no published package pulls TypeScript 6.x into a consumer's install tree.

  `npx` continues to work because npm's resolver handles the circular dependency
  correctly. TypeScript 5.9.3 is stable and tested; TypeScript 6.x support will
  return once the upstream bug is resolved.

  Closes [#962](https://github.com/millionco/react-doctor/issues/962)

- [#1012](https://github.com/millionco/react-doctor/pull/1012) [`80e3093`](https://github.com/millionco/react-doctor/commit/80e3093815ecc40f29442ef44b4fee9accd76e8a) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Core-engine reliability and security fixes from the 20-day audit. The lint binary-split retry budget is now scoped per batch and anchored at the first failure, so one pathological batch no longer starves the rest of the scan's recovery (and drop reasons name the limit that fired). `REACT_DOCTOR_SUPPLY_CHAIN_TIMEOUT_MS` can now raise the supply-chain budget instead of only lowering it. A corrupt per-file lint cache no longer fails every warm scan until hand-deleted, and the cache now busts when the oxlint child runs a different Node than the CLI (nvm fallback). The `/tmp` fallback cache directory is scoped per user so another local user can't pre-create and poison it, and the auto-detected default branch is validated before reaching git argv. The spawn argv guard is platform-sized (Windows 24k chars, macOS 800k, other POSIX 1.5M), so large `--scope lines` diffs no longer silently degrade to file scope on Linux/macOS. A security-scan I/O failure now skips that pass instead of failing the whole scan, and is reported on the run's telemetry as `securityScan.failed`. Note: the per-file lint cache is invalidated once on upgrade (its ruleset-hash separators changed).

- [#934](https://github.com/millionco/react-doctor/pull/934) [`970babc`](https://github.com/millionco/react-doctor/commit/970babcb09a597f2d0891b283c2bac7f8afaef1d) Thanks [@skoshx](https://github.com/skoshx)! - Fix `--project` resolution when scanning from within a project directory whose basename matches the requested project name.

  When running react-doctor from a subdirectory (e.g., `apps/website`) and passing `--project website`, the CLI now correctly recognizes that the current directory is the requested project instead of failing with "Project 'website' is not a directory under /path/to/apps/website."

  This affects users who scan a single (non-workspace) project directory and pass that directory's own name as the project — e.g. `directory: apps/website` together with `--project website` (or `projects: ["website"]` in config). The `*` ("all projects") default is unaffected: it short-circuits to the root directory and never goes through name resolution.

- [#984](https://github.com/millionco/react-doctor/pull/984) [`0b64af5`](https://github.com/millionco/react-doctor/commit/0b64af58b16329c5cae7a210463d2842e34b150d) Thanks [@aidenybai](https://github.com/aidenybai)! - Stop `no-eval` and `auth-token-in-web-storage` from firing in non-production files

  `eval` / `new Function` / a stringy `setTimeout`, and a token written to web
  storage, are only vulnerabilities in code that ships to users. Both rules now
  skip test, spec, fixture, story, and script files (`isTestlikeFilename`), so a
  `new Function(...)` inside a `*.test.ts` or a throwaway token in `__tests__/` is
  no longer reported. The rules stay fully enabled in production code.

- [#938](https://github.com/millionco/react-doctor/pull/938) [`229ea2e`](https://github.com/millionco/react-doctor/commit/229ea2e12e95e8af3279988c6c1c7a653bf5f6c5) Thanks [@skoshx](https://github.com/skoshx)! - fix(staged): log warning when getStagedSourceFiles encounters git errors

  When git commands fail (missing git binary, corrupted repo, permission errors), `getStagedSourceFiles` now logs a warning message showing the error instead of silently returning an empty array. This makes `--staged` failures much easier to debug while still gracefully degrading.

- [#957](https://github.com/millionco/react-doctor/pull/957) [`5893a56`](https://github.com/millionco/react-doctor/commit/5893a56f03c70eb9ca1ff5f88879a9acf3306f36) Thanks [@skoshx](https://github.com/skoshx)! - Fix mojibake (`ÔÇö`, `├ù`) in CLI output on Windows. The console was decoding
  react-doctor's UTF-8 bytes with a non-UTF-8 code page (CP-850/437 in cmd.exe),
  so `—`, `×`, `›`, and box-drawing rendered as garbage — including in VS Code's
  terminal. Switch the Windows console to UTF-8 (code page 65001) once at CLI
  startup (console-only, best-effort), which fixes every glyph at the source
  rather than swapping individual characters for ASCII. Closes [#956](https://github.com/millionco/react-doctor/issues/956).

- [#967](https://github.com/millionco/react-doctor/pull/967) [`43267da`](https://github.com/millionco/react-doctor/commit/43267da930fa25b9fa78e30de80f8d102c753a45) Thanks [@skoshx](https://github.com/skoshx)! - Install agent hooks (Cursor, Claude Code) as a Node `.mjs` runner invoked via `node` instead of a `#!/bin/sh` script, so they run on Windows without Git Bash/WSL/Cygwin. Closes [#965](https://github.com/millionco/react-doctor/issues/965).

- [#930](https://github.com/millionco/react-doctor/pull/930) [`ea4d9af`](https://github.com/millionco/react-doctor/commit/ea4d9afd4f2afc15c5d52217c3d001bd02b84046) Thanks [@skoshx](https://github.com/skoshx)! - Degrade gracefully when git is unavailable or diff base ref is missing (fixes REACT-DOCTOR-F, REACT-DOCTOR-1K, REACT-DOCTOR-14, REACT-DOCTOR-22). CI containers without git installed and shallow clones missing the diff base ref now fall back to a full scan with a clear warning instead of crashing and reporting to Sentry.

- [#926](https://github.com/millionco/react-doctor/pull/926) [`b8188e0`](https://github.com/millionco/react-doctor/commit/b8188e096bd0107e6ed350c7d77f582c99f79bbc) Thanks [@skoshx](https://github.com/skoshx)! - Fix `react-doctor install` crashes on pre-existing malformed/conflicting agent config. The install command now handles three user-environment failure modes gracefully with clear error messages instead of unhandled exceptions:

  1. Malformed JSON in `~/.claude/settings.json` or `~/.cursor/hooks.json` (REACT-DOCTOR-25)
  2. Directory path blocked by an existing file at `~/.claude/skills` or parent paths (REACT-DOCTOR-17)
  3. Permission denied when target directories aren't writable (REACT-DOCTOR-1A)

  These errors are now treated as expected user-environment conditions (not react-doctor bugs) and surface actionable messages without Sentry reports.

- [#939](https://github.com/millionco/react-doctor/pull/939) [`986557d`](https://github.com/millionco/react-doctor/commit/986557d4ccebe26d16f73468773bed6cefa7d52f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Align `react-doctor install`'s agent selection with the Vercel `skills` CLI so it stops scattering skill directories across your project. The prompt previously detected every agent with a config dir anywhere in `$HOME` (`~/.codebuddy`, `~/.crush`, `~/.goose`, `~/.kilocode`, …) and **pre-selected all of them**, so a single Enter copied `.codebuddy/`, `.crush/`, `.goose/`, … into the project root.

  Now, following that CLI's heuristic, the default selection is:

  - your **remembered** last pick (persisted globally, like `skills`' `lastSelectedAgents` lock), else
  - a small curated set of popular agents (`claude-code`, `cursor`, `codex`, `opencode`), else
  - a lone detected agent when that's the only one — and otherwise nothing, so you make a deliberate choice.

  Every detected agent is still shown so the rest are one keystroke away; they're just no longer pre-checked. A non-interactive run (`--yes` / CI) still installs to all detected agents, matching `skills`' `--yes`.

- [#947](https://github.com/millionco/react-doctor/pull/947) [`05cafc6`](https://github.com/millionco/react-doctor/commit/05cafc669a5ff1e6c87daf83e9fa2972fe90c7e4) Thanks [@skoshx](https://github.com/skoshx)! - Add `--json-out <path>` flag to write JSON reports to a file instead of stdout

- [#944](https://github.com/millionco/react-doctor/pull/944) [`0c19858`](https://github.com/millionco/react-doctor/commit/0c198589d81702cc0b59cfe6d41e63329154e203) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Organize the per-scan Sentry "wide event" under dotted namespaces. The root-span attributes had accreted into a flat, half-namespaced set (~50 keys, most bare); each now carries a namespace matching its concept — `scan.*` (config + `scan.fileCount`), `action.*` (CI/action knobs), `outcome.*` (verdict), `diag.*` (findings), `score.*`, `lint.*`, `deadCode.*`, `supplyChain.*`, `timing.*` — alongside the already-namespaced `migration.*`/`baseline.*`. Applied via a single `withNamespace` helper so the prefix lives in one place instead of being hand-spelled per key. Pure rename: value types are preserved (numbers stay numeric so `p75`/`avg` keep working) and the keys stay filter-/group-/aggregate-able in Sentry's Spans dataset. Run/project base tags and all metrics are unchanged.

- [#917](https://github.com/millionco/react-doctor/pull/917) [`7a673d2`](https://github.com/millionco/react-doctor/commit/7a673d20238903b4ef2d2b525379bec96cec2642) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Remember the post-scan "What would you like to do next?" pick. The interactive handoff prompt now pre-selects whatever the user chose last (an agent, "copy to clipboard", or "skip"), so the common "always hand off to the same agent" path is a single Enter. The choice is remembered per user in the existing CLI state file via a new `Preference` lifecycle primitive; a remembered agent that's since been uninstalled falls back to highlighting the first option, and pressing Esc leaves the prior preference untouched.

- [#1016](https://github.com/millionco/react-doctor/pull/1016) [`f028d8b`](https://github.com/millionco/react-doctor/commit/f028d8b19daec982c6248ffc067ee37f8fb700a4) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add anonymized telemetry for which rules users silence. A `rule.disabled` counter records config off-switches (`rules: "off"` and `ignore.rules`, keyed by canonicalized rule + source) once per scan, and a `rule.suppressed` counter records findings the diagnostic pipeline dropped per user intent — config off-switch, per-path `ignore.overrides` entry, or inline `react-doctor-disable*` comment — with per-source rollups (`diag.suppressed*`) on the per-scan wide event. No rule identity ever rode telemetry for silenced rules before, so rule-rejection (the strongest false-positive signal) was unmeasurable.

- [#928](https://github.com/millionco/react-doctor/pull/928) [`734c564`](https://github.com/millionco/react-doctor/commit/734c564db30507b99246f08308fa4ab68235194b) Thanks [@skoshx](https://github.com/skoshx)! - Stop reporting unactionable environment errors to Sentry. A narrow set of filesystem conditions react-doctor cannot fix — a full disk (`ENOSPC`), a failing or read-only disk (`EIO`/`EROFS`), denied permissions (`EACCES`/`EPERM`), a path blocked by a file (`ENOTDIR`), or a missing binary (`spawn … ENOENT`) — now exit cleanly with an actionable message instead of crashing with a stack trace and appearing as product defects in Sentry. The set is deliberately narrow: codes that usually indicate a react-doctor bug (a missing file we expected, or an over-long argv such as `ENAMETOOLONG`) keep reaching Sentry. A low-cardinality `cli.env_error` metric, keyed by code, tracks how often these occur without inflating the crash dashboard. Closes REACT-DOCTOR-13, REACT-DOCTOR-1V, REACT-DOCTOR-24.

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

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Run dead-code analysis sequentially by default and scale its timeout to the repo size — fixing a silent drop of all dead-code findings on large supply-chain scans.

  Dead-code (deslop reachability) is CPU-bound, like the oxlint lint pass. Running them concurrently oversubscribed the cores: deslop's parse pool and the oxlint pool each size to all cores, so together they demanded ~2x the cores, thrashed, and the parse pass missed its in-worker timeout. On a large repo (where the pass already runs near the cap) the supply-chain pass bleeding into the dead-code phase was enough to tip it over, and the fail-open path then silently dropped EVERY dead-code finding — observed dropping all ~349 findings on ~2/3 of supply-chain-on Sentry scans, with no user-visible error.

  Dead-code now runs strictly after lint with the full core budget — fastest per-phase and never oversubscribed (overlapping two CPU-bound passes buys no wall-clock anyway). `REACT_DOCTOR_DEAD_CODE_OVERLAP=on` still forces the overlap, but the two pools now SPLIT the core budget — deslop's parse pool is capped via the new `DESLOP_PARSE_CONCURRENCY` env and lint shrinks to the remainder — so they sum to the cores instead of doubling them.

  The dead-code phase + in-worker timeouts now scale with the project's source-file count (and inversely with the dead-code core share when overlapped) instead of a flat cap, so a large repo's legitimately-long pass isn't reclaimed before it finishes; the ceiling still reclaims a genuinely wedged worker, and an explicit `REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS` override is honored verbatim. This supersedes the previous memory-gated dead-code overlap and replaces the flat dead-code phase cap with the size-scaled budget.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Skip the deslop analysis passes whose output react-doctor discards — an ~8.5x speedup of the dead-code phase on large repos.

  react-doctor consumes only deslop's graph dead-code findings: unused files, unused exports, unused dependencies, and circular dependencies. The dead-code worker projects exactly those four off deslop's result (`check-dead-code.ts` `normalizeResult`); the other ~18 fields deslop computes never cross the worker boundary. Two of deslop's passes produce only discarded output and are the bulk of the runtime: the full-TypeScript-Program **semantic** pass (unused types / enum & class members / misclassified deps), and a set of **code-quality** detectors (duplicate-block / copy-paste detection, complexity hotspots, feature flags, TypeScript smells, private-type leaks, re-export cycles). Profiling a ~9k-file repo (Sentry) showed `generateReport` was ~90% of the phase and duplicate-block detection alone was ~83s of ~130s.

  deslop gains a `reportCodeQuality` flag (default `true`, so deslop used standalone is unchanged) that gates those six code-quality detectors — they were the only expensive detectors still running unconditionally while the cheaper redundancy detectors were already opt-in. react-doctor's dead-code worker now passes both `semantic: { enabled: false }` and `reportCodeQuality: false`.

  Measured on Sentry: deslop drops from ~132s to ~15.5s (8.5x) with byte-identical consumed findings (198 unused files, 10 unused exports, 4 unused deps, 137 cycles), and a full supply-chain-on scan drops from ~142s to ~40s. Skipping these is provably safe — each consumed finding comes from its own detector, independent of the disabled passes — and a parity test locks the invariant so a future deslop change that ever coupled a consumed finding to either pass fails CI first.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Diagnostics are now emitted in a deterministic order across runs (JSON report, terminal output, on-disk dump, and the agent handoff), so two runs of the same repo produce byte-identical ordering instead of the parallel lint pass's arrival order. Lint scans also schedule the largest source files first (LPT batch ordering) for better wall-clock on large repos — a free reordering using the file size the minified-file gate already stat'd. Set `REACT_DOCTOR_LINT_BATCH_ORDERING=arrival` to fall back to discovery order. The diagnostics array content (and the JSON `schemaVersion`) is unchanged — only the ordering becomes deterministic.

- [#906](https://github.com/millionco/react-doctor/pull/906) [`8b91ac8`](https://github.com/millionco/react-doctor/commit/8b91ac8206aa840724420862927b2d3e5200ba36) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix the GitHub Actions setup flow opening duplicate PRs and bundling unrelated local changes ([#904](https://github.com/millionco/react-doctor/issues/904)). Before creating a branch, `openWorkflowPullRequest` now checks for an already-open React Doctor setup PR and surfaces it instead of minting a second timestamped branch, and it bails when the working tree has tracked changes other than the workflow file (which `git checkout -b` + the whole-index `git commit` would otherwise sweep into the PR), falling back to staging the workflow file.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Memoize the large-minified-file stat/sniff so each source path is statted and content-sniffed at most once per process. A full scan enumerates the source tree more than once — `countSourceFiles` during discovery, `listSourceFiles` during the lint pass, and `collectSecurityScanFiles` during the env-check phase — and every `≥20KB` candidate was `statSync`'d (plus a 64KB content read) on each walk. A module-scope path-keyed cache collapses that to a single stat/sniff per file, wired into the existing `clearCaches()` invalidation contract so long-running `diagnose()` consumers still re-read files that change between calls. Behavior is unchanged (identical diagnostics and `sourceFileCount`); this only removes redundant pre-lint syscalls on full scans.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Replace the fixed 16-worker lint ceiling with a memory-and-core-budgeted auto count (up to 32). The auto path now picks `min(cores, floor(availableMemory / 1 GiB))` clamped to `[1, 32]`, where `availableMemory` is `os.totalmem()` floored by the container's cgroup memory limit (read directly, since Node's memory APIs report the host total inside a container). `os.freemem()` is deliberately not used — it excludes reclaimable page cache and reads near-zero on macOS / cache-heavy Linux, which would have collapsed the default scan to a single worker.

  The 1 GiB/worker budget matches the per-worker footprint the old fixed-16 ceiling already tolerated (16 workers on a typical 16 GiB CI box), so machines with at least ~1 GiB per core stay core-bound and unchanged. A 32/64-core runner with enough memory now uses up to 32 workers instead of idling cores behind the old 16; a high-core but memory-starved box or container uses fewer workers so the oxlint native binding doesn't OOM (the existing `EAGAIN`/`ENOMEM` serial replay remains the runtime backstop). Past ~10 workers parallel efficiency already flattens, so this is headroom and OOM-safety, not a proportional speedup.

  The cgroup v2 limit is read from the mount-root `memory.max`, which is the container's limit under the standard cgroup-namespace setup CI runners use; a non-namespaced nested cgroup falls back to the host total (with the serial replay as the backstop).

  Note for `diagnose({ projects })` batch scans: each project's lint pass is budgeted independently against the whole machine, so a batch (default 4 concurrent projects) can now spawn up to `4 × 32` concurrent oxlint processes on a large runner (was `4 × 16`). The per-project `EAGAIN`/`ENOMEM` serial replay still backstops any over-subscription; dividing the per-project memory budget by the batch concurrency is a possible follow-up.

  Explicit `REACT_DOCTOR_PARALLEL=N` and `inspect({ concurrency: N })` pins are now clamped to 32 (was 16). The `[~N workers]` scan suffix can show more than 16 on large runners, and the `oxlint.workers` telemetry distribution (plus the wide-event `workerCount` / `parallel`) now reports the real resolved worker count on the default auto path instead of only when a count was pinned.

- [#908](https://github.com/millionco/react-doctor/pull/908) [`2cadd3f`](https://github.com/millionco/react-doctor/commit/2cadd3fe2cb5b0476b35b1581c0a4c99bcdf1306) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add a once-per-repo migration that pins a mutable `@main` / `@master` React Doctor GitHub Action reference in `.github/workflows/*.yml` to the recommended floating major (`@v2`).

  An unpinned `@main` runs whatever the action's HEAD points to with the workflow's write permissions — a supply-chain risk ([#299](https://github.com/millionco/react-doctor/issues/299)) — and the rewrite also moves the workflow onto the current install- and scan-cached action release. Pinned tags / commit SHAs are deliberate and left untouched, and a different action on `@main` (e.g. `actions/checkout@main`) is ignored. Runs once per repo like the legacy-config migration, rewrites only the ref (owner, comments, and the action's `version:` input are preserved), and logs the change for the user to review and commit (or revert if they intentionally track main).

- [#907](https://github.com/millionco/react-doctor/pull/907) [`7e10716`](https://github.com/millionco/react-doctor/commit/7e10716ae1d3a9b1a9fb7657841c76e5f856a8f0) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Rework the CLI's per-user state tracking into a small lifecycle framework. All onboarding, growth, and migration state now lives behind one store (`cli-state-store.ts`) and one set of primitives (`cli-lifecycle.ts`): **gates** (fire once per machine or per repo, with an outcome and a version), **migrations** (run a code/config update once per repo, tracked), and **invalidation** (bump a gate's/migration's version to re-fire). Onboarding, the CI pitch, the action-upgrade offer, the agent install hint, and the legacy `react-doctor.config.json` → `doctor.config.ts` migration are all expressed on it. The on-disk state file upgrades itself in place on first read, preserving every recorded answer — no user is re-prompted. No change to commands, flags, or output.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add a per-file content-addressed lint cache so repeat scans re-lint only the files whose content changed. On a warm scan the oxlint pass partitions the file list by content hash: unchanged files replay their cached raw diagnostics, and only changed files are re-linted. The five cross-file rules (`no-barrel-import`, `nextjs-missing-metadata`, `nextjs-no-use-search-params-without-suspense`, `no-mutating-reducer-state`, `rn-prefer-expo-image`) — whose verdict for a file can depend on _other_ files — always run fresh in a never-cached sidecar pass, so a dependency change can never serve a stale verdict. Output is byte-identical with the cache on or off (the design invariant), so the score, JSON report, and `inspect()`/`diagnose()` return values are unchanged.

  The cache is on by default and content-hashed (so it survives CI re-clones), and is automatically bypassed in audit mode, when an `extends` lint config is adopted, or when user plugins are configured. Disable it with `REACT_DOCTOR_NO_FILE_CACHE=1`; the existing `REACT_DOCTOR_NO_CACHE=1` now disables both the whole-repo scan cache and this per-file cache. A `cross-file-rules` guard test fails if a future rule starts reading other files without being carved into the always-fresh sidecar. The CLI reports cache effectiveness on its Sentry run event as `lintCacheHitRatio`.

  `oxlint-plugin-react-doctor` now exports `CROSS_FILE_RULE_IDS`, the canonical set of rules whose verdict can depend on other files.

- [#908](https://github.com/millionco/react-doctor/pull/908) [`2cadd3f`](https://github.com/millionco/react-doctor/commit/2cadd3fe2cb5b0476b35b1581c0a4c99bcdf1306) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Persist react-doctor's scan caches across CI runs (plan 10).

  In CI every commit is a fresh, SHA-scoped checkout, so the project-local `node_modules/.cache` never survives between commits — every run recomputes from scratch. This makes the engine's caches survivable:

  - **`REACT_DOCTOR_CACHE_DIR`** (new env): an operator/CI-pinned cache root. The GitHub Action points it at a stable `${runner.temp}` path and persists it with `actions/cache`, so the per-file content-addressed lint cache restores across runs — a PR re-lints only its changed files instead of the whole project. Keyed on the react-doctor version + lockfile + os/arch, with a `restore-keys` partial-hit fallback; the engine re-validates every restored entry by content hash + ruleset hash, so a stale entry simply misses and recomputes (no correctness risk).
  - **Supply-chain on-disk cache** (new): per-PURL Socket artifacts are cached under the cache dir with a 24h TTL (`SUPPLY_CHAIN_CACHE_TTL_MS`), so unchanged dependencies skip the network on repeated scans — locally and in CI — removing the bulk of the Socket fetches a full scan makes. Fail-open (a cache miss/error just fetches; a write failure never sinks the scan) and disabled by the existing `REACT_DOCTOR_NO_CACHE` off-switch.

  The `action.yml` cache wiring ships as an action release (cut a tag after dogfooding). A `--print-cache-key` flag for a tighter (ruleset-exact) actions/cache key is a possible follow-up; the version+lockfile key already restores soundly today.

- [#903](https://github.com/millionco/react-doctor/pull/903) [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Overlap the Socket.dev supply-chain check with the lint pass. The supply-chain
  score lookup is ~100% network-bound and the lint pass is ~100% CPU/subprocess-
  bound, but they previously ran back-to-back. The check now runs on a background
  fiber whose wall-clock overlaps the lint pass, collapsing the two serial phases
  into roughly `max(supplyChain, lint)`. A generous wall-clock budget bounds a
  hung network socket so it can never drag out a scan; on expiry the check fails
  open to no diagnostics — the same outcome as an existing Socket API outage. The
  diagnostic set, ordering, and score are unchanged.
- Updated dependencies [[`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae), [`8bbcca8`](https://github.com/millionco/react-doctor/commit/8bbcca87daf06e60d0fa3005f8ad636fc929e513), [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae), [`627f9ca`](https://github.com/millionco/react-doctor/commit/627f9ca4b363f7b7a037f2a77cba1213b7d605ae)]:
  - deslop-js@0.5.8
  - oxlint-plugin-react-doctor@0.5.8

## 0.5.7

### Patch Changes

- [#881](https://github.com/millionco/react-doctor/pull/881) [`50999f4`](https://github.com/millionco/react-doctor/commit/50999f4a09c992d534c86fe248bfdb65dd8ef377) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add a `--debug` flag that prints the run's Sentry trace id at the end of a scan.

  When something looks wrong, run `react-doctor --debug`: it forces a Sentry performance trace for that run (even if `SENTRY_TRACES_SAMPLE_RATE` was turned down) and prints `Sentry trace (mention this when reporting): <id>` as the last line so the id can be pasted into a bug report for maintainers to pull the full trace. It prints on both outcomes — a clean run and a crash (the crash's trace is surfaced even when it happens before the scan span starts). The line goes to stderr, so `--json` / `--score` stdout stays machine-clean. Combining `--debug` with `--no-score` / `--no-telemetry` is rejected up front, since those flags disable the Sentry reporting `--debug` depends on. Telemetry also gains a low-cardinality `debug` run tag so adoption of the flag is visible.

- [#864](https://github.com/millionco/react-doctor/pull/864) [`b317164`](https://github.com/millionco/react-doctor/commit/b317164e3e6bc9a5d7fc0fa4870187a17ba73493) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Make `file:line` diagnostic locations clickable in the terminal, and record which terminal each run uses.

  Diagnostic locations are now wrapped in OSC 8 hyperlinks pointing at each file's absolute path, so supporting terminals (iTerm2, WezTerm, Kitty, Windows Terminal, VS Code, and other VTE-based emulators) turn them into click-to-open links — even in monorepo scans where the displayed path is relative to a sub-project root rather than the terminal's cwd. The visible text is unchanged (`src/App.tsx:12`), the link rides in escape sequences, and terminals without OSC 8 support print it exactly as before. Hyperlinks are auto-detected per terminal and can be forced on/off with the standard `FORCE_HYPERLINK` env var; they are off for non-TTYs, CI, and coding agents (whose output parsers shouldn't see the escapes).

  Telemetry also gains a `terminalKind` run tag (neovim, vscode, iterm, wezterm, kitty, windows-terminal, …) so we can see where React Doctor is actually run. It is a low-cardinality enum with no path, username, or secret.

- [#863](https://github.com/millionco/react-doctor/pull/863) [`740211c`](https://github.com/millionco/react-doctor/commit/740211cf201ee28910c105b59b79e9aa73e1bd45) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add a per-project `scannedFileCount` to the JSON report's `projects[]` entries —
  the number of source files the scan's linter examined (the changed React-eligible
  files in diff mode, the whole source tree in a full scan). It's additive and
  optional, so the `schemaVersion` is unchanged and existing consumers are unaffected.

  This lets the GitHub Action tell "a PR that changed no React-eligible files" (the
  linter examined nothing — `scannedFileCount: 0` for every project) apart from "a
  clean scan of real React changes" (`scannedFileCount >= 1`), which previously
  produced identical reports. The Action now treats the former as a no-op: it skips
  the sticky PR comment entirely and the commit status reads "Skipped — no React
  files changed" instead of a zero-filled score line. A clean scan of real React
  changes still posts its "no issues 🎉" comment.

- [#844](https://github.com/millionco/react-doctor/pull/844) [`eafac9d`](https://github.com/millionco/react-doctor/commit/eafac9d4f1d52f68258306ad037841a981a9d6cf) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop recommending the deprecated `--diff` flag in agent-facing guidance ([#834](https://github.com/millionco/react-doctor/issues/834)).

  The CLI "Agent guidance" section, the installed agent hooks, and the `--help` examples all advised running `react-doctor --verbose --diff`, which now prints a deprecation warning on every run. They now recommend the supported `--scope changed` (pass `--base <ref>` to pin the base). The website `llms.txt` and the `react-doctor` skill reference were updated to match.

- [#832](https://github.com/millionco/react-doctor/pull/832) [`f45cb29`](https://github.com/millionco/react-doctor/commit/f45cb297ef89320bfa0b8f5d52ecbfdb3ad3552c) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix a false-positive `deslop/unused-file` for a file imported only by a file in `ignore.files`. Ignored files are now kept in the dead-code dependency graph (only their reporting is suppressed), so a module reachable solely through an ignored file is no longer flagged as unused.

- [#851](https://github.com/millionco/react-doctor/pull/851) [`1e260c5`](https://github.com/millionco/react-doctor/commit/1e260c5d219391dbdf18e1cfd729dbc97b3806fb) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Show the "Add React Doctor to CI" and "install React Doctor" pitches once per repo instead of on every scan.

  The post-scan handoff re-asked the CI question on every run, and the agent install hint re-printed every run because its opt-out store was built but never written. Both now record a per-repo answer (reusing the existing once-per-repo `Conf` pattern) and stay quiet afterward — the first-run experience is unchanged, only the repetition stops.

  The agent copy-prompt no longer carries the CI marketing preamble at all. The interactive handoff prompt is now the single once-per-repo pitch, so the agent is never instructed to re-ask what the user was just asked — capable agents were flagging that preamble as social-engineering and it was eroding trust in the actual diagnostics.

- [#848](https://github.com/millionco/react-doctor/pull/848) [`431e515`](https://github.com/millionco/react-doctor/commit/431e515260a209088c2305c6372249009dd95474) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop a broken `eslint-plugin-react-hooks` install from sinking the whole lint pass, and fix the misleading error it produced (issue [#833](https://github.com/millionco/react-doctor/issues/833)).

  When the optional `react-hooks-js` (React Compiler) plugin can't be imported in the user's environment, oxlint fails the entire config load — which previously dropped every curated react-doctor diagnostic too and left the scan with `skippedChecks: ["lint"]` and zero results. The oxlint error is also multi-line, and the 200-char error preview truncated its plugin path mid-string (often right at `…/node_modules/`), so it read as react-doctor passing an invalid directory rather than a plugin that failed to load.

  - **Graceful degradation:** the oxlint runner now detects a `react-hooks-js` plugin-load failure and retries once with that plugin (and its compiler rules) dropped — mirroring the existing adopted-`extends` fallback. The curated react-doctor rules, dead-code, and environment checks all still run; only the React Compiler rules are skipped, surfaced as a clear `lint:partial` note that includes oxlint's real underlying reason.
  - **Readable error:** the unparseable-output preview grew from 200 to 600 chars so the full plugin path and the underlying `Error:` line survive instead of being cut at `…/node_modules/`.

- [#857](https://github.com/millionco/react-doctor/pull/857) [`17389ba`](https://github.com/millionco/react-doctor/commit/17389ba4feb07a54727100623b1b5a4ecc061e85) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Show a syntax-highlighted source snippet in `react-doctor why <file>:<line>`.

  The `buildCodeFrame` util already powers the source frames in the scan summary, but the `why` command (the single-location explain path) never called it — so explaining a diagnostic printed the rule, category, help, and suppression hint with no view of the offending code. It now renders the same code frame directly under the headline, with the caret on the offending column (or the whole line span for a multi-site diagnostic). When the file can't be read or the line is minified, it falls back to the existing text-only output.

- [#882](https://github.com/millionco/react-doctor/pull/882) [`a9d2713`](https://github.com/millionco/react-doctor/commit/a9d27134c4a5124b30f7a82f4ac3e4fd3339845c) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Group findings that a single fix resolves into one root-cause task.

  Several findings can share one fix — e.g. four `useEffect`s that reset state on the same prop change all clear with a single `key` prop. Those findings now carry a shared `fixGroupId` in the JSON report and the on-disk `diagnostics.json` dump, so a tool that turns findings into work items counts one fix as one task instead of N. The terminal labels such a group "One fix clears all N findings", and the agent handoff frames it as a single task ("one fix · N sites") and tells the agent to group by `fixGroupId`.

  Grouping is presentation-only and keyed on identical (file, rule, message) for an allowlist of rules where the same message means the same fix — the state-on-prop-change family today (`no-derived-state-effect`, `no-adjust-state-on-prop-change`, `no-reset-all-state-on-prop-change`, and the `no-derived-state` / `no-derived-useState` rules). The score is unchanged — it already de-weights repeated same-rule findings and never reads the new field. `fixGroupId` is an additive optional field, so existing JSON consumers are unaffected.

- [#859](https://github.com/millionco/react-doctor/pull/859) [`44db3e0`](https://github.com/millionco/react-doctor/commit/44db3e0546fe0518b79e0aa2636754dcccda2939) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Improve disable-directive handling for react-doctor rules:

  - `// react-doctor-disable-line` / `-next-line` (and `ignore.rules` / rule lookups) now accept a rule's bare short id, e.g. `no-eval` for `react-doctor/no-eval` — the unqualified form people reach for first.
  - When an `eslint-disable` / `oxlint-disable` directive names a react-doctor rule by an id oxlint can't bind to a plugin rule — a bare short id (`no-eval`) or a legacy plugin prefix (`react/jsx-key`), whether inline or as a file-level block disable — the diagnostic now carries a hint to use the full `react-doctor/<id>` key.

- [#884](https://github.com/millionco/react-doctor/pull/884) [`869f220`](https://github.com/millionco/react-doctor/commit/869f220d97c1c30cb3e0d6897833f9db372667bb) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Warn before mass-fixing a migration-scale bucket. When a single rule spans dozens of files (≥ `MIGRATION_SCALE_RULE_FILE_COUNT`, default 40), the report now prints a "Migration-scale change: sample before you sweep" advisory. It names the rule(s), explains the review risk, and points at `npx react-doctor@latest <path>` to scope the work down one area at a time.

  The same guidance reaches coding agents. A new "Agent guidance" line and an inline note on any migration-scale bucket in the agent handoff prompt tell the agent to fix a representative sample, confirm the recipe holds, and get the code owner's sign-off before changing the rest, instead of mass-fixing a broad pattern in one unreviewed pass.

  A new wide-event attribute (`migration.largestRuleBucketFiles`, plus `migration.largestRuleBucketSites` and `migration.largestRuleBucketRule`) records the widest-blast-radius rule per scan, so the threshold can be calibrated against real runs. No change to the score, exit code, or JSON report.

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

- [#744](https://github.com/millionco/react-doctor/pull/744) [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb) Thanks [@aidenybai](https://github.com/aidenybai)! - Remove the `--sfw` demo flag (the standalone Socket.dev supply-chain score listing that printed every direct dependency's score and exited).

  The Socket.dev supply-chain **check** is unaffected — it still runs during normal full scans (and on diff scans whose `package.json` changed) and its scores still appear in the JSON report. Only the standalone listing is gone, along with its demo-only internals (`collectSupplyChainScores`, the `DependencyScore` type, the monorepo-wide dependency collector, and the score-table renderer).

- Updated dependencies [[`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb), [`eacdcf2`](https://github.com/millionco/react-doctor/commit/eacdcf2e65d6755fc000c6e05d8b76a49440adfb)]:
  - oxlint-plugin-react-doctor@0.5.4

## 0.5.3

### Patch Changes

- [#804](https://github.com/millionco/react-doctor/pull/804) [`022790b`](https://github.com/millionco/react-doctor/commit/022790bf9e62a69a9649910edf5a07e1ee8c639d) Thanks [@NisargIO](https://github.com/NisargIO)! - Clearer Socket supply-chain diagnostics (`socket/low-supply-chain-score`). When Socket returns a concrete alert, the message now names it — e.g. a critical "known malware" alert, the offending file, and a one-line description — instead of only a bare score; when it doesn't (metric-driven dips like CVE-only scores), the message explains what the failing axis means. The help is now axis-aware: remove a package flagged as compromised, upgrade past known vulnerabilities (`npm audit`), or vet-and-raise the threshold — rather than a generic "update or replace". The headline leads with the exact failing axis and collapses the redundant "declared as X, scored at X" phrasing (a range now reads `pkg@floor (lowest version "^x.y.z" allows)`). JSON report shape is unchanged (`schemaVersion: 1`).

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.5.3

## 0.5.2

### Patch Changes

- [#767](https://github.com/millionco/react-doctor/pull/767) [`486c68f`](https://github.com/millionco/react-doctor/commit/486c68f655117819dc268f2b0715ed5b5bebce84) Thanks [@rayhanadev](https://github.com/rayhanadev)! - The GitHub Action's `blocking` input now defaults to `none` (advisory) instead of `error`. Every PR still gets the full React Doctor report — the sticky summary comment, inline review comments, and a commit status with the health score — but the check no longer fails on findings, so a brand-new install can't red-X a teammate's PR on day one (trust-before-gate). To turn the gate back on, set `blocking: warning` (fail on any finding) or `blocking: error` (fail on error-severity findings) on the action. The generated `react-doctor.yml` documents this inline.

  Note: this changes behavior for existing `millionco/react-doctor@v2` workflows that never set `blocking` — they were gating on error-severity findings and will now run advisory. Add `blocking: error` to the action's `with:` block to keep the previous behavior.

  The CLI / config default is unchanged: `react-doctor` (and `--blocking` / the `blocking` config key) still defaults to `error`, so local runs, pre-commit hooks, and non-action CI keep failing on error-severity findings.

- [#766](https://github.com/millionco/react-doctor/pull/766) [`94f9f4f`](https://github.com/millionco/react-doctor/commit/94f9f4fe98207181958f82275b41d94963bc73a2) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Bump `engines.node` to `^20.19.0 || >=22.13.0` so the declared support range matches transitive dependencies (`eslint-scope@9`, `eslint-visitor-keys@5` require `^22.13.0`), preventing EBADENGINE warnings on npm and hard install failures on Yarn 1 under Node 22.12.x.

- [#731](https://github.com/millionco/react-doctor/pull/731) [`1ca6f0e`](https://github.com/millionco/react-doctor/commit/1ca6f0ead3d69ddf4feababb54ddeea8d8c0d01d) Thanks [@aidenybai](https://github.com/aidenybai)! - Bundle Effect into the published CLI so `npx react-doctor@latest` no longer installs Effect's `ini@7` dependency and avoids the Node 22.19 engine warning.

- [#791](https://github.com/millionco/react-doctor/pull/791) [`22268f7`](https://github.com/millionco/react-doctor/commit/22268f70ac2a557dd6170fb582eb020c4e9d3cf0) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Cap the `oxlint` dependency to `>=1.66.0 <1.67.0`. oxlint 1.67.0 added an optional peer dependency on `vite-plus`, which in pnpm workspaces that install `vite-plus` at the root forces a second peer-resolution context for the Vite+ toolchain. That split installs a duplicate copy of the Vitest fork (`@voidzero-dev/vite-plus-test`), and test runs fail at collection with `Vitest failed to find the current suite` because hooks register in one copy while suites live in the other ([#699](https://github.com/millionco/react-doctor/issues/699)). Pinning below 1.67 keeps react-doctor's oxlint free of the `vite-plus` peer edge, so pnpm dedupes the toolchain back to a single instance.

- [#793](https://github.com/millionco/react-doctor/pull/793) [`9cc6555`](https://github.com/millionco/react-doctor/commit/9cc655591e85b90734f23a19f3181cbe1625fae8) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Carry the React Compiler bail-out reason in the primary diagnostic message. `react-hooks-js/*` diagnostics previously all rendered the same generic "This component misses React Compiler's automatic memoization…" message, with the specific reason relegated to `help`. The message now includes the first line of the compiler's reason (e.g. `useMemo() callbacks may not be async or generator functions`) so contexts that only show the message explain _why_ the compiler bailed; the reason's remaining lines stay in `help`, so the rendered message + suggestion never repeat the same sentence. `todo` diagnostics keep the generic message — their reasons are compiler-internal work notes, not user-facing copy. Because diagnostics dedupe on their full message, two _different_ bail-out reasons anchored at the same source location now survive as two diagnostics instead of collapsing into one, so counts can rise slightly on affected projects.

- [#800](https://github.com/millionco/react-doctor/pull/800) [`3de9106`](https://github.com/millionco/react-doctor/commit/3de910612de481a063ff19c6c7b2c62f0098411a) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Load `doctor.config.ts` files that import `defineConfig` from `react-doctor/api` even when the scanned repo has no installed node_modules (e.g. the GitHub Action runs the CLI via `npm exec` without installing the repo's dependencies). The config loader now retries the load with `react-doctor/api` aliased to the running package's own copy instead of silently falling back to default config.

- [#769](https://github.com/millionco/react-doctor/pull/769) [`2f26228`](https://github.com/millionco/react-doctor/commit/2f26228e36cfe64a430a41596d7b1053d6d7d307) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Consolidate the scan-scope controls into one `--scope` flag (and `scope` config option) with four values, shared verbatim by the CLI and the GitHub Action:

  - `full` (default) — the whole project, every issue. Whole-project checks (dead-code, environment, supply-chain) run only here.
  - `files` — only the files changed vs the base, with all issues in them (no compare-to-main). What `--staged` and an uncommitted `--diff` did.
  - `changed` — only issues the change introduced vs the base (the baseline delta). What `--diff <base>` and the action's `scope: changed` did.
  - `lines` — only issues on the lines the change actually touched. New: previously this scoping existed only inside the GitHub Action's inline-review-comment step; it now lives in the engine, so the CI gate, score display, summary, and inline comments all honor one scope.

  `--base <ref>` sets the comparison base for `files` / `changed` / `lines` (auto-detected when omitted). Behavior is unchanged by default: the CLI `--scope` defaults to `full` and the action `scope` input still defaults to `changed`. `--diff` / `config.diff` keep working as a deprecated alias (`--diff <base>` → `--scope changed --base <base>`, `--diff false` → `--scope full`) and emit a one-time deprecation warning; `--staged` is retained as the source selector and composes with `--scope files` / `--scope lines`.

- [#795](https://github.com/millionco/react-doctor/pull/795) [`04e72a4`](https://github.com/millionco/react-doctor/commit/04e72a4d563b792af09c15f069ce9d523a9c538c) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Diagnostics in test, spec, fixture, and Storybook files are now labeled with their file context. The terminal report and the per-rule text dumps tag those sites as `(test file)` / `(story file)` so a finding in a spec doesn't read as a production problem, and each diagnostic in the JSON report carries an optional `fileContext` field (`"test"` / `"story"`; omitted for production files). The classification reuses the same path heuristics that already drive test-noise auto-suppression, so the label and the suppression can never disagree.

- [#784](https://github.com/millionco/react-doctor/pull/784) [`038aaf7`](https://github.com/millionco/react-doctor/commit/038aaf78c12f7f9a2699f46d3a6aa304dc69fc12) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a false positive in `nextjs-missing-metadata` ([#775](https://github.com/millionco/react-doctor/issues/775)): an App Router page is no longer flagged as "missing metadata for search previews" when it inherits `metadata` / `generateMetadata` from a co-located or ancestor `layout.*`. Next.js merges metadata down the segment chain, so a page covered by a parent layout's title/description already has search-preview metadata. The rule now walks up the App Router directory tree (bounded, stopping at `app/`) and stays quiet when an ancestor layout supplies metadata; pages with no metadata anywhere in the chain are still flagged.

- [#768](https://github.com/millionco/react-doctor/pull/768) [`a64093c`](https://github.com/millionco/react-doctor/commit/a64093c8a14255dc2108d834d56f4d21b9d9ac60) Thanks [@rayhanadev](https://github.com/rayhanadev)! - CI onboarding now resolves the repository's actual default branch instead of assuming `main`. The pull request opened during setup asks GitHub (`gh repo view`) for the default branch — falling back to `origin/HEAD`, then `main`/`master` — and uses it as the PR base, and the installed workflow's push trigger scans that same branch (`master`, `develop`, …) so the health-score trend works on repos whose default branch isn't `main`.

- [#783](https://github.com/millionco/react-doctor/pull/783) [`a48fb06`](https://github.com/millionco/react-doctor/commit/a48fb06ffbe7221655e18529fcc954ecae17a22f) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Add a `--output-dir <dir>` flag that writes the full diagnostics dump (diagnostics.json + one .txt per rule) to a directory of your choice instead of a random temp folder, prints the written path whenever the flag is set (previously `--verbose`-only), and makes the agent handoff reuse that directory instead of writing a second temp copy. Without the flag, behavior is unchanged.

- [#792](https://github.com/millionco/react-doctor/pull/792) [`19d99ee`](https://github.com/millionco/react-doctor/commit/19d99eee1e91d1748fe7e80776fe3d5e6a1c59f2) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Title `react-hooks-js/todo` diagnostics "React Compiler doesn't support this syntax" instead of the generic "React Compiler can't optimize this" headline. The `todo` rule fires when the compiler bails out on syntax it doesn't handle yet, so the headline now says what actually happened.

- [#801](https://github.com/millionco/react-doctor/pull/801) [`0f91fa3`](https://github.com/millionco/react-doctor/commit/0f91fa36b8b26ef78f2fc64b5cba2ff2e3ba4e9b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Add `rn-no-metro-babel-runtime-version` — warns when a babel config uses `module:@react-native/babel-preset` without an `enableBabelRuntime` version. Without a version the preset can duplicate Babel runtime helpers across files instead of importing them once from `@babel/runtime`, increasing the JS bundle (facebook/react-native#57123). It fires as a `warning` (a bundle-size optimization, not a broken build, so it never blocks CI on the default React Native config), only when the preset is referenced as a real string literal (Expo's `babel-preset-expo` and comment mentions are unaffected), and treats `enableBabelRuntime: true`/`false` as still missing a version.

- [#790](https://github.com/millionco/react-doctor/pull/790) [`f52bd07`](https://github.com/millionco/react-doctor/commit/f52bd0737527df9ab81f3746e64bdb5ac1defbc7) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix false positives in `rn-no-raw-text` ([#788](https://github.com/millionco/react-doctor/issues/788)) for custom components that forward their children into a `<Text>`: the in-file wrapper detection now recognizes components that render `{children}` (or `{props.children}`) inside a nested `<Text>` (the `<View><Text>{children}</Text></View>` shape), not just components whose returned root is a `<Text>`. Detection also handles parenthesized `return (...)` bodies, `memo`/`forwardRef`-wrapped components, fragment roots, conditional and logical returns, early returns inside `if` branches, renamed destructured children (`{ children: content }`), the `<Text children={children} />` prop form, wrappers that forward through another in-file wrapper, children aliased to a variable or destructured from props in the body, props spreads that carry children (`<Text {...props} />`, `<Text {...rest} />`, `<Text {...this.props} />`), class components, and `styled(Text)` / `styled.Text` factories. The rule is also tagged `test-noise`, so it no longer fires in test/story files — raw text rendered through React Native Testing Library never ships to users, and cross-file wrappers (an imported `<Chip>Test Chip</Chip>` in a `.test.tsx`) were the main source of unfixable noise there.

- [#780](https://github.com/millionco/react-doctor/pull/780) [`f5f539a`](https://github.com/millionco/react-doctor/commit/f5f539a1a3c6609136808a0d0e091669d8443584) Thanks [@rayhanadev](https://github.com/rayhanadev)! - The Socket supply-chain check now gates on the security axes (supply chain, vulnerability) instead of Socket's `overall` score, and the diagnostic names the exact axis that failed. Socket's `overall` is its lowest axis, so a package with perfect security scores could fail the Security gate purely on quality/maintenance — `@types/bun` was reported as having a "supply-chain score of 48" while socket.dev showed Supply Chain 100 (issue [#770](https://github.com/millionco/react-doctor/issues/770)). Known-bad packages (`event-stream@3.3.6`, vulnerable `minimist`/`lodash` releases) are still flagged via their vulnerability axis, and the reported number now always matches the axis named on the socket.dev package page.

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

- [#747](https://github.com/millionco/react-doctor/pull/747) [`a254414`](https://github.com/millionco/react-doctor/commit/a2544146668e8cbaa77d0d846eb252acf083a0ba) Thanks [@NisargIO](https://github.com/NisargIO)! - Add a `--sfw` demo flag that prints the Socket.dev supply-chain score (0–100) of every direct dependency — across every workspace `package.json` in a monorepo, de-duplicated by `name@version` — color-coded and sorted worst-first, then exits without running a scan. Scores come from Socket's free, keyless PURL endpoint (the same one the supply-chain check uses).

- [#747](https://github.com/millionco/react-doctor/pull/747) [`a254414`](https://github.com/millionco/react-doctor/commit/a2544146668e8cbaa77d0d846eb252acf083a0ba) Thanks [@NisargIO](https://github.com/NisargIO)! - Add a Socket.dev supply-chain score check. Every direct dependency in `package.json` is scored against Socket's free, keyless PURL endpoint (the same lookup Socket Firewall's free tier uses) and any dependency whose Socket score falls below `supplyChain.minScore` (default `50`, 0–100 scale) produces a `Security` diagnostic anchored at the offending `package.json` entry. At the default `severity: "error"` a low score fails the scan at the standard `blocking` gate.

  The check runs by default; opt out with `supplyChain: { enabled: false }`. It is fail-open (per-package timeouts / network failures are skipped, never sinking the scan). A plain `--diff` / `--staged` scan skips it like the other whole-project checks, but a diff that edits a `package.json` (including any workspace's in a monorepo) still scores that project's dependencies — so a PR that adds or bumps a dependency is covered. `next` is excluded (its framework-specific risks are already covered by the Next.js / server-components rules).

### Patch Changes

- [#739](https://github.com/millionco/react-doctor/pull/739) [`829655c`](https://github.com/millionco/react-doctor/commit/829655c4049342fc0b967e8c60c865f1586875a4) Thanks [@NisargIO](https://github.com/NisargIO)! - CI setup: collapsed the multi-line inline comments in the generated `.github/workflows/react-doctor.yml` to a single explanatory sentence per trigger and one line for the concurrency block, and dropped the permissions comment (the four well-named keys are self-explanatory). The resulting workflow still configures the same triggers, permissions, and action ref — just with less scrolling for new users.

- [#729](https://github.com/millionco/react-doctor/pull/729) [`25cc69b`](https://github.com/millionco/react-doctor/commit/25cc69bd8fb64d395d33562439e8f50660f9b7b2) Thanks [@aidenybai](https://github.com/aidenybai)! - Fold the standalone `doctor-explain` skill into the `react-doctor` skill as `references/explain.md`.

  Rule-explanation and config-tuning guidance now ships as an on-demand reference inside the primary skill (per the agentskills.io `references/` convention) instead of a separate sibling skill. `react-doctor install` installs a single skill, and the dead bundled-sibling-skill install machinery is removed.

- [#752](https://github.com/millionco/react-doctor/pull/752) [`5b06a86`](https://github.com/millionco/react-doctor/commit/5b06a865faf1cb02acbd9492eeaa9abe92336aa7) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Name every unused dependency in the verbose warning tail.

  Unused-dependency warnings all report at the same line-less location (`package.json:0`), so the dim location header collapsed every finding into one line and dropped the package names — leaving only a generic `deslop/unused-dependency ×N` line ([#690](https://github.com/millionco/react-doctor/issues/690)). `react-doctor --verbose` now lists each `deslop/unused-dependency` and `deslop/unused-dev-dependency` by name, with the shared "why" explanation shown once instead of repeated per package. Errors and code-frame rendering are unchanged.

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

## 0.4.1

### Patch Changes

- [#711](https://github.com/millionco/react-doctor/pull/711) [`36ecd05`](https://github.com/millionco/react-doctor/commit/36ecd053cfe22e16678ac2ff307e015b6f9a2859) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix false positive in `require-reduced-motion`: the check now searches untracked files so newly created source (e.g. a `providers.tsx` with `<MotionConfig reducedMotion="user">` not yet committed) is detected.

- [#706](https://github.com/millionco/react-doctor/pull/706) [`15bd9d8`](https://github.com/millionco/react-doctor/commit/15bd9d861703c6d3b0e2fd8ffad82b7b6a922b00) Thanks [@rayhanadev](https://github.com/rayhanadev)! - CI setup now offers a one-time, per-repo prompt to upgrade an existing React Doctor GitHub Actions workflow from `@v1` to `@v2` — accepting opens a PR with the bump, declining is remembered so it never asks again. The generated / "Add to CI" workflow now pins `millionco/react-doctor@v2` and grants `statuses: write`, so the action can publish the score as a commit status (and surface results on pushes to the default branch).

- Updated dependencies [[`dc35070`](https://github.com/millionco/react-doctor/commit/dc35070a5066f9864a7565b952dec2f81bff1223), [`b1a22ef`](https://github.com/millionco/react-doctor/commit/b1a22efdf7b18f2cc8b7af6c0b12173ed3c76d34), [`73dcb20`](https://github.com/millionco/react-doctor/commit/73dcb2040dc6aa207beea074f846fd675c30bd2b), [`64667da`](https://github.com/millionco/react-doctor/commit/64667dae16b812ad9b4304bd7906d5ddbb50921a), [`ee9ab33`](https://github.com/millionco/react-doctor/commit/ee9ab336d3b2918d319bc048b5b164f58611df83), [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b), [`831cf3f`](https://github.com/millionco/react-doctor/commit/831cf3fbfd703f5048de5c2c3258e47988a2cce0)]:
  - oxlint-plugin-react-doctor@0.4.1

## 0.4.0

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

- [#681](https://github.com/millionco/react-doctor/pull/681) [`915745e`](https://github.com/millionco/react-doctor/commit/915745ef7b88730e153d93bf52ce48bce2806495) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add `react-doctor experimental-lsp`, an experimental language server that surfaces React Doctor diagnostics directly in your editor — VS Code, Cursor, Zed, Neovim, Sublime Text, Emacs, Helix, or any LSP client. It is gated behind the `experimental-` prefix while its protocol, caching, and diagnostics stabilize. It scans the file you are editing live from the unsaved buffer, underlines the exact offending token via precise ranges, shows rich hovers (rule, category, recommendation, docs link), and offers quick fixes (disable-for-this-line with the correct comment style, suppress-all-in-file, explain, open docs, report false positive). It discovers every React project across workspace folders and monorepo packages, runs offline (no score lookup, no git), prioritizes open-buffer scans, supports push and pull diagnostics, and invalidates caches when config / package.json / lockfiles change. The background workspace scan is chunked so diagnostics stream in progressively (seconds to first results on large repos), parallelizes across all CPU cores, reserves a slot so edits stay responsive while it runs, and cancels in-flight work when config changes. Results are cached per file (by content metadata, invalidated on config change) and persisted to disk, so re-opening the editor or re-scanning surfaces diagnostics almost instantly — on an ~8,800-file repo a cold scan is ~27s and a warm scan ~2s.

  Start it with `react-doctor experimental-lsp --stdio` (or `npx react-doctor@latest experimental-lsp --stdio`). A `scanOnType` initialization option toggles live-as-you-type scanning, with first-class companion extensions for VS Code/Cursor and Zed.

  Like the CLI, the language server reports anonymized usage analytics to Sentry — a per-workspace-scan wide event plus session/scan counters — sharing the CLI's IP-stripping and path/secret scrubbing. Opt out with `REACT_DOCTOR_NO_TELEMETRY=1` (or by launching it with `--no-telemetry`).

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.0

## 0.3.0

### Minor Changes

- [#658](https://github.com/millionco/react-doctor/pull/658) [`cbdff62`](https://github.com/millionco/react-doctor/commit/cbdff6203d8ebb95adeea2c875938a6d811259bd) Thanks [@aidenybai](https://github.com/aidenybai)! - Add an "Add to CI" path to the post-scan handoff and make `install` set up CI by default.

  The post-scan prompt now leads with an "Add to CI" choice (the default) that installs the `react-doctor` dev dependency + `doctor` script and writes a `.github/workflows/react-doctor.yml` GitHub Actions workflow so every pull request is scanned. When you instead hand off to an agent, the generated prompt now asks the agent to offer CI setup first. The `install` subcommand pre-selects the workflow and `install --yes` now writes it by default. The workflow's action is pinned to the `@v1` floating major (never `@main`, per the supply-chain guidance in issue [#299](https://github.com/millionco/react-doctor/issues/299)).

### Patch Changes

- [#676](https://github.com/millionco/react-doctor/pull/676) [`08e1d55`](https://github.com/millionco/react-doctor/commit/08e1d55da45d8b4afae1861484b2366743871e31) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - `react-doctor --full --yes` no longer errors with "Cannot combine --yes and --full; pick one."

  `--yes` (skip prompts, scan all workspace projects) and `--full` (force a full scan, overriding any `diff` value) control orthogonal concerns, so combining them is a valid request — "scan every workspace project fully, without prompting." The mutual-exclusion check that rejected the pair has been removed.

- [#674](https://github.com/millionco/react-doctor/pull/674) [`6851a78`](https://github.com/millionco/react-doctor/commit/6851a786e57e875fe4e9afbbd239397e99bf854b) Thanks [@aidenybai](https://github.com/aidenybai)! - Bump bundled `deslop-js` to `^0.0.17`, which stops `deslop/unused-dev-dependency` from false-positiving on dependencies referenced in a `package.json` script as a flag argument rather than the leading command — e.g. `jest --testResultsProcessor jest-sonar-reporter` or `--reporters=jest-junit` ([#653](https://github.com/millionco/react-doctor/issues/653)).

- [#668](https://github.com/millionco/react-doctor/pull/668) [`3c05fc4`](https://github.com/millionco/react-doctor/commit/3c05fc4d63993055469e8c8a18f151ba95a3a36e) Thanks [@aidenybai](https://github.com/aidenybai)! - Update the dead-code analysis engine (`deslop-js`) to `0.0.16`.

- [#655](https://github.com/millionco/react-doctor/pull/655) [`d594f69`](https://github.com/millionco/react-doctor/commit/d594f69f26efaab9b2d0a78140ff97a3ff497ab0) Thanks [@rayhanadev](https://github.com/rayhanadev)! - react-doctor no longer crashes when the `--changed-files-from` file can't be read.

  `--changed-files-from <file>` is user input, so an unreadable file — missing, a directory, permission-denied, or a stale pipe/process-substitution descriptor (`EBADF`, REACT-DOCTOR-V) — is an invocation mistake, not a bug. It now exits non-zero with a clean, single-line message telling you to pass a readable text file, instead of printing the generic "Something went wrong" block and reporting the read failure to Sentry.

- [#660](https://github.com/millionco/react-doctor/pull/660) [`e3b106e`](https://github.com/millionco/react-doctor/commit/e3b106e19156ddc508b92c80776237e3ebce1453) Thanks [@rayhanadev](https://github.com/rayhanadev)! - react-doctor now records a single anonymized per-scan "wide event" on its Sentry run span — the full run/CI/project/outcome context (scan mode, score, diagnostics by severity and category, top rule, lint/dead-code state, and, in CI, the GitHub event, an official-action marker, the forwarded action inputs, and the pull-request gate) — so usage and CI behavior can be analyzed by querying spans instead of pre-aggregated counters.

  It also mints a random per-run `runId` attached to the Sentry run context (never as a tag or metric dimension) to correlate the spans of a single run. Telemetry stays anonymized — no repo, owner, username, branch, or path is sent to Sentry — and `--no-score` / `--no-telemetry` still opts out entirely. The official GitHub Action forwards its inputs (fail-on, non-blocking, comment, annotations, version) so action configuration is visible in telemetry.

- [#658](https://github.com/millionco/react-doctor/pull/658) [`cbdff62`](https://github.com/millionco/react-doctor/commit/cbdff6203d8ebb95adeea2c875938a6d811259bd) Thanks [@aidenybai](https://github.com/aidenybai)! - Polished the first-run onboarding experience — the animated welcome scene now plays on every interactive regular-mode run (not just the first) but at half the cadence for returning users (`hasCompletedOnboarding()`), `--verbose` skips the intro entirely and goes straight to the static branded header, and the closing `"Let's scan your codebase..."` typewriter beat was cut so the intro ends on the tagline.

  Restructured the scan-report layout so the top-errors detail (code frames + fixes) leads the report and the per-category breakdown moves down as a wrap-up overview directly above the score. The breakdown now has its own bold `All N issues` header (mirroring `Top N errors you should fix`) with the total folded into the header text, categories sort in a fixed Security → Bugs → Performance → Accessibility → Maintainability order, and warnings no longer get boxed code frames in `--verbose` (errors still do) so a long warning tail stops drowning the report. The trailing `--verbose` CTA drops the redundant `+N more rules and +N optional warnings` stats (the breakdown above already carries those) and reads as a clean `Run npx react-doctor@latest --verbose to list every error and warning`.

  Quieted the "Add to CI" handoff: it no longer runs the local dev-dep install (the `doctor` package script and the GitHub workflow both invoke `npx react-doctor@latest`, so a local copy adds nothing and on pnpm with a beta channel it noisily trips the supply-chain trust guard for zero user benefit). The trust-policy skip on the `react-doctor install` path now renders as a yellow `⚠` warning with a tightened one-liner and a dim follow-up showing the manual install command, instead of a red `✖` that read like a crash next to its own "React Doctor still works" reassurance.

  Made the case for GitHub Actions before the handoff prompt instead of after it. The scan-report footer now closes with a `GitHub Actions: https://react.doctor/ci` entry (matching the `Share` / `Docs` / `GitHub` bold label + dim description shape) carrying the strongest reasons in two short lines: `Scan every pull request: new PRs stay clean while you fix the backlog` + `Used by teams at PayPal, Rippling, and Alibaba`. Sitting last in the footer makes it the final thing read before the handoff prompt that recommends the same action. The prompt's choice reads as `Add to GitHub Actions (recommended)` (or `(already configured)`) with a description of what gets set up; the state tag lives in the title so the description always describes what the option _does_, not the project's current state. The post-pick message drops the social-proof + backlog framing (now redundant — the footer already showed it) and just confirms what changed plus the docs link.

- [#667](https://github.com/millionco/react-doctor/pull/667) [`4dc48d7`](https://github.com/millionco/react-doctor/commit/4dc48d7bc5dbb5ba46cd63e5bd20082485630f97) Thanks [@aidenybai](https://github.com/aidenybai)! - React Compiler projects no longer report `jsx-no-constructed-context-values` for fresh context provider values that the compiler memoizes automatically.

- [#654](https://github.com/millionco/react-doctor/pull/654) [`eab6dc2`](https://github.com/millionco/react-doctor/commit/eab6dc27477998c31bfa6fc100c50b33af449795) Thanks [@rayhanadev](https://github.com/rayhanadev)! - react-doctor no longer crashes when a directory can't be enumerated during project discovery.

  The recursive subproject crawl reads directories best-effort and already skipped ones it couldn't open for permission or missing-path reasons (`EACCES`/`EPERM`/`ENOENT`/`ENOTDIR`). It now also skips directories the underlying filesystem rejects outright — `EINVAL` on `scandir` (REACT-DOCTOR-N, seen on special/virtual mounts), plus symlink loops (`ELOOP`) and over-long paths (`ENAMETOOLONG`) — instead of throwing and reporting the environment issue to Sentry. The crawl continues past the unreadable directory.

- [#666](https://github.com/millionco/react-doctor/pull/666) [`5d7b36b`](https://github.com/millionco/react-doctor/commit/5d7b36bc315ba4c0a8ba6b60bd781a11efbed94f) Thanks [@aidenybai](https://github.com/aidenybai)! - Retires `rn-animate-layout-property`. Reanimated `useAnimatedStyle` runs entirely on the UI thread, so layout-affecting style animations driven by helpers like `withTiming` or `withSpring` are valid and should not be flagged.

- [#645](https://github.com/millionco/react-doctor/pull/645) [`4aadaab`](https://github.com/millionco/react-doctor/commit/4aadaabfd488055a4323cc8b7f816c75601e40f1) Thanks [@aidenybai](https://github.com/aidenybai)! - Two React Native rules no longer false-positive on Expo Universal UI (`@expo/ui`).

  `@expo/ui` is a native UI layer (it delegates to SwiftUI / Jetpack Compose), not React Native's core primitives, so several RN-core assumptions don't hold for its components:

  - **`rn-no-raw-text`**: Universal UI's `<ListItem>` renders its raw string children inside the native headline text area, and its compound slot markers (`<ListItem.Leading>`, `<ListItem.Supporting>`, `<ListItem.Trailing>`) forward strings into native text too — so raw text inside them is safe, unlike React Native's core `<View>`. The rule now recognizes them as text-handling.
  - **`rn-no-scrollview-mapped-list`**: Universal UI's `<ScrollView>` is a native scroll container; React Native's virtualized lists (`FlashList`/`FlatList`) can't compose inside its `<Host>` tree, and `@expo/ui` ships its own virtualized `<List>`. The rule no longer flags mapped children inside an `@expo/ui` `ScrollView`.

  Both checks are gated on the `@expo/ui` import (root, `@expo/ui/swift-ui`, or `@expo/ui/jetpack-compose`, including renamed and namespace imports), so same-named components from other libraries — or with no import — still report.

- [#672](https://github.com/millionco/react-doctor/pull/672) [`8e7fb33`](https://github.com/millionco/react-doctor/commit/8e7fb3366fc4b56a60bceb97195309f782c51541) Thanks [@aidenybai](https://github.com/aidenybai)! - `prefer-module-scope-static-value` ("Static value rebuilt every render") is now disabled when React Compiler is enabled.

  React Compiler already hoists and caches per-render array/object allocations, so both halves of the recommendation — avoid the re-allocation and preserve referential equality for memoized children — are handled automatically, making the warning pure noise on a compiler-enabled codebase ([#669](https://github.com/millionco/react-doctor/issues/669)). The rule now carries `disabledBy: ["react-compiler"]`, matching the `jsx-no-new-*-as-prop` rules that gate on the same capability.

- [#650](https://github.com/millionco/react-doctor/pull/650) [`3cc9971`](https://github.com/millionco/react-doctor/commit/3cc997108be438d0fc13b00529159c88984ed36a) Thanks [@rayhanadev](https://github.com/rayhanadev)! - A terminal hangup during an interactive prompt no longer crashes the CLI. When the terminal/PTY backing a prompt goes away mid-read (closing the tab, a dropped SSH/tmux session, sleep/wake), Node raises `read EIO` on the raw-mode stdin handle; the CLI now exits cleanly (code 129) instead of surfacing it as a fatal uncaught exception and reporting it to crash telemetry. Genuine stdin errors still funnel to the error reporter unchanged.

- [#673](https://github.com/millionco/react-doctor/pull/673) [`68a0bef`](https://github.com/millionco/react-doctor/commit/68a0befa1a688d591ddeeefe03b334c515654942) Thanks [@aidenybai](https://github.com/aidenybai)! - `no-wide-letter-spacing` no longer false-positives on uppercase labels styled through a wrapper component prop.

  The rule exempts wide tracking on uppercase text, but it could only see `textTransform: 'uppercase'` written inline in the same style object. Design-system text components routinely apply the transform from a prop instead (`<SSText uppercase style={{ letterSpacing: 2 }}>`), which the rule can't see inside the component ([#671](https://github.com/millionco/react-doctor/issues/671)). It now also treats a sibling `uppercase` boolean prop or a `textTransform="uppercase"` prop on the same element as the uppercase signal, so those short labels stay quiet.

- Updated dependencies [[`eba20ae`](https://github.com/millionco/react-doctor/commit/eba20ae9a708af81c7d95dbdadf16c8e5c6d21f9), [`5d7b36b`](https://github.com/millionco/react-doctor/commit/5d7b36bc315ba4c0a8ba6b60bd781a11efbed94f)]:
  - oxlint-plugin-react-doctor@0.3.0

## 0.2.18

### Patch Changes

- [#640](https://github.com/millionco/react-doctor/pull/640) [`b336f54`](https://github.com/millionco/react-doctor/commit/b336f54d664bf49e0c7b9575b7dcd374eebfd9c6) Thanks [@aidenybai](https://github.com/aidenybai)! - The interactive category breakdown now reveals issues one at a time — a category's errors before its warnings, top to bottom — instead of every count easing up in parallel, holds for a beat once it settles, and finally plays on monorepo (multi-project) scans too.

  Previously the count-up only animated on single-project scans; the multi-project aggregate report rendered the breakdown (and the score projection) statically. Both now share the same interactive reveal, gated on the same real-TTY predicate, so a monorepo's report animates like a single project's. Small and medium breakdowns step one issue per frame; very large ones grow the per-step increment so the reveal still resolves quickly.

- [#643](https://github.com/millionco/react-doctor/pull/643) [`0c8b797`](https://github.com/millionco/react-doctor/commit/0c8b797d18d7d8d0b347fbea0da111b38075eb5d) Thanks [@rayhanadev](https://github.com/rayhanadev)! - react-doctor no longer crashes when `git` isn't installed.

  During a normal scan, diff auto-detection reads the current branch first. When the `git` binary couldn't be spawned (e.g. a bare container with no git on `PATH`), that best-effort read threw instead of degrading, crashing the scan and reporting an environment issue to Sentry (REACT-DOCTOR-F). It now degrades to "unknown branch" — matching how a non-zero `git` exit was already handled — so the scan continues without git context.

- [#642](https://github.com/millionco/react-doctor/pull/642) [`2aa96f3`](https://github.com/millionco/react-doctor/commit/2aa96f39b56555722b7121569a5bbd9caa10dc44) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Expected, user-actionable failures are no longer reported to Sentry or rendered as crashes.

  When react-doctor exits because of the user's project or invocation — not a bug — it now prints a clean, single-line message and exits non-zero, instead of the generic "Something went wrong, open a prefilled issue" block. These cases are also no longer sent to Sentry or counted in the alertable error-rate metric. This was flooding crash reporting with non-bugs from CI, coding agents, and sandboxes.

  Covered cases:

  - **No React / no project / missing path** — every project-discovery failure (`NoReactDependencyError`, `ProjectNotFoundError`, `PackageJsonNotFoundError`, `NotADirectoryError`, `AmbiguousProjectError`) is now treated as a clean user error (REACT-DOCTOR-1, -4, -6, -7). When the scan target simply doesn't exist on disk, the message now says the path doesn't exist instead of the misleading "Expected a package.json…" guidance.
  - **CLI invocation mistakes** — a malformed `<file>:<line>` argument, mutually exclusive flags (e.g. `--yes` + `--full`), and an unknown `--project` name now render as clean errors (REACT-DOCTOR-B, -D, -G, -H).
  - **Read-only config directory** — react-doctor no longer crashes when it can't create/read its global setup-prompt store on a locked-down or read-only filesystem; it degrades gracefully (REACT-DOCTOR-E).

  The fix is enforced centrally in `reportErrorToSentry`, so the CLI entry point, `inspect`, and `install` all benefit.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.18

## 0.2.17

### Patch Changes

- [#638](https://github.com/millionco/react-doctor/pull/638) [`114893e`](https://github.com/millionco/react-doctor/commit/114893e07d83d143aa3cdddc9fb178137b786f47) Thanks [@aidenybai](https://github.com/aidenybai)! - Redesigned the interactive scan report and added a first-run onboarding reveal.

  The default single-project report now reads top-to-bottom the way a human scans it: the category tally, then the score box (with the total issue count inline on the score line, e.g. `7 / 100 Critical   295 issues`), the projection, the top fixes one by one, the warning roll-up, a single merged `+N more errors and +N more warnings` overflow line, and finally Share / Docs / Tip. The per-section `+N more rules` lines, the `N warnings` sub-header, and the `Top N errors you should fix` header were removed for a cleaner read. CI, coding-agent, git-hook, and verbose runs keep the classic information-dense layout (diagnostics first, then agent guidance and score).

  On a user's first interactive run it plays as an onboarding sequence: a happy React Doctor "welcome" scene opens, the scan runs, the category tallies count up from zero in parallel, and then each section — and each of the top errors — reveals on an ~850ms beat (quickening to ~680ms once the score lands) instead of a wall of text. It runs only once (a marker persisted in the global config records that it was shown), and is skipped entirely in CI, under coding agents, and on any non-TTY / score-only / JSON run.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.17

## 0.2.16

### Patch Changes

- [#637](https://github.com/millionco/react-doctor/pull/637) [`8162bfb`](https://github.com/millionco/react-doctor/commit/8162bfb7ca0948b137dd75a22776e55cab99b740) Thanks [@aidenybai](https://github.com/aidenybai)! - Redesign the scan output's summary and footer. The default (non-verbose) run no longer lists every warning rule — warnings are rolled into a single overflow line alongside the hidden errors (e.g. `+4 more rules and +50 optional warnings — run npx react-doctor@latest --verbose for details`). `--verbose` now renders warnings in the same boxed, titled, code-framed format as errors (with a "Learn more" docs link), instead of a separate compact list. The closing footer is restructured into a `Share:` / `Docs:` / `GitHub:` block (each with a one-line description) separated by a divider, and the share link now appears for monorepo runs too (gated the same way as single-project: shown unless CI, `--no-score`, or `share: false`). The scan spinner's worker count now reads as a dimmed `[~N workers]`.

- [#633](https://github.com/millionco/react-doctor/pull/633) [`520b0a9`](https://github.com/millionco/react-doctor/commit/520b0a9235d37074821c12fd73455d8462128a75) Thanks [@rayhanadev](https://github.com/rayhanadev)! - `--diff` now accepts git commit ranges, and a bad `--diff` value is no longer treated as a crash.

  - `--diff A..B` (two-dot, diff A directly against B) and `--diff A...B` (three-dot, diff from the merge-base of A and B to B) are now supported, matching git's own range syntax — an empty endpoint defaults to `HEAD` (`main..` ⇒ `main..HEAD`). Previously any value containing `..` was rejected outright, so `react-doctor --diff 7694215..c4de712` failed. Each range endpoint is still individually validated against the anti-injection guard, so a range can't smuggle a `--upload-pack=…`-style option past it.
  - An invalid `--diff` value (a malformed ref/range or a base branch that hasn't been fetched) is now rendered as a clean, single-line message and exits non-zero — it no longer prints the generic "Something went wrong, open a prefilled issue" block or reports the expected user error to Sentry.

- [#635](https://github.com/millionco/react-doctor/pull/635) [`bd8298d`](https://github.com/millionco/react-doctor/commit/bd8298d6cf3484ef7f2898fe981442706ffea3ce) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Lint in parallel by default. React Doctor now fans the lint pass across your CPU cores out of the box (previously serial) and automatically falls back to a single worker if a parallel run exhausts system resources (`EAGAIN`/`EMFILE`/`ENFILE`/`ENOMEM`); any other failure still surfaces. Pass `--no-parallel` (or set `REACT_DOCTOR_PARALLEL=0`) to force serial linting, or set `REACT_DOCTOR_PARALLEL=<n>` to pin a worker count. The experimental `--experimental-parallel` flag is replaced by `--no-parallel`.

- [#634](https://github.com/millionco/react-doctor/pull/634) [`17e722e`](https://github.com/millionco/react-doctor/commit/17e722ee074d10a5c4082b9f0a6b40ccaf3bed3b) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add anonymized Sentry Application Metrics (counters + distributions) to the CLI, alongside the existing crash reporting and tracing, so we can track reliability/performance and prioritize work.

  - **Counters & distributions**: each run records `cli.invoked` (per command), `scan.completed`, `scan.duration`/`scan.files`/`scan.score`, `project.detected` (anonymous project shape), `rule.fired` (a per-rule counter keyed by `rule`/`plugin`/`category`/`severity`, so we can see which rules actually catch issues, which are noisy, and which never fire), `lint.failed`/`deadcode.failed`/`scan.check_skipped`/`score.unavailable`, `cli.error`, plus growth/activation signals on `install` (which coding agents, git hook, CI workflow, agent hooks, dependency outcome), the agent-handoff fix loop (`agent.handoff`), and `rules` config changes (`rules.changed`/`rules.queried`).
  - **Trace-connected & enabled by default**: metrics use `Sentry.metrics.*` (SDK ≥ 10.25), flow independently of `SENTRY_TRACES_SAMPLE_RATE`, and carry the run snapshot + project shape (rebuilt per emit, mirroring the per-event run tags).
  - **Anonymized by default**: a `beforeSendMetric` hook drops the `server.address` hostname attribute and scrubs home-directory paths + known secrets from attribute values via the same redactor used for events, dropping the metric on failure. Attributes are enums/booleans/counts/rule names only — no source code or specific findings.
  - **Opt-out unchanged**: `--no-score` (and its `--no-telemetry` alias) disables metrics along with crash reporting and tracing; metrics are skipped under test runs, and the programmatic `@react-doctor/api` library never initializes Sentry.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.16

## 0.2.15

### Patch Changes

- [#612](https://github.com/millionco/react-doctor/pull/612) [`3ceb748`](https://github.com/millionco/react-doctor/commit/3ceb7480c1f1b61a45a728274940f9e3de74a462) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop flagging known public client keys in `no-secrets-in-client-code`. Keys that vendors design to ship in the browser bundle — RevenueCat public SDK keys (`appl_`/`goog_`/`amzn_`/`strp_`), Stripe/Clerk publishable keys (`pk_live_`/`pk_test_`), Supabase publishable keys (`sb_publishable_`), PostHog project keys (`phc_`), Stytch public tokens (`public-token-`), and Mapbox public access tokens (`pk.`) — are now allowlisted, so the variable-name heuristic no longer reports them as hardcoded secrets. Ambiguous shapes that can be either public or sensitive (Google/Firebase `AIza…` browser keys, and bare Supabase `anon`/`service_role` JWTs) are intentionally still flagged.

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Diagnostic ranking now depends solely on the score API's per-rule priority. The hand-rolled severity/category-stakes weighting (and the offline priority midpoints) is gone: when the API priority is unavailable (`--no-score`, offline, or API failure) rules and categories keep their scan order, with categories falling back to alphabetical for determinism.

- [#619](https://github.com/millionco/react-doctor/pull/619) [`b3c3aa9`](https://github.com/millionco/react-doctor/commit/b3c3aa94018bfde765431f6a5612435c621eb925) Thanks [@aidenybai](https://github.com/aidenybai)! - Treat `CI=1` and `CI=True` as CI environments, not just `CI=true`. CI-only behavior (suppressing the share URL, marking the run as CI-originated for scoring) now triggers consistently across providers that set `CI` to a truthy value other than the literal string `"true"`; explicit `CI=false` / `CI=0` are still treated as non-CI.

  A present-but-unparseable `react-doctor.config.json` at the scanned root no longer silently falls through to a parent directory's config. The tool stops there instead of letting an ancestor repo's config govern the project; a `package.json` `reactDoctor` config in the same directory is still used as a fallback.

- [#605](https://github.com/millionco/react-doctor/pull/605) [`4861f37`](https://github.com/millionco/react-doctor/commit/4861f37a55eb12909c7faca170ec5c9fd636f9a9) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Update the dead-code analysis engine (`deslop-js`) to `0.0.14` so the published CLI's unused-file / dead-code detection runs on the latest release. The CLI previously pinned `^0.0.13` while the internal core engine was already on `0.0.14`; this aligns both on a single version and drops the duplicate from the lockfile.

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Collapse diagnostic categories into five clear, outcome-based buckets: **Security**, **Bugs**, **Performance**, **Accessibility**, and **Maintainability**. The previous fine-grained labels (Correctness, State & Effects, React Compiler, Next.js, React Native, Server, TanStack Query/Start, Preact → Bugs; Bundle Size → Performance; Architecture/Design → Maintainability) now roll up so the scan output reads as plain issue types at a glance.

  This changes the `category` value on every diagnostic (CLI output, the per-error headline prefix like `Security: Use of eval()`, and JSON/programmatic output). If you key `categories` severity overrides off the old names, update them to the new buckets. Dead-code findings (unused files/exports/dependencies, circular imports) now report `Maintainability` instead of `Dead Code`. Bundle-size findings now sort with `Performance` (higher stakes) rather than near the bottom of the top-errors block.

- [#623](https://github.com/millionco/react-doctor/pull/623) [`b9e9bcb`](https://github.com/millionco/react-doctor/commit/b9e9bcbc08985f4bd77df1f354713d2cdbdaf2ec) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Align the CLI with the clig.dev and 12-factor CLI guidelines:

  - `--color` / `--no-color` flags force or disable colored output, with app-specific `REACT_DOCTOR_NO_COLOR` / `REACT_DOCTOR_FORCE_COLOR` env overrides. Flags win over env vars, which win over picocolors' built-in `NO_COLOR` / `FORCE_COLOR` / `TERM` / TTY detection; the preference is resolved before parsing so it reaches every surface (scan report, branded header, score, prompts, errors).
  - `react-doctor --help` and `react-doctor install --help` now lead with worked examples and link to where to report feedback.
  - New `react-doctor version` subcommand prints the version with Node and platform info (e.g. `react-doctor/0.2.14 darwin-arm64 node-v24.14.0`); `-v` / `-V` / `--version` stay terse for scripts.
  - `react-doctor help` and `react-doctor help <command>` now show help instead of failing by trying to scan a directory named "help".

- [#583](https://github.com/millionco/react-doctor/pull/583) [`4bc8a73`](https://github.com/millionco/react-doctor/commit/4bc8a73d247d9b8378616e738780af3794f0b97f) Thanks [@aidenybai](https://github.com/aidenybai)! - Port expo-doctor's project-level checks as Expo-gated diagnostics. When an Expo project is detected (`expoVersion !== null`), react-doctor now runs the statically-determinable subset of expo-doctor's check suite during the environment-checks phase (skipped in diff/staged mode):

  - `expo-no-unimodules-packages` — legacy `@unimodules/*` / `react-native-unimodules` packages (IllegalPackageCheck).
  - `expo-no-cli-dependencies` — `expo-cli` / `eas-cli` listed as project dependencies (GlobalPackageInstalledLocallyCheck).
  - `expo-no-redundant-dependency` — packages Expo installs transitively or that were removed/deprecated (`expo-modules-core`, `@expo/metro-config`, `@types/react-native`, `expo-permissions`, the `expo-firebase-*` family, …), each SDK-version gated (DirectPackageInstallCheck).
  - `expo-no-conflicting-dependency-override` — `overrides`/`resolutions`/`pnpm.overrides` that pin SDK-critical packages like `@expo/cli` or `metro*` (DependencyVersionOverrideCheck).
  - `expo-router-no-react-navigation` — direct `@react-navigation/*` alongside `expo-router` on the SDK 56 line only (`>=56 <57`, matching expo-doctor's range) (ExpoRouterReactNavigationCheck).
  - `expo-vector-icons-conflict` — scoped icon packages mixed with `@expo/vector-icons` / `react-native-vector-icons` (VectorIconsCheck).
  - `expo-package-json-conflict` — `expo`/`react-native` scripts shadowing node_modules bins, and a package name colliding with a dependency (PackageJsonCheck).
  - `expo-lockfile` — missing or multiple lock files at the workspace root (LockfileCheck).
  - `expo-gitignore` — a committed `.expo/` directory, or local module native dirs that are gitignored (ProjectSetupCheck).
  - `expo-env-local-not-gitignored` — committed `.env*.local` files (EnvLocalFilesCheck).
  - `expo-metro-config` — a metro config that doesn't extend `expo/metro-config`, while tolerating known wrappers that extend it internally such as Sentry's `getSentryExpoConfig` (MetroConfigCheck).

  The remaining expo-doctor checks require running the Expo CLI, querying the Expo API, or inspecting native iOS/Android projects — none of which fit react-doctor's offline, static model — so they're intentionally out of scope.

- [#583](https://github.com/millionco/react-doctor/pull/583) [`4bc8a73`](https://github.com/millionco/react-doctor/commit/4bc8a73d247d9b8378616e738780af3794f0b97f) Thanks [@aidenybai](https://github.com/aidenybai)! - Detect Expo projects independently of the single-valued `framework` hint. Project discovery now surfaces an `expoVersion` signal (the declared `expo` package spec, looked up in the project or any of its workspace packages, or `null`), paralleling `reactVersion`. The `expo` capability is keyed off `expoVersion !== null` rather than `framework === "expo"`, so Expo-specific rules now load on web-rooted monorepos whose `apps/mobile` workspace targets Expo, and on projects that declare both `expo` and a web bundler (where `vite` / `next` previously won framework detection and silently dropped the `expo` capability). The file-level package boundary in `oxlint-plugin-react-doctor` still keeps Expo-only rules quiet on web workspaces.

- [#615](https://github.com/millionco/react-doctor/pull/615) [`8b313ba`](https://github.com/millionco/react-doctor/commit/8b313badda74de19ba56a242d965c54399d39b9c) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix two dead-code / fix-recipe papercuts surfaced on alias-heavy Next.js projects.

  **Dead-code no longer mis-flags `@/…` (and other) imports as unused.** The dead-code pass resolves imports through `oxc-resolver`, which returns realpath'd (symlink-free) paths, but built its module graph from the scan root as-is. When the project root sat behind a symlink — e.g. a macOS iCloud-synced `~/Documents` / `~/Desktop`, or a symlinked checkout — the two path spaces diverged, every import edge dropped, and files reachable only through those imports (in an alias-heavy codebase, every `@/…` target) were reported as "unused / unreachable". The scan root is now canonicalized before analysis so the module graph and the resolver agree. This was never specific to `@/*` aliases; relative imports were affected the same way.

  **Per-rule fix-recipe URLs are only shown when a recipe exists.** Findings advertised a "fetch the canonical fix recipe" URL (`/prompts/rules/<plugin>/<rule>.md`) for every diagnostic, but recipes are only published for react-doctor's own engine rules. Dead-code (`deslop/*`), the environment / supply-chain checks (`require-reduced-motion`, `require-pnpm-hardening`), and adopted third-party plugins (`eslint`, `unicorn`, `react-hooks-js`, …) have no recipe, so their links 404. The directive is now gated to engine rules, so agents are no longer sent to dead links.

- [#607](https://github.com/millionco/react-doctor/pull/607) [`5dff3b5`](https://github.com/millionco/react-doctor/commit/5dff3b5a5da033e0ae4cd5dd432a74d36ca7d143) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `react-doctor --staged` (and other scans) hanging after the diagnostics summary is already printed. When an adopted lint config crashed oxlint on the first attempt, the oxlint runner's per-batch progress timer was left running while the scan silently retried with `extends` stripped — so the run finished and printed results, but the orphaned `setInterval` kept the Node event loop alive and the process never returned control to the shell. The batch loop now clears the timer in a `finally`, so it's always cleaned up even when a batch throws. See [#599](https://github.com/millionco/react-doctor/issues/599).

- [#614](https://github.com/millionco/react-doctor/pull/614) [`daef23c`](https://github.com/millionco/react-doctor/commit/daef23ceff93634ffdb34c8e22e41610a07a596b) Thanks [@aidenybai](https://github.com/aidenybai)! - `jsx-key` no longer reports a missing key when a list element spreads the whole iteration item — `items.map((item) => <Item {...item} />)`. Spreading the row object is the canonical "this row carries its own identity" shape and was the dominant source of `jsx-key` noise on real lists, while rarely catching a genuine reorder bug. Genuine keyless lists still report: `items.map((item) => <Item name={item.name} />)`, index keys, array literals (`[<Item {...item} />]`), and spreads of anything other than the iteration variable.

- [#614](https://github.com/millionco/react-doctor/pull/614) [`daef23c`](https://github.com/millionco/react-doctor/commit/daef23ceff93634ffdb34c8e22e41610a07a596b) Thanks [@aidenybai](https://github.com/aidenybai)! - App-only heuristics now stay quiet in published libraries, and React Compiler memoization-cleanup is demoted to a warning.

  - `react-hooks-js/static-components` and `no-render-prop-children` no longer fire on files in a published library — a non-`private` `package.json` that declares the publish contract (`name` + `exports`). They still fire in applications (including private monorepo apps that live under `packages/` or declare a niche internal `exports` map) and in any package without that contract, and an explicit per-rule severity in config always re-enables them.
  - `react-compiler-no-manual-memoization` now defaults to `warn` instead of `error` when React Compiler is detected — redundant `useMemo` / `useCallback` / `memo` is correctness-neutral cleanup, so it's hidden from the default report. The external `react-hooks-js/*` compiler rules stay `error` because each marks code the compiler could not optimize (a real perf regression).
  - New `buckets` config field: set `{ "buckets": { "compiler-cleanup": "error" } }` to re-enable strict errors for the redundant-memoization rule. A per-rule override still wins over a bucket.

- [#613](https://github.com/millionco/react-doctor/pull/613) [`6448d5b`](https://github.com/millionco/react-doctor/commit/6448d5bfe1a920003a0d74d4080351d973dcbc0b) Thanks [@NisargIO](https://github.com/NisargIO)! - Speed up scans of effect-heavy codebases by memoizing `getDownstreamRefs` in the State & Effects rule helpers. `ascend()` re-descended the same large definition subtrees on every recursion step, so the seven effect rules (led by `no-pass-data-to-parent`) blew up superlinearly on big components with many `useEffect`s — re-walking and re-scoping identical bodies across recursion, across effects, and across rules. Caching the downstream-reference lookup per Program node (a `WeakMap` keyed on the per-`Program` analysis singleton, GC-bound with the file) collapses that to a single descent.

  On an 866-file Next.js app this cut ~9s (~24%) off a full scan — the worst rule on the largest file (a 1,159-line component with 10 effects) dropped from ~9.5s to ~0.18s, and the hot lint batch from ~13.5s to ~2.5s. Diagnostics are byte-identical (verified by a SHA-256 fingerprint over every diagnostic before/after); the cache only stores arrays callers already read and never mutate.

- [#616](https://github.com/millionco/react-doctor/pull/616) [`bb15252`](https://github.com/millionco/react-doctor/commit/bb15252940bbd598846d7f7018df3fb86f11ea9f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add an `--experimental-parallel [workers]` flag that runs the oxlint lint pass across multiple worker processes instead of one batch at a time. React Doctor's rules are oxlint JS plugins (single-threaded per process), so a serial scan only ever pins one core; `--experimental-parallel` fans the file batches out across the requested number of concurrent oxlint subprocesses, which scales the scan nearly linearly with CPU cores (measured ~3.5–4.6x on a 1,500-file project and ~4.6x on Sentry's 8,773 files) while producing byte-identical diagnostics.

  `--experimental-parallel` with no value auto-detects available cores; `--experimental-parallel <n>` caps the worker count; `REACT_DOCTOR_PARALLEL=<n>` seeds the default for flag-less / CI runs. The worker count is clamped to a safe range to bound peak memory, and the default remains serial so resource usage stays opt-in.

- [#601](https://github.com/millionco/react-doctor/pull/601) [`5f7cc7c`](https://github.com/millionco/react-doctor/commit/5f7cc7c36ed62b0c2264916f2aeb694e5713e821) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Publish a JSON Schema for `react-doctor.config.json` at `https://react.doctor/schema/config.json`.

  Pointing `$schema` at the URL enables editor autocomplete, hover docs from the interface JSDoc, and typo warnings in any editor that understands JSON Schema. Closes [#497](https://github.com/millionco/react-doctor/issues/497).

  ```jsonc
  {
    "$schema": "https://react.doctor/schema/config.json",
    "lint": true
  }
  ```

  The schema is generated from `packages/core/src/types/config.ts` via `pnpm build:schema` and checked into `packages/website/public/schema/config.json`.

- [#606](https://github.com/millionco/react-doctor/pull/606) [`fe01e57`](https://github.com/millionco/react-doctor/commit/fe01e573a91a36316c858ad1e7c12a5fe18c1039) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Redact secrets and PII from diagnostic output. Every diagnostic's `message`/`help` is now scrubbed for API keys, tokens, private keys, JWTs, credentialed URLs, and email addresses before it reaches the terminal, the JSON report, or the score API — so react-doctor never echoes or transmits a secret embedded in your source. Provider tokens keep their non-secret, type-identifying prefix (e.g. `sk_live_<redacted>`, `ghp_<redacted>`) so you can tell which credential leaked while the secret itself stays masked.

- [#625](https://github.com/millionco/react-doctor/pull/625) [`bdb9e36`](https://github.com/millionco/react-doctor/commit/bdb9e36b0e8f27e04104f676bffd8c6091b65cc5) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Add 10 React Native & Expo diagnostics (researched against first-party docs/RFCs and validated against an OSS corpus). Six are oxlint AST rules; four are project-level checks gated on the React Native / Expo capability and run in the environment-checks phase (skipped in diff/staged mode).

  AST rules:

  - `rn-no-deep-imports` — deep imports of public symbols from `react-native/Libraries/*` (RFC 0894; breaks on upgrade). Curated to symbols re-exported from the root, with a tailored message for the relocated `NewAppScreen`; skips type-only imports and the Codegen/TurboModule authoring surface.
  - `rn-no-set-native-props` — `ref.current(?.).setNativeProps(...)`, a silent no-op under the New Architecture (Fabric).
  - `rn-no-image-children` — children inside react-native's `<Image>` (which renders none); use `<ImageBackground>`. Resolves the element to the `react-native` import so `expo-image`/custom `Image` are ignored.
  - `rn-no-panresponder` — `PanResponder` imported from `react-native` (JS-thread gestures); use `react-native-gesture-handler`.
  - `rn-detox-missing-await` — un-awaited Detox actions / `waitFor` / `expect(element(...))` in `*.e2e.*` files.
  - `expo-no-non-inlined-env` — computed `process.env[...]` and `process.env` destructuring, which `babel-preset-expo` can't inline (value is `undefined` at runtime); scoped to Expo client files.

  Project-level checks:

  - `rn-no-metro-babel-preset` — `module:metro-react-native-babel-preset` in a babel config (renamed to `@react-native/babel-preset`; uninstalled on RN 0.73+).
  - `rn-library-react-in-dependencies` — a `react-native-builder-bob` library listing `react`/`react-native` in `dependencies` instead of `peerDependencies` (duplicate-React / duplicate-native-module crashes).
  - `expo-reanimated-v4-requires-new-arch` — `react-native-reanimated` v4 with `newArchEnabled: false` in the app config (first-launch crash).
  - `expo-updates-no-unsafe-production-config` — `updates.disableAntiBrickingMeasures: true` in the app config (can brick installed apps).

- [#614](https://github.com/millionco/react-doctor/pull/614) [`daef23c`](https://github.com/millionco/react-doctor/commit/daef23ceff93634ffdb34c8e22e41610a07a596b) Thanks [@aidenybai](https://github.com/aidenybai)! - `rn-no-raw-text` now auto-detects in-file custom text wrappers, cutting false positives on design-system `<Text>` forwarders. A component whose returned root is a `<Text>` — e.g. `const Banner = ({ children }) => <Text>{children}</Text>` or `export const Caption = (props) => <Text {...props} />` — is treated as a string-only text forwarder, so raw text passed to it (`<Banner>Hello</Banner>`) no longer reports. Mixed children still report (`<Banner><Icon /> hi</Banner>`) because a single-`<Text>` forwarder can't be trusted to route a JSX child into text. Components only referenced (not defined) in the file keep the existing name-heuristic behavior, and the config-driven `textComponents` / `rawTextWrapperComponents` overrides are unchanged.

- [#617](https://github.com/millionco/react-doctor/pull/617) [`9777f1a`](https://github.com/millionco/react-doctor/commit/9777f1ac453d8211e90c66852e0527a0ec386bc6) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Configure React Doctor with `doctor.config.{ts,js,mjs,cjs,mts,cts,json}` (or a `package.json#reactDoctor` key), and add `react-doctor rules` commands to list, explain, and configure rules without hand-editing config.

  - **TS-first config.** Author `doctor.config.ts` (or any JS/JSON variant) — TypeScript and ESM configs load via `jiti`, and JSON configs allow comments and trailing commas (JSONC).
  - **`rules` commands.** `rules list` shows every rule and the severity it runs at; `rules explain <rule>` describes why a rule matters and how to tune it; and `rules set` / `enable` / `disable` / `category` / `ignore-tag` / `unignore-tag` edit your config for you. TS/JS configs are edited in place via `magicast` (formatting and comments preserved); JSON and `package.json` are edited as data; a `doctor.config.json` is created when no config exists. Rule references accept the full key (`react-doctor/no-danger`), the bare id (`no-danger`), or a legacy key (`react/no-danger`).
  - **`doctor-explain` skill** (alias `doctor-config`), shipped via `react-doctor install`, teaches coding agents to explain a rule before disabling it and to pick the narrowest control (rule severity vs category vs tag vs `surfaces`).

  **Breaking:** the config file is now `doctor.config.*` instead of `react-doctor.config.json`. The next time you run `react-doctor` interactively, an existing `react-doctor.config.json` is automatically migrated to a typed `doctor.config.ts` (settings preserved, `$schema` dropped) and you're told once — CI, coding-agent, `--staged`, JSON/score, and non-TTY runs are left untouched (a warning still nudges them). The `package.json#reactDoctor` key is unchanged.

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Cleaner scan output and smarter file scoping:

  - The post-scan summary now leads with a "Top errors you should fix" block — each error shows a plain-language explanation and an inline code frame, with the rule's human title prefixed by its category (e.g. `Security: Use of eval()`) instead of its id, so it's clear at a glance what kind of problem it is.
  - Security rules now read as security findings: `dangerouslySetInnerHTML` (XSS) is categorized under Security, and security messages use explicit vulnerability language (code injection, XSS, reverse tabnabbing, CSRF, secret exposure).
  - Every rule's messages were rewritten to be short, plain, and dash-free, and each rule now carries a short `title`.
  - Generated bundler output (`*.iife.js`, `*.umd.js`, `*.global.js`, `*.min.js`) is now excluded from scans by default. As a result `project.sourceFileCount` (and the scanned-file totals) no longer count these generated bundles.
  - Minified files that carry an ordinary extension (e.g. a one-line `public/inject.js` bundle) are now detected by content and skipped, so they no longer flood the report with noise. Any diagnostic that still lands on an overlong single line falls back to a `file:line` reference instead of rendering an unreadable code frame.
  - Multi-project scans now report the number of UNIQUE files scanned, so nested workspace packages (a parent whose tree contains a child package) are no longer double-counted in the "Scanned N files" total.

- [#621](https://github.com/millionco/react-doctor/pull/621) [`24425b1`](https://github.com/millionco/react-doctor/commit/24425b113adcd965545b8c790af85c13a0d86c86) Thanks [@NisargIO](https://github.com/NisargIO)! - Add Sentry crash reporting to the CLI. Uncaught errors that reach the CLI's error funnels are now captured via `@sentry/node` and flushed before the process exits, each enriched with a `run` context snapshot (version, node/platform/arch, the invocation `command`/`argv`, `cwd`, CI provider, coding agent, interactivity, and JSON mode) to make crashes triage-able. Sentry initializes as the first statement of the CLI entry so its global handlers are armed before any command runs, and it's scoped to the CLI only — the programmatic `@react-doctor/api` library never initializes Sentry.

  Reporting is opt-out: pass `--no-score` to disable crash reporting along with the hosted score API and share URL. The SDK is also skipped under test runs (`VITEST` / `NODE_ENV=test`).

- [#628](https://github.com/millionco/react-doctor/pull/628) [`e9e71bb`](https://github.com/millionco/react-doctor/commit/e9e71bbc2f98e7175136918b1a3de134e9d7cb87) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Deepen the CLI's Sentry integration: uploaded source maps, unified tracing, and richer run context.

  - **Source maps**: the CLI bundle is now built with source maps, and the release pipeline injects Sentry Debug IDs into `dist/cli.js` and uploads the maps (`scripts/sentry-sourcemaps.mjs`, run from `pnpm release` and the `@dev` publish job) so crash stack traces are fully de-minified. Maps are uploaded to Sentry, not shipped in the npm tarball. Wired for both tagged releases and `@dev` snapshots; a no-op unless the `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` CI secrets are configured.
  - **Tracing / OpenTelemetry**: each run is now a Sentry transaction, and the existing Effect instrumentation (`runInspect` plus every `Effect.fn("Service.method")` span) is bridged straight into Sentry as one unified per-run trace. If a user has their own OTLP backend configured (`REACT_DOCTOR_OTLP_*`), that still wins and the Effect trace is additionally parented under the Sentry trace so the two share a `trace_id`. Tracing is tunable via `SENTRY_TRACES_SAMPLE_RATE` (set to `0` to disable; default samples every run).
  - **Crash references**: when an error is reported, the Sentry event id is surfaced as a reference — printed in the CLI's error output ("Reference (mention this when reporting): …") and added to the prefilled GitHub issue — so a user-reported crash can be located in Sentry by id. Errors thrown during a scan are also linked back to that run's transaction trace (same `trace_id`) so the crash and its spans appear together.
  - **Environment / run information**: events now carry a Sentry `environment` (`production` / `development`, overridable via `SENTRY_ENVIRONMENT`), a `react-doctor@<version>` `release` that matches the uploaded source-map artifacts, and the full run snapshot as searchable tags on _every_ event (not just exceptions) — including which command ran (`command`, `argv`), where it ran (`origin` = cli/ci/agent/git-hook, plus `ci`/`ciProvider`), the launching package manager (`invokedVia`, e.g. npm vs. pnpm dlx), and Node major version.
  - **Project information**: the anonymous project shape we already detect during a scan is attached to crashes and the run transaction as soon as it's discovered — searchable `project.*` tags (framework, React major, TypeScript, React Compiler, Expo, React Native) plus a `project` context block (versions of React/Tailwind/Zod/Preact/Expo, TanStack Query, Reanimated, source-file count). The identifying `projectName`/`rootDirectory` are deliberately excluded; no source code or diagnostic findings are sent.
  - **Anonymized by default**: every event and transaction is scrubbed before it leaves the machine — `sendDefaultPii` is off (no IP), the hostname/`server_name`/device name and captured local variables are stripped, the OS username is removed from all paths (home directory → `~`) across cwd, argv, stack frames, and span attributes (e.g. the `inspect.directory` path), and known secrets/emails are masked via the same redactor used for diagnostics. If scrubbing ever fails, the event is dropped rather than sent.
  - **Configuration**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE`, and `SENTRY_DEBUG` are all honored at runtime.

  Reporting remains opt-out and CLI-only: `--no-score` disables Sentry entirely (crash reporting and tracing), it's skipped under test runs, and the programmatic `@react-doctor/api` library never initializes Sentry.

- [#622](https://github.com/millionco/react-doctor/pull/622) [`0938376`](https://github.com/millionco/react-doctor/commit/0938376e9c60dcc52fdf4691c15db49feb603033) Thanks [@NisargIO](https://github.com/NisargIO)! - Show `"warning"`-severity diagnostics by default again. A scan that reports only errors is too generous a bar for a health check, so warnings surface on every surface (CLI, PR comment, score, `--fail-on`) out of the box. Opt out with `--no-warnings` or `"warnings": false`; per-rule / per-category severity overrides still win as before.

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Hide `warning`-severity diagnostics by default — a clean scan now reports only `error`-severity findings (errors always show). Opt warnings back in with the `--warnings` flag or `"warnings": true` config option; `--no-warnings` / `"warnings": false` is the explicit default-off. The toggle is the master switch and runs after per-rule / per-category severity overrides, so a rule explicitly set to `"warn"` via `rules` / `categories` still shows even when warnings are hidden.

  Because dead-code analysis only emits `warning`-severity findings, it's now skipped entirely when warnings are hidden (its results would be filtered out anyway) — avoiding an expensive analysis pass on the default path. `--warnings` / `"warnings": true` (and `--fail-on warning`) re-enable it.

- Updated dependencies [[`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7), [`75c1f99`](https://github.com/millionco/react-doctor/commit/75c1f99e062a8fc3e5e4ba294208dbc56bca5f6f)]:
  - oxlint-plugin-react-doctor@0.2.15

## 0.2.14

### Patch Changes

- [#593](https://github.com/millionco/react-doctor/pull/593) [`ac14db3`](https://github.com/millionco/react-doctor/commit/ac14db31e2b1cb77143bf74676d599a7b4eeedfe) Thanks [@aidenybai](https://github.com/aidenybai)! - Guard the startup `process.stdin` unref on `process.stdin.isTTY` so interactive prompts no longer exit by themselves. The startup unref (added so one-shot non-interactive runs like `--json` from an eval runner holding the stdin pipe open can exit cleanly) was applied unconditionally, including on a real terminal. On a TTY `prompts` never re-refs the unref'd stdin handle — `readline.createInterface` + `setRawMode(true)` do not re-ref it — so the multiselect ("Select projects") rendered and the CLI then drained the event loop and exited (code 0) before the user could answer. Skipping the unref when stdin is a TTY keeps the one-shot exit fix for non-interactive pipes/sockets while leaving interactive terminals untouched. Adds an in-process behavioral test and a real-PTY CI smoke (`pnpm smoke:tty-prompt`).

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.14

## 0.2.13

### Patch Changes

- [#586](https://github.com/millionco/react-doctor/pull/586) [`9d20182`](https://github.com/millionco/react-doctor/commit/9d20182ac14c7d89d52de98d2a8bfa9bad74f99e) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix the CLI hanging after the post-scan prompts. Interactive prompts re-ref stdin via `readline` and never release it on close, undoing the startup `unrefStdin()` and holding the one-shot CLI's event loop open. The shared `prompts` wrapper now re-unrefs stdin once each prompt settles.

- [`d40a933`](https://github.com/millionco/react-doctor/commit/d40a9339cfacd818b199be5b87bb68129d07b336) Thanks [@aidenybai](https://github.com/aidenybai)! - Trigger a release.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.13

## 0.2.12

### Patch Changes

- [#570](https://github.com/millionco/react-doctor/pull/570) [`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the `no-prop-types` architecture rule. React 19 removed runtime `propTypes` validation entirely — React no longer reads `Component.propTypes`, so invalid props that used to log a console warning now pass silently. The rule flags `Component.propTypes = { ... }` assignments and `static propTypes` class fields on component-cased identifiers, and is version-gated to React 19+ (`requires: ["react:19"]`) so projects where `propTypes` still runs stay quiet. It steers users toward TypeScript prop types plus explicit runtime validation. See [#460](https://github.com/millionco/react-doctor/issues/460).

- [#582](https://github.com/millionco/react-doctor/pull/582) [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a `rn-no-raw-text` false positive on fbtee translation tags. fbtee's `<fbt>` / `<fbs>` (and namespaced children like `<fbt:param>`) are compile-time translation tags that disappear at build time, so text inside `<Text><fbt>…</fbt></Text>` is really rendered inside `<Text>` and is safe on React Native. The rule now treats `fbt` / `fbs` as transparent wrappers when every ancestor up to a text-handling component is also transparent, while still reporting raw text when an `<fbt>` is used outside a `<Text>` boundary. See [#581](https://github.com/millionco/react-doctor/issues/581).

- [#557](https://github.com/millionco/react-doctor/pull/557) [`67848ae`](https://github.com/millionco/react-doctor/commit/67848aec9cba76fc44ec7e36ac3a2b0717f5bd28) Thanks [@aidenybai](https://github.com/aidenybai)! - Scope React subproject discovery so running `react-doctor` from a home directory no longer reports unrelated, vendored projects as ambiguous candidates. When the scan root has no `package.json` or workspace manifest, the filesystem crawl now skips OS/editor app-data directories (`AppData`, `Library`, …) and stops descending past a fixed depth. Previously a home-directory scan could surface React packages bundled inside editor installs (e.g. a VS Code extension under `AppData`) alongside real projects, aborting with `Multiple React projects found`. See [#545](https://github.com/millionco/react-doctor/issues/545).

- [#576](https://github.com/millionco/react-doctor/pull/576) [`e7a998a`](https://github.com/millionco/react-doctor/commit/e7a998a9fa00a894177d9afc22e3a78b814392f1) Thanks [@aidenybai](https://github.com/aidenybai)! - Unref `process.stdin` at CLI startup so an inherited stdin pipe/socket can no longer keep the event loop alive after a scan completes. Previously `react-doctor --json` (and other one-shot runs) could finish the scan and flush the full report yet never exit when launched by a parent that holds the stdin write-end open (eval runners, CI harnesses, editor integrations) — Node kept the loop alive on the idle `Socket fd=0`. Interactive prompts are unaffected because `prompts`' `readline` interface re-refs stdin on demand.

- Updated dependencies [[`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de), [`d0f5206`](https://github.com/millionco/react-doctor/commit/d0f52062e09c7bfe11eda2c06ad6e9ab0ab7da58), [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb)]:
  - oxlint-plugin-react-doctor@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies [[`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163)]:
  - oxlint-plugin-react-doctor@0.2.11

## 0.2.10

### Patch Changes

- Add Preact project detection so `react-doctor inspect` recognizes Preact workspaces, including Vite + Preact projects that still report `vite` as their framework, and enables the bundled Preact rule family.

- Bundle new diagnostics across the rule set: Preact compatibility checks, HTML correctness and dialog accessibility rules, `hooks-no-nan-in-deps`, Jotai atom diagnostics, React Native performance rules, `js-async-reduce-without-awaited-acc`, and React 19.2 `<Activity>` effect-boundary checks.

- Fix CLI reliability around dead-code scans and setup prompts. Dead-code analysis now runs with a bounded worker path instead of freezing the scan, monorepo scans still show the setup prompt, and repeated setup questions collapse into one install flow.

- Inherit false-positive fixes for `control-has-associated-label` and `no-giant-component`.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.10`.

## 0.2.9

### Patch Changes

- Publish workflow now uses npm trusted publishing through GitHub OIDC, including an npm version with provenance support. Releases no longer need a long-lived npm token.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.9`.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.8

## 0.2.7

### Patch Changes

- **Animated score progress bar.** The CLI health score now renders with a smooth progress-bar animation, automatically skipped in CI and coding-agent environments.

- **CI and agent detection.** New `isCiOrAgent` utility detects CI providers and coding agents (Cursor, Claude Code, Codex, etc.) and suppresses interactive prompts, animations, and the onboarding flow so scans run non-interactively where appropriate.

- **Concurrent lint + dead-code analysis.** The `inspect` command now runs linting and dead-code detection in parallel instead of sequentially, reducing wall-clock scan time.

- **Agent install hint.** When running inside a coding agent, the CLI suggests `react-doctor install` to set up the agent skill for in-editor diagnostics.

- **Skip prefilled project question.** The monorepo project-selection prompt is skipped when there is only one scannable project, removing an unnecessary interactive step.

- **`/doctor` triage skill.** The React Doctor agent skill now includes a `/doctor` command that fetches the canonical playbook for full-project triage.

- Bundle `eslint-plugin-react-hooks` as a direct dependency so React Compiler rules work out of the box.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.7

## 0.2.6

### Patch Changes

- Remove `design-no-bold-heading` rule - the heuristic produced too many false positives in design systems where headings intentionally vary weight.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.6

## 0.2.5

### Patch Changes

- **First-run onboarding.** New users see a brief walkthrough on their first `react-doctor` invocation explaining what the tool does and how to read the report.

- **Node 20 support.** Fix runtime dependency resolution so the CLI runs correctly on Node 20 without requiring Node 22+ built-ins.

- Cover child workspace diff include paths so `--diff` mode in monorepos correctly scans files changed inside nested workspace packages.

- Stop `jsx-key` from flagging shorthand JSX fragments (`<>...</>`) which cannot accept a `key` prop.

- Normalize static template literal handling so rules treat `` `hello` `` the same as `"hello"`.

- Add `require-pnpm-hardening` environment check that warns when `pnpm` is detected without strict lockfile settings.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.5

## 0.2.4

### Patch Changes

- **Effect v4 runtime migration.** The entire scan pipeline is rebuilt on Effect v4 - tagged errors, dependency-injected services, generator-based control flow, and `Context.Reference` ambient config replace the previous imperative architecture.

- **New `@react-doctor/api` package.** Programmatic `diagnose()` entry point backed by the same `runInspect` orchestrator the CLI uses, with typed `ReactDoctorError` failures and `Effect.catchReasons` dispatch.

- **`inspect()` rewired through `runInspect`.** The CLI `inspect` command now delegates to the core streaming orchestrator instead of managing the scan loop directly, aligning CLI and API behavior.

- **Native agent hook installer.** `react-doctor install` writes post-checkout / post-merge git hooks that auto-run the scan on relevant file changes.

- **Opt-in OpenTelemetry.** `REACT_DOCTOR_OTLP_ENDPOINT` + `REACT_DOCTOR_OTLP_AUTH_HEADER` ship every service span to an OTLP backend.

- **User-plugin extension.** `config.plugins: [...]` loads custom oxlint plugin packages alongside the built-in rules.

- **Security hardening.** Pin CI workflow permissions, add fork guards, fix four pre-existing audit findings.

- Collapse `@react-doctor/types` and `@react-doctor/project-info` into `@react-doctor/core`.

- Adopt `Effect.Console` throughout - drop the custom `Logger` service.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.4

## 0.2.3

### Patch Changes

- Fix vite build configuration for bundling workspace dependencies so `npx react-doctor` resolves internal workspace imports correctly.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.3

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

## 0.2.1

### Patch Changes

- Make filesystem walks tolerate EPERM/EACCES (macOS Library)

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.1

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

- [`29b7229`](https://github.com/millionco/react-doctor/commit/29b7229ea144cfe80c4401391eed3aa035071bcd) - Add `oxlint-plugin-react-doctor` to `dependencies` so it is installed
  alongside the CLI. The bundler correctly externalises the plugin (oxlint
  loads it by file path at runtime) but it was missing from the published
  dependency list, causing `ERR_MODULE_NOT_FOUND` on `npx react-doctor`.

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

- [`10d5de8`](https://github.com/millionco/react-doctor/commit/10d5de804fe9c03fa9f18e5350bb26965a5108ac) - Fix workspace packages not being bundled into dist, causing
  `ERR_MODULE_NOT_FOUND: Cannot find package '@react-doctor/core'`
  when running the published CLI.

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

- [#202](https://github.com/millionco/react-doctor/pull/202) [`53fa4df`](https://github.com/millionco/react-doctor/commit/53fa4dffe837e0157fb850fef700fccaaec191ea) - Detect the project's Tailwind version (`tailwindcss` in `package.json`,
  including pnpm and Bun catalog references) and gate Tailwind-aware
  rules on it. `design-no-redundant-size-axes` (which suggests collapsing
  `w-N h-N` → `size-N`) now stays silent on Tailwind v3.0 … v3.3 - those
  versions predate the `size-N` shorthand and the suggestion would
  generate classes that don't compile. The rule still fires on Tailwind
  v3.4+, v4+, and when the Tailwind version cannot be resolved.

  A new `tailwindVersion` field is added to `ProjectInfo` and printed
  during scans so it's visible alongside the detected React version and
  framework.

- Updated dependencies [[`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255), [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758), [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0)]:
  - oxlint-plugin-react-doctor@0.2.0

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

## 0.2.0-beta.5

### Patch Changes

- [#271](https://github.com/millionco/react-doctor/pull/271) [`7a7ec84`](https://github.com/millionco/react-doctor/commit/7a7ec84fad631d96f70279394be5f086b8424d17) - **Per-surface diagnostic controls (CLI).** New
  `cli/utils/inspect-flags.ts` flag + companion
  `cli/utils/resolve-cli-inspect-options.ts` and
  `cli/utils/validate-mode-flags.ts` plumbing wire the new
  `@react-doctor/core` surface filter into `cli/commands/inspect.ts`
  and `inspect.ts`. Design + Tailwind cleanup categories are demoted
  from the default PR-comment surface so they no longer dominate code
  review output, while still appearing in the CLI report and at the
  CI failure gate. Documented in the package README and the new
  `action.yml` knobs.

- Inherits the rule-fix wave from
  `oxlint-plugin-react-doctor@0.2.0-beta.5` (rules are bundled into
  the CLI):
  `no-secrets-in-client-code` scoping
  ([#252](https://github.com/millionco/react-doctor/pull/252)),
  `nextjs-no-side-effect-in-get-handler` safe local bindings
  ([#260](https://github.com/millionco/react-doctor/pull/260)),
  `async-defer-await` false-positive fixes
  ([#265](https://github.com/millionco/react-doctor/pull/265)),
  `js-length-check-first` `&&`-chain detection
  ([#269](https://github.com/millionco/react-doctor/pull/269)),
  `async-parallel` test / browser-fixture suppression
  ([#270](https://github.com/millionco/react-doctor/pull/270)),
  `js-combine-iterations` lazy `Iterator` skip
  ([#272](https://github.com/millionco/react-doctor/pull/272)), and
  `no-prevent-default` framework awareness
  ([#274](https://github.com/millionco/react-doctor/pull/274)).

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

## 0.2.0-beta.4

### Patch Changes

- Add `oxlint-plugin-react-doctor` to `dependencies` so it is installed
  alongside the CLI. The bundler correctly externalises the plugin (oxlint
  loads it by file path at runtime) but it was missing from the published
  dependency list, causing `ERR_MODULE_NOT_FOUND` on `npx react-doctor`.
- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- [`10d5de8`](https://github.com/millionco/react-doctor/commit/10d5de804fe9c03fa9f18e5350bb26965a5108ac) - Fix workspace packages
  (`@react-doctor/core`, `@react-doctor/project-info`,
  `@react-doctor/types`) not being bundled into the published `dist/`
  output, which caused
  `ERR_MODULE_NOT_FOUND: Cannot find package '@react-doctor/core'`
  on `npx react-doctor` after the package extraction in beta.2.
  Vite config now treats the workspace dependencies as bundle-time
  inputs.

- Inherits the
  [#253](https://github.com/millionco/react-doctor/pull/253) `no-barrel-import`
  index-resolution fix from
  `oxlint-plugin-react-doctor@0.2.0-beta.3` (rules are bundled into
  the CLI).

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- [#249](https://github.com/millionco/react-doctor/pull/249) [`f0198e2`](https://github.com/millionco/react-doctor/commit/f0198e2f2d9560a15bdb4a78f4a378ca2ac5fcdd) - **Internal-package extraction.** The CLI no longer vendors project
  detection, the oxlint runner, scoring, or the shared type layer
  inline - those modules now live in
  `@react-doctor/types`, `@react-doctor/project-info`, and
  `@react-doctor/core` and are consumed as workspace dependencies.
  Bundled into `dist/` on publish (see also
  [#253](https://github.com/millionco/react-doctor/pull/253) bundler
  follow-up in beta.3). The `react-doctor`, `react-doctor inspect`,
  and `react-doctor install` binaries are surface-compatible with
  0.1.6.

- [#250](https://github.com/millionco/react-doctor/pull/250) [`6e2ee9d`](https://github.com/millionco/react-doctor/commit/6e2ee9d474fddbde4c1246ff65b2f3e5bb3a42fc) - **CLI reorganised.** `src/cli/` is now split into `commands/` +
  `utils/`, mirroring the layout ported from `react-grab`. Each
  subcommand has a dedicated module (`inspect`, `install`, version /
  help). No user-visible change to flags or output.

### Patch Changes

- [#208](https://github.com/millionco/react-doctor/pull/208) [`8556b31`](https://github.com/millionco/react-doctor/commit/8556b31d8e4e165f791db0aa60a6b038b18ec777) - **User-feedback sweep.** Reduce false positives across the design /
  Tailwind / state-and-effects rule groups, surface per-rule scoring
  contributions in `react-doctor inspect`, and add `--severity` /
  `--rule-set` CLI options plus their `react-doctor.config.json`
  counterparts. Closes the bulk of the feedback collected on 0.1.x.

- [#174](https://github.com/millionco/react-doctor/pull/174) - Forward
  `reactMajorVersion` through the programmatic `diagnose()` entry
  point so embedders running react-doctor inside their own pipeline
  (Vercel AI Code Review sandbox and friends) get the same React-19
  rule gating the CLI gets.

- [#202](https://github.com/millionco/react-doctor/pull/202) [`53fa4df`](https://github.com/millionco/react-doctor/commit/53fa4dffe837e0157fb850fef700fccaaec191ea) - Detect the project's Tailwind version (`tailwindcss` in `package.json`,
  including pnpm and Bun catalog references) and gate Tailwind-aware
  rules on it. `design-no-redundant-size-axes` (which suggests collapsing
  `w-N h-N` → `size-N`) now stays silent on Tailwind v3.0 … v3.3 - those
  versions predate the `size-N` shorthand and the suggestion would
  generate classes that don't compile. The rule still fires on Tailwind
  v3.4+, v4+, and when the Tailwind version cannot be resolved.

  A new `tailwindVersion` field is added to `ProjectInfo` and printed
  during scans so it's visible alongside the detected React version and
  framework.

## 0.1.6

### Patch Changes

- [`e9e4217`](https://github.com/millionco/react-doctor/commit/e9e4217711341cf2bfb7c1b11f37caaae44df7c3) - Harden `discover-project` and `resolve-diagnose-target`: tighter
  workspace-root detection constants, additional regression coverage in
  `tests/diagnose.test.ts` and `tests/discover-project.test.ts` for the
  nested-subproject fallback added in 0.1.5.

## 0.1.5

### Patch Changes

- [`b06b768`](https://github.com/millionco/react-doctor/commit/b06b768) ([#193](https://github.com/millionco/react-doctor/pull/193)) - `diagnose()` now falls back to the first nested React subproject when the
  requested directory has no root `package.json`, instead of crashing with
  `No package.json found in <directory>`. This unblocks external review
  runners (e.g. the Vercel AI Code Review sandbox) that point `diagnose()`
  at the cloned repo root for projects whose `package.json` lives in a
  subfolder like `apps/web`. When neither the root nor any nested
  subdirectory contains a React project, `diagnose()` now throws a clearer
  `No React project found in <directory>` error.

- [#200](https://github.com/millionco/react-doctor/pull/200) - Typed
  errors from `diagnose()` plus a `rootDir` config option so embedders
  can target a specific subdirectory without relying on cwd inference.

- [#201](https://github.com/millionco/react-doctor/pull/201) - Integrate
  `eslint-plugin-react-you-might-not-need-an-effect` into the curated
  rule set so its useEffect-elimination diagnostics flow into the score
  alongside react-doctor's own state-and-effects rules.

- [#194](https://github.com/millionco/react-doctor/pull/194) - Resolve
  the React version from Bun grouped catalogs (in addition to pnpm
  catalogs) so monorepos using Bun for dependency hoisting still get an
  accurate React major back from the catalog resolver.

- [#196](https://github.com/millionco/react-doctor/pull/196) - Match
  `react-doctor-disable*` suppression comments that carry descriptive
  trailing text (e.g. `// react-doctor-disable-next-line rule -- why`)
  instead of requiring a bare comment. Resolves
  [#159](https://github.com/millionco/react-doctor/issues/159).

- [#198](https://github.com/millionco/react-doctor/pull/198) - Expose
  `--why` as a documented public alias for `--explain` in the CLI.
  Resolves [#161](https://github.com/millionco/react-doctor/issues/161).

- [#195](https://github.com/millionco/react-doctor/pull/195) - The
  GitHub Action's score step is output-only and never fails the job, so
  consumers can gate on the score themselves without losing the run.
  Resolves [#190](https://github.com/millionco/react-doctor/issues/190).

- [#197](https://github.com/millionco/react-doctor/pull/197) - Docs:
  clarify that `ignore.overrides` covers per-file rule ignores.

- [#199](https://github.com/millionco/react-doctor/pull/199) - Docs:
  full GitHub Actions workflow example and inputs reference.

## 0.1.4

### Patch Changes

- [`a63d5d5`](https://github.com/millionco/react-doctor/commit/a63d5d5d0bbff26e7367a0b6d634aeb089a935ef) - CLI scan output reformat. Adds `utils/wrap-indented-text.ts` for
  consistent wrapping of multi-line diagnostic recommendations, expands
  the scan-summary types to carry per-line wrap state, and threads the
  helper through `scan.ts`. Backed by the new `wrap-indented-text.test.ts`
  unit suite and a `cli-and-output` regression suite that snapshots the
  rendered CLI output.

## 0.1.3

### Patch Changes

- [#184](https://github.com/millionco/react-doctor/pull/184) - Add a
  `rawTextWrapperComponents` config option so projects can teach
  `rn-no-raw-text` about their own `<Text>` wrappers (e.g. design-system
  primitives that render `Text` internally). Resolves
  [#183](https://github.com/millionco/react-doctor/issues/183).

- [#182](https://github.com/millionco/react-doctor/pull/182) - Restore
  React Compiler rules to `error` severity. They had silently regressed
  to `warn` in 0.1.0 when the plugin-resolution gating landed, masking
  Compiler-blocking violations behind the warning lane.

- [#181](https://github.com/millionco/react-doctor/pull/181) - Website
  fix: keep the diagnostic count next to the rule name on narrow widths
  in the leaderboard / diagnostic listings.

- [`cca5808`](https://github.com/millionco/react-doctor/commit/cca5808) - Promote `react-hooks-js/*` diagnostics to errors so projects with
  React Hooks rule violations no longer pass with a clean score.

- [`9ee3a6d`](https://github.com/millionco/react-doctor/commit/9ee3a6d) - Refresh the website's terminal demo to match the new CLI output
  format introduced in 0.1.1 / 0.1.4.

## 0.1.2

### Patch Changes

- [`6ddb02c`](https://github.com/millionco/react-doctor/commit/6ddb02c6b08fbfb06e2429d3cabd338c91891cd6) - Polish follow-up to the 0.1.1 CLI redesign. Consolidates duplicated
  scan-summary literals into `constants.ts`, simplifies `scan.ts` to
  drop a redundant branch (-9 LOC), and tightens the `spinner.ts`
  helper so its cleanup is symmetric with start. No user-visible
  behaviour change.

## 0.1.1

### Patch Changes

- [#178](https://github.com/millionco/react-doctor/pull/178) - CLI
  scan-summary redesign. The final report now inlines a category
  breakdown (state-and-effects / design / bundle-size / …) and a
  compact rule list grouped under each category, replacing the
  previous single-line counts. Verbose mode keeps the per-diagnostic
  listing.

## 0.1.0

### Minor Changes

- d71a6bf: feat(react-doctor): ship rules as an ESLint plugin (`react-doctor/eslint-plugin`)

  The same React Doctor rule set that powers the CLI scan and the
  `react-doctor/oxlint-plugin` export is now available as a first-class
  ESLint plugin. Drop it into your `eslint.config.js` flat config and
  diagnostics surface inline through whichever IDE / agent / pre-commit
  hook already speaks ESLint - no separate `react-doctor` invocation
  needed.

  ```js
  // eslint.config.js
  import reactDoctor from "react-doctor/eslint-plugin";

  export default [
    reactDoctor.configs.recommended,
    reactDoctor.configs.next, // composable framework presets
    reactDoctor.configs["react-native"],
    reactDoctor.configs["tanstack-start"],
    reactDoctor.configs["tanstack-query"],
    // reactDoctor.configs.all, // every rule at react-doctor's default severity
  ];
  ```

  The exported `recommended`, `next`, `react-native`, `tanstack-start`,
  `tanstack-query`, and `all` configs reuse the exact severity maps the
  react-doctor CLI emits to oxlint, so behavior stays in lock-step
  between engines. You can also cherry-pick individual rules under the
  `react-doctor/*` namespace.

  The visitor signatures inside each rule are already ESLint-compatible
  (`create(context) => visitors`); the new export wraps each rule with
  the ESLint-required `meta` (`type`, `docs.url`, `schema`) and exposes
  the plugin shape ESLint v9 flat configs expect. Closes
  [#143](https://github.com/millionco/react-doctor/issues/143).

- d71a6bf: feat(react-doctor): adopt the project's existing oxlint / eslint config and factor those rules into the score

  When a project has a JSON-format oxlint or eslint config (`.oxlintrc.json`
  or `.eslintrc.json`) at the scanned directory or any ancestor up to the
  nearest project boundary (`.git` directory or monorepo root),
  react-doctor now folds that config into the same scan via oxlint's
  `extends` field. The user's existing rules fire alongside the curated
  react-doctor rule set, and the resulting diagnostics count toward the
  0–100 health score - no separate `oxlint` / `eslint` invocation needed.

  **Behavior change on upgrade.** Projects with an existing
  `.oxlintrc.json` / `.eslintrc.json` will see new diagnostics flow into
  the score on first run; the score may drop. Set
  `"adoptExistingLintConfig": false` in `react-doctor.config.json` (or the
  `"reactDoctor"` key in `package.json`) to preserve the previous
  behavior. `customRulesOnly: true` also implies opt-out, since that mode
  runs only the `react-doctor/*` plugin.

  **Resilience.** If oxlint can't load the user's config (broken JSON,
  missing plugin, unknown rule name), react-doctor logs the reason on
  stderr and retries the scan once without `extends` so the score is
  still computed off the curated rule set instead of failing the whole
  lint pass.

  **Coverage broadened.** Diagnostics on `.ts` and `.js` files are now
  reported (previously the parser dropped everything that wasn't `.tsx`
  / `.jsx`). This affects react-doctor's own JS-performance / bundle-size
  rules in addition to adopted user rules.

  **Limitations.** Only JSON configs are picked up: oxlint's `extends`
  cannot evaluate JS or TS, so flat configs (`eslint.config.js`),
  `.eslintrc.{js,cjs}`, and `oxlint.config.ts` are silently skipped.
  Rule-level severities (`"rules": {...}`) flow through, but
  category-level enables (`"categories": {...}`) do not - react-doctor's
  local categories block always wins. Closes #143.

- d71a6bf: feat(react-doctor): add 11 new lint rules - 3 state / correctness, 8 design system

  **3 new state / correctness rules** (all `warn`):

  - `react-doctor/no-direct-state-mutation` - flags `state.foo = x` and
    in-place array mutators (`push` / `pop` / `shift` / `unshift` /
    `splice` / `sort` / `reverse` / `fill` / `copyWithin`) on `useState`
    values. Tracks shadowed names through nested function params and
    locals so a handler that re-binds the state name doesn't
    false-positive.
  - `react-doctor/no-set-state-in-render` - flags only **unconditional**
    top-level setter calls so the canonical
    `if (prev !== prop) setPrev(prop)` derive-from-props pattern stays
    clean.
  - `react-doctor/no-uncontrolled-input` - catches `<input value={…}>`
    without `onChange` / `readOnly`, `value` + `defaultValue` conflicts,
    and `useState()` flip-from-undefined. Bails on JSX spread props
    (`{...register(…)}`, Headless UI, Radix) where `onChange` may come
    from spread.

  **8 new design-system rules in `react-ui.ts`** (all `warn`):

  - `react-doctor/design-no-bold-heading` -
    `font-bold` / `font-extrabold` / `font-black` or inline
    `fontWeight ≥ 700` on `h1`–`h6`.
  - `react-doctor/design-no-redundant-padding-axes` - collapse
    `px-N py-N` → `p-N`.
  - `react-doctor/design-no-redundant-size-axes` - collapse `w-N h-N` →
    `size-N`.
  - `react-doctor/design-no-space-on-flex-children` - use `gap-*` over
    `space-*-*`.
  - `react-doctor/design-no-em-dash-in-jsx-text` - em dashes in JSX
    text.
  - `react-doctor/design-no-three-period-ellipsis` - `Loading...` →
    `Loading…`.
  - `react-doctor/design-no-default-tailwind-palette` -
    `indigo-*` / `gray-*` / `slate-*` reads as the Tailwind template
    default; reports every offending token in the className (not just
    the first).
  - `react-doctor/design-no-vague-button-label` - `OK` / `Continue` /
    `Submit` etc.; recurses into `<>…</>` fragment children.

  Each new rule has dedicated regression tests covering both the
  positive trigger and the false-positive cases above.

  **Other**

  - Hoists shared regex / token patterns into the appropriate
    `constants.ts` per AGENTS.md.

- d71a6bf: remove(react-doctor): drop browser entrypoints, browser CLI, and the
  `react-doctor-browser` workspace package

  **Removed package exports.** `react-doctor/browser` and
  `react-doctor/worker` are no longer published. Imports of either subpath
  will fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. If you depended on the
  in-browser diagnostics pipeline (caller-supplied `projectFiles` map +
  `runOxlint` callback running oxlint in a Web Worker), pin
  `react-doctor@0.0.47` or vendor the relevant modules from the
  `archive/browser` git branch.

  **Removed CLI subcommand.** `react-doctor browser …` (`start`, `stop`,
  `status`, `snapshot`, `screenshot`, `playwright`) is gone. The
  long-running headless Chrome session, ARIA snapshot helpers, screenshot
  capture, and `--eval` Playwright harness are no longer available from
  the CLI.

  **Removed companion package.** The `react-doctor-browser` npm package
  (headless browser automation, CDP discovery, system Chrome launcher,
  cross-browser cookie extraction) has been removed from the workspace.
  The last published version remains installable on npm but will not
  receive further updates.

  **Why.** The browser surface area was unused inside the monorepo (the
  website does not import it) and added a heavy dependency footprint
  (`playwright`, `libsql`, etc.) for a public API with no known internal
  consumers. Removing it tightens what `react-doctor` is responsible for:
  the diagnostics CLI, the Node `react-doctor/api`, and the
  `react-doctor/eslint-plugin` / `react-doctor/oxlint-plugin` exports.

  The full removed source remains available on the `archive/browser`
  branch for anyone who wants to fork or vendor the modules.

### Patch Changes

- 2aebfa6: fix(react-doctor): support block comment forms of `react-doctor-disable-line` / `react-doctor-disable-next-line`

  The inline-suppression matcher previously only recognized line comments
  (`// react-doctor-disable-…`). Block comments - including the JSX form
  `{/* react-doctor-disable-next-line … */}`, which is the only suppression
  form legal directly inside JSX - were silently ignored, forcing users to
  write `{/* // react-doctor-disable-line … */}` as a workaround. Both forms
  now work, and either accepts a comma- or whitespace-separated rule list
  or no rule id (suppress every diagnostic on the targeted line). Closes #144.

- 2aebfa6: fix(react-doctor): stop flagging `useState` as `useRef` when state reaches render through `useMemo`, derived values, or context `value`

  `rerender-state-only-in-handlers` (the rule that suggests "use `useRef`
  because this state is never read in render") only checked whether the
  state name appeared by name in the component's `return` JSX. That
  heuristic produced loud false positives for ordinary patterns:

  - state filtered/derived through `useMemo` → JSX uses the memo result
  - state passed as the `value` of a React Context Provider
  - state combined with other variables into a rendered constant

  Following the bad hint and converting these to `useRef` silently broke
  apps because `ref.current = …` does not trigger a re-render - search
  results stopped updating, dialogs stayed open, and context consumers
  saw stale snapshots.

  The rule now performs a transitive "render-reachable" analysis on
  top-level component bindings. A `useState` is only flagged when neither
  the value itself nor anything derived from it (recursively) appears
  anywhere in the rendered JSX, including attribute values like
  `<Context value={…}>`, `style={…}`, `className={…}`, etc. Truly
  transient state (e.g. a scroll position only stored to be ignored)
  still fires. Closes #146.

- [#148](https://github.com/millionco/react-doctor/pull/148) ([`3f5c031`](https://github.com/millionco/react-doctor/commit/3f5c031)) - Add the (now-removed in 0.1.0) `react-doctor browser` CLI subcommand
  and 11 new lint rules: 3 state / correctness rules
  (`no-direct-state-mutation`, `no-set-state-in-render`,
  `no-uncontrolled-input`) and 8 design-system rules (see the
  dedicated bullet above).

- [#152](https://github.com/millionco/react-doctor/pull/152) ([`8f10098`](https://github.com/millionco/react-doctor/commit/8f10098)) - 4 new React 18→19 migration rules: pre-flight checks for the
  `forwardRef`-deprecation / new context API / new ref-callback
  cleanup / `use()` adoption migration paths.

- [#154](https://github.com/millionco/react-doctor/pull/154) ([`276ea2f`](https://github.com/millionco/react-doctor/commit/276ea2f)) - Add `prefer-use-sync-external-store` rule. Catches `useEffect`-based
  subscriptions that should be `useSyncExternalStore` (concurrent-mode
  safe, tearing-resistant).

- [#155](https://github.com/millionco/react-doctor/pull/155) ([`2240b1f`](https://github.com/millionco/react-doctor/commit/2240b1f)) - Add `no-event-trigger-state` rule. Flags state that is only ever
  written from an event handler and only read from the rendered JSX
  return - a frequent prop-derivation antipattern.

- [#156](https://github.com/millionco/react-doctor/pull/156) ([`4b92f50`](https://github.com/millionco/react-doctor/commit/4b92f50)) - Add `no-effect-chain` rule. Flags `useEffect` chains where one
  effect's setState triggers another effect, which is almost always a
  signal to collapse the chain into a derived value or event handler.

- [#157](https://github.com/millionco/react-doctor/pull/157) ([`0be99ad`](https://github.com/millionco/react-doctor/commit/0be99ad)) - Comprehensive useEffect analyzer: three new rules
  (`no-mutable-in-deps`, `no-mirror-prop-effect`, `effect-needs-cleanup`)
  plus shared dependency-tracking infrastructure.

- [#162](https://github.com/millionco/react-doctor/pull/162) ([`945138d`](https://github.com/millionco/react-doctor/commit/945138d)) - Gate `prefer-use-effect-event` behind React 19+ so the suggestion
  doesn't fire on React 18 projects (where `useEffectEvent` is not
  available).

- [#163](https://github.com/millionco/react-doctor/pull/163) ([`c20857e`](https://github.com/millionco/react-doctor/commit/c20857e)) - `no-effect-event-handler` honors empty-frame barriers in prop-stack
  lookups so callbacks hoisted out of effects don't inherit the
  surrounding effect classification.

- [#165](https://github.com/millionco/react-doctor/pull/165) ([`78db3b2`](https://github.com/millionco/react-doctor/commit/78db3b2)) - Multi-line JSX and stacked suppression comments, per-file rule
  overrides, and near-miss hints for misspelled rule ids.

- [#166](https://github.com/millionco/react-doctor/pull/166) ([`8745c34`](https://github.com/millionco/react-doctor/commit/8745c34)) - Suppression follow-ups: audit-mode handling, overrides-config
  validation, `--explain` working inside monorepos, JSX generics
  parsing, line-comment skip semantics, and a single-pass evaluator
  for the suppression matcher.

- [#167](https://github.com/millionco/react-doctor/pull/167) ([`d3e26d6`](https://github.com/millionco/react-doctor/commit/d3e26d6)) - Refactor: consolidate state-and-effects rule plumbing.

- [#169](https://github.com/millionco/react-doctor/pull/169) ([`50d08fd`](https://github.com/millionco/react-doctor/commit/50d08fd)) - AGENTS.md compliance pass on the state-and-effects rule directory.

- [#170](https://github.com/millionco/react-doctor/pull/170) ([`97cb1bb`](https://github.com/millionco/react-doctor/commit/97cb1bb)) - Collapse non-verbose CLI diagnostics to the top 3 rules so the
  default scan output stays scannable on large projects; `--verbose`
  restores the full listing.

- [#172](https://github.com/millionco/react-doctor/pull/172) ([`2a1b0ae`](https://github.com/millionco/react-doctor/commit/2a1b0ae)) - Tighten state-and-effects rules against false positives across the
  rules-of-hooks / handler-detection / render-reachable code paths.

- [#174](https://github.com/millionco/react-doctor/pull/174) ([`4fb4d27`](https://github.com/millionco/react-doctor/commit/4fb4d27)) - Forward `reactMajorVersion` through the programmatic `diagnose()`
  entry point so embedders get the same React-19 rule gating the CLI
  uses.

- [#177](https://github.com/millionco/react-doctor/pull/177) ([`01c38a7`](https://github.com/millionco/react-doctor/commit/01c38a7)) - Harden rules against prototype-pollution false positives and quiet
  the adopt-config noise introduced in `d71a6bf` when the user's
  config contains unknown rules.

## 0.0.47

### Patch Changes

- 6a0e6d6: chore(react-doctor): bump oxlint to ^1.62.0

  Pulls in oxlint v1.61.0 + v1.62.0 improvements (additional Vue rules,
  jest/vitest rule splits, autofix for prefer-template, no-unknown-property
  support for React 19's precedence prop, jsx-a11y/anchor-is-valid attribute
  settings, and various correctness fixes). The release-line breaking
  changes are internal Rust API only - oxlint's CLI and config schema
  are unchanged.

- dbf200d: fix(react-doctor): filter React Compiler rules to those the loaded `eslint-plugin-react-hooks` actually exports

  Follow-up to the #141 fix in 0.0.46. The peer range `^6 || ^7` allows
  v6.x of `eslint-plugin-react-hooks`, which doesn't expose the
  `void-use-memo` rule (added in v7). When a v6 user had React
  Compiler detected, oxlint failed with
  `Rule 'void-use-memo' not found in plugin 'react-hooks-js'`. The
  config now introspects the loaded plugin's `rules` map and only
  enables `react-hooks-js/*` entries that the installed version
  actually exports - so future rule additions or removals can no
  longer crash a scan.

## 0.0.46

### Patch Changes

- c13a8df: fix(react-doctor): skip React Compiler rules when `eslint-plugin-react-hooks` isn't installed

  When a project had React Compiler detected but the optional peer
  `eslint-plugin-react-hooks` was not installed, oxlint failed with
  `react-hooks-js not found` because the React Compiler rules were
  emitted into the config without the corresponding plugin entry.
  Gate `REACT_COMPILER_RULES` on successful plugin resolution so a
  missing optional peer silently skips them instead of crashing the
  scan (#141).

## 0.0.45

### Patch Changes

- 6b07924: `react-doctor install` now delegates skill installation to
  [`agent-install`](https://www.npmjs.com/package/agent-install) `0.0.4`,
  which natively models **54 supported coding agents** (up from the 8 we
  previously hand-rolled).

  Behavior changes:

  - **Detection** is now the union of CLI binaries on `$PATH` (the previous
    signal) and config dirs in `$HOME` (`~/.claude`, `~/.cursor`,
    `~/.codex`, `~/.factory`, `~/.pi`, etc.). This catches agents the user
    has run at least once even if the CLI is no longer on `$PATH`, and vice
    versa.
  - **All 8 originally documented agents stay supported**: Claude Code,
    Codex, Cursor, Factory Droid, Gemini CLI, GitHub Copilot, OpenCode, Pi.
  - **46 newly supported agents** via upstream `agent-install@0.0.4`:
    Goose, Windsurf, Roo Code, Cline, Kilo Code, Warp, Replit, OpenHands,
    Qwen Code, Continue, Aider Desk, Augment, Cortex, Devin, Junie, Kiro
    CLI, Crush, Mux, Pochi, Qoder, Trae, Zencoder, and many more.
  - **Bug fix**: malformed `SKILL.md` frontmatter now surfaces as an error
    instead of a silent "installed for ..." success with zero files
    written. Build-time validation in `vite.config.ts` also catches this
    before publish.

## 0.0.44

### Patch Changes

- [`57467cd`](https://github.com/millionco/react-doctor/commit/57467cd) - Patch follow-up to the 0.0.43 ignore-respecting refactor: misc
  rough edges in the new ignore-pattern collector and inline-disable
  matcher.

## 0.0.43

### Patch Changes

- **Respect existing eslint / oxlint / prettier ignores by default.** React Doctor now honors `.gitignore`, `.eslintignore`, `.oxlintignore`, `.prettierignore`, and `.gitattributes` `linguist-vendored` / `linguist-generated` annotations, plus inline `// eslint-disable*` and `// oxlint-disable*` comments. Previously inline disable comments were neutralized so react-doctor saw through every prior suppression - this surprised users who had `eslint-disable` in place for legitimate reasons. **Behavior change:** existing users may see fewer findings (previously-suppressed code is now correctly suppressed). To restore the old "audit everything" behavior, set `"respectInlineDisables": false` in `react-doctor.config.json` or pass `--no-respect-inline-disables` on the CLI.
- **Internals:** the ignore-pattern collector now writes a single combined `--ignore-path` file rather than passing N `--ignore-pattern` args; this removes a `baseArgs`-length pressure point that could shrink batch sizes on large diffs. Boolean config fields (`lint`, `deadCode`, `verbose`, `customRulesOnly`, `share`, `respectInlineDisables`) are now coerced from the common `"true"` / `"false"` JSON-string typo at config-load time, with a warning. The `parseOxlintOutput` "no files to lint" workaround is now locale-agnostic (it skips any noise before the first `{`). The non-git audit-mode fallback walks the project tree directly instead of silently no-op'ing when `git grep` isn't available. New regression suite covers all of the above end-to-end.

## 0.0.42

### Patch Changes

- 79fb877: Fix `Dead code detection failed (non-fatal, skipping)` (#135). The plugin-failure detector now walks the error cause chain, matches Windows-style paths, plugin configs without a leading directory, and parser errors, so knip plugin loading errors are recovered from in more environments. The retry loop also now surfaces the original knip error after exhausting attempts (previously could throw a generic `Unreachable` error) and only disables knip plugin keys it actually recognizes. Dead-code and lint failures are now reported with the full cause chain instead of a single wrapped `Error loading …` line.
- 391b751: Fix knip step ignoring workspace-local config in monorepos (#136). When a workspace owns its own knip config (`knip.json`, `knip.jsonc`, `knip.ts`, etc.), `runKnip` now runs knip with `cwd = workspaceDirectory` so the config is discovered, instead of running from the monorepo root with `--workspace` and silently falling back to knip's defaults - which mass-flagged every file as `Unused file` for setups like TanStack Start whose entry layout doesn't match the defaults. Behavior for monorepos with a root-level `knip.json` containing a `workspaces` mapping is unchanged.

## 0.0.41

### Patch Changes

- [`1fdc9a0`](https://github.com/millionco/react-doctor/commit/1fdc9a0) - Patch follow-up to the 0.0.39 browser-entrypoint work: misc
  bundling fixes for the now-removed `react-doctor/browser` and
  `react-doctor/worker` subpath exports.

## 0.0.40

### Patch Changes

- [`874f7bc`](https://github.com/millionco/react-doctor/commit/874f7bc) - Publishing-pipeline retry of 0.0.39 (no code delta).

## 0.0.39

### Patch Changes

- [#134](https://github.com/millionco/react-doctor/pull/134) ([`7da4ce4`](https://github.com/millionco/react-doctor/commit/7da4ce4)) - Fix `TypeError: issues.files is not iterable` crash during dead-code
  detection. Knip 6.x returns `issues.files` as an `IssueRecords`
  object instead of a `Set<string>`. The dead-code pass now handles
  both shapes (and arrays) defensively.

- [`5238e7b`](https://github.com/millionco/react-doctor/commit/5238e7b) / [`061a794`](https://github.com/millionco/react-doctor/commit/061a794) - Add the `react-doctor/browser` entrypoint and a `diagnoseBrowser` /
  `processBrowserDiagnostics` API so the website's in-browser
  demo can run the same scoring + rule pipeline as the CLI without
  shelling out. Shared diagnose helpers and the browser scorer are
  extracted so bundles can omit the proxy-fetch path. (The browser
  surface was later removed in 0.1.0 - see that section.)

- [`b5519b6`](https://github.com/millionco/react-doctor/commit/b5519b6) - Inject the browser scorer at build time so the bundled
  `react-doctor/browser` output omits the proxy-fetch / Node-only score
  path.

## 0.0.38

### Patch Changes

- [`8b0485a`](https://github.com/millionco/react-doctor/commit/8b0485a) - GitHub Action improvements (input validation + step output cleanups),
  clickable file paths in CLI diagnostic output (terminal hyperlinks
  via OSC-8), and a website hydration fix.

- [`bb5188f`](https://github.com/millionco/react-doctor/commit/bb5188f) - Document every config option supported by `react-doctor.config.json`
  in the README.

- [`100731c`](https://github.com/millionco/react-doctor/commit/100731c) - `install-skill` and `detect-agents` formatting fixes so CI's
  `format:check` step stays green.

## 0.0.37

### Patch Changes

- [`f1bd776`](https://github.com/millionco/react-doctor/commit/f1bd776) - Republish 0.0.36 after a botched skill payload - the
  `install-skill` SKILL.md frontmatter was malformed and the prior
  publish shipped an unusable skill. No code delta vs 0.0.36 beyond
  the SKILL.md regeneration.

## 0.0.36

### Patch Changes

- [#131](https://github.com/millionco/react-doctor/pull/131) ([`ff5b637`](https://github.com/millionco/react-doctor/commit/ff5b637)) - Frontend design-quality rules (initial cut of the design-system
  rule family - bold headings, redundant padding/size axes, vague
  button labels, etc.). Expanded substantially in 0.1.0.

- [`074f854`](https://github.com/millionco/react-doctor/commit/074f854) - Add the `react-doctor install` subcommand that installs the
  React Doctor SKILL.md into the user's configured coding agents.

## 0.0.35

### Patch Changes

- [`7136aa5`](https://github.com/millionco/react-doctor/commit/7136aa5) - Republish 0.0.34 after a packaging hiccup; no code delta.

## 0.0.34

### Patch Changes

- [#124](https://github.com/millionco/react-doctor/pull/124) ([`0eb635a`](https://github.com/millionco/react-doctor/commit/0eb635a)) - Add TanStack Start rule family (router conventions, server-function
  hygiene, `useServerFn` adoption hints).

- [#129](https://github.com/millionco/react-doctor/pull/129) ([`47105e9`](https://github.com/millionco/react-doctor/commit/47105e9)) - Fix false positives for Next.js redirect guidance and React Compiler
  detection.

## 0.0.33

### Patch Changes

- [`87d4b86`](https://github.com/millionco/react-doctor/commit/87d4b86) - Republish 0.0.32 after a packaging hiccup; no code delta.

## 0.0.32

### Patch Changes

- [#120](https://github.com/millionco/react-doctor/pull/120) ([`10bd788`](https://github.com/millionco/react-doctor/commit/10bd788)) - Address multiple GitHub issues (#117, #113, #119, #106): assorted
  rule false-positive fixes, CLI option polish, and detection
  hardening.

- [#122](https://github.com/millionco/react-doctor/pull/122) ([`901fce5`](https://github.com/millionco/react-doctor/commit/901fce5)) - Restrict setter detection to direct `Identifier` callees so dynamic
  / member-expression accessors no longer count as setter invocations.

## 0.0.31

### Patch Changes

- [#108](https://github.com/millionco/react-doctor/pull/108) ([`1aef45a`](https://github.com/millionco/react-doctor/commit/1aef45a)) - Resolve 7 GitHub issues across catalog resolution, file-ignore
  semantics, CLI ergonomics, React Native detection, Next.js
  detection, the `--offline` flag, and monorepo discovery.

- [#110](https://github.com/millionco/react-doctor/pull/110) ([`720f421`](https://github.com/millionco/react-doctor/commit/720f421)) - Apply `ignore.files` as a pre-filter so ignored files are skipped
  before linting starts (previously they were linted then filtered).

## 0.0.30

### Patch Changes

- [`c405f4a`](https://github.com/millionco/react-doctor/commit/c405f4a) - Resolve multiple GitHub issues (#71, #72, #76, #77, #83, #84, #86,
  #87, #89, #92, #93, #94): broad rule false-positive sweep across
  detection, scoring, and rule output formatting.

- [`97b21f1`](https://github.com/millionco/react-doctor/commit/97b21f1) - Replace `fs.existsSync` with the shared `isFile` utility for
  consistent file checks across the codebase.

## 0.0.29

### Patch Changes

- [#63](https://github.com/millionco/react-doctor/pull/63) ([`9f51b9d`](https://github.com/millionco/react-doctor/commit/9f51b9d)) - GitHub Action: add a `diff` input so the action can scan only files
  changed in the PR, plus optional PR-comment posting from the action
  step.

- [#64](https://github.com/millionco/react-doctor/pull/64) ([`79af7ca`](https://github.com/millionco/react-doctor/commit/79af7ca)) - Detect Expo and React Native and enable the RN-specific rule
  family when a project targets them.

- [#68](https://github.com/millionco/react-doctor/pull/68) ([`1947859`](https://github.com/millionco/react-doctor/commit/1947859)) - Rule / detection false-positive fixes (issue rollup).

## 0.0.28

### Patch Changes

- [`bd949cc`](https://github.com/millionco/react-doctor/commit/bd949cc) - Bump the Node version requirement, enhance the linting process with
  improved error handling, and tighten the CI matrix.

## 0.0.27

### Patch Changes

- [`370ea4c`](https://github.com/millionco/react-doctor/commit/370ea4c) - Refactor CLI option handling and improve automated-environment
  detection (CI / agent contexts).

- [`051a02c`](https://github.com/millionco/react-doctor/commit/051a02c) - Score-calculation refactor: extract shared constants and add the
  proxy-fetch fallback used by the in-browser scorer.

- [`bf21a87`](https://github.com/millionco/react-doctor/commit/bf21a87) - Fix `--fix` deeplink rendering issues introduced when the install
  prompt was integrated into the CLI workflow.

## 0.0.26

### Patch Changes

- [`7716d6c`](https://github.com/millionco/react-doctor/commit/7716d6c) - Integrate the SKILL.md installation prompt directly into the CLI
  workflow so first-run users get the skill installed without a
  separate command.

## 0.0.25

### Patch Changes

- [#44](https://github.com/millionco/react-doctor/pull/44) ([`dcf4276`](https://github.com/millionco/react-doctor/commit/dcf4276)) - Remove the silent global install introduced in 0.0.9; the CLI no
  longer auto-installs itself globally on first run. Resolves
  [#43](https://github.com/millionco/react-doctor/issues/43).

- [`7e20da1`](https://github.com/millionco/react-doctor/commit/7e20da1) - Refactor the diagnostic payload structure used by the
  score-estimation API and tighten its validation.

- [`da83168`](https://github.com/millionco/react-doctor/commit/da83168) - Enhance the React Doctor skill installation script with detailed
  usage instructions and support for multiple platforms.

## 0.0.24

### Patch Changes

- [#33](https://github.com/millionco/react-doctor/pull/33) ([`c2b687a`](https://github.com/millionco/react-doctor/commit/c2b687a)) - Detect React Compiler in Expo projects.

- [#37](https://github.com/millionco/react-doctor/pull/37) ([`7f49833`](https://github.com/millionco/react-doctor/commit/7f49833)) - Chore: add node.js to leaderboard.

## 0.0.23

### Patch Changes

- [`c05f4b0`](https://github.com/millionco/react-doctor/commit/c05f4b0) / [`b33976c`](https://github.com/millionco/react-doctor/commit/b33976c) - Patch sweep - assorted rule and CLI false-positive fixes.

## 0.0.22

### Patch Changes

- [`84bb6d5`](https://github.com/millionco/react-doctor/commit/84bb6d5) / [`61406e0`](https://github.com/millionco/react-doctor/commit/61406e0) / [`1b07fa2`](https://github.com/millionco/react-doctor/commit/1b07fa2) / [`0299fc4`](https://github.com/millionco/react-doctor/commit/0299fc4) - Patch sweep - rule false-positive fixes and formatting follow-ups.

## 0.0.21

### Patch Changes

- [`73da9e2`](https://github.com/millionco/react-doctor/commit/73da9e2) - Add the `--offline` flag so the CLI skips network calls (telemetry,
  the leaderboard upload step) for users behind firewalls or in
  air-gapped CI.

## 0.0.20

### Patch Changes

- [`45a3d33`](https://github.com/millionco/react-doctor/commit/45a3d33) / [`d90a60d`](https://github.com/millionco/react-doctor/commit/d90a60d) / [`b2d0b64`](https://github.com/millionco/react-doctor/commit/b2d0b64) - Surface stderr from `oxlint` / `knip` invocations so failures
  produce diagnosable error messages instead of a silent non-zero
  exit. Also updates CLI option docs.

## 0.0.19

### Patch Changes

- [`b8cc03a`](https://github.com/millionco/react-doctor/commit/b8cc03a) / [`2d2f7a1`](https://github.com/millionco/react-doctor/commit/2d2f7a1) - Update CLI options, enhance configuration documentation, and
  miscellaneous fixes.

## 0.0.18

### Patch Changes

- [#17](https://github.com/millionco/react-doctor/pull/17) ([`64d837b`](https://github.com/millionco/react-doctor/commit/64d837b)) - Add `typescript` as a direct dependency to resolve the knip peer
  requirement; previously users without TypeScript installed got a
  warning on every scan.

## 0.0.17

### Patch Changes

- [`5c2119b`](https://github.com/millionco/react-doctor/commit/5c2119b) / [`116d6cd`](https://github.com/millionco/react-doctor/commit/116d6cd) - Enhance error handling in dead-code detection so a knip failure no
  longer drops the rest of the scan output.

## 0.0.16

### Patch Changes

- [`06fb14e`](https://github.com/millionco/react-doctor/commit/06fb14e) - Improve error handling in the linting and dead-code analysis paths
  so failures log a useful message instead of a stack trace.

- [`595ca55`](https://github.com/millionco/react-doctor/commit/595ca55) - Remove the video package from `main` (kept on a separate branch for
  asset generation).

## 0.0.15

### Patch Changes

- [`e8cfef0`](https://github.com/millionco/react-doctor/commit/e8cfef0) / [`1410650`](https://github.com/millionco/react-doctor/commit/1410650) - Update `react-doctor` package configuration / constants and refresh
  the README with usage docs for the published node API.

## 0.0.14

### Patch Changes

- [`90ffa0a`](https://github.com/millionco/react-doctor/commit/90ffa0a) - Add `llms.txt` so models discovering the package via the npm
  registry can find structured docs.

- [`e218d63`](https://github.com/millionco/react-doctor/commit/e218d63) - Format the leaderboard data files to satisfy CI `format:check`.

## 0.0.13

### Patch Changes

- [#11](https://github.com/millionco/react-doctor/pull/11) ([`2d2f779`](https://github.com/millionco/react-doctor/commit/2d2f779)) - React Doctor branding refresh: theme-aware README logo + asset
  refresh. Reverted in [`28d820a`](https://github.com/millionco/react-doctor/commit/28d820a) when the assets failed to render
  correctly on npm.

- [#12](https://github.com/millionco/react-doctor/pull/12) ([`5fc130d`](https://github.com/millionco/react-doctor/commit/5fc130d)) - Fix the favicon badge ring cutout.

- [#14](https://github.com/millionco/react-doctor/pull/14) ([`67bad8f`](https://github.com/millionco/react-doctor/commit/67bad8f)) - Set the Twitter image to the brand banner.

## 0.0.12

### Patch Changes

- [`b200689`](https://github.com/millionco/react-doctor/commit/b200689) / [`4519747`](https://github.com/millionco/react-doctor/commit/4519747) / [`7f0b4d2`](https://github.com/millionco/react-doctor/commit/7f0b4d2) / [`6d1ae5e`](https://github.com/millionco/react-doctor/commit/6d1ae5e) / [`5688c1f`](https://github.com/millionco/react-doctor/commit/5688c1f) / [`6dd481a`](https://github.com/millionco/react-doctor/commit/6dd481a) / [`ce8437e`](https://github.com/millionco/react-doctor/commit/ce8437e) - Iteration sweep on detection / output formatting / README copy
  during the pre-1.0 stabilization push.

## 0.0.11

### Patch Changes

- [`db319d0`](https://github.com/millionco/react-doctor/commit/db319d0) / [`358750a`](https://github.com/millionco/react-doctor/commit/358750a) - Environment-variable handling fix: thread the documented
  `REACT_DOCTOR_*` env vars through the score-estimation API call so
  CI overrides actually take effect.

## 0.0.10

### Patch Changes

- [`e5ef934`](https://github.com/millionco/react-doctor/commit/e5ef934) - "Almost ready" milestone - the rule pipeline + scoring + CLI surface
  are end-to-end functional for the first time. No discrete commits
  between 0.0.9 and 0.0.10 beyond the version bump itself.

## 0.0.9

### Patch Changes

- [#2](https://github.com/millionco/react-doctor/pull/2) ([`1ae6094`](https://github.com/millionco/react-doctor/commit/1ae6094)) - Improve the `--prompt` clipboard output emitted for agent fixes
  (Ami-style copy block formatting).

- [#3](https://github.com/millionco/react-doctor/pull/3) ([`f664ca2`](https://github.com/millionco/react-doctor/commit/f664ca2)) - Fix the multiselect `a`-key select-all behavior in the interactive
  CLI prompt.

- [#4](https://github.com/millionco/react-doctor/pull/4) ([`940e82a`](https://github.com/millionco/react-doctor/commit/940e82a)) - Indent multi-line diagnostic help output in the CLI scan summary.

- [#5](https://github.com/millionco/react-doctor/pull/5) ([`00f21ec`](https://github.com/millionco/react-doctor/commit/00f21ec)) - Color diagnostic counts by severity in the CLI summary.

- [#6](https://github.com/millionco/react-doctor/pull/6) ([`c55edc9`](https://github.com/millionco/react-doctor/commit/c55edc9)) - Add severity icons to the summary counts.

- [#7](https://github.com/millionco/react-doctor/pull/7) ([`8894a54`](https://github.com/millionco/react-doctor/commit/8894a54)) - Frame the summary footer output (boxed border around the final
  score line).

- [#9](https://github.com/millionco/react-doctor/pull/9) ([`a66c977`](https://github.com/millionco/react-doctor/commit/a66c977)) - Move the website video overlays to a bottom-gradient layout and
  darken them.

- [`b5ea69b`](https://github.com/millionco/react-doctor/commit/b5ea69b) - Add the GitHub Action for CI integration and fix monorepo scanning
  inside CI environments.

- [`578e75a`](https://github.com/millionco/react-doctor/commit/578e75a) - Auto-install globally in the background when run via `npx`. (Later
  removed in 0.0.25 / #44 because it surprised users.)

- [`bde1167`](https://github.com/millionco/react-doctor/commit/bde1167) - Add the video package and Ami skills for marketing-asset
  generation.

## 0.0.8

### Patch Changes

- [`19fa34b`](https://github.com/millionco/react-doctor/commit/19fa34b) - Resolve a merge conflict in `cli.ts` introduced in 0.0.7.

- [`eef87e0`](https://github.com/millionco/react-doctor/commit/eef87e0) - Use a single deeplink for `--fix` instead of the two-step deeplink

  - sleep dance.

- [`9cf691d`](https://github.com/millionco/react-doctor/commit/9cf691d) / [`21c0d61`](https://github.com/millionco/react-doctor/commit/21c0d61) - Skill install prompt copy refresh and README cleanup (remove the
  rules table, promote `install` above `options`).

## 0.0.7

### Patch Changes

- [`2ae9b87`](https://github.com/millionco/react-doctor/commit/2ae9b87) - Fix the `--fix` deeplink to open the project with the correct cwd
  and autosend the prompt.

## 0.0.6

### Patch Changes

- [`f9157c7`](https://github.com/millionco/react-doctor/commit/f9157c7) - Add the `no-side-effect-in-get-handler` rule and export the oxlint
  plugin as a standalone entrypoint.

- [`9965871`](https://github.com/millionco/react-doctor/commit/9965871) / [`80d676e`](https://github.com/millionco/react-doctor/commit/80d676e) - Add the website with the animated CLI terminal landing page, and
  update the README with consumer-friendly docs.

- [`8379064`](https://github.com/millionco/react-doctor/commit/8379064) / [`de1cbd4`](https://github.com/millionco/react-doctor/commit/de1cbd4) - Add `fix` and `install-ami` commands that deeplink into Ami for
  automated rule application.

- [`330afc2`](https://github.com/millionco/react-doctor/commit/330afc2) / [`7aa7b3f`](https://github.com/millionco/react-doctor/commit/7aa7b3f) / [`05d2f79`](https://github.com/millionco/react-doctor/commit/05d2f79) / [`4dfaeab`](https://github.com/millionco/react-doctor/commit/4dfaeab) - Add ASCII doctor face / box branding to the CLI score output and
  the website terminal.

- [`b1f1abc`](https://github.com/millionco/react-doctor/commit/b1f1abc) - Add the CI workflow for e2e tests, lint, and format.

- [`4b481c8`](https://github.com/millionco/react-doctor/commit/4b481c8) - Add the React Doctor skill and the install prompt on first run.

## 0.0.5

### Patch Changes

- [`ccf404a`](https://github.com/millionco/react-doctor/commit/ccf404a) - Gracefully handle failures in `oxlint`, the reduced-motion check,
  and summary-file writing so a single subsystem can't take down the
  scan.

- [`f1407d7`](https://github.com/millionco/react-doctor/commit/f1407d7) - Gracefully handle knip failures on non-React config files.

- Project scoring (the 0–100 health score) lands in this release.

## 0.0.4

### Patch Changes

- [`2d9a69b`](https://github.com/millionco/react-doctor/commit/2d9a69b) - Add actionable help text, animation rules, per-rule summary files,
  and strengthen the framework / dependency detection.

- [`327c076`](https://github.com/millionco/react-doctor/commit/327c076) - Move the website source into `packages/website`.

## 0.0.3

### Patch Changes

- [`680e7c4`](https://github.com/millionco/react-doctor/commit/680e7c4) - Reduce default scan noisiness - tighter default rule severity
  thresholds for the first user-facing prerelease.

## 0.0.2

### Patch Changes

- [`a8770b7`](https://github.com/millionco/react-doctor/commit/a8770b7) - Add CLI scaffolding with the initial oxlint integration: scan
  command, oxlint runner, diagnostic-collection pipeline.

## 0.0.1

### Patch Changes

- [`f50426b`](https://github.com/millionco/react-doctor/commit/f50426b) - Initial publish - empty package scaffold to claim the npm name.
