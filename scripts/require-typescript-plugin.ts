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
//
// The require is also deferred to the first property read: the default export
// is a live `let` binding that starts as a Proxy and is swapped for the real
// module on first access, so a run that never asks TypeScript anything (a
// whole-repo cache hit, `--version`) never pays its compile and evaluation,
// and every later `ts.x` read hits the real module directly. No module in the
// bundles reads the binding at module scope (a module-scope
// `ts.SyntaxKind.X` would re-eagerize the load). Side effect: typescript.js
// raises `Error.stackTraceLimit` at evaluation, which now happens later.
export const requireTypescriptPlugin = (): TsdownPlugin => ({
  name: "react-doctor:require-typescript",
  resolveId: (id) => (id === TYPESCRIPT_MODULE_ID ? RESOLVED_ID : null),
  load: (id) =>
    id === RESOLVED_ID
      ? [
          'import { createRequire } from "node:module";',
          "const requireTypescript = createRequire(import.meta.url);",
          "const loadTypescript = () => {",
          `  const realModule = requireTypescript(${JSON.stringify(TYPESCRIPT_MODULE_ID)});`,
          "  typescriptBinding = realModule;",
          "  return realModule;",
          "};",
          "let typescriptBinding = new Proxy({}, {",
          "  get: (_target, key) => Reflect.get(loadTypescript(), key),",
          "  has: (_target, key) => Reflect.has(loadTypescript(), key),",
          "});",
          "export { typescriptBinding as default };",
        ].join("\n")
      : null,
});
