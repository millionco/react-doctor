<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="180" height="40">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

Your agent writes bad React, this catches it.

One command scans your codebase and outputs a **0 to 100 health score** with actionable diagnostics.

Works with Next.js, Vite, and React Native.

### [See it in action →](https://react.doctor)

## Install

Run this at your project root:

```bash
npx -y react-doctor@latest .
```

You'll get a score (75+ Great, 50 to 74 Needs work, under 50 Critical) and a list of issues across state & effects, performance, architecture, security, accessibility, and dead code. Rules toggle automatically based on your framework and React version.

https://github.com/user-attachments/assets/07cc88d9-9589-44c3-aa73-5d603cb1c570

## Install for your coding agent

Teach your coding agent React best practices so it stops writing the bad code in the first place.

```bash
npx -y react-doctor@latest install
```

You'll be prompted to pick which detected agents to install for. Pass `--yes` to skip prompts.

Works with Claude Code, Cursor, Codex, OpenCode, and 50+ other agents.

## GitHub Actions

A composite action ships with this repository. Drop it into `.github/workflows/react-doctor.yml`:

```yaml
name: React Doctor

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write # required to post PR comments

jobs:
  react-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # required for `diff`
      - uses: millionco/react-doctor@main
        with:
          diff: main
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

When `github-token` is set on `pull_request` events, findings are posted (and updated) as a PR comment. The action also exposes a `score` output (0–100) you can use in subsequent steps.

**Inputs:** `directory`, `verbose`, `project`, `diff`, `github-token`, `fail-on` (`error` / `warning` / `none`), `offline`, `node-version`. See [`action.yml`](https://github.com/millionco/react-doctor/blob/main/action.yml) for full descriptions.

Prefer not to add a marketplace action? The bare `npx` form works too:

```yaml
- run: npx -y react-doctor@latest --fail-on warning
```

## Configuration

Create a `react-doctor.config.json` in your project root:

```json
{
  "ignore": {
    "rules": ["react/no-danger", "jsx-a11y/no-autofocus"],
    "files": ["src/generated/**"],
    "overrides": [
      {
        "files": ["components/modules/diff/**"],
        "rules": ["react-doctor/no-array-index-as-key", "react-doctor/no-render-in-render"]
      },
      {
        "files": ["components/search/HighlightedSnippet.tsx"],
        "rules": ["react/no-danger"]
      }
    ]
  }
}
```

Three nested keys, three layers of granularity — pick the narrowest one that fits:

- **`ignore.rules`** silences a rule across the whole codebase.
- **`ignore.files`** silences **every** rule on the matched files (use sparingly — it loses coverage for unrelated rules).
- **`ignore.overrides`** silences only the listed rules on the matched files, leaving every other rule active. This is what you want when a single file (or glob) legitimately needs an exemption from one or two rules but should still be scanned for everything else.

You can also use the `"reactDoctor"` key in `package.json`. CLI flags always override config values.

React Doctor respects `.gitignore`, `.eslintignore`, `.oxlintignore`, `.prettierignore`, and `linguist-vendored` / `linguist-generated` annotations in `.gitattributes`. Inline `// eslint-disable*` and `// oxlint-disable*` comments are honored too.

If you have a JSON oxlint or eslint config (`.oxlintrc.json` or `.eslintrc.json`), its rules get merged into the scan automatically and count toward the score. Set `adoptExistingLintConfig: false` to opt out.

#### Optional companion plugins

When the following ESLint plugins are installed in the scanned project (or hoisted in your monorepo), React Doctor folds their rules into the same scan. Both are listed as **optional peer dependencies** — install only what you want.

