# React Doctor in your editor

React Doctor ships a Language Server Protocol (LSP) server, so the same
diagnostics you get on the command line show up live as you type —
underlined inline, with rich hovers and one-keystroke quick fixes. The
server is editor-agnostic: it speaks LSP over **stdio** and activates for
`.ts`, `.tsx`, `.js`, and `.jsx` files.

The server is part of the published `react-doctor` CLI. The universal
launch command is:

```bash
react-doctor experimental-lsp --stdio
```

There are two ways to invoke it in an editor config:

- **No install (zero-config):** `npx react-doctor@latest experimental-lsp --stdio`
- **Project devDependency (faster, version-pinned):** the local bin
  `react-doctor experimental-lsp --stdio` (resolves to `./node_modules/.bin/react-doctor`).
  `npx react-doctor experimental-lsp --stdio` also picks up the local copy.

The snippets below default to the `npx` form so they work without any
install; switch the command to `react-doctor` when the package is a
dependency of the project.

**Jump to:** [VS Code](#vs-code) · [Cursor](#cursor) · [Zed](#zed) ·
[Neovim](#neovim) · [Sublime Text](#sublime-text) · [Emacs](#emacs) ·
[Helix](#helix) · [Any LSP client](#any-lsp-client) ·
[Configuration](#configuration) · [Troubleshooting](#troubleshooting)

## What you get

- **Live diagnostics** — the server re-scans the file from your _unsaved_
  buffer on every change, so squiggles reflect what is on screen, not the
  last save.
- **Precise ranges** — oxlint's byte spans are mapped to exact editor
  ranges, so the underline lands on the offending token.
- **Rich hovers** — rule id, category, severity, the rule's
  recommendation, and a link to the docs.
- **Code actions / quick fixes** — _Disable this rule for this line_,
  _Suppress all React Doctor issues in this file_, _Explain_,
  _Open documentation_, and _Report false positive_.
- **Workspace commands** (via `workspace/executeCommand`):
  `react-doctor.scanWorkspace`, `react-doctor.scanFile`,
  `react-doctor.fixAll`, `react-doctor.explain`, `react-doctor.openDocs`,
  `react-doctor.suppressLine`, `react-doctor.reportFalsePositive`,
  `react-doctor.restart`.
- **Push + pull diagnostics** — diagnostics are published proactively and
  also answered for clients that pull (`textDocument/diagnostic`).
- **Workspace-aware** — discovers every React project across workspace
  folders and monorepo packages, picks the owning project per file, and
  re-scans when `react-doctor.config.json` / `package.json` / lockfiles
  change.
- **Offline** — no hosted score lookup and no git calls, so editor scans
  are fast and side-effect free.
- **Live status** — emits work-done progress (a scanning spinner in
  capable clients) and a rust-analyzer-style `experimental/serverStatus`
  notification (`health` + `quiescent`) that the VS Code/Cursor extension
  renders as a status-bar item (spinner while scanning, a warning glyph
  when lint is degraded).
- **Quiet by default** — weak-signal style rules (the `design` family)
  are surfaced as `Information`, so they sit beneath real correctness,
  performance, and security findings instead of competing with them.

## VS Code

Install the **React Doctor** extension (publisher `millionco`). It is
currently distributed as a VSIX / dev extension from
`packages/vscode-react-doctor`; the VS Code Marketplace is the eventual
channel.

```bash
# Build + package the VSIX, then install it
pnpm --filter vscode-react-doctor package
code --install-extension packages/vscode-react-doctor/react-doctor.vsix
```

(Or open `packages/vscode-react-doctor` in VS Code and press `F5` to run
it in an Extension Development Host.)

The extension auto-starts the React Doctor language server for
JavaScript/TypeScript files by running `react-doctor experimental-lsp --stdio`. It uses
your project's `react-doctor` when present (`node_modules/.bin`) and falls
back to `npx react-doctor@latest`, so no setup is required. Override the
executable with `reactDoctor.serverPath` to pin a specific binary.

**Commands** (Command Palette → "React Doctor: …"):

| Command                     | ID                           |
| --------------------------- | ---------------------------- |
| Scan Workspace              | `react-doctor.scanWorkspace` |
| Scan Current File           | `react-doctor.scanFile`      |
| Suppress All Issues in File | `react-doctor.fixAll`        |
| Restart Server              | `react-doctor.restart`       |
| Show Output                 | `react-doctor.showOutput`    |

_Disable this rule for this line_, _Suppress all issues in this file_,
_Explain_, _Open documentation_, and _Report false positive_ are offered
as quick fixes on the lightbulb / `Ctrl+.` menu.

**Settings:**

| Setting                    | Default | Description                                                                                                                        |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `reactDoctor.enable`       | `true`  | Enable diagnostics, hovers, and quick fixes.                                                                                       |
| `reactDoctor.serverPath`   | `""`    | Explicit path to the `react-doctor` executable. Empty uses the project's local install, falling back to `npx react-doctor@latest`. |
| `reactDoctor.scanOnType`   | `true`  | Re-scan live as you type (from the unsaved buffer). Disable to scan only on open and save.                                         |
| `reactDoctor.trace.server` | `"off"` | `off` \| `messages` \| `verbose` — trace editor↔server traffic.                                                                    |

## Cursor

Cursor runs VS Code extensions, so the setup is identical to
[VS Code](#vs-code): install the same React Doctor extension (VSIX / dev
extension from `packages/vscode-react-doctor`), and you get the same
commands and `reactDoctor.*` settings. The server starts automatically for
`.ts`, `.tsx`, `.js`, and `.jsx` files.

## Zed

Zed language support is provided through an extension. Install the dev
extension shipped in `editors/zed-react-doctor`:

1. Install Rust via [rustup](https://rustup.rs) (required to build Zed dev
   extensions).
2. Open **Extensions** (`zed: extensions`), click **Install Dev
   Extension**, and select the `editors/zed-react-doctor` directory.

The extension launches `react-doctor experimental-lsp --stdio`. It uses the
`react-doctor` from your project when present and falls back to
`npx react-doctor@latest` otherwise.

Optionally pass initialization options through Zed's settings:

```json
{
  "lsp": {
    "react-doctor": {
      "initialization_options": { "scanOnType": true }
    }
  }
}
```

## Neovim

### Built-in LSP (Neovim 0.11+)

Neovim 0.11 added `vim.lsp.config` / `vim.lsp.enable`, so no plugin is
needed. Add this to your config (e.g. `init.lua`):

```lua
vim.lsp.config("react_doctor", {
  cmd = { "npx", "react-doctor@latest", "experimental-lsp", "--stdio" },
  -- If react-doctor is a project dependency, prefer the local bin:
  -- cmd = { "react-doctor", "experimental-lsp", "--stdio" },
  filetypes = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
  root_markers = { "package.json", ".git" },
  -- Optional: set to false to scan only on open and save (default true).
  init_options = { scanOnType = true },
})

vim.lsp.enable("react_doctor")
```

By default Neovim also attaches on single files outside a project (a
missing root is treated as single-file mode). Add `workspace_required =
true` to the config to attach only inside a detected project root.

### nvim-lspconfig (custom server)

`require("lspconfig")` is the legacy framework and is **deprecated on
Neovim 0.11+** — prefer the built-in snippet above. If you still drive
LSP through nvim-lspconfig, register React Doctor as a custom server:

```lua
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")

if not configs.react_doctor then
  configs.react_doctor = {
    default_config = {
      cmd = { "npx", "react-doctor@latest", "experimental-lsp", "--stdio" },
      filetypes = { "typescript", "typescriptreact", "javascript", "javascriptreact" },
      root_dir = lspconfig.util.root_pattern("package.json", ".git"),
      single_file_support = true,
      init_options = { scanOnType = true },
    },
  }
end

lspconfig.react_doctor.setup({})
```

## Sublime Text

Install the **LSP** package from Package Control, then open
**Preferences → Package Settings → LSP → Settings** and add a
`react-doctor` client to `LSP.sublime-settings`:

```json
{
  "clients": {
    "react-doctor": {
      "enabled": true,
      "command": ["npx", "react-doctor@latest", "experimental-lsp", "--stdio"],
      "selector": "source.ts | source.tsx | source.js | source.jsx",
      "initialization_options": { "scanOnType": true }
    }
  }
}
```

Swap `command` for `["react-doctor", "experimental-lsp", "--stdio"]` when the package
is installed in the project.

## Emacs

### Eglot

Eglot manages a single language server per buffer, so this makes React
Doctor the LSP server for JS/TS buffers. To run it _alongside_ tsserver,
use lsp-mode below.

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '((typescript-ts-mode tsx-ts-mode js-ts-mode typescript-mode js-mode)
                 . ("npx" "react-doctor@latest" "experimental-lsp" "--stdio"))))
```

To pass initialization options, use the backtick form with
`:initializationOptions` (`t` is JSON `true`):

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               `((typescript-ts-mode tsx-ts-mode js-ts-mode typescript-mode js-mode)
                 . ("npx" "react-doctor@latest" "experimental-lsp" "--stdio"
                    :initializationOptions (:scanOnType t)))))
