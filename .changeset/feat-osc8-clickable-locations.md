---
"react-doctor": patch
---

Make `file:line` diagnostic locations clickable in the terminal, and record which terminal each run uses.

Diagnostic locations are now wrapped in OSC 8 hyperlinks pointing at each file's absolute path, so supporting terminals (iTerm2, WezTerm, Kitty, Windows Terminal, VS Code, and other VTE-based emulators) turn them into click-to-open links — even in monorepo scans where the displayed path is relative to a sub-project root rather than the terminal's cwd. The visible text is unchanged (`src/App.tsx:12`), the link rides in escape sequences, and terminals without OSC 8 support print it exactly as before. Hyperlinks are auto-detected per terminal and can be forced on/off with the standard `FORCE_HYPERLINK` env var; they are off for non-TTYs, CI, and coding agents (whose output parsers shouldn't see the escapes).

Telemetry also gains a `terminalKind` run tag (neovim, vscode, iterm, wezterm, kitty, windows-terminal, …) so we can see where React Doctor is actually run. It is a low-cardinality enum with no path, username, or secret.
