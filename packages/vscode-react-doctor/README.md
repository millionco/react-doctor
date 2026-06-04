# React Doctor for VS Code & Cursor

Live React Doctor diagnostics, hovers, and quick fixes in your editor,
powered by the React Doctor language server. Works in VS Code and Cursor
(Cursor runs VS Code extensions).

## What you get

- **Live diagnostics** — files are re-scanned as you type, from the
  unsaved buffer, with the underline on the exact offending token.
- **Hovers** — rule id, category, the rule's recommendation, and a docs
  link.
- **Quick fixes** — disable a rule for the current line (with the right
  `//` or `{/* … */}` comment), suppress all issues in a file, explain a
  finding, open its docs, or report a false positive.
- **Commands** — Scan Workspace, Scan Current File, Suppress All Issues
  in File, Restart Server, Show Output.

## How it runs the server

The extension launches `react-doctor experimental-lsp --stdio`. It does **not** bundle
the engine; it uses your project's own version so diagnostics match the
CLI and CI:

1. `reactDoctor.serverPath` (if set)
2. the project's `node_modules/.bin/react-doctor`
3. `npx react-doctor@latest` (zero-config fallback)

Add `react-doctor` to your project (`npm i -D react-doctor`) for the
fastest startup and version pinning.

## Settings

- `reactDoctor.enable` — turn the extension on/off (default `true`).
- `reactDoctor.serverPath` — explicit path to the `react-doctor` binary.
- `reactDoctor.scanOnType` — re-scan live as you type (default `true`);
  disable to scan only on open and save.
- `reactDoctor.trace.server` — LSP trace verbosity (`off` / `messages` /
  `verbose`).

## Configuration

The server honors your project's `react-doctor.config.json` — the same
configuration the CLI uses. No editor-specific config is required.

## Packaging

`pnpm run package` builds a self-contained `.vsix` (the client bundle is
produced with esbuild). Publishing to the VS Code Marketplace / Open VSX
is a follow-up.
