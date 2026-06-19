---
"@react-doctor/core": patch
---

Loosen the `typescript` dependency range to `>=5.0.4 <7` so consumers on TypeScript 5 can vendor `@react-doctor/core` without a forced TS 6 install. Every TypeScript compiler API the engine uses (`createSourceFile`, `forEachChild`, `parseConfigFileTextToJson`, and the AST type guards — the newest being `isTypeAssertionExpression`, TS 5.0) exists in TS 5.x, and this matches the range already declared by the published `react-doctor` CLI that bundles core.
