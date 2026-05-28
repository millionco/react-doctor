---
name: preact-no-build-vite-setup
description: "Use when starting a Preact app, choosing Vite versus no-build HTM or import maps, setting JSX pragmas, CDN ESM imports, create-preact, or integrating Preact into an existing build pipeline."
---

# Preact Setup: Vite, No-Build, and Existing Pipelines

Pick the lightest setup that supports the code the user intends to write.

## Choices

- **New app** — prefer `npm init preact` or the Vite Preact template. You get a dev server, production build, TypeScript/routing options, and correct aliases out of the box.
- **No build tools** — import Preact from an ESM CDN in a `<script type="module">`. Use [HTM](https://github.com/developit/htm) for JSX-like syntax without transpilation.
- **Existing bundler** — add the JSX transform and compat aliases only when needed (see the [preact-compat-aliasing](../preact-compat-aliasing/SKILL.md) skill).

## JSX Setup

- **Babel classic JSX**: `@babel/plugin-transform-react-jsx` with `pragma: "h"` and `pragmaFrag: "Fragment"`.
- **TypeScript automatic JSX**: `"jsx": "react-jsx"` and `"jsxImportSource": "preact"`.
- **TypeScript classic JSX**: `"jsxFactory": "h"` and `"jsxFragmentFactory": "Fragment"`.

## Import Maps

When using no-build workflows, map both the package root and subpaths to the **same version** so `preact` and `preact/hooks` share core state. Use an unpinned major so the CDN serves the latest patch:

```html
<script type="importmap">
{
  "imports": {
    "preact": "https://esm.sh/preact@10",
    "preact/": "https://esm.sh/preact@10/",
    "htm/preact": "https://esm.sh/htm@3/preact"
  }
}
</script>
<script type="module">
  import { html, render } from 'htm/preact';
  render(html`<h1>Hello</h1>`, document.body);
</script>
```

Add `react`, `react/`, and `react-dom` mappings to `preact/compat` only when using React libraries.

Doc anchors: [Getting Started](https://preactjs.com/guide/v10/getting-started), [No-Build Workflows](https://preactjs.com/guide/v10/no-build-workflows), [TypeScript](https://preactjs.com/guide/v10/typescript).
