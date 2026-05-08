# react-doctor

## 0.0.47

### Patch Changes

- fix
- 6a0e6d6: chore(react-doctor): bump oxlint to ^1.62.0

  Pulls in oxlint v1.61.0 + v1.62.0 improvements (additional Vue rules,
  jest/vitest rule splits, autofix for prefer-template, no-unknown-property
  support for React 19's precedence prop, jsx-a11y/anchor-is-valid attribute
  settings, and various correctness fixes). The release-line breaking
  changes are internal Rust API only — oxlint's CLI and config schema
  are unchanged.

- dbf200d: fix(react-doctor): filter React Compiler rules to those the loaded `eslint-plugin-react-hooks` actually exports

  Follow-up to the #141 fix in 0.0.46. The peer range `^6 || ^7` allows
  v6.x of `eslint-plugin-react-hooks`, which doesn't expose the
  `void-use-memo` rule (added in v7). When a v6 user had React
  Compiler detected, oxlint failed with
  `Rule 'void-use-memo' not found in plugin 'react-hooks-js'`. The
  config now introspects the loaded plugin's `rules` map and only
  enables `react-hooks-js/*` entries that the installed version
  actually exports — so future rule additions or removals can no
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

- fix

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

- fix

## 0.0.44

### Patch Changes

- fix

## 0.0.43

### Patch Changes

- **Respect existing eslint / oxlint / prettier ignores by default.** React Doctor now honors `.gitignore`, `.eslintignore`, `.oxlintignore`, `.prettierignore`, and `.gitattributes` `linguist-vendored` / `linguist-generated` annotations, plus inline `// eslint-disable*` and `// oxlint-disable*` comments. Previously inline disable comments were neutralized so react-doctor saw through every prior suppression — this surprised users who had `eslint-disable` in place for legitimate reasons. **Behavior change:** existing users may see fewer findings (previously-suppressed code is now correctly suppressed). To restore the old "audit everything" behavior, set `"respectInlineDisables": false` in `react-doctor.config.json` or pass `--no-respect-inline-disables` on the CLI.
- **Internals:** the ignore-pattern collector now writes a single combined `--ignore-path` file rather than passing N `--ignore-pattern` args; this removes a `baseArgs`-length pressure point that could shrink batch sizes on large diffs. Boolean config fields (`lint`, `deadCode`, `verbose`, `customRulesOnly`, `share`, `respectInlineDisables`) are now coerced from the common `"true"` / `"false"` JSON-string typo at config-load time, with a warning. The `parseOxlintOutput` "no files to lint" workaround is now locale-agnostic (it skips any noise before the first `{`). The non-git audit-mode fallback walks the project tree directly instead of silently no-op'ing when `git grep` isn't available. New regression suite covers all of the above end-to-end.

## 0.0.42

### Patch Changes

- 79fb877: Fix `Dead code detection failed (non-fatal, skipping)` (#135). The plugin-failure detector now walks the error cause chain, matches Windows-style paths, plugin configs without a leading directory, and parser errors, so knip plugin loading errors are recovered from in more environments. The retry loop also now surfaces the original knip error after exhausting attempts (previously could throw a generic `Unreachable` error) and only disables knip plugin keys it actually recognizes. Dead-code and lint failures are now reported with the full cause chain instead of a single wrapped `Error loading …` line.
- 391b751: Fix knip step ignoring workspace-local config in monorepos (#136). When a workspace owns its own knip config (`knip.json`, `knip.jsonc`, `knip.ts`, etc.), `runKnip` now runs knip with `cwd = workspaceDirectory` so the config is discovered, instead of running from the monorepo root with `--workspace` and silently falling back to knip's defaults — which mass-flagged every file as `Unused file` for setups like TanStack Start whose entry layout doesn't match the defaults. Behavior for monorepos with a root-level `knip.json` containing a `workspaces` mapping is unchanged.

## 0.0.41

### Patch Changes

- fix

## 0.0.40

### Patch Changes

- fix

## 0.0.39

### Patch Changes

- 7da4ce4: Fix `TypeError: issues.files is not iterable` crash during dead code detection. Knip 6.x returns `issues.files` as an `IssueRecords` object instead of a `Set<string>`. The dead code pass now handles both shapes (and arrays) defensively.
- fix

## 0.0.37

### Patch Changes

- fix skill

## 0.0.36

### Patch Changes

- fix

## 0.0.35

### Patch Changes

- fix

## 0.0.34

### Patch Changes

- fix

## 0.0.33

### Patch Changes

- fix

## 0.0.32

### Patch Changes

- fix

## 0.0.31

### Patch Changes

- fix

## 0.0.30

### Patch Changes

- fix issues

## 0.0.29

### Patch Changes

- fix

## 0.0.28

### Patch Changes

- fix

## 0.0.27

### Patch Changes

- cleanip

## 0.0.26

### Patch Changes

- fix

## 0.0.25

### Patch Changes

- fix

## 0.0.24

### Patch Changes

- fix

## 0.0.23

### Patch Changes

- fix issues

## 0.0.22

### Patch Changes

- fix

## 0.0.21

### Patch Changes

- offline flag

## 0.0.20

### Patch Changes

- log err

## 0.0.19

### Patch Changes

- fix issues

## 0.0.18

### Patch Changes

- fix

## 0.0.17

### Patch Changes

- add lopgging

## 0.0.16

### Patch Changes

- fix: log lint errors

## 0.0.15

### Patch Changes

- export node api

## 0.0.14

### Patch Changes

- fix repo

## 0.0.13

### Patch Changes

- fix: skill

## 0.0.12

### Patch Changes

- fix

## 0.0.11

### Patch Changes

- fix: enviroment vars

## 0.0.10

### Patch Changes

- almost ready

## 0.0.9

### Patch Changes

- fix

## 0.0.8

### Patch Changes

- react doctor

## 0.0.7

### Patch Changes

- fix: deeplinking

## 0.0.6

### Patch Changes

- fix: improvements

## 0.0.5

### Patch Changes

- scores

## 0.0.4

### Patch Changes

- fix

## 0.0.3

### Patch Changes

- fix: noisiness

## 0.0.2

### Patch Changes

- init

## 0.0.1

### Patch Changes

- init
