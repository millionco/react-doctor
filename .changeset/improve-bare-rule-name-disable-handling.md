---
"react-doctor": patch
---

Improve disable-directive handling for react-doctor rules:

- `// react-doctor-disable-line` / `-next-line` (and `ignore.rules` / rule lookups) now accept a rule's bare short id, e.g. `no-eval` for `react-doctor/no-eval` — the unqualified form people reach for first.
- When an `eslint-disable` / `oxlint-disable` directive names a react-doctor rule by an id oxlint can't bind to a plugin rule — a bare short id (`no-eval`) or a legacy plugin prefix (`react/jsx-key`), whether inline or as a file-level block disable — the diagnostic now carries a hint to use the full `react-doctor/<id>` key.
