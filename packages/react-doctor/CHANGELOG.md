# react-doctor

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
