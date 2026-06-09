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

### 3. Run in CI

React Doctor CI (GitHub Actions) reviews every pull request automatically and reports only the issues your change introduced, not your existing backlog.

[Add GitHub Action →](https://react.doctor/docs/ci-and-prs/github-actions-setup)

### 4. Configure rules

You can configure which rules to run and how to run them in `doctor.config.ts`.

[Learn more →](https://react.doctor/docs/configuration/config-files)

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
