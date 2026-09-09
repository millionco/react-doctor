import type { TsdownPlugin } from "vite-plus/pack";

const TYPESCRIPT_MODULE_ID = "typescript";
const RESOLVED_ID = "\0react-doctor:require-typescript";

// HACK: `typescript` is a ~10 MB CommonJS bundle whose package.json declares no
// `type`, so reaching it through a static ESM `import` makes Node sniff the
// module format and run cjs-module-lexer over the whole file on every start
// (~130ms, immune to the compile cache). Rewrite the bundled import to the
// plain `require` a CommonJS package expects, which skips both. Source keeps
// `import ts from "typescript"` so types resolve normally; only the emitted
// bundle changes. Node dedupes the two loaders' module instance either way.
export const requireTypescriptPlugin = (): TsdownPlugin => ({
  name: "react-doctor:require-typescript",
  resolveId: (id) => (id === TYPESCRIPT_MODULE_ID ? RESOLVED_ID : null),
  load: (id) =>
    id === RESOLVED_ID
      ? [
          'import { createRequire } from "node:module";',
          `export default createRequire(import.meta.url)(${JSON.stringify(TYPESCRIPT_MODULE_ID)});`,
        ].join("\n")
      : null,
});
