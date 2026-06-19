---
"@react-doctor/core": patch
---

Support TypeScript 5.0+ alongside 6.x

Widens the `typescript` dependency range from `^6.0.3` to `>=5.0.0 <7` to support consumers on TypeScript 5.x. All TypeScript APIs used in @react-doctor/core (`ts.createSourceFile`, `ts.parseConfigFileTextToJson`, `ts.forEachChild`, type guards including `ts.isSatisfiesExpression` and `ts.isTypeAssertionExpression`) are available in TypeScript 5.0+.

The floor is set to 5.0.0 because that's when `isTypeAssertionExpression` became the required API name (replacing the deprecated `isTypeAssertion`).
