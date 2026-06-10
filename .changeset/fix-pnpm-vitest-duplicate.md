---
"react-doctor": patch
---

fix: widen oxlint version range to `>=1.60.0` to prevent duplicate vitest instances in pnpm monorepos

When `react-doctor` was installed alongside `vite-plus` (which pins `oxlint@=1.63.0`), pnpm created two instances of oxlint with different peer dependency fingerprints. This caused the vitest fork (`@voidzero-dev/vite-plus-test`) to also have two instances, breaking Vitest's internal hook registry and causing "Vitest failed to find the current suite" errors.

By widening the version range from `^1.66.0` to `>=1.60.0`, pnpm can now dedupe the oxlint dependency when the consumer's workspace already provides a compatible version, preventing the cascade of duplicate instances.

The CLI features react-doctor uses (`-c`, `--format json`, `--tsconfig`, `--ignore-path`) are stable across oxlint 1.60+.
