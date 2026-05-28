---
name: preact-typescript-jsx
description: "Use when configuring Preact TypeScript, JSX transforms, jsxImportSource, preact/compat TS paths, JSX namespace augmentation, component children types, DOM event or ref types, or React type conflicts."
---

# Preact TypeScript and JSX

Choose the JSX runtime first, then align TypeScript, Babel, bundler aliases, and test tooling with that choice.

## Config

- **Automatic JSX transform**: `"jsx": "react-jsx"` and `"jsxImportSource": "preact"`.
- **Classic transform**: `"jsx": "react"`, `"jsxFactory": "h"`, `"jsxFragmentFactory": "Fragment"`.
- **Babel-owned JSX**: `"jsx": "preserve"` in TS, but still set factory settings for type-checking.
- Rename JSX-bearing TypeScript files to `.tsx`.

## `tsconfig.json` — Preact-only

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "skipLibCheck": true
  }
}
```

## `tsconfig.json` — with `preact/compat` for React libraries

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "strict": true,
    "skipLibCheck": true,
    "paths": {
      "react": ["./node_modules/preact/compat/"],
      "react/jsx-runtime": ["./node_modules/preact/jsx-runtime"],
      "react-dom": ["./node_modules/preact/compat/"],
      "react-dom/*": ["./node_modules/preact/compat/*"]
    }
  }
}
```

Use `skipLibCheck` when third-party React library declarations exceed compat's surface.

## Common Types

- **Children**: `ComponentChildren`; `FunctionComponent` includes children.
- **DOM props**: extend `HTMLInputAttributes`, `HTMLAttributes`, or per-element JSX interfaces.
- **Events**: Preact uses DOM events — prefer `TargetedEvent` / `TargetedMouseEvent` from `preact`, or inferred inline handlers.
- **Refs**: `createRef<T>()` and `useRef<T>(null)` need element generics under strict null checks.
- **Custom elements or attributes**: augment `namespace preact.JSX` in a module `.d.ts` file with `export {}` at the top to keep it a module.

```ts
// custom-elements.d.ts
import 'preact';
declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'my-widget': HTMLAttributes<HTMLElement> & { label?: string };
    }
  }
}
export {};
```

Doc anchors: [TypeScript](https://preactjs.com/guide/v10/typescript).