| Plugin                                                                                                                                          | Adds                                                                                                                                                                                                        | Namespace          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| [`eslint-plugin-react-hooks`](https://www.npmjs.com/package/eslint-plugin-react-hooks) (v6 or v7)                                               | The React Compiler frontend's correctness rules — fired when a React Compiler is detected in the project.                                                                                                   | `react-hooks-js/*` |
| [`eslint-plugin-react-you-might-not-need-an-effect`](https://github.com/nickjvandyke/eslint-plugin-react-you-might-not-need-an-effect) (v0.10+) | Complementary effects-as-anti-pattern rules (`no-derived-state`, `no-chain-state-updates`, `no-event-handler`, `no-pass-data-to-parent`, …) that run alongside React Doctor's native State & Effects rules. | `effect/*`         |

### Inline suppressions

```tsx
// react-doctor-disable-next-line react-doctor/no-cascading-set-state
useEffect(() => {
  setA(value);
  setB(value);
}, [value]);
```

When two rules fire on the same line, you have two equivalent options. Comma-separate the rule ids on a single comment:

```tsx
// react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers, react-doctor/no-derived-useState
const [localSearch, setLocalSearch] = useState(searchQuery);
```

Or stack one comment per rule directly above the diagnostic. Stacked comments are honored as long as nothing but other `react-doctor-disable-next-line` comments sits between them and the target line:

```tsx
// react-doctor-disable-next-line react-doctor/rerender-state-only-in-handlers
// react-doctor-disable-next-line react-doctor/no-derived-useState
const [localSearch, setLocalSearch] = useState(searchQuery);
```

A code line between stacked comments breaks the chain: only the comment immediately above the diagnostic (and any contiguous `react-doctor-disable-next-line` comments stacked on top of it) is honored. If a comment looks adjacent but the rule still fires, run `react-doctor --explain <file:line>` — it reports whether a nearby suppression was found, what rules it covers, and why it didn't apply.

Block comments work inside JSX:

<!-- prettier-ignore -->
```tsx
{/* react-doctor-disable-next-line react/no-danger */}
<div dangerouslySetInnerHTML={{ __html }} />
```

For multi-line JSX, putting the comment immediately above the opening tag covers the entire attribute list (matching ESLint convention).

## Lint plugin (standalone)

The same rule set ships as both an oxlint plugin and an ESLint plugin, so you can wire it into whichever lint engine your project already runs. These are published as separate packages, so you can install just the lint integration without pulling in the full CLI.

**oxlint** in `.oxlintrc.json` (install [`oxlint-plugin-react-doctor`](https://npmjs.com/package/oxlint-plugin-react-doctor)):

```jsonc
{
  "jsPlugins": [{ "name": "react-doctor", "specifier": "oxlint-plugin-react-doctor" }],
  "rules": {
    "react-doctor/no-fetch-in-effect": "warn",
    "react-doctor/no-derived-state-effect": "warn",
  },
}
```

**ESLint** flat config (install [`eslint-plugin-react-doctor`](https://npmjs.com/package/eslint-plugin-react-doctor)):

```js
import reactDoctor from "eslint-plugin-react-doctor";

export default [
  reactDoctor.configs.recommended,
  reactDoctor.configs.next,
  reactDoctor.configs["react-native"],
  reactDoctor.configs["tanstack-start"],
  reactDoctor.configs["tanstack-query"],
];
```

The full rule list lives in [`packages/oxlint-plugin-react-doctor/src/plugin/rules`](https://github.com/millionco/react-doctor/tree/main/packages/oxlint-plugin-react-doctor/src/plugin/rules).

## CLI reference

```
Usage: react-doctor [directory] [options]

Options:
  -v, --version           display the version number
  --no-lint               skip linting
  --verbose               show every rule and per-file details (default shows top 3 rules)
  --score                 output only the score
  --json                  output a single structured JSON report
  -y, --yes               skip prompts, scan all workspace projects
  --full                  skip prompts, always run a full scan
  --project <name>        select workspace project (comma-separated for multiple)
  --diff [base]           scan only files changed vs base branch
  --staged                scan only staged files (for pre-commit hooks)
  --offline               skip the score API and share URL (no score shown)
  --fail-on <level>       exit with error on diagnostics: error, warning, none
  --annotations           output diagnostics as GitHub Actions annotations
  --explain <file:line>   diagnose why a rule fired or why a suppression didn't apply
  --why <file:line>       alias for --explain
  -h, --help              display help
```

When a suppression isn't working, `--explain <file:line>` (or its alias `--why <file:line>`) reports what the scanner sees at that location, including why a nearby `react-doctor-disable-next-line` didn't apply. The diagnosis distinguishes the common failure modes — adjacent comment for a different rule (use the comma form), a code line between the comment and the diagnostic (the chain is broken), or no nearby suppression at all. The same hint surfaces inline with `--verbose` for every flagged site, and in `--json` output as `diagnostic.suppressionHint`, so a single scan doubles as a suppression audit without a separate flag.

`--json` produces a parsable object on stdout with all human-readable output suppressed. Errors still produce a JSON object with `ok: false`, so stdout is always a valid document.

### Config keys

| Key                        | Type                             | Default  |
| -------------------------- | -------------------------------- | -------- |
| `ignore.rules`             | `string[]`                       | `[]`     |
| `ignore.files`             | `string[]`                       | `[]`     |
| `ignore.overrides`         | `{ files, rules? }[]`            | `[]`     |
| `lint`                     | `boolean`                        | `true`   |
| `verbose`                  | `boolean`                        | `false`  |
| `diff`                     | `boolean \| string`              |          |
| `failOn`                   | `"error" \| "warning" \| "none"` | `"none"` |
| `customRulesOnly`          | `boolean`                        | `false`  |
| `share`                    | `boolean`                        | `true`   |
| `offline`                  | `boolean`                        | `false`  |
| `textComponents`           | `string[]`                       | `[]`     |
| `rawTextWrapperComponents` | `string[]`                       | `[]`     |
| `respectInlineDisables`    | `boolean`                        | `true`   |
| `adoptExistingLintConfig`  | `boolean`                        | `true`   |
| `ignore.tags`              | `string[]`                       | `[]`     |

`textComponents` is the broad escape hatch for `rn-no-raw-text` — list components that themselves behave like React Native's `<Text>` (custom `Typography`, `NativeTabs.Trigger.Label`, etc.) and the rule will treat them as text containers regardless of what their children look like.

`rawTextWrapperComponents` is the narrower option for components that are not text elements but safely route string-only children through an internal `<Text>` (e.g. `heroui-native`'s `Button`, which stringifies its children and renders them through a `ButtonLabel`). Listed wrappers suppress `rn-no-raw-text` only when their children are entirely stringifiable. A wrapper with mixed children — e.g. `<Button>Save<Icon /></Button>` — still reports because the wrapper can't safely route raw text alongside a sibling JSX element.

`ignore.tags` suppresses entire categories of rules by tag. For example, `"tags": ["design"]` disables all opinionated design rules (gradient text, pure black backgrounds, side tab borders, default Tailwind palettes). Available tags: `"design"`.

`offline` skips the score API entirely — no score is shown and no share URL is generated. Automatically enabled in CI environments (GitHub Actions, GitLab CI, CircleCI) so CI runs don't depend on the network.

## Scoring

The health score formula: `100 - (unique_error_rules x 1.5) - (unique_warning_rules x 0.75)`.

Scoring runs on react.doctor's API and is **network-dependent**: without a successful API round-trip (or under `--offline`) the score is omitted and the rest of the report still renders normally. Key details:

- The score counts **unique rules triggered**, not total instances. Fixing 49 of 50 `no-barrel-import` violations does not change the score; fixing all 50 removes the 0.75 penalty for that rule.
- Error-severity rules cost 1.5 points each. Warning-severity rules cost 0.75 points each.
- Category breakdowns shown in the output are for display only and do not weight the score.

Score labels: 75+ is **Great**, 50 to 74 is **Needs work**, under 50 is **Critical**.

Scores may decrease across releases as new rules are added. Each new rule that fires in your codebase introduces an additional penalty. This is expected — it means the tool is catching more issues, not that your code got worse. Pin to a specific react-doctor version in CI if you need stable scores across upgrades.

## Diff and staged modes

React Doctor can scan only changed files instead of the full project:

- **`--diff [base]`** scans files changed vs a base branch. Auto-detects `main`/`master`, or pass an explicit branch: `--diff develop`. Also available as a config key: `"diff": true` or `"diff": "develop"`.
- **`--staged`** scans only files in the git staging area (index). Designed for pre-commit hooks — materializes staged file contents into a temp directory so the scan reflects exactly what will be committed.
- **`--full`** forces a full scan, overriding any `diff` value in config or CLI.

When on a feature branch without explicit flags, you'll be prompted: "Only scan changed files?" This prompt is suppressed in CI, `--json` mode, and non-interactive environments.

`--staged` and `--diff` cannot be combined.

## Agent and CI integration

React Doctor detects 50+ coding agents (Claude Code, Cursor, Codex, OpenCode, Windsurf, and more) and adapts its behavior automatically:

- **Install for agents**: `npx react-doctor@latest install` writes agent-specific rule files (SKILL.md, AGENTS.md, .cursorrules) into your project so agents learn React best practices.
- **JSON output**: `--json` produces a structured `JsonReport` on stdout. Errors still produce a valid JSON document with `ok: false`. Use `--json-compact` for minimal whitespace.
- **Score-only output**: `--score` outputs just the numeric score (0-100), useful for threshold checks in agent loops.
- **GitHub Actions annotations**: `--annotations` emits `::error` / `::warning` format for inline PR annotations.
- **Exit codes**: `--fail-on error` (default) exits non-zero when error-severity diagnostics are found. Use `--fail-on warning` or `--fail-on none` to tune CI gating.
- **Programmatic API**: `import { diagnose } from "react-doctor/api"` for direct integration in scripts and automation.

In CI environments, prompts are automatically skipped and `--offline` is implied (no network round-trip; score is omitted from the output).

## Node.js API

```js
import { diagnose, toJsonReport, summarizeDiagnostics } from "react-doctor/api";

const result = await diagnose("./path/to/your/react-project");

console.log(result.score); // { score: 82, label: "Great" } or null
console.log(result.diagnostics); // Diagnostic[]
console.log(result.project); // detected framework, React version, etc.
```

`diagnose` accepts a second argument: `{ lint?: boolean }`.

```js
const report = toJsonReport(result, { version: "1.0.0" });
const counts = summarizeDiagnostics(result.diagnostics);
```

`react-doctor/api` re-exports `JsonReport`, `JsonReportSummary`, `JsonReportProjectEntry`, `JsonReportMode`, plus the lower-level `buildJsonReport` and `buildJsonReportError` builders. See [`packages/react-doctor/src/api.ts`](https://github.com/millionco/react-doctor/blob/main/packages/react-doctor/src/api.ts) for the full types.

## Leaderboard

Top React codebases scanned by React Doctor, ranked by score. Updated automatically from [millionco/react-doctor-benchmarks](https://github.com/millionco/react-doctor-benchmarks).

<!-- LEADERBOARD:START -->
<!-- prettier-ignore -->
| #  | Repo | Score |
| -- | ---- | ----: |
| 1  | [executor](https://github.com/RhysSullivan/executor) | 94 |
| 2  | [nodejs.org](https://github.com/nodejs/nodejs.org) | 86 |
| 3  | [tldraw](https://github.com/tldraw/tldraw) | 70 |
| 4  | [t3code](https://github.com/pingdotgg/t3code) | 68 |
| 5  | [better-auth](https://github.com/better-auth/better-auth) | 64 |
| 6  | [excalidraw](https://github.com/excalidraw/excalidraw) | 63 |
| 7  | [mastra](https://github.com/mastra-ai/mastra) | 63 |
| 8  | [payload](https://github.com/payloadcms/payload) | 60 |
| 9  | [typebot](https://github.com/baptisteArno/typebot.io) | 57 |
| 10 | [plane](https://github.com/makeplane/plane) | 56 |

<!-- LEADERBOARD:END -->

See the [full leaderboard](https://www.react.doctor/leaderboard).

## Resources & Contributing Back

Want to try it out? Check out [the demo](https://react.doctor).

Looking to contribute back? Clone the repo, install, build, and submit a PR.

```bash
git clone https://github.com/millionco/react-doctor
cd react-doctor
pnpm install
pnpm build
node packages/react-doctor/bin/react-doctor.js /path/to/your/react-project
```

Find a bug? Head to the [issue tracker](https://github.com/millionco/react-doctor/issues).

### License

React Doctor is MIT-licensed open-source software.
