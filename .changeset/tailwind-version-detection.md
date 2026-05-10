---
"react-doctor": patch
---

Detect the project's Tailwind version (`tailwindcss` in `package.json`,
including pnpm and Bun catalog references) and gate Tailwind-aware
rules on it. `design-no-redundant-size-axes` (which suggests collapsing
`w-N h-N` → `size-N`) now stays silent on Tailwind v3.0 … v3.3 — those
versions predate the `size-N` shorthand and the suggestion would
generate classes that don't compile. The rule still fires on Tailwind
v3.4+, v4+, and when the version cannot be resolved (the same
"assume latest" fallback used by the React-major gate).

A new `tailwindVersion` field is added to `ProjectInfo` and printed
during scans so it's visible alongside the detected React version and
framework.
