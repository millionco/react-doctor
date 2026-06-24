---
"react-doctor": minor
---

Add `react-doctor ci <install|upgrade|config>`, a dedicated command for managing React Doctor in CI.

- `ci install` adds a workflow that scans every pull request. It auto-detects the provider (GitHub Actions or GitLab CI), bakes a gate from `--blocking`/`--scope`/`--comment`/`--review-comments`/`--commit-status`, and can open a pull request with `--pr`.
- `ci config` walks you through the gate, scan scope, and pull-request reporting interactively (with a plain-language recap of what each setting does), or applies the same flags non-interactively. It only edits a workflow React Doctor generated; a hand-customized file gets a paste snippet instead of an overwrite.
- `ci upgrade` bumps the GitHub Action to its current floating major.

GitHub Actions is fully supported; GitLab CI gets a gate-only scaffold. The `install` command's CI setup is unchanged; `ci` is the focused home for managing CI on its own.
