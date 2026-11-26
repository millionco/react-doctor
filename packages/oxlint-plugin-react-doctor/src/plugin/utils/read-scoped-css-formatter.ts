import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
export interface CssFormatterRequirements {
  readonly recordPaths: readonly string[];
  readonly primitivePaths: readonly string[];
  readonly stringKeyHelper: SymbolDescriptor;
  readonly requiresOwnDataDescriptors: true;
  readonly requiresStockIterationAndStringIntrinsics: true;
}
interface Value {
  readonly path: string;
  readonly key?: boolean;
}
/** Syntax/effect slice only: the caller must prove each returned path is own primitive/data. */
export function readScopedCssFormatter(
  formatter: EsTreeNode,
  scopes: ScopeAnalysis,
): CssFormatterRequirements | null {
  if (
    !isNodeOfType(formatter, "FunctionDeclaration") ||
    formatter.async ||
    formatter.generator ||
    formatter.params.length !== 1 ||
    !isNodeOfType(formatter.params[0], "ObjectPattern") ||
    !formatter.body
  )
    return null;
  const module = scopes.rootScope.node;
  if (!isNodeOfType(module, "Program")) return null;
  const unique = (name: string): boolean =>
    module.body
      .map((n) => (isNodeOfType(n, "ExportNamedDeclaration") ? n.declaration : n))
      .filter((n) => isNodeOfType(n, "FunctionDeclaration") && n.id?.name === name).length === 1;
  if (!formatter.id || !unique(formatter.id.name)) return null;
  const values = new Map<number, Value>();
  const records = new Set<string>(),
    primitives = new Set<string>();
  let array: SymbolDescriptor | null = null;
  let helper: SymbolDescriptor | null = null;
  const bind = (n: EsTreeNode | undefined | null, value: Value): boolean => {
    if (!isNodeOfType(n, "Identifier")) return false;
    const symbol = scopes.symbolFor(n);
    if (!symbol || symbol.references.some((r) => r.flag !== "read")) return false;
    values.set(symbol.id, value);
    return true;
  };
  for (const p of formatter.params[0].properties) {
    if (
      !isNodeOfType(p, "Property") ||
      p.computed ||
      p.kind !== "init" ||
      !isNodeOfType(p.key, "Identifier") ||
      !bind(p.value, { path: p.key.name })
    )
      return null;
  }
  const value = (n: EsTreeNode | undefined | null): Value | null => {
    if (isNodeOfType(n, "Identifier")) {
      const symbol = scopes.symbolFor(n);
      return symbol ? (values.get(symbol.id) ?? null) : null;
    }
    if (
      isNodeOfType(n, "MemberExpression") &&
      !n.computed &&
      !n.optional &&
      isNodeOfType(n.property, "Identifier")
    ) {
      const parent = value(n.object);
      return parent ? { path: parent.path + "." + n.property.name } : null;
    }
    return null;
  };
  const same = (n: EsTreeNode | undefined | null, s: SymbolDescriptor | null): boolean =>
    !!s && isNodeOfType(n, "Identifier") && scopes.symbolFor(n)?.id === s.id;
  const primitive = (n: EsTreeNode | undefined | null): boolean => {
    if (isNodeOfType(n, "Literal"))
      return (
        typeof n.value === "string" || typeof n.value === "number" || typeof n.value === "boolean"
      );
    const v = value(n);
    if (v) {
      if (!v.key) primitives.add(v.path);
      return true;
    }
    return false;
  };
  const stringHelper = (symbol: SymbolDescriptor): boolean => {
    const node = symbol.declarationNode;
    if (
      !unique(symbol.name) ||
      !isNodeOfType(node, "FunctionDeclaration") ||
      node.async ||
      node.generator ||
      node.params.length !== 1 ||
      !isNodeOfType(node.params[0], "Identifier") ||
      !node.body ||
      node.body.body.length !== 1
    )
      return false;
    const parameter = scopes.symbolFor(node.params[0]);
    const ret = node.body.body[0];
    if (
      !parameter ||
      !isNodeOfType(ret, "ReturnStatement") ||
      !isNodeOfType(ret.argument, "CallExpression") ||
      ret.argument.optional ||
      ret.argument.arguments.length ||
      !isNodeOfType(ret.argument.callee, "MemberExpression") ||
      ret.argument.callee.computed ||
      ret.argument.callee.optional ||
      !isNodeOfType(ret.argument.callee.property, "Identifier") ||
      ret.argument.callee.property.name !== "toLowerCase"
    )
      return false;
    const replace = ret.argument.callee.object;
    if (
      !isNodeOfType(replace, "CallExpression") ||
      replace.optional ||
      replace.arguments.length !== 2 ||
      !isNodeOfType(replace.callee, "MemberExpression") ||
      replace.callee.computed ||
      replace.callee.optional ||
      !same(replace.callee.object, parameter) ||
      !isNodeOfType(replace.callee.property, "Identifier") ||
      replace.callee.property.name !== "replace"
    )
      return false;
    const regex = replace.arguments[0];
    return (
      isNodeOfType(regex, "Literal") &&
      "regex" in regex &&
      !!regex.regex &&
      regex.regex.pattern === "([a-z0-9])([A-Z])" &&
      regex.regex.flags === "g" &&
      isNodeOfType(replace.arguments[1], "Literal") &&
      replace.arguments[1].value === "$1-$2"
    );
  };
  const text = (n: EsTreeNode | undefined | null): boolean => {
    if (primitive(n)) return true;
    if (isNodeOfType(n, "TemplateLiteral"))
      return n.expressions.every((expr) => {
        if (primitive(expr)) return true;
        if (
          !isNodeOfType(expr, "CallExpression") ||
          expr.optional ||
          expr.arguments.length !== 1 ||
          !isNodeOfType(expr.callee, "Identifier")
        )
          return false;
        const argument = value(expr.arguments[0]),
          symbol = scopes.symbolFor(expr.callee);
        if (
          !argument?.key ||
          !symbol ||
          !stringHelper(symbol) ||
          (helper && helper.id !== symbol.id)
        )
          return false;
        helper = symbol;
        return true;
      });
    return false;
  };
  const push = (n: EsTreeNode): boolean =>
    isNodeOfType(n, "ExpressionStatement") &&
    isNodeOfType(n.expression, "CallExpression") &&
    !n.expression.optional &&
    n.expression.arguments.length === 1 &&
    isNodeOfType(n.expression.callee, "MemberExpression") &&
    !n.expression.callee.computed &&
    !n.expression.callee.optional &&
    same(n.expression.callee.object, array) &&
    isNodeOfType(n.expression.callee.property, "Identifier") &&
    n.expression.callee.property.name === "push" &&
    text(n.expression.arguments[0]);
  const statements = (body: readonly EsTreeNode[], depth: number): boolean => {
    if (depth > 4) return false;
    for (const n of body) {
      if (push(n)) continue;
      if (
        isNodeOfType(n, "VariableDeclaration") &&
        n.kind === "const" &&
        n.declarations.length === 1
      ) {
        const d = n.declarations[0];
        if (!isNodeOfType(d, "VariableDeclarator") || !isNodeOfType(d.id, "Identifier"))
          return false;
        if (!array && isNodeOfType(d.init, "ArrayExpression") && !d.init.elements.length) {
          array = scopes.symbolFor(d.id);
          if (!array) return false;
          continue;
        }
        const v = value(d.init);
        if (!v || !bind(d.id, v)) return false;
        continue;
      }
      if (
        isNodeOfType(n, "IfStatement") &&
        !n.alternate &&
        isNodeOfType(n.test, "BinaryExpression") &&
        ["===", "!=="].includes(n.test.operator) &&
        primitive(n.test.left) &&
        primitive(n.test.right) &&
        isNodeOfType(n.consequent, "ContinueStatement") &&
        !n.consequent.label &&
        depth > 0
      )
        continue;
      if (
        isNodeOfType(n, "ForOfStatement") &&
        !n.await &&
        isNodeOfType(n.left, "VariableDeclaration") &&
        n.left.kind === "const" &&
        n.left.declarations.length === 1 &&
        isNodeOfType(n.body, "BlockStatement")
      ) {
        const d = n.left.declarations[0],
          call = n.right;
        if (
          !isNodeOfType(d, "VariableDeclarator") ||
          !isNodeOfType(d.id, "ArrayPattern") ||
          d.id.elements.length !== 2 ||
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          call.arguments.length !== 1 ||
          !isNodeOfType(call.callee, "MemberExpression") ||
          call.callee.computed ||
          call.callee.optional ||
          !isNodeOfType(call.callee.object, "Identifier") ||
          call.callee.object.name !== "Object" ||
          !scopes.isGlobalReference(call.callee.object) ||
          !isNodeOfType(call.callee.property, "Identifier") ||
          call.callee.property.name !== "entries"
        )
          return false;
        const source = value(call.arguments[0]);
        if (!source) return false;
        records.add(source.path);
        if (
          !bind(d.id.elements[0], { path: source.path + ".*key", key: true }) ||
          !bind(d.id.elements[1], { path: source.path + ".*" })
        )
          return false;
        if (!statements(n.body.body, depth + 1)) return false;
        continue;
      }
      return false;
    }
    return true;
  };
  const body = formatter.body.body;
  if (!body.length) return null;
  const ret = body.at(-1)!;
  if (
    !isNodeOfType(ret, "ReturnStatement") ||
    !isNodeOfType(ret.argument, "CallExpression") ||
    ret.argument.optional ||
    ret.argument.arguments.length !== 1 ||
    !isNodeOfType(ret.argument.arguments[0], "Literal") ||
    ret.argument.arguments[0].value !== "\n" ||
    !isNodeOfType(ret.argument.callee, "MemberExpression") ||
    ret.argument.callee.computed ||
    ret.argument.callee.optional ||
    !isNodeOfType(ret.argument.callee.property, "Identifier") ||
    ret.argument.callee.property.name !== "join"
  )
    return null;
  if (!statements(body.slice(0, -1), 0) || !same(ret.argument.callee.object, array) || !helper)
    return null;
  return {
    recordPaths: [...records].sort(),
    primitivePaths: [...primitives].sort(),
    stringKeyHelper: helper,
    requiresOwnDataDescriptors: true,
    requiresStockIterationAndStringIntrinsics: true,
  };
}
