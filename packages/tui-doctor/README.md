# TUI Doctor

Focused React Doctor diagnostics for [Ink](https://github.com/vadimdemedes/ink) terminal UIs.

```bash
npx tui-doctor@latest
```

TUI Doctor runs every rule tagged `ink`, including terminal lifecycle, raw mode, focus, layout, text-width, animation, paste, Suspense, and accessibility checks. It uses React Doctor's engine, respects `doctor.config.*` and inline disables, and supports the same project, diff-scope, staged, verbose, blocking, and JSON flags.

Dead-code, supply-chain, custom-plugin, external lint-config, and health-score passes are intentionally excluded from this focused audit.
