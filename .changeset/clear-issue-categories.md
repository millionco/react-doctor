---
"react-doctor": patch
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
---

Collapse diagnostic categories into five clear, outcome-based buckets: **Security**, **Bugs**, **Performance**, **Accessibility**, and **Maintainability**. The previous fine-grained labels (Correctness, State & Effects, React Compiler, Next.js, React Native, Server, TanStack Query/Start, Preact → Bugs; Bundle Size → Performance; Architecture/Design → Maintainability) now roll up so the scan output reads as plain issue types at a glance.

This changes the `category` value on every diagnostic (CLI output, the per-error headline prefix like `Security: Use of eval()`, and JSON/programmatic output). If you key `categories` severity overrides off the old names, update them to the new buckets. Dead-code findings (unused files/exports/dependencies, circular imports) now report `Maintainability` instead of `Dead Code`. Bundle-size findings now sort with `Performance` (higher stakes) rather than near the bottom of the top-errors block.
