# eslint-plugin-react-doctor

[![version](https://img.shields.io/npm/v/eslint-plugin-react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/eslint-plugin-react-doctor)
[![downloads](https://img.shields.io/npm/dt/eslint-plugin-react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/eslint-plugin-react-doctor)

ESLint plugin for [React Doctor](https://react.doctor). Diagnoses React codebases for security, performance, correctness, accessibility, bundle-size, and architecture issues.

The set now includes 100 rules ported from
[`oxc-project/oxc`](https://github.com/oxc-project/oxc)'s React +
jsx-a11y linting plugins, exposed alongside React Doctor's own rules
under the `react-doctor/*` namespace.

This package owns the ESLint adapter for React Doctor's rule set. The underlying rules ship in [`oxlint-plugin-react-doctor`](https://npmjs.com/package/oxlint-plugin-react-doctor) (auto-installed as a transitive dependency). The full diagnostic CLI lives in [`react-doctor`](https://npmjs.com/package/react-doctor) and pulls in this same rule set; install whichever fits your workflow.

## Install

```bash
npm install --save-dev eslint-plugin-react-doctor
```

```bash
pnpm add -D eslint-plugin-react-doctor
```

```bash
yarn add -D eslint-plugin-react-doctor
```

## Usage

Flat config (ESLint v9+):

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

Pick only the configs that match your stack. `recommended` is framework-agnostic; the others layer on framework-specific rules.

If React Compiler is enabled, declare that capability once so React Doctor can disable compiler-redundant manual-memoization rules:

```js
export default [
  reactDoctor.configs.recommended,
  reactDoctor.configs["react-native"],
  {
    settings: {
      "react-doctor": {
        capabilities: ["react-compiler"],
      },
    },
  },
];
```

React Doctor's CLI discovers this automatically. ESLint flat configs are static, so standalone ESLint users declare the capability explicitly.

## Available configs

| Config           | What it adds                                                  |
| ---------------- | ------------------------------------------------------------- |
| `recommended`    | Framework-agnostic React rules. Safe baseline.                |
| `next`           | Next.js specific rules (App Router, server components, etc.). |
| `react-native`   | React Native specific rules.                                  |
| `tanstack-start` | TanStack Start specific rules.                                |
| `tanstack-query` | TanStack Query specific rules.                                |
| `all`            | Every rule across every framework, at recommended severity.   |

## Available rules

The full rule list lives in [`rule-registry.ts`](https://github.com/millionco/react-doctor/blob/main/packages/oxlint-plugin-react-doctor/src/plugin/rule-registry.ts). Rules are namespaced under `react-doctor/*`.

To override a rule:

```js
import reactDoctor from "eslint-plugin-react-doctor";

export default [
  reactDoctor.configs.recommended,
  {
    rules: {
      "react-doctor/no-fetch-in-effect": "error",
      "react-doctor/no-derived-state-effect": "off",
    },
  },
];
```

## Want the CLI too?

This package only ships the ESLint plugin. To run React Doctor's full scan (with scoring, JSON reports, agent integration, etc.), use the main CLI:

```bash
npx react-doctor@latest
```

See the [React Doctor README](https://github.com/millionco/react-doctor#readme) for the full feature set.

## License

MIT
