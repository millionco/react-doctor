// `hermes-parser` ships no type declarations. The verify tooling
// (`verify/capture-code.ts`) only uses its `parse`/`parseForESLint` exports at
// runtime; an ambient declaration is enough to satisfy `tsc` (TS7016) without
// pulling in a full typing surface.
declare module "hermes-parser";
