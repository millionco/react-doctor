<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="134" height="36">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

React Doctor runs deterministic checks on your code. It reports issues in state and effects, performance, architecture, security, accessibility, and maintainability.

Supports React projects built with Next.js, Vite, Astro, TanStack, React Native, and Expo.

[Documentation →](https://react.doctor/docs)

## Install

### 1. Run a scan

Run this command from your project root:

```bash
npx react-doctor@latest
```

https://github.com/user-attachments/assets/07cc88d9-9589-44c3-aa73-5d603cb1c570

### 2. Install for agents

Install the skill to help your coding agent find and fix React issues:

```bash
npx react-doctor@latest install
```

Supports coding agents including Claude Code, Cursor, Codex, and OpenCode.

### 3. Run in CI

Scan each pull request and report the issues it introduces:

```bash
npx react-doctor@latest ci install
```

[CI docs →](https://react.doctor/ci)

### 4. Configure rules

Choose rules and scan settings in `doctor.config.ts`.

With `customRulesOnly: true`, explicit `rules` settings of `"warn"` or `"error"`
enable selected ported rules. Legacy rule names also work. Other ported rules and
the React Compiler plugin stay off.

Mixed classic and automatic JSX projects can use
`automaticJsxRuntimeFiles` to tell the opt-in JSX scope rule which exact
project-relative paths use the automatic transform.

[Configuration docs →](https://react.doctor/docs/configuration/config-files)

## Runtime performance traces

Record a Chrome DevTools performance trace while you interact with a running React app:

```bash
npx react-doctor@latest scan http://localhost:3000
```

[Runtime trace docs →](https://react.doctor/docs/reference/cli-reference#runtime-performance-traces)

## Telemetry

The CLI collects crash reports and anonymous usage data. See [Data use](https://react.doctor/docs/legal/data-use) for details.

To opt out, run: `npx react-doctor@latest --no-telemetry`

## Contributing

[Report an issue](https://github.com/millionco/react-doctor/issues)

MIT-licensed
