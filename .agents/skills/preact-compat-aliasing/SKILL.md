---
name: preact-compat-aliasing
description: "Use when migrating React code or libraries to Preact, configuring preact/compat, bundler aliases, react/jsx-runtime, react-dom, Jest, Node SSR aliases, or diagnosing duplicate React/Preact copies and compat behavior differences."
---

# Preact Compat Aliasing

Start by deciding whether the code needs React ecosystem compatibility. Use Preact core for Preact-native apps; use `preact/compat` when React libraries import `react`, `react-dom`, or React JSX runtimes.

## Alias Checklist

- **Vite with `@preact/preset-vite`**: aliases are handled for you — just install the preset.
- **Webpack/Rollup/Parcel**: alias `react` → `preact/compat`, `react-dom` → `preact/compat`, `react-dom/test-utils` → `preact/test-utils`, and `react/jsx-runtime` → `preact/jsx-runtime`.
- **Node SSR**: bundler aliases do not apply. Use package aliases such as `"react": "npm:@preact/compat"` and `"react-dom": "npm:@preact/compat"` in `package.json` when the runtime imports React directly.
- **TypeScript**: add `paths` for `react`, `react/jsx-runtime`, `react-dom`, and `react-dom/*`. `skipLibCheck` may be needed for third-party React library types.
- **Jest / test runners**: mirror the same aliases in `moduleNameMapper` or resolver config.

## Config Examples

Vite (only needed outside `@preact/preset-vite`):

```js
// vite.config.js
export default {
  resolve: {
    alias: {
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
};
```

Webpack:

```js
// webpack.config.js
module.exports = {
  resolve: {
    alias: {
      'react': 'preact/compat',
      'react-dom': 'preact/compat',
      'react-dom/test-utils': 'preact/test-utils',
      'react/jsx-runtime': 'preact/jsx-runtime',
    },
  },
};
```

Jest:

```js
// jest.config.js
module.exports = {
  moduleNameMapper: {
    '^react$': 'preact/compat',
    '^react-dom$': 'preact/compat',
    '^react-dom/test-utils$': 'preact/test-utils',
    '^react/jsx-runtime$': 'preact/jsx-runtime',
  },
};
```

## Pitfalls

- Do not allow two Preact copies in one app. Hook failures and context splits often trace back to duplicate module instances — check bundler dedupe, linked packages, and import maps.
- `preact/compat/client` provides React-style `createRoot()` and `hydrateRoot()` wrappers, but hydration still uses Preact hydration semantics.
- Core Preact events are DOM-native. Compat normalizes common React event names and behavior, but UI libraries can still depend on React scheduler, focus, portal, or synthetic event quirks.
- SSR and browser bundles must agree on aliases and JSX runtime. A mixed core/compat render path is a common hydration-mismatch source.

Observed risk areas: Radix/floating-ui event behavior, newer React API surface, type conflicts, and mixed module hook failures.

Doc anchors: [Switching to Preact from React](https://preactjs.com/guide/v10/switching-to-preact), [Differences to React](https://preactjs.com/guide/v10/differences-to-react).
