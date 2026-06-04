# React Doctor for Zed

A [Zed](https://zed.dev) extension that runs the [React Doctor](https://github.com/millionco/react-doctor) language server, giving you React-specific lint, accessibility, bundle-size, and architecture diagnostics directly in the editor.

## What it provides

- **Live diagnostics** as you type, including unsaved buffers (no save required).
- **Precise ranges** that point at the exact offending node, not whole lines.
- **Hovers** with rule documentation for each diagnostic.
- **Quick fixes** to suppress a diagnostic inline, for `.ts`, `.tsx`, `.js`, and `.jsx` files.

It activates for the **TypeScript**, **TSX**, and **JavaScript** languages (Zed treats JSX as part of JavaScript).

## Requirements

The extension launches `react-doctor experimental-lsp --stdio` and resolves the binary in this order:

1. The project-local CLI at `node_modules/.bin/react-doctor` (when `react-doctor` is installed in the worktree).
2. A `react-doctor` binary on your `PATH`.
3. A fallback to `npx -y react-doctor@latest`.

So the only hard requirement is **Node.js on your `PATH`**. For the fastest, version-pinned experience, install React Doctor in your project:

```bash
npm i -D react-doctor
# or: pnpm add -D react-doctor / yarn add -D react-doctor
```

If neither a `react-doctor` binary nor `npx` can be found, the extension reports an error asking you to install it.

## Installing (dev extension)

This extension is not yet published to the Zed extension registry, so install it as a dev extension:

1. Open Zed.
2. Open the command palette and run **`zed: extensions`** (or use the menu: **Zed → Extensions**).
3. Click **Install Dev Extension**.
4. Select this folder: `packages/zed-react-doctor`.

Zed compiles the Rust extension to WebAssembly on install. Reload the extension from the same Extensions view after pulling changes.

## Roadmap

- Publishing to the Zed extension registry is a planned follow-up.
