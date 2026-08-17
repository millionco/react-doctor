<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="134" height="36">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

Your agent writes bad React, this catches it.

React Doctor deterministically scans your codebase and finds issues across state and effects, performance, architecture, security, accessibility, and maintainability. It highlights overly complex React functions and repeated JSX trees that are good candidates for composition.

Works across React frameworks and React-enabled sites - Next.js, Vite, Astro, TanStack, React Native, Expo, you name it.

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

React Doctor reviews every pull request and reports only the issues your change introduced, not your existing backlog. Set it up with one command:

```bash
npx react-doctor@latest ci install
```

This adds the workflow, scans every pull request, and posts a summary comment. Change the gate, scan scope, and comments anytime with `react-doctor ci config`, and bump the action with `react-doctor ci upgrade`. GitHub Actions is fully supported; GitLab CI gets a gate-only scaffold.

[CI docs →](https://react.doctor/ci)

### 4. Configure rules

You can configure which rules to run and how to run them in `doctor.config.ts`.

[Learn more →](https://react.doctor/docs/configuration/config-files)

## Runtime performance traces

Record a Chrome DevTools performance trace while you interact with a running React app:

```bash
npx react-doctor@latest scan http://localhost:3000
```

React Doctor opens system Chrome in a temporary isolated profile, records until you press Enter
(up to five minutes), and flashes purple outlines with component names as React renders. It then
returns a readable summary plus the path to a compressed DevTools trace. Use `--format json` or
`--format jsonl` for coding agents. In an interactive terminal, you can run `react-doctor scan`
without a URL and choose a detected localhost app or enter another URL; coding agents and CI must
pass the URL explicitly.

An already-open normal browser is left alone. To reuse an authenticated session, start a dedicated
Chrome profile with remote debugging, sign in, close its non-blank tabs, and pass its endpoint:

```bash
npx react-doctor@latest scan https://app.example.com --cdp http://127.0.0.1:9222
```

Chrome performance tracing is browser-wide, so React Doctor rejects attached profiles with open
pages. It closes blank startup tabs before tracing and closes its scan tab afterward; the attached
browser stays open. The trace is stored locally and is never uploaded, but it can contain page
URLs, source paths, and React profiling details. Treat it as sensitive application data.

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
