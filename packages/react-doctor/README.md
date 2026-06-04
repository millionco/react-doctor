<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="134" height="36">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

Your agent writes bad React, this catches it.

React Doctor deterministically scans your codebase and finds issues across state & effects, performance, architecture, security, and accessibility.

Works for all React frameworks and libraries - Next.js, Vite, TanStack, React Native, Expo, you name it.

[Website →](https://react.doctor/docs)

## Install

### 1. Quick start

Run this at your project root to get an audit.

```bash
npx react-doctor@latest
```

https://github.com/user-attachments/assets/07cc88d9-9589-44c3-aa73-5d603cb1c570

### 2. Install for agents

Once you have an audit, you can install the skill for your coding agent to learn from the issues and fix them in the future.

```bash
npx react-doctor@latest install
```

Works with Claude Code, Cursor, Codex, OpenCode, and many more.

### 3. Use in your editor (LSP)

React Doctor ships an experimental language server, so diagnostics show up live as you type — underlined inline, with rich hovers and quick fixes — in VS Code, Cursor, Zed, Neovim, Sublime, Emacs, Helix, or any LSP client. The universal launch command is:

```bash
react-doctor experimental-lsp --stdio
```

> The editor language server is experimental — its protocol, caching, and diagnostics may change between releases, hence the `experimental-` prefix.

Companion extensions for VS Code/Cursor and Zed live under `packages/`; any other LSP client can run the command above directly over stdio.

### 4. Run in CI (GitHub Actions) for your team

[![GitHub Action](https://img.shields.io/badge/GitHub%20Action-React%20Doctor-000000?style=flat&labelColor=000000&logo=githubactions&logoColor=white)](https://github.com/marketplace/actions/react-doctor)

On a pull request the Action reports only the issues your change **introduced** — it scans the PR and the merge-base and reports the difference (like Codecov for coverage), leaving pre-existing findings alone. It posts inline review comments on the changed lines and a sticky summary with the new / fixed delta.

```yaml
name: React Doctor

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]

permissions:
  contents: read
  pull-requests: write
  issues: write

concurrency:
  group: react-doctor-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  react-doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0 # so React Doctor can diff against the merge-base for new-vs-existing
      - uses: millionco/react-doctor@v1
```

`fetch-depth: 0` is recommended so the baseline comparison can read the base commit; without enough history the Action falls back to reporting every finding in the changed files.

`@v1` always resolves to the latest `v1.x` release of the Action. For hardened CI — recommended whenever the workflow is granted `pull-requests: write` — pin to a full commit SHA instead and let Dependabot or Renovate keep it current:

```yaml
- uses: millionco/react-doctor@b612664043a9be414166e3c6a69b355e39a8dcf4 # v1.1.1
```

[Add GitHub Action →](https://github.com/marketplace/actions/react-doctor)

### 4. Configure rules in `doctor.config.ts`

Configure with a `doctor.config.ts` (or `.js`, `.mjs`, `.cjs`, `.json`, `.jsonc`) in your project root.

```ts
// doctor.config.ts
import type { ReactDoctorConfig } from "react-doctor/api";

export default {
  lint: true,
  rules: {
    "react-doctor/no-array-index-as-key": "off",
  },
} satisfies ReactDoctorConfig;
```

Prefer JSON? Use `doctor.config.json`:

```jsonc
{
  "$schema": "https://react.doctor/schema/config.json",
  "lint": true,
}
```

## Telemetry

The CLI reports crashes, basic run traces, and anonymous usage counters to [Sentry](https://sentry.io/) to help us fix bugs and prioritize work.

We collect:

- Environment: CLI version, platform, Node version
- Invocation: which command, package manager, and run context (whether it's local vs. CI vs. coding agent)
- Project shape: framework, React version, TypeScript, project size NO file contents)
- Rules fired: rule names and counts only (e.g. `react-doctor/no-array-index-as-key`) (NO code or specific findings)
- De-minified React Doctor CLI stack traces

To opt out, run: `npx react-doctor@latest --no-telemetry`

## Contributing

[Issues welcome!](https://github.com/millionco/react-doctor/issues)

MIT-licensed
