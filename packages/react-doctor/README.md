<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="180" height="40">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

Let coding agents diagnose and fix your React code.

One command scans your codebase for security, performance, correctness, and architecture issues, then outputs a **0–100 score** with actionable diagnostics.

### [See it in action →](https://react.doctor)

https://github.com/user-attachments/assets/07cc88d9-9589-44c3-aa73-5d603cb1c570

## How it works

React Doctor detects your framework (Next.js, Vite, Remix, etc.), React version, and compiler setup, then runs two analysis passes **in parallel**:

1. **Lint**: Checks 60+ rules across state & effects, performance, architecture, bundle size, security, correctness, accessibility, and framework-specific categories (Next.js, React Native). Rules are toggled automatically based on your project setup.
2. **Dead code**: Detects unused files, exports, types, and duplicates.

Diagnostics are filtered through your config, then scored by severity (errors weigh more than warnings) to produce a **0–100 health score** (75+ Great, 50–74 Needs work, <50 Critical).

## Install

Run this at your project root:

```bash
npx -y react-doctor@latest .
```

Use `--verbose` to see affected files and line numbers:

```bash
npx -y react-doctor@latest . --verbose
```

## Install for your coding agent

Teach your coding agent React best practices. Run this at your project root:

```bash
npx -y react-doctor@latest install
```

You'll be prompted to pick which detected agents to install for. Pass `--yes` to skip prompts and install for every detected agent.

Supports Claude Code, Codex, GitHub Copilot, Gemini CLI, Cursor, OpenCode, Factory Droid, and Pi.

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

| Input          | Default | Description                                                       |
| -------------- | ------- | ----------------------------------------------------------------- |
| `directory`    | `.`     | Project directory to scan                                         |
| `verbose`      | `true`  | Show file details per rule                                        |
| `project`      |         | Workspace project(s) to scan (comma-separated)                    |
| `diff`         |         | Base branch for diff mode. Only changed files are scanned         |
| `github-token` |         | When set on `pull_request` events, posts findings as a PR comment |
| `fail-on`      | `error` | Exit with error code on diagnostics: `error`, `warning`, `none`   |
| `offline`      | `false` | Skip sending diagnostics to the react.doctor API                  |
| `node-version` | `22`    | Node.js version to use                                            |

The action outputs a `score` (0–100) you can use in subsequent steps.

## Options

```
Usage: react-doctor [directory] [options]

Options:
  -v, --version      display the version number
  --no-lint          skip linting
  --no-dead-code     skip dead code detection
  --verbose          show file details per rule
  --score            output only the score
  --json             output a single structured JSON report (suppresses other output)
  -y, --yes          skip prompts, scan all workspace projects
  --full             skip prompts, always run a full scan (decline diff-only)
  --project <name>   select workspace project (comma-separated for multiple)
  --diff [base]      scan only files changed vs base branch
  --offline          skip telemetry (anonymous, not stored, only used to calculate score)
  --staged           scan only staged (git index) files for pre-commit hooks
  --fail-on <level>  exit with error code on diagnostics: error, warning, none
  --annotations      output diagnostics as GitHub Actions annotations
  -h, --help         display help for command
```

## JSON output

Pass `--json` to get a single, parsable JSON object on stdout. All human-readable output, prompts, and the share link are suppressed; pipe straight into `jq`, `node`, or any other tool:

```bash
npx -y react-doctor@latest . --json | jq '.summary'
```

Exit code is `0` on success and `1` if the scan throws or `--fail-on` is triggered. Errors still produce a JSON object with `ok: false`, so the stdout is always a valid document.

### Schema

```ts
interface JsonReport {
  schemaVersion: 1;
  version: string; // react-doctor version
  ok: boolean; // false when an error was thrown
  directory: string; // resolved root passed to the CLI
  mode: "full" | "diff" | "staged";
  diff: {
    baseBranch: string;
    currentBranch: string;
    changedFileCount: number;
    isCurrentChanges: boolean;
  } | null;
  projects: Array<{
    directory: string;
    project: ProjectInfo;
    diagnostics: Diagnostic[];
    score: { score: number; label: string } | null;
    skippedChecks: string[];
    elapsedMilliseconds: number;
  }>;
  diagnostics: Diagnostic[]; // flattened across all scanned projects
  summary: {
    errorCount: number;
    warningCount: number;
    affectedFileCount: number;
    totalDiagnosticCount: number;
    score: number | null; // worst project score, when available
    scoreLabel: string | null;
  };
  elapsedMilliseconds: number; // total wall time across all projects
  error: {
    message: string;
    name: string;
    chain: string[]; // outer error message first, every `error.cause`
    // unwrapped after; chain[0] always equals `message`
  } | null; // null on success, populated when ok=false
}
```

