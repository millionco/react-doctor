---
"@react-doctor/core": patch
---

Fix project discovery failures in pnpm workspaces by using default TypeScript import for ESM/CJS interop.

Replace `import * as ts from 'typescript'` with `import ts from 'typescript'` in 4 files to fix "No React project found" errors in environments where TypeScript 5.3.3 is resolved. The namespace import created a structure where the TypeScript API was under `ts.default`, causing calls like `ts.parseConfigFileTextToJson` to fail with "not a function". The default import pattern works consistently across all TypeScript versions and module resolution strategies.
