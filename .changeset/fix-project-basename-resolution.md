---
"react-doctor": patch
---

Fix `--project` resolution when scanning from within a project directory whose basename matches the requested project name.

When running react-doctor from a subdirectory (e.g., `apps/website`) and passing `--project website`, the CLI now correctly recognizes that the current directory is the requested project instead of failing with "Project 'website' is not a directory under /path/to/apps/website."

This affects users who scan a single (non-workspace) project directory and pass that directory's own name as the project — e.g. `directory: apps/website` together with `--project website` (or `projects: ["website"]` in config). The `*` ("all projects") default is unaffected: it short-circuits to the root directory and never goes through name resolution.
