import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface StockKktConfigOperations {
  readonly parameterRoles: readonly ["configuration", "environment", "loaderOptions"];
  readonly pluginOrder: ReadonlyArray<{ readonly source: string; readonly importedName: string }>;
  readonly rawSuffix: ".txt";
  readonly definedVersionIdentifier: string;
  readonly productionPublicPath: "./";
  readonly requiresStockSuppliers: true;
  readonly requiresPlainConfiguration: true;
}
const PLUGINS = [
  ["@kkt/less-modules", "default"],
  ["@kkt/raw-modules", "default"],
  ["markdown-react-code-preview-loader", "mdCodeModulesLoader"],
  ["@kkt/scope-plugin-options", "disableScopePlugin"],
] as const;
const objectFields = (node: EsTreeNode | null | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (key === null || key === "__proto__" || fields.has(key)) return null;
    fields.set(key, property.value);
  }
  return fields;
};
const literal = (node: EsTreeNode | null | undefined, value: unknown): boolean =>
  isNodeOfType(node, "Literal") && node.value === value;
const regex = (node: EsTreeNode | null | undefined): { pattern: string; flags: string } | null => {
  if (!isNodeOfType(node, "Literal") || !("regex" in node) || !node.regex) return null;
  return node.regex;
};

/** Declaration/operation grammar only; never executes config or certifies supplier bytes. */
export const readStockKktConfigOperations = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): StockKktConfigOperations | null => {
  if (!isNodeOfType(program, "Program")) return null;
  const imports = new Map<string, SymbolDescriptor>();
  const allowedReferences = new Set<EsTreeNode>();
  const tracked = new Set<SymbolDescriptor>();
  const bind = (node: EsTreeNode): SymbolDescriptor | null => {
    const symbol = scopes.symbolFor(node);
    if (symbol) tracked.add(symbol);
    return symbol;
  };
  const use = (
    node: EsTreeNode | null | undefined,
    symbol: SymbolDescriptor | null | undefined,
  ): boolean => {
    if (
      !node ||
      !symbol ||
      !isNodeOfType(node, "Identifier") ||
      scopes.symbolFor(node)?.id !== symbol.id
    )
      return false;
    allowedReferences.add(node);
    return true;
  };
  let callback: EsTreeNode | null = null;
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      if (typeof statement.source.value !== "string") return null;
      const source = statement.source.value;
      if (statement.specifiers.length === 0) return null;
      if (!["webpack", "kkt", "./package.json", ...PLUGINS.map(([name]) => name)].includes(source))
        return null;
      for (const specifier of statement.specifiers) {
        const name = isNodeOfType(specifier, "ImportDefaultSpecifier")
          ? "default"
          : isNodeOfType(specifier, "ImportSpecifier") &&
              isNodeOfType(specifier.imported, "Identifier")
            ? specifier.imported.name
            : null;
        if (!name) return null;
        const key = source + ":" + name;
        if (imports.has(key)) return null;
        const symbol = bind(specifier.local);
        if (!symbol) return null;
        if (source === "kkt") {
          if (
            !["LoaderConfOptions", "WebpackConfiguration"].includes(name) ||
            symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier))
          )
            return null;
        } else if (
          source === "webpack" || source === "./package.json"
            ? name !== "default"
            : !PLUGINS.some(([role, api]) => source === role && name === api)
        )
          return null;
        imports.set(key, symbol);
      }
    } else if (isNodeOfType(statement, "ExportDefaultDeclaration") && !callback)
      callback = stripParenExpression(statement.declaration);
    else return null;
  }
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 3 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    !callback.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  )
    return null;
  const conf = bind(callback.params[0]!),
    env = bind(callback.params[1]!),
    options = bind(callback.params[2]!);
  if (!conf || !env || !options) return null;
  const member = (
    node: EsTreeNode | null | undefined,
    keys: ReadonlyArray<string>,
    owner = conf,
  ): boolean => {
    if (!node) return false;
    let current = stripParenExpression(node);
    for (let i = keys.length - 1; i >= 0; i--) {
      if (
        !isNodeOfType(current, "MemberExpression") ||
        current.computed ||
        current.optional ||
        !isNodeOfType(current.property, "Identifier") ||
        current.property.name !== keys[i]
      )
        return false;
      current = stripParenExpression(current.object);
    }
    return use(current, owner);
  };
  const assignment = (statement: EsTreeNode, keys: ReadonlyArray<string>): EsTreeNode | null => {
    if (
      !isNodeOfType(statement, "ExpressionStatement") ||
      !isNodeOfType(statement.expression, "AssignmentExpression") ||
      statement.expression.operator !== "=" ||
      !member(statement.expression.left, keys)
    )
      return null;
    return statement.expression.right;
  };
  const body = callback.body.body;
  if (body.length !== 9) return null;
  for (let i = 0; i < 4; i++) {
    const expression = assignment(body[i]!, []);
    if (
      !isNodeOfType(expression, "CallExpression") ||
      expression.optional ||
      !use(expression.callee, imports.get(PLUGINS[i]![0] + ":" + PLUGINS[i]![1]))
    )
      return null;
    const args = expression.arguments;
    if (!use(args[0], conf)) return null;
    if (i === 0) {
      if (args.length !== 3 || !use(args[1], env) || !use(args[2], options)) return null;
    } else if (i === 1) {
      if (
        args.length !== 3 ||
        !use(args[1], env) ||
        !isNodeOfType(args[2], "ObjectExpression") ||
        args[2].properties.length !== 2
      )
        return null;
      const [spread, test] = args[2].properties;
      if (
        !isNodeOfType(spread, "SpreadElement") ||
        !use(spread.argument, options) ||
        !isNodeOfType(test, "Property") ||
        test.computed ||
        test.method ||
        test.kind !== "init" ||
        getStaticPropertyKeyName(test) !== "test"
      )
        return null;
      const suffix = regex(test.value);
      if (
        !suffix ||
        !["\\.txt$", "\\.(txt)$", "\\.(?:txt)$"].includes(suffix.pattern) ||
        !["", "i"].includes(suffix.flags)
      )
        return null;
    } else if (args.length !== 1) return null;
  }
  const push = body[4];
  if (
    !isNodeOfType(push, "ExpressionStatement") ||
    !isNodeOfType(push.expression, "CallExpression") ||
    push.expression.optional ||
    !member(push.expression.callee, ["plugins", "push"]) ||
    push.expression.arguments.length !== 1
  )
    return null;
  const plugin = push.expression.arguments[0];
  if (
    !isNodeOfType(plugin, "NewExpression") ||
    !member(plugin.callee, ["DefinePlugin"], imports.get("webpack:default")) ||
    plugin.arguments.length !== 1
  )
    return null;
  const definitions = objectFields(plugin.arguments[0]);
  if (!definitions || definitions.size !== 1) return null;
  const definedVersionIdentifier = [...definitions.keys()][0]!;
  if (!/^[A-Z][A-Z0-9_]*$/.test(definedVersionIdentifier) || definedVersionIdentifier === "JSON")
    return null;
  const defineValue = [...definitions.values()][0];
  if (
    !isNodeOfType(defineValue, "CallExpression") ||
    defineValue.optional ||
    defineValue.arguments.length !== 1 ||
    !isNodeOfType(defineValue.callee, "MemberExpression") ||
    defineValue.callee.computed ||
    !isNodeOfType(defineValue.callee.object, "Identifier") ||
    defineValue.callee.object.name !== "JSON" ||
    !scopes.isGlobalReference(defineValue.callee.object) ||
    !isNodeOfType(defineValue.callee.property, "Identifier") ||
    defineValue.callee.property.name !== "stringify" ||
    !member(defineValue.arguments[0], ["version"], imports.get("./package.json:default"))
  )
    return null;
  if (!literal(assignment(body[5]!, ["module", "exprContextCritical"]), false)) return null;
  const warnings = assignment(body[6]!, ["ignoreWarnings"]);
  if (!isNodeOfType(warnings, "ArrayExpression") || warnings.elements.length !== 1) return null;
  const warning = objectFields(warnings.elements[0]);
  if (!warning || warning.size !== 1 || !regex(warning.get("module"))) return null;
  const production = body[7];
  if (
    !isNodeOfType(production, "IfStatement") ||
    production.alternate ||
    !isNodeOfType(production.test, "BinaryExpression") ||
    production.test.operator !== "===" ||
    !use(production.test.left, env) ||
    !literal(production.test.right, "production") ||
    !isNodeOfType(production.consequent, "BlockStatement") ||
    production.consequent.body.length !== 2
  )
    return null;
  const optimization = assignment(production.consequent.body[0]!, ["optimization"]);
  if (!isNodeOfType(optimization, "ObjectExpression") || optimization.properties.length !== 2)
    return null;
  const [spread, split] = optimization.properties;
  if (
    !isNodeOfType(spread, "SpreadElement") ||
    !member(spread.argument, ["optimization"]) ||
    !isNodeOfType(split, "Property") ||
    split.computed ||
    split.method ||
    split.kind !== "init" ||
    getStaticPropertyKeyName(split) !== "splitChunks"
  )
    return null;
  const splitFields = objectFields(split.value);
  if (!splitFields || splitFields.size !== 1) return null;
  const groups = objectFields(splitFields.get("cacheGroups"));
  if (!groups || !groups.size) return null;
  for (const group of groups.values()) {
    const fields = objectFields(group);
    const name = fields?.get("name");
    if (
      !fields ||
      fields.size !== 3 ||
      !regex(fields.get("test")) ||
      !isNodeOfType(name, "Literal") ||
      typeof name.value !== "string" ||
      !literal(fields.get("chunks"), "all")
    )
      return null;
  }
  const output = assignment(production.consequent.body[1]!, ["output"]);
  if (!isNodeOfType(output, "ObjectExpression") || output.properties.length !== 2) return null;
  const [outputSpread, publicPath] = output.properties;
  if (
    !isNodeOfType(outputSpread, "SpreadElement") ||
    !member(outputSpread.argument, ["output"]) ||
    !isNodeOfType(publicPath, "Property") ||
    publicPath.computed ||
    publicPath.method ||
    publicPath.kind !== "init" ||
    getStaticPropertyKeyName(publicPath) !== "publicPath" ||
    !literal(publicPath.value, "./")
  )
    return null;
  if (!isNodeOfType(body[8], "ReturnStatement") || !use(body[8].argument, conf)) return null;
  for (const symbol of tracked) {
    if (
      symbol.references.some(
        ({ identifier }) =>
          identifier !== symbol.bindingIdentifier &&
          !allowedReferences.has(identifier) &&
          !isTypeScriptTypePosition(identifier),
      )
    )
      return null;
  }
  return {
    parameterRoles: ["configuration", "environment", "loaderOptions"],
    pluginOrder: PLUGINS.map(([source, importedName]) => ({ source, importedName })),
    rawSuffix: ".txt",
    definedVersionIdentifier,
    productionPublicPath: "./",
    requiresStockSuppliers: true,
    requiresPlainConfiguration: true,
  };
};
