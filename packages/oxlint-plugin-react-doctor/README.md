# oxlint-plugin-react-doctor

[![version](https://img.shields.io/npm/v/oxlint-plugin-react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/oxlint-plugin-react-doctor)
[![downloads](https://img.shields.io/npm/dt/oxlint-plugin-react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/oxlint-plugin-react-doctor)

[oxlint](https://oxc.rs/docs/guide/usage/linter) plugin for [React Doctor](https://react.doctor). Diagnoses React codebases for security, performance, correctness, accessibility, bundle-size, and architecture issues.

This package owns the rule implementations (287 rules across architecture, performance, correctness, security, accessibility, bundle-size, framework-specific, `react-builtins`, and `a11y` buckets). [`eslint-plugin-react-doctor`](https://npmjs.com/package/eslint-plugin-react-doctor) wraps these same rules for ESLint, and the full diagnostic CLI lives in [`react-doctor`](https://npmjs.com/package/react-doctor).

### Ported OXC react + jsx-a11y rules

The `react-builtins/` and `a11y/` buckets contain 100 rules ported from
[`oxc-project/oxc`](https://github.com/oxc-project/oxc)'s
`crates/oxc_linter/src/rules/{react,react_perf,jsx_a11y}/`. They cover
every rule React Doctor previously consumed via oxlint's built-in
`react/*` and `jsx-a11y/*` plugins (now sourced natively as
`react-doctor/*`), including `react/rules-of-hooks` and
`react/exhaustive-deps`, which run on top of a TS port of OXC's scope
analysis + control-flow-graph layer.

## Install

```bash
npm install --save-dev oxlint oxlint-plugin-react-doctor
```

```bash
pnpm add -D oxlint oxlint-plugin-react-doctor
```

```bash
yarn add -D oxlint oxlint-plugin-react-doctor
```

## Usage

In `.oxlintrc.json`:

```jsonc
{
  "jsPlugins": [{ "name": "react-doctor", "specifier": "oxlint-plugin-react-doctor" }],
  "rules": {
    "react-doctor/no-fetch-in-effect": "warn",
    "react-doctor/no-derived-state-effect": "warn",
  },
}
```

Run oxlint as normal:

```bash
npx oxlint .
```

## Lightweight engine entry

`oxlint-plugin-react-doctor/core` exposes rule metadata, cross-file collectors,
and project scan rules without loading the full oxlint visitor registry. It is
intended for engine integrations. Oxlint configurations should continue using
the package's root entry.

## Available rules

The full rule list lives in [`rule-registry.ts`](https://github.com/millionco/react-doctor/blob/main/packages/oxlint-plugin-react-doctor/src/plugin/rule-registry.ts). Rules exported by this package use the `react-doctor/*` namespace.

### Choose a runner for each diagnostic

Standalone Oxlint runs rules that inspect one source file. The React Doctor CLI also runs whole-project and package analyzers.

| Diagnostic source                                                                             | Standalone Oxlint | Runner                                                           |
| --------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| `react-doctor/*` rules with per-file visitors                                                 | Yes               | Configure them under `rules` as shown above                      |
| Project rules such as `react-doctor/circular-dependency` and `react-doctor/unused-dependency` | No                | Run the React Doctor CLI                                         |
| `deslop/*` diagnostics                                                                        | No                | Run the React Doctor CLI                                         |
| `socket/*` diagnostics                                                                        | No                | Run the React Doctor CLI                                         |
| `react-hooks-js/*` React Compiler diagnostics                                                 | Separate plugin   | Register `eslint-plugin-react-hooks` or run the React Doctor CLI |

The `deslop/*` names are CLI output aliases for project rules. These rules need the complete dependency graph, so their plugin entries have no per-file visitors. The `socket/*` diagnostics need package and supply-chain data. Neither prefix names an Oxlint plugin exported by this package.

Rules in the `security-scan` bucket also require a project-wide file scan. They register metadata here but do nothing under standalone Oxlint or ESLint. The [React Doctor CLI](https://npmjs.com/package/react-doctor) executes them during its whole-tree scan.

### Run React Compiler diagnostics in standalone Oxlint

React Doctor loads React Compiler diagnostics from `eslint-plugin-react-hooks` when it detects the compiler. To use them in standalone Oxlint, install and register that plugin:

```bash
npm install --save-dev eslint-plugin-react-hooks
```

Add both plugins to `.oxlintrc.json`. The `react-compiler` capability enables compiler-specific React Doctor cleanup rules:

```jsonc
{
  "jsPlugins": [
    { "name": "react-doctor", "specifier": "oxlint-plugin-react-doctor" },
    { "name": "react-hooks-js", "specifier": "eslint-plugin-react-hooks" },
  ],
  "settings": {
    "react-doctor": {
      "capabilities": ["react-compiler"],
    },
  },
  "rules": {
    "react-doctor/react-compiler-no-manual-memoization": "warn",
    "react-hooks-js/immutability": "error",
    "react-hooks-js/refs": "error",
  },
}
```

The `react-hooks-js` namespace is the alias React Doctor uses for the external plugin. It is not exported by `oxlint-plugin-react-doctor`.

Each rule can be set to `"error"`, `"warn"`, or `"off"`:

```jsonc
{
  "rules": {
    "react-doctor/effect-needs-cleanup": "error",
    "react-doctor/no-array-index-as-key": "warn",
  },
}
```

## "You Might Not Need an Effect" rule family

Eight rules ported 1:1 from [`eslint-plugin-react-you-might-not-need-an-effect`](https://github.com/NickvanDyke/eslint-plugin-react-you-might-not-need-an-effect) (MIT, NickvanDyke) ship natively in this package — same rule IDs, same diagnostic messages, same semantics (195 of 196 upstream test cases pass; the remaining one is upstream's own `todo: true`). Attribution and known divergences live in [`SOURCE.md`](https://github.com/millionco/react-doctor/blob/main/packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/effect/SOURCE.md).

| Rule                                             | What it catches                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `react-doctor/no-derived-state`                  | Storing derived state via `useEffect` instead of computing during render      |
| `react-doctor/no-chain-state-updates`            | Chaining state updates across effects                                         |
| `react-doctor/no-event-handler`                  | Using state + a guarded effect as an event handler                            |
| `react-doctor/no-adjust-state-on-prop-change`    | Adjusting state in an effect when a prop changes                              |
| `react-doctor/no-reset-all-state-on-prop-change` | Resetting all state in an effect (use a `key` prop instead)                   |
| `react-doctor/no-pass-live-state-to-parent`      | Pushing live state to a parent via a callback in an effect                    |
| `react-doctor/no-pass-data-to-parent`            | Passing fetched data to a parent via a callback in an effect                  |
| `react-doctor/no-initialize-state`               | Initializing state inside a mount-only effect (pass it to `useState` instead) |

If you previously enabled them as `effect/*` via the optional peer dep, drop the peer dep — they're enabled by default through React Doctor's CLI config now.

## Want the CLI too?

This package only ships the oxlint plugin. To run React Doctor's full scan (with scoring, JSON reports, agent integration, etc.), use the main CLI:

```bash
npx react-doctor@latest
```

See the [React Doctor README](https://github.com/millionco/react-doctor#readme) for the full feature set.

## License

MIT