```

### lsp-mode

Register React Doctor as an **add-on** client (`:add-on? t`) so it runs in
parallel with your primary TypeScript server (`ts-ls`):

```elisp
(with-eval-after-load 'lsp-mode
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection '("npx" "react-doctor@latest" "experimental-lsp" "--stdio"))
    :activation-fn (lsp-activate-on "typescript" "typescriptreact"
                                    "javascript" "javascriptreact")
    :add-on? t
    :server-id 'react-doctor
    ;; Optional init options; t is JSON true.
    :initialization-options (lambda () (list :scanOnType t)))))
```

React Doctor reads its own `react-doctor.config.json`, so no
`lsp-register-custom-settings` workspace configuration is required.

## Helix

Helix supports multiple language servers per language. Add a
`react-doctor` server in `~/.config/helix/languages.toml` and attach it to
the four languages **alongside** the default `typescript-language-server`
(diagnostics from all attached servers are merged):

```toml
[language-server.react-doctor]
command = "npx"
args = ["react-doctor@latest", "experimental-lsp", "--stdio"]
# Optional init options (Helix maps `config` to initializationOptions):
# config = { scanOnType = true }

[[language]]
name = "typescript"
language-servers = ["typescript-language-server", "react-doctor"]

[[language]]
name = "tsx"
language-servers = ["typescript-language-server", "react-doctor"]

