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

### 2. Run a focused design audit

Use the design command when you only want UI composition, typography, interaction, accessibility, and motion findings:

```bash
npx react-doctor@latest design
```

This activates the complete design rule family, including focused rules that stay opt-in during a general health scan, and skips unrelated dead-code, supply-chain, custom-plugin, and health-score passes. It accepts the normal scan flags, including `--scope`, `--project`, `--verbose`, and `--json`.

### 3. Install for agents

Once you have an audit, you can install the skill for your coding agent to learn from the issues and fix them in the future.

```bash
npx react-doctor@latest install
```

Works with Claude Code, Cursor, Codex, OpenCode, and many more.

### 4. Run in CI

React Doctor reviews every pull request and reports only the issues your change introduced, not your existing backlog. Set it up with one command:

```bash
npx react-doctor@latest ci install
```

This adds the workflow, scans every pull request, and posts a summary comment. Change the gate, scan scope, and comments anytime with `react-doctor ci config`, and bump the action with `react-doctor ci upgrade`. GitHub Actions is fully supported; GitLab CI gets a gate-only scaffold.

[CI docs →](https://react.doctor/ci)

### 5. Configure rules

You can configure which rules to run and how to run them in `doctor.config.ts`.

[Learn more →](https://react.doctor/docs/configuration/config-files)

### 6. Consume JSON

Use `--json` for stdout or `--json-out <path>` for a file. The default
`schemaVersion: 3` report includes deterministic diagnostic IDs and exact
per-project scan coverage.

[JSON report contract →](./docs/json-report.md)

## Telemetry

The CLI reports crashes, basic run traces, and anonymous usage counters to [Sentry](https://sentry.io/) to help us fix bugs and prioritize work.

We collect:

- Environment: CLI version, platform, Node version
- Invocation: which command, package manager, and run context (whether it's local vs. CI vs. coding agent)
- Project shape: framework, React version, TypeScript, project size (NO file contents)
- Rules fired: rule names and counts only (e.g. `react-doctor/no-array-index-as-key`) (NO code or specific findings)
- De-minified React Doctor CLI stack traces

To opt out, run: `npx react-doctor@latest --no-telemetry`

## Contributing

[Issues welcome!](https://github.com/millionco/react-doctor/issues)

MIT-licensed
