import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import {
  hasServeOnlyViteFactory,
  readViteCssBuildConfig,
  type ViteCssBuildDeclaration,
} from "./read-vite-css-build-config.js";
interface ImportedBinding {
  readonly source: string;
  readonly imported: string;
  readonly symbol: SymbolDescriptor;
}
export interface ViteCssConfigStartup {
  readonly declaration: ViteCssBuildDeclaration;
  readonly eagerModuleRequests: readonly string[];
  readonly overrideRelativeFilename: string;
  readonly cssFactoryRequest: { readonly source: string; readonly imported: string };
  readonly requiresPhysicalOverrideSelection: true;
}
const fields = (n: EsTreeNode | undefined | null): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(n, "ObjectExpression")) return null;
  const out = new Map<string, EsTreeNode>();
  for (const p of n.properties) {
    if (!isNodeOfType(p, "Property") || p.computed || p.method || p.kind !== "init") return null;
    const k = getStaticPropertyKeyName(p);
    if (!k || k === "__proto__" || out.has(k)) return null;
    out.set(k, p.value);
  }
  return out;
};
const exact = (
  f: Map<string, EsTreeNode> | null,
  keys: readonly string[],
): f is Map<string, EsTreeNode> => !!f && f.size === keys.length && keys.every((k) => f.has(k));
const isPort = (n: EsTreeNode | undefined): boolean =>
  isNodeOfType(n, "Literal") &&
  typeof n.value === "number" &&
  Number.isInteger(n.value) &&
  n.value > 0 &&
  n.value <= 65535;
const literal = (n: EsTreeNode | undefined | null, v: unknown): boolean =>
  isNodeOfType(n, "Literal") && n.value === v;