[[language]]
name = "javascript"
language-servers = ["typescript-language-server", "react-doctor"]

[[language]]
name = "jsx"
language-servers = ["typescript-language-server", "react-doctor"]
```

For an installed project, use `command = "react-doctor"` with
`args = ["experimental-lsp", "--stdio"]`.

## Any LSP client

If your editor isn't listed, point any LSP client at the stdio command:

- **Command:** `react-doctor experimental-lsp --stdio` (or `npx react-doctor@latest experimental-lsp --stdio`)
- **Transport:** stdio
- **Attach for:** language ids `typescript`, `typescriptreact`,
  `javascript`, `javascriptreact` (extensions `.ts`, `.tsx`, `.js`, `.jsx`)
- **Root:** nearest `package.json` or `.git`
- **Initialization options** (optional): `{ "scanOnType": false }` to turn
  off per-keystroke re-scans

The server advertises hover, code actions (quick fix + source), and these
`workspace/executeCommand` commands: `react-doctor.scanWorkspace`,
`react-doctor.scanFile`, `react-doctor.fixAll`, `react-doctor.explain`,
`react-doctor.openDocs`, `react-doctor.suppressLine`,
`react-doctor.reportFalsePositive`, `react-doctor.restart`. It supports
both push and pull diagnostics.

## Configuration

There is **no separate LSP configuration**. The server honors the same
`react-doctor.config.json` (or the `"reactDoctor"` key in `package.json`)
that the CLI uses, resolved per project — including in monorepos, where
each workspace's config applies to its own files. Editing the config
re-scans open files automatically.

The only LSP-level knob is the `scanOnType` **initialization option**
(default `true`):

- `true` — re-scan the buffer on every change (live diagnostics).
- `false` — scan on open and save only.

It is passed via the client's initialization options (see the Neovim,
Sublime, Emacs, Helix, and generic snippets above). The VS Code/Cursor
extension exposes it as the `reactDoctor.scanOnType` setting.

Editor scans always run **offline** — no hosted score lookup and no git
metadata — and React projects are discovered automatically across
monorepo workspaces.

## Telemetry

Like the CLI, the language server reports **anonymized** usage analytics to
Sentry to guide what gets built next: a wide event per workspace scan (trigger,
duration, project/file counts, diagnostics by severity and category, whether
lint was degraded) plus session and scan counters. It shares the CLI's privacy
contract — no IP address, and home-directory paths and known secrets are
scrubbed from everything sent. No source code or file paths are included.

Opt out by setting `REACT_DOCTOR_NO_TELEMETRY=1` in the environment the editor
launches the server in, or by adding `--no-telemetry` (alias `--no-score`) to
the server command. Honors the standard `SENTRY_*` overrides
(`SENTRY_TRACES_SAMPLE_RATE=0` disables the wide-event spans while keeping
counters).

## Troubleshooting

**The server doesn't start.**

- Make sure `node` is on your `PATH` and `react-doctor` is resolvable —
  either installed as a project devDependency or reachable via
  `npx react-doctor@latest`.
- Verify the command works in a terminal. It should start and then _wait_
  for LSP messages on stdin (not exit or print a report):

  ```bash
  npx react-doctor@latest experimental-lsp --stdio
  ```

**Check the editor's LSP log.** The server reports status through the LSP
`window/logMessage` channel, surfaced by each client:

- **VS Code / Cursor:** the "React Doctor" output channel (run
  _React Doctor: Show Output_); set `reactDoctor.trace.server` to
  `verbose` for full traffic.
- **Neovim:** `:LspLog` and `:checkhealth vim.lsp`.
- **Sublime Text:** _LSP: Toggle Log Panel_.
- **Emacs:** `*EGLOT events*` (eglot) or `*lsp-log*` (lsp-mode).
- **Helix:** run `hx -v` or read `~/.cache/helix/helix.log`.
- **Zed:** `zed: open log`.

**"lint is degraded" warning.** This means the oxlint native binding
could not be loaded for the Node version the editor used to spawn the
server; diagnostics may be incomplete. Run the editor (or point its server
command) at a supported Node version — `^20.19.0 || >=22.12.0` — and
restart the server (_React Doctor: Restart Server_ in VS Code/Cursor, or
your client's LSP-restart command).
