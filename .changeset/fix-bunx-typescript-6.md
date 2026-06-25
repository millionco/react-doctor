---
"react-doctor": patch
"deslop-js": patch
---

Exclude TypeScript 6.x to fix bunx installation crash

TypeScript 6.0.3 has an internal circular dependency with its `Comparison` enum
that triggers a known Bun module loader bug, causing `bunx react-doctor install`
to crash with "ReferenceError: Cannot access 'Comparison' before initialization".
Narrow the dependency range to `>=5.0.4 <6` until Bun fixes enum initialization
order (see oven-sh/bun#12805).

The constraint covers both `react-doctor` (whose CLI imports `typescript` at
startup) and `deslop-js` (loaded by the dead-code scan, which can run under bun),
so no published package pulls TypeScript 6.x into a consumer's install tree.

`npx` continues to work because npm's resolver handles the circular dependency
correctly. TypeScript 5.9.3 is stable and tested; TypeScript 6.x support will
return once the upstream bug is resolved.

Closes #962
