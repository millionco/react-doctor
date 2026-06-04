# @react-doctor/language-server

The editor brain behind React Doctor. A Language Server Protocol (LSP)
server that surfaces React Doctor diagnostics directly in your editor —
VS Code, Cursor, Neovim, Zed, Helix, or any LSP client — instead of only
on the command line.

This package is internal (not published on its own). It is bundled into
the published `react-doctor` CLI and started with the experimental command:

```bash
react-doctor experimental-lsp --stdio
```

## What it does

- **Live diagnostics** — scans the file you are editing on every change
  using an in-memory overlay of the unsaved buffer, so squiggles reflect
  what is on screen, not the last save.
- **Precise ranges** — maps oxlint's UTF-8 byte spans to exact editor
  ranges, so the underline lands on the offending token.
- **Rich hovers** — rule id, severity, category, the rule's
  recommendation, suppression hints, and a link to the docs.
- **Quick fixes** — "Disable this rule for this line" (with the correct
  `//` or `{/* … */}` comment for the context), "Suppress all issues in
  this file", plus explain / open-docs / report-false-positive actions.
- **Workspace aware** — discovers every React project across workspace
  folders and monorepo packages, picks the owning project per file, and
  invalidates caches when config / `package.json` / lockfiles change.
- **Responsive** — a priority scheduler runs open-buffer scans first,
  debounces edits, bounds concurrency, and drops superseded scans so a
  large monorepo never blocks the file you are in.
- **Push + pull diagnostics** — publishes diagnostics proactively and
  answers `textDocument/diagnostic` pull requests for clients that use
  them.
- **Status + progress** — reports work-done progress while scanning and a
  rust-analyzer-style `experimental/serverStatus` notification (`health`,
  `quiescent`, `message`) for a persistent editor status indicator.
- **Signal-tiered severity** — weak-signal `design` rules map to LSP
  `Information` so they don't drown out real findings; `codeAction`
  requests honor `context.only`, and the file-level suppress uses a
  namespaced `source.suppressAll.reactDoctor` kind (never bare `source`,
  which an on-save config could trigger destructively).

## Architecture

```
documents (open buffers) ─┐
workspace / watcher events ┤→ scheduler → scan-runner → @react-doctor/core
                           │              (overlay fs)     runEditorScan
                           └→ project graph                      │
                                                                 ▼
                                          diagnostics manager (map → publish)
                                                                 │
                                          hover / code actions / commands
```

All linting goes through `@react-doctor/core`'s `runEditorScan`, which
runs the same diagnostic pipeline as the CLI (config, ignores, inline
suppressions, severity controls) but offline: no hosted score lookup and
no git metadata, so scans are fast and side-effect free.

## Commands

The server registers these `workspace/executeCommand` commands (also
contributed by the companion editor extension):

- `react-doctor.scanWorkspace`
- `react-doctor.scanFile`
- `react-doctor.fixAll`
- `react-doctor.explain`
- `react-doctor.openDocs`
- `react-doctor.suppressLine`
- `react-doctor.reportFalsePositive`
- `react-doctor.restart`
