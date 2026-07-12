---
"@react-doctor/core": patch
---

Enable the per-file lint cache in audit mode (`--no-respect-inline-disables`). The neutralize pass already rewrites inline disable directives on disk before the per-file content hash is taken, so the cache key reflects exactly what oxlint linted; `respectInlineDisables` is now folded into the ruleset hash so audit and default runs occupy disjoint cache namespaces and never replay each other's entries. Warm audit-mode scans re-lint only changed files instead of the whole tree — the mode CI and pre-commit hooks run in.
