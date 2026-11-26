import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";

export interface ViteCssBuildBindings {
  readonly defineConfig: SymbolDescriptor;
  readonly cssFactory: SymbolDescriptor;
  readonly serveFactory: SymbolDescriptor;
  readonly reactFactory: SymbolDescriptor;
  readonly stylesheetFactory: SymbolDescriptor;
  readonly buildOverrides: SymbolDescriptor;
}
export interface ViteCssBuildDeclaration {
  readonly pluginRoles: readonly ["css-build", "serve-only", "react", "stylesheet"];
  readonly chunks: readonly { readonly contains: readonly string[]; readonly name: string }[];
  readonly jsonFields: readonly ["base", "outDir", "emptyOutDir"];
  readonly requiresQualifiedEagerModuleEvaluation: true;
  readonly requiresPhysicalCssOutputAndJsonSelection: true;
}
const fields = (
  node: EsTreeNode | null | undefined,
  methods = false,
): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const result = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      (!methods && property.method)
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (!key || key === "__proto__" || result.has(key)) return null;
    result.set(key, property.value);
  }
  return result;
};
const exact = (
  map: Map<string, EsTreeNode> | null,
  keys: readonly string[],
): map is Map<string, EsTreeNode> =>
  Boolean(map && map.size === keys.length && keys.every((key) => map.has(key)));
const stringLiteral = (node: EsTreeNode | undefined): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "string";
const lit = (node: EsTreeNode | null | undefined, value: unknown): boolean =>
  isNodeOfType(node, "Literal") && node.value === value;
const use = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => isNodeOfType(node, "Identifier") && scopes.symbolFor(node)?.id === symbol.id;
const fn = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "FunctionExpression") &&
  !node.async &&
  !node.generator &&
  isNodeOfType(node.body, "BlockStatement");
const call0 = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.length === 0 &&
  use(node.callee, symbol, scopes);

/** Local factory proof only. Stock Vite's production hook semantics remain required. */
export const hasServeOnlyViteFactory = (node: EsTreeNode): boolean => {
  if (
    !isNodeOfType(node, "FunctionDeclaration") ||
    node.async ||
    node.generator ||
    node.params.length ||
    !node.body ||
    node.body.body.length !== 1
  )
    return false;
  const ret = node.body.body[0];
  const object = isNodeOfType(ret, "ReturnStatement") ? fields(ret.argument, true) : null;
  if (!exact(object, ["name", "configureServer"]) || !stringLiteral(object.get("name")))
    return false;
  const hook = object.get("configureServer");
  return fn(hook) && isNodeOfType(hook, "FunctionExpression") && hook.params.length === 1;
};

/** Proves only the factory's wrapper; the callee must have a separate CSS write proof. */
export const hasCssBuildStartWrapper = (
  node: EsTreeNode,
  regenerate: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(node, "FunctionDeclaration") ||
    node.async ||
    node.generator ||
    node.params.length ||
    !node.body ||
    node.body.body.length !== 1
  )
    return false;
  const ret = node.body.body[0];
  const object = isNodeOfType(ret, "ReturnStatement") ? fields(ret.argument, true) : null;
  if (
    !exact(object, ["name", "buildStart", "configureServer"]) ||
    !stringLiteral(object.get("name"))
  )
    return false;
  const hook = object.get("buildStart");
  if (
    !isNodeOfType(hook, "FunctionExpression") ||
    !hook.async ||
    hook.generator ||
    hook.params.length ||
    !isNodeOfType(hook.body, "BlockStatement") ||
    hook.body.body.length !== 1
  )
    return false;
  const statement = hook.body.body[0];
  return (
    isNodeOfType(statement, "ExpressionStatement") &&
    isNodeOfType(statement.expression, "AwaitExpression") &&
    call0(statement.expression.argument, regenerate, scopes) &&
    fn(object.get("configureServer"))
  );
};

