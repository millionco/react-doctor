---
"react-doctor": patch
"@react-doctor/core": patch
"oxlint-plugin-react-doctor": patch
---

Next.js `output: "export"` now gates server-only recommendations: `nextjs-no-client-side-redirect` is disabled for static export, and `no-prevent-default` no longer recommends Server Actions for forms in static-export projects. This fixes the false positives from #976 and locks in the #1082 and #1078 regressions with tests.
