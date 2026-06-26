---
"@react-doctor/core": patch
"react-doctor": patch
"oxlint-plugin-react-doctor": patch
---

fix: gate server-only rule recommendations for Next.js static export

Detects `output: "export"` in `next.config.*` and gates rules that recommend server-side fixes (server `redirect()`, middleware, Server Actions) for projects where those features don't exist. Fixes #976.

- `nextjs-no-client-side-redirect` is now disabled with `disabledBy: ["nextjs:static-export"]`
- `no-prevent-default` treats static-export Next.js as client-only (no server action recommendation)
