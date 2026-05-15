# oxlint-plugin-react-doctor

[![version](https://img.shields.io/npm/v/oxlint-plugin-react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/oxlint-plugin-react-doctor)
[![downloads](https://img.shields.io/npm/dt/oxlint-plugin-react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/oxlint-plugin-react-doctor)

[oxlint](https://oxc.rs/docs/guide/usage/linter) plugin for [React Doctor](https://react.doctor). Diagnoses React codebases for security, performance, correctness, accessibility, bundle-size, and architecture issues.

This package owns the rule implementations (178 rules across architecture, performance, correctness, security, accessibility, bundle-size, and framework-specific buckets). [`eslint-plugin-react-doctor`](https://npmjs.com/package/eslint-plugin-react-doctor) wraps these same rules for ESLint, and the full diagnostic CLI lives in [`react-doctor`](https://npmjs.com/package/react-doctor).

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

## Available rules

The full rule list lives in [`oxlint-config.ts`](https://github.com/millionco/react-doctor/blob/main/packages/react-doctor/src/oxlint-config.ts). All rules are namespaced under `react-doctor/*`.

Each rule can be set to `"error"`, `"warn"`, or `"off"`:

```jsonc
{
  "rules": {
    "react-doctor/no-cascading-set-state": "error",
    "react-doctor/no-array-index-as-key": "warn",
  },
}
```

## Want the CLI too?

This package only ships the oxlint plugin. To run React Doctor's full scan (with scoring, JSON reports, agent integration, etc.), use the main CLI:

```bash
npx -y react-doctor@latest .
```

See the [React Doctor README](https://github.com/millionco/react-doctor#readme) for the full feature set.

## License

MIT
