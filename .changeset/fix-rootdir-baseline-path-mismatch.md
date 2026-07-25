---
"react-doctor": patch
---

fix: adjust changed file paths after rootDir redirect for baseline mode

When `doctor.config` sets `rootDir` to redirect scans to a subdirectory but changed files come from the Action with repo-root-relative paths, baseline mode now correctly adjusts those paths to be relative to the resolved directory. This prevents false baseline degradation when the Action runs with `directory: '.'` while config has `rootDir: 'apps/website'`.

Fixes #1456.