export const readViteCssBuildConfig = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  bindings: ViteCssBuildBindings,
): ViteCssBuildDeclaration | null => {
  if (!isNodeOfType(program, "Program")) return null;
  const exports = program.body.filter((statement) =>
    isNodeOfType(statement, "ExportDefaultDeclaration"),
  );
  if (exports.length !== 1 || !isNodeOfType(exports[0], "ExportDefaultDeclaration")) return null;
  const call = exports[0].declaration;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !use(call.callee, bindings.defineConfig, scopes) ||
    call.arguments.length !== 1
  )
    return null;
  const root = fields(call.arguments[0]);
  if (!exact(root, ["base", "plugins", "build", "server"])) return null;
  const jsonRead = (node: EsTreeNode | undefined, key: string): boolean => {
    const member = isNodeOfType(node, "ChainExpression") ? node.expression : node;
    return (
      isNodeOfType(member, "MemberExpression") &&
      member.optional === true &&
      !member.computed &&
      isNodeOfType(member.property, "Identifier") &&
      member.property.name === key &&
      use(member.object, bindings.buildOverrides, scopes)
    );
  };
  const fallback = (node: EsTreeNode | undefined, key: string, value: unknown): boolean =>
    isNodeOfType(node, "LogicalExpression") &&
    node.operator === "||" &&
    jsonRead(node.left, key) &&
    lit(node.right, value);
  if (!fallback(root.get("base"), "base", "/")) return null;
  const plugins = root.get("plugins");
  if (
    !isNodeOfType(plugins, "ArrayExpression") ||
    plugins.elements.length !== 4 ||
    !plugins.elements.every((node, index) =>
      call0(
        node,
        [
          bindings.cssFactory,
          bindings.serveFactory,
          bindings.reactFactory,
          bindings.stylesheetFactory,
        ][index],
        scopes,
      ),
    )
  )
    return null;
  const build = fields(root.get("build"));
  if (
    !exact(build, ["outDir", "emptyOutDir", "rollupOptions"]) ||
    !fallback(build.get("outDir"), "outDir", "dist")
  )
    return null;
  const empty = build.get("emptyOutDir");
  if (
    !isNodeOfType(empty, "CallExpression") ||
    empty.optional ||
    empty.arguments.length !== 1 ||
    !isNodeOfType(empty.callee, "Identifier") ||
    empty.callee.name !== "Boolean" ||
    !scopes.isGlobalReference(empty.callee) ||
    !jsonRead(empty.arguments[0], "emptyOutDir")
  )
    return null;
  const rollup = fields(build.get("rollupOptions"));
  const output = rollup && fields(rollup.get("output"), true);
  if (!exact(rollup, ["output"]) || !exact(output, ["manualChunks"])) return null;
  const chunks = output.get("manualChunks");
  if (
    !isNodeOfType(chunks, "FunctionExpression") ||
    !fn(chunks) ||
    chunks.params.length !== 1 ||
    !isNodeOfType(chunks.params[0], "Identifier") ||
    !isNodeOfType(chunks.body, "BlockStatement")
  )
    return null;
  const parameter = scopes.symbolFor(chunks.params[0]);
  if (!parameter) return null;
  const groups: { contains: string[]; name: string }[] = [];
  const contains = (node: EsTreeNode): string[] | null => {
    if (isNodeOfType(node, "LogicalExpression") && node.operator === "||") {
      const a = contains(node.left),
        b = contains(node.right);
      return a && b ? [...a, ...b] : null;
    }
    if (
      !isNodeOfType(node, "CallExpression") ||
      node.optional ||
      node.arguments.length !== 1 ||
      !isNodeOfType(node.arguments[0], "Literal") ||
      typeof node.arguments[0].value !== "string"
    )
      return null;
    const callee = node.callee;
    return isNodeOfType(callee, "MemberExpression") &&
      !callee.optional &&
      !callee.computed &&
      use(callee.object, parameter, scopes) &&
      isNodeOfType(callee.property, "Identifier") &&
      callee.property.name === "includes"
      ? [node.arguments[0].value]
      : null;
  };
  for (const statement of chunks.body.body) {
    if (
      isNodeOfType(statement, "ReturnStatement") &&
      isNodeOfType(statement.argument, "Identifier") &&
      statement.argument.name === "undefined" &&
      scopes.isGlobalReference(statement.argument) &&
      statement === chunks.body.body.at(-1)
    )
      continue;
    if (
      !isNodeOfType(statement, "IfStatement") ||
      statement.alternate ||
      !isNodeOfType(statement.consequent, "BlockStatement") ||
      statement.consequent.body.length !== 1
    )
      return null;
    const ret = statement.consequent.body[0],
      terms = contains(statement.test);
    if (
      !terms ||
      !isNodeOfType(ret, "ReturnStatement") ||
      !isNodeOfType(ret.argument, "Literal") ||
      typeof ret.argument.value !== "string"
    )
      return null;
    groups.push({ contains: terms, name: ret.argument.value });
  }
  if (!groups.length || groups.length > 8) return null;
  // Server options are evaluated by the enclosing source-module abstract proof.
  // This reader never certifies their eager initialization or JSON/output paths.
  if (!fields(root.get("server"))) return null;
  return {
    pluginRoles: ["css-build", "serve-only", "react", "stylesheet"],
    chunks: groups,
    jsonFields: ["base", "outDir", "emptyOutDir"],
    requiresQualifiedEagerModuleEvaluation: true,
    requiresPhysicalCssOutputAndJsonSelection: true,
  };
};
