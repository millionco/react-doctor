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

```yaml
- uses: actions/checkout@v5
  with:
    fetch-depth: 0 # required for --diff
- uses: millionco/react-doctor@main
  with:
    diff: main
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

When `github-token` is set on `pull_request` events, findings are posted as a PR comment. The action also outputs a `score` (0 to 100) you can use in subsequent steps.

## Configuration

Create a `react-doctor.config.json` in your project root:

```json
{
  "ignore": {
    "rules": ["react/no-danger", "jsx-a11y/no-autofocus"],
    "files": ["src/generated/**"],
    "overrides": [
      {
        "files": ["components/diff/**"],
        "rules": ["react-doctor/no-array-index-as-key"]
      }
    ]
  }
}
```

`ignore.rules` silences a rule everywhere. `ignore.files` silences every rule on matched files. `ignore.overrides` silences specific rules in specific directories. You can also use the `"reactDoctor"` key in `package.json`. CLI flags always override config values.

React Doctor respects `.gitignore`, `.eslintignore`, `.oxlintignore`, `.prettierignore`, and `linguist-vendored` / `linguist-generated` annotations in `.gitattributes`. Inline `// eslint-disable*` and `// oxlint-disable*` comments are honored too.

If you have a JSON oxlint or eslint config (`.oxlintrc.json` or `.eslintrc.json`), its rules get merged into the scan automatically and count toward the score. Set `adoptExistingLintConfig: false` to opt out.

### Inline suppressions

```tsx
// react-doctor-disable-next-line react-doctor/no-cascading-set-state
useEffect(() => {
  setA(value);
  setB(value);
}, [value]);
```

When two rules fire on the same line, comma-separate the rule ids on a single comment. Block comments work inside JSX:

<!-- prettier-ignore -->
```tsx
{/* react-doctor-disable-next-line react/no-danger */}
<div dangerouslySetInnerHTML={{ __html }} />
```

For multi-line JSX, putting the comment immediately above the opening tag covers the entire attribute list (matching ESLint convention).

## Lint plugin (standalone)

The same rule set ships as both an oxlint plugin and an ESLint plugin, so you can wire it into whichever lint engine your project already runs.

**oxlint** in `.oxlintrc.json`:

```jsonc
{
  "jsPlugins": [{ "name": "react-doctor", "specifier": "react-doctor/oxlint-plugin" }],
  "rules": {
    "react-doctor/no-fetch-in-effect": "warn",
    "react-doctor/no-derived-state-effect": "warn",
  },
}
```

**ESLint** flat config:

```js
import reactDoctor from "react-doctor/eslint-plugin";

export default [
  reactDoctor.configs.recommended,
  reactDoctor.configs.next,
  reactDoctor.configs["react-native"],
  reactDoctor.configs["tanstack-start"],
  reactDoctor.configs["tanstack-query"],
];
```

The full rule list lives in [`oxlint-config.ts`](https://github.com/millionco/react-doctor/blob/main/packages/react-doctor/src/oxlint-config.ts).

## CLI reference

```
Usage: react-doctor [directory] [options]

Options:
  -v, --version           display the version number
  --no-lint               skip linting
  --no-dead-code          skip dead code detection
  --verbose               show every rule and per-file details (default shows top 3 rules)
  --score                 output only the score
  --json                  output a single structured JSON report
  -y, --yes               skip prompts, scan all workspace projects
  --full                  skip prompts, always run a full scan
  --project <name>        select workspace project (comma-separated for multiple)
  --diff [base]           scan only files changed vs base branch
  --staged                scan only staged files (for pre-commit hooks)
  --offline               skip telemetry
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
| `deadCode`                 | `boolean`                        | `true`   |
| `verbose`                  | `boolean`                        | `false`  |
| `diff`                     | `boolean \| string`              |          |
| `failOn`                   | `"error" \| "warning" \| "none"` | `"none"` |
| `customRulesOnly`          | `boolean`                        | `false`  |
| `share`                    | `boolean`                        | `true`   |
| `textComponents`           | `string[]`                       | `[]`     |
| `rawTextWrapperComponents` | `string[]`                       | `[]`     |
| `respectInlineDisables`    | `boolean`                        | `true`   |
| `adoptExistingLintConfig`  | `boolean`                        | `true`   |

`textComponents` is the broad escape hatch for `rn-no-raw-text` — list components that themselves behave like React Native's `<Text>` (custom `Typography`, `NativeTabs.Trigger.Label`, etc.) and the rule will treat them as text containers regardless of what their children look like.

`rawTextWrapperComponents` is the narrower option for components that are not text elements but safely route string-only children through an internal `<Text>` (e.g. `heroui-native`'s `Button`, which stringifies its children and renders them through a `ButtonLabel`). Listed wrappers suppress `rn-no-raw-text` only when their children are entirely stringifiable. A wrapper with mixed children — e.g. `<Button>Save<Icon /></Button>` — still reports because the wrapper can't safely route raw text alongside a sibling JSX element.

## Node.js API

```js
import { diagnose, toJsonReport, summarizeDiagnostics } from "react-doctor/api";

const result = await diagnose("./path/to/your/react-project");

console.log(result.score); // { score: 82, label: "Great" } or null
console.log(result.diagnostics); // Diagnostic[]
console.log(result.project); // detected framework, React version, etc.
```

`diagnose` accepts a second argument: `{ lint?: boolean, deadCode?: boolean }`.

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
| 1  | [executor](https://github.com/RhysSullivan/executor) | 96 |
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
