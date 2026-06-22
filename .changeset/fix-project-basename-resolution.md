---
"react-doctor": patch
---

Fix `--project` resolution when scanning from within a project directory whose basename matches the requested project name.

When running react-doctor from a subdirectory (e.g., `apps/website`) and passing `--project website`, the CLI now correctly recognizes that the current directory is the requested project instead of failing with "Project 'website' is not a directory under /path/to/apps/website."

This primarily affects GitHub Action users who set `directory: apps/website` while leaving `project: "*"` at its default, where the `*` expands to the single discovered project named `website`.
