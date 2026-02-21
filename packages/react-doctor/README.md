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

Teach your coding agent all 47+ React best practice rules:

```bash
curl -fsSL https://react.doctor/install-skill.sh | bash
```

Supports Cursor, Claude Code, Amp Code, Codex, Gemini CLI, OpenCode, Windsurf, and Antigravity.

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
| `node-version` | `20`    | Node.js version to use                                            |

The action outputs a `score` (0–100) you can use in subsequent steps.

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
  --diff [base]     scan only files changed vs base branch
  --no-ami          skip Ami-related prompts
  --fix             open Ami to auto-fix all issues
  -h, --help        display help for command
```

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

### Config options

| Key            | Type                | Default | Description                                                                                                                         |
| -------------- | ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ignore.rules` | `string[]`          | `[]`    | Rules to suppress, using the `plugin/rule` format shown in diagnostic output (e.g. `react/no-danger`, `knip/exports`, `knip/types`) |
| `ignore.files` | `string[]`          | `[]`    | File paths to exclude, supports glob patterns (`src/generated/**`, `**/*.test.tsx`)                                                 |
| `lint`         | `boolean`           | `true`  | Enable/disable lint checks (same as `--no-lint`)                                                                                    |
| `deadCode`     | `boolean`           | `true`  | Enable/disable dead code detection (same as `--no-dead-code`)                                                                       |
| `verbose`      | `boolean`           | `false` | Show file details per rule (same as `--verbose`)                                                                                    |
| `diff`         | `boolean \| string` | —       | Force diff mode (`true`) or pin a base branch (`"main"`). Set to `false` to disable auto-detection.                                 |

CLI flags always override config values.

## Node.js API

You can also use React Doctor programmatically:

```js
import { diagnose } from "react-doctor/api";

const result = await diagnose("./path/to/your/react-project");

console.log(result.score); // { score: 82, label: "Good" } or null
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

## [Scores for popular open-source projects](https://react.doctor/leaderboard)

| Project                                                | Score  | Share                                                                                   |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| [tldraw](https://github.com/tldraw/tldraw)             | **84** | [view](https://www.react.doctor/share?p=tldraw&s=84&e=98&w=139&f=40)                    |
| [excalidraw](https://github.com/excalidraw/excalidraw) | **84** | [view](https://www.react.doctor/share?p=%40excalidraw%2Fexcalidraw&s=84&e=2&w=196&f=80) |
| [twenty](https://github.com/twentyhq/twenty)           | **78** | [view](https://www.react.doctor/share?p=twenty-front&s=78&e=99&w=293&f=268)             |
| [plane](https://github.com/makeplane/plane)            | **78** | [view](https://www.react.doctor/share?p=web&s=78&e=7&w=525&f=292)                       |
| [formbricks](https://github.com/formbricks/formbricks) | **75** | [view](https://www.react.doctor/share?p=%40formbricks%2Fweb&s=75&e=15&w=389&f=242)      |
| [posthog](https://github.com/PostHog/posthog)          | **72** | [view](https://www.react.doctor/share?p=%40posthog%2Ffrontend&s=72&e=82&w=1177&f=585)   |
| [supabase](https://github.com/supabase/supabase)       | **69** | [view](https://www.react.doctor/share?p=studio&s=69&e=74&w=1087&f=566)                  |
| [onlook](https://github.com/onlook-dev/onlook)         | **69** | [view](https://www.react.doctor/share?p=%40onlook%2Fweb-client&s=69&e=64&w=418&f=178)   |
| [payload](https://github.com/payloadcms/payload)       | **68** | [view](https://www.react.doctor/share?p=%40payloadcms%2Fui&s=68&e=139&w=408&f=298)      |
| [sentry](https://github.com/getsentry/sentry)          | **64** | [view](https://www.react.doctor/share?p=sentry&s=64&e=94&w=1345&f=818)                  |
| [cal.com](https://github.com/calcom/cal.com)           | **63** | [view](https://www.react.doctor/share?p=%40calcom%2Fweb&s=63&e=31&w=558&f=311)          |
| [dub](https://github.com/dubinc/dub)                   | **62** | [view](https://www.react.doctor/share?p=web&s=62&e=52&w=966&f=457)                      |

## Contributing

Want to contribute? Check out the codebase and submit a PR.

```bash
git clone https://github.com/millionco/react-doctor
cd react-doctor
pnpm install
pnpm -r run build
```

Run locally:

```bash
node packages/react-doctor/dist/cli.js /path/to/your/react-project
```

### License

React Doctor is MIT-licensed open-source software.
