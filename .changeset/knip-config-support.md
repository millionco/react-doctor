---
"@react-doctor/core": patch
"react-doctor": patch
---

Support knip.config.{ts,js,mjs,cjs} in dead-code analysis. React Doctor now loads TypeScript and JavaScript Knip config files in addition to knip.json and package.json#knip, eliminating the need to duplicate ignore patterns. Config files are resolved in this order: knip.config.{ts,mts,cts,js,mjs,cjs} → knip.json → package.json#knip.
