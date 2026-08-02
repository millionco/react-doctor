# UI Doctor

Focused React Doctor diagnostics for UI design quality.

```bash
npx ui-doctor@latest
```

UI Doctor runs every rule tagged `design`, including typography, spacing, hierarchy, interaction, responsive layout, motion, contrast, Tailwind, styled-components, and common generated-UI anti-patterns. It uses React Doctor's engine, respects `doctor.config.*` and inline disables, and supports the same project, diff-scope, staged, verbose, blocking, and JSON flags.

Dead-code, supply-chain, custom-plugin, external lint-config, and health-score passes are intentionally excluded from this focused audit.
