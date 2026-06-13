---
"react-doctor": patch
---

Load `doctor.config.ts` files that import `defineConfig` from `react-doctor/api` even when the scanned repo has no installed node_modules (e.g. the GitHub Action runs the CLI via `npm exec` without installing the repo's dependencies). The config loader now retries the load with `react-doctor/api` aliased to the running package's own copy instead of silently falling back to default config.