## Browser API

Import `react-doctor/browser` to run the same **diagnostics merge, config-based filtering, timing, and scoring pipeline** as `react-doctor/api`’s `diagnose`, but with **caller-supplied** inputs: `project` metadata, a virtual `projectFiles` map (contents keyed by paths relative to `rootDirectory`) for ignore/suppression resolution, and a `runOxlint` callback that performs linting in your environment (for example a Web Worker with oxlint).

Git history, real filesystem discovery, knip, the CLI, staged-file detection, and interactive prompts are **not** available in the browser bundle; treat those as Node-only or supply equivalents yourself. `react-doctor/worker` re-exports the same browser-facing modules for worker targets.

If you call **`diagnoseCore`** yourself in the browser, pass **`calculateDiagnosticsScore`** from this package (re-exported as **`calculateScore`** on `react-doctor/browser`) so the bundle never pulls in Node-only proxy code.

## Configuration

Create a `react-doctor.config.json` in your project root to customize behavior:

```json
{
  "ignore": {
    "rules": ["react/no-danger", "jsx-a11y/no-autofocus", "knip/exports"],
    "files": ["src/generated/**"]
  }
}
```

You can also use the `"reactDoctor"` key in your `package.json` instead:

```json
{
  "reactDoctor": {
    "ignore": {
      "rules": ["react/no-danger"]
    }
  }
}
```

If both exist, `react-doctor.config.json` takes precedence.

### Inline suppressions

Suppress a rule on a specific line with `// react-doctor-disable-line` or the next line with `// react-doctor-disable-next-line`:

```tsx
// react-doctor-disable-next-line react-doctor/no-cascading-set-state
useEffect(() => {
  setA(value);
  setB(value);
  setC(value);
}, [value]);

const value = expensiveComputation(); // react-doctor-disable-line react-doctor/no-usememo-simple-expression
```

Comma- or space-separate multiple rule ids on the same comment. With no rule id, the comment suppresses every diagnostic on that line.

### Respecting your existing project ignores

By default, React Doctor honors all of the ignore-style files your project already has, so you don't need to maintain a separate "what should react-doctor skip" list:

| File                                                         | What gets skipped                                                                                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.gitignore`                                                 | files git ignores (oxlint default)                                                                                                                                    |
| `.eslintignore`                                              | files eslint skips (oxlint default)                                                                                                                                   |
| `.oxlintignore`                                              | files oxlint skips (added via `--ignore-pattern` so `.eslintignore` still applies)                                                                                    |
| `.prettierignore`                                            | files prettier skips — typically vendored code, generated builds, and lockfiles                                                                                       |
| `.gitattributes` (`linguist-vendored`, `linguist-generated`) | paths GitHub's linguist library hides from language stats; if it's not "your" code by GitHub's reckoning, it shouldn't be audited as your code by react-doctor either |

React Doctor also respects inline lint suppressions in source files:

- `// oxlint-disable`, `// oxlint-disable-line`, `// oxlint-disable-next-line` — with or without rule ids.
- `// eslint-disable`, `// eslint-disable-line`, `// eslint-disable-next-line` — oxlint reads both prefixes interchangeably.

> Note: `.editorconfig` is intentionally NOT consulted. It describes editor settings (indent size, charset, end-of-line) and has no concept of "files to skip" — there's nothing in it that would change what react-doctor lints.

If you want React Doctor to ignore those inline suppressions and audit your codebase for everything (useful for one-off "what does my project actually score?" runs), set:

```jsonc
{ "respectInlineDisables": false }
```

This only neutralizes the inline `// eslint-disable*` / `// oxlint-disable*` comments — the file-level ignore lists above are always honored, even in audit mode, because they typically point at vendored or generated code that genuinely shouldn't be linted.

### Config options