/** Declaration/startup algebra only. Imports and the CSS factory are separately qualified. */
export function readViteCssConfigStartup(
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  provenCssFactory: SymbolDescriptor,
): ViteCssConfigStartup | null {
  if (!isNodeOfType(program, "Program")) return null;
  const imports: ImportedBinding[] = [];
  const declarations: EsTreeNode[] = [];
  const functions: EsTreeNode[] = [];
  let exported: EsTreeNode | null = null;
  for (const n of program.body) {
    if (isNodeOfType(n, "ImportDeclaration")) {
      if (typeof n.source.value !== "string" || !n.specifiers.length) return null;
      for (const spec of n.specifiers) {
        const imported = isNodeOfType(spec, "ImportDefaultSpecifier")
          ? "default"
          : isNodeOfType(spec, "ImportSpecifier")
            ? isNodeOfType(spec.imported, "Identifier")
              ? spec.imported.name
              : String(spec.imported.value)
            : null;
        const symbol = scopes.symbolFor(spec.local);
        if (!imported || !symbol || symbol.references.some((r) => r.flag !== "read")) return null;
        imports.push({ source: n.source.value, imported, symbol });
      }
    } else if (isNodeOfType(n, "VariableDeclaration")) {
      if (n.kind !== "const" || n.declarations.length !== 1) return null;
      declarations.push(n.declarations[0]);
    } else if (isNodeOfType(n, "FunctionDeclaration")) functions.push(n);
    else if (isNodeOfType(n, "ExportDefaultDeclaration") && !exported) exported = n.declaration;
    else return null;
  }
  const binding = (source: string, imported: string): SymbolDescriptor | null => {
    const all = imports.filter((i) => i.source === source && i.imported === imported);
    return all.length === 1 ? all[0].symbol : null;
  };
  const fs = binding("node:fs", "default"),
    url = binding("node:url", "URL"),
    fileURL = binding("node:url", "fileURLToPath"),
    define = binding("vite", "defineConfig"),
    react = binding("@vitejs/plugin-react", "default"),
    style = binding("@tailwindcss/vite", "default");
  if (
    !fs ||
    !url ||
    !fileURL ||
    !define ||
    !react ||
    !style ||
    declarations.length !== 2 ||
    !exported
  )
    return null;
  const same = (n: EsTreeNode | undefined | null, s: SymbolDescriptor): boolean =>
    isNodeOfType(n, "Identifier") && scopes.symbolFor(n)?.id === s.id;
  const directCall = (
    n: EsTreeNode | undefined | null,
    s: SymbolDescriptor,
    args: number,
  ): n is EsTreeNode & { arguments: EsTreeNode[] } =>
    isNodeOfType(n, "CallExpression") &&
    !n.optional &&
    n.arguments.length === args &&
    same(n.callee, s);
  const memberCall = (
    n: EsTreeNode | undefined | null,
    s: SymbolDescriptor,
    key: string,
    args: number,
  ): n is EsTreeNode & { arguments: EsTreeNode[] } =>
    isNodeOfType(n, "CallExpression") &&
    !n.optional &&
    n.arguments.length === args &&
    isNodeOfType(n.callee, "MemberExpression") &&
    !n.callee.computed &&
    !n.callee.optional &&
    same(n.callee.object, s) &&
    isNodeOfType(n.callee.property, "Identifier") &&
    n.callee.property.name === key;
  const meta = (n: EsTreeNode): boolean =>
    isNodeOfType(n, "MemberExpression") &&
    !n.computed &&
    !n.optional &&
    isNodeOfType(n.object, "MetaProperty") &&
    n.object.meta.name === "import" &&
    n.object.property.name === "meta" &&
    isNodeOfType(n.property, "Identifier") &&
    n.property.name === "url";
  const fileFromUrl = (n: EsTreeNode | undefined | null, value: string): boolean =>
    directCall(n, fileURL, 1) &&
    isNodeOfType(n.arguments[0], "NewExpression") &&
    same(n.arguments[0].callee, url) &&
    n.arguments[0].arguments.length === 2 &&
    literal(n.arguments[0].arguments[0], value) &&
    meta(n.arguments[0].arguments[1]);
  const pathDeclaration = declarations[0],
    dataDeclaration = declarations[1];
  if (
    !isNodeOfType(pathDeclaration, "VariableDeclarator") ||
    !isNodeOfType(pathDeclaration.id, "Identifier") ||
    !isNodeOfType(dataDeclaration, "VariableDeclarator") ||
    !isNodeOfType(dataDeclaration.id, "Identifier")
  )
    return null;
  const pathSymbol = scopes.symbolFor(pathDeclaration.id),
    dataSymbol = scopes.symbolFor(dataDeclaration.id);
  if (!pathSymbol || !dataSymbol || !directCall(pathDeclaration.init, fileURL, 1)) return null;
  const urlExpression = pathDeclaration.init.arguments[0];
  if (
    !isNodeOfType(urlExpression, "NewExpression") ||
    !isNodeOfType(urlExpression.arguments[0], "Literal") ||
    typeof urlExpression.arguments[0].value !== "string"
  )
    return null;
  const filename = urlExpression.arguments[0].value;
  if (
    !/^\.\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.json$/u.test(filename) ||
    filename
      .split("/")
      .slice(1)
      .some((p) => p === "." || p === "..") ||
    !fileFromUrl(pathDeclaration.init, filename)
  )
    return null;
  const value = dataDeclaration.init;
  if (
    !isNodeOfType(value, "ConditionalExpression") ||
    !memberCall(value.test, fs, "existsSync", 1) ||
    !same(value.test.arguments[0], pathSymbol) ||
    !literal(value.alternate, null)
  )
    return null;
  const parse = value.consequent;
  if (
    !isNodeOfType(parse, "CallExpression") ||
    parse.optional ||
    parse.arguments.length !== 1 ||
    !isNodeOfType(parse.callee, "MemberExpression") ||
    parse.callee.computed ||
    parse.callee.optional ||
    !isNodeOfType(parse.callee.object, "Identifier") ||
    parse.callee.object.name !== "JSON" ||
    !scopes.isGlobalReference(parse.callee.object) ||
    !isNodeOfType(parse.callee.property, "Identifier") ||
    parse.callee.property.name !== "parse"
  )
    return null;
  const read = parse.arguments[0];
  if (
    !memberCall(read, fs, "readFileSync", 2) ||
    !same(read.arguments[0], pathSymbol) ||
    !literal(read.arguments[1], "utf8")
  )
    return null;
  if (!directCall(exported, define, 1)) return null;
  const root = fields(exported.arguments[0]);
  if (!root) return null;
  const plugins = root.get("plugins");
  if (!isNodeOfType(plugins, "ArrayExpression") || plugins.elements.length !== 4) return null;
  const serveCall = plugins.elements[1];
  if (!isNodeOfType(serveCall, "CallExpression") || !isNodeOfType(serveCall.callee, "Identifier"))
    return null;
  const serveSymbol = scopes.symbolFor(serveCall.callee);
  if (!serveSymbol) return null;
  const candidates = functions.filter(
    (f) => isNodeOfType(f, "FunctionDeclaration") && f.id?.name === serveSymbol.name,
  );
  const serve = candidates.length === 1 ? candidates[0] : null;
  if (
    !serve ||
    serveSymbol.declarationNode !== serve ||
    serveSymbol.references.some((r) => r.flag !== "read") ||
    !hasServeOnlyViteFactory(serve)
  )
    return null;
  const css = imports.find((i) => i.symbol.id === provenCssFactory.id);
  if (!css) return null;
  const server = fields(root.get("server"));
  const serverFs = server && fields(server.get("fs"));
  if (
    !exact(server, ["host", "port", "strictPort", "fs"]) ||
    !literal(server.get("host"), "127.0.0.1") ||
    !isPort(server.get("port")) ||
    !literal(server.get("strictPort"), true) ||
    !exact(serverFs, ["allow"])
  )
    return null;
  const allow = serverFs.get("allow");
  if (
    !isNodeOfType(allow, "ArrayExpression") ||
    allow.elements.length !== 1 ||
    !fileFromUrl(allow.elements[0], "..")
  )
    return null;
  // Other function declarations are inert at startup. The module evaluator must
  // additionally prove they are not invoked by imported factories/config values.
  const declaration = readViteCssBuildConfig(program, scopes, {
    defineConfig: define,
    cssFactory: provenCssFactory,
    serveFactory: serveSymbol,
    reactFactory: react,
    stylesheetFactory: style,
    buildOverrides: dataSymbol,
  });
  return declaration
    ? {
        declaration,
        eagerModuleRequests: [...new Set(imports.map((i) => i.source))],
        overrideRelativeFilename: filename,
        cssFactoryRequest: { source: css.source, imported: css.imported },
        requiresPhysicalOverrideSelection: true,
      }
    : null;
}