| Key                     | Type                             | Default  | Description                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ignore.rules`          | `string[]`                       | `[]`     | Rules to suppress, using the `plugin/rule` format shown in diagnostic output (e.g. `react/no-danger`, `knip/exports`, `knip/types`)                                                                                                                  |
| `ignore.files`          | `string[]`                       | `[]`     | File paths to exclude, supports glob patterns (`src/generated/**`, `**/*.test.tsx`)                                                                                                                                                                  |
| `lint`                  | `boolean`                        | `true`   | Enable/disable lint checks (same as `--no-lint`)                                                                                                                                                                                                     |
| `deadCode`              | `boolean`                        | `true`   | Enable/disable dead code detection (same as `--no-dead-code`)                                                                                                                                                                                        |
| `verbose`               | `boolean`                        | `false`  | Show file details per rule (same as `--verbose`)                                                                                                                                                                                                     |
| `diff`                  | `boolean \| string`              | —        | Force diff mode (`true`) or pin a base branch (`"main"`). Set to `false` to disable auto-detection.                                                                                                                                                  |
| `failOn`                | `"error" \| "warning" \| "none"` | `"none"` | Exit with error code on diagnostics of the given severity or above                                                                                                                                                                                   |
| `customRulesOnly`       | `boolean`                        | `false`  | Disable built-in react/jsx-a11y/compiler rules, keeping only `react-doctor/*` plugin rules                                                                                                                                                           |
| `share`                 | `boolean`                        | `true`   | Show the share-your-results URL after scanning                                                                                                                                                                                                       |
| `textComponents`        | `string[]`                       | `[]`     | React Native only. Component names whose children should not trigger `rn-no-raw-text` (e.g. `["MyText", "Label.Bold"]`)                                                                                                                              |
| `respectInlineDisables` | `boolean`                        | `true`   | Respect inline `// eslint-disable*` / `// oxlint-disable*` comments. Set `false` for audit mode. File-level ignores (`.gitignore`, `.eslintignore`, `.oxlintignore`, `.prettierignore`, `.gitattributes` linguist annotations) are always respected. |

CLI flags always override config values.

## Node.js API

You can also use React Doctor programmatically:

```js
import { diagnose } from "react-doctor/api";

const result = await diagnose("./path/to/your/react-project");

console.log(result.score); // { score: 82, label: "Great" } or null
console.log(result.diagnostics); // Array of Diagnostic objects
console.log(result.project); // Detected framework, React version, etc.
```

The `diagnose` function accepts an optional second argument:

```js
const result = await diagnose(".", {
  lint: true, // run lint checks (default: true)
  deadCode: true, // run dead code detection (default: true)
});
```

Each diagnostic has the following shape:

```ts
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

To produce the same structured output the `--json` CLI flag emits, use `toJsonReport`:

```js
import { diagnose, toJsonReport, summarizeDiagnostics } from "react-doctor/api";

const result = await diagnose(".");

const report = toJsonReport(result, { version: "1.0.0" });
console.log(JSON.stringify(report, null, 2));

const counts = summarizeDiagnostics(result.diagnostics);
console.log(`${counts.errorCount} errors, ${counts.warningCount} warnings`);
```

`react-doctor/api` also re-exports the `JsonReport`, `JsonReportSummary`, `JsonReportProjectEntry`, and `JsonReportMode` types, plus the lower-level `buildJsonReport` and `buildJsonReportError` builders if you need to assemble reports from multiple `diagnose()` calls.

## Use the oxlint plugin standalone

If you already use oxlint and just want React Doctor's rule set, register the plugin directly in your `.oxlintrc.json`:

```jsonc
{
  "jsPlugins": [
    {
      "name": "react-doctor",
      "specifier": "react-doctor/oxlint-plugin",
    },
  ],
  "rules": {
    "react-doctor/no-fetch-in-effect": "warn",
    "react-doctor/no-derived-state-effect": "warn",
    // ...pick the rules you want
  },
}
```

The full rule list is in [`oxlint-config.ts`](https://github.com/millionco/react-doctor/blob/main/packages/react-doctor/src/oxlint-config.ts).

## Scores for popular open-source projects

See the live leaderboard at [react.doctor/leaderboard](https://react.doctor/leaderboard) for current scores across React projects.

## Contributing

Want to contribute? Check out the codebase and submit a PR.

```bash
git clone https://github.com/millionco/react-doctor
cd react-doctor
pnpm install
pnpm build
```

Run locally:

```bash
node packages/react-doctor/bin/react-doctor.js /path/to/your/react-project
```

### License

React Doctor is MIT-licensed open-source software.
