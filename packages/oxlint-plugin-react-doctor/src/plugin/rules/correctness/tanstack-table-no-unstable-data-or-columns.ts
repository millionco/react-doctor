import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const TANSTACK_TABLE_MODULE = "@tanstack/react-table";
const TABLE_HOOK_NAMES = new Set(["useReactTable", "useTable"]);
const CHECKED_OPTION_NAMES = new Set(["data", "columns"]);
// Array.prototype methods that always allocate a fresh array — calling one
// inline in the options object recreates the reference on every render.
const ARRAY_PRODUCING_METHOD_NAMES = new Set([
  "concat",
  "filter",
  "flat",
  "flatMap",
  "map",
  "slice",
  "toReversed",
  "toSorted",
  "toSpliced",
  "with",
]);

const STATIC_ARRAY_PRODUCERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Array", new Set(["from", "of"])],
  ["Object", new Set(["entries", "keys", "values"])],
]);

const isTanstackTableHookCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const reference = resolveImportedApiReference(callExpression.callee, context.scopes);
  return Boolean(
    reference?.source === TANSTACK_TABLE_MODULE &&
    reference.importedName &&
    TABLE_HOOK_NAMES.has(reference.importedName),
  );
};

const isKnownNonArrayObjectValue = (
  rawExpression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "ObjectExpression")) return true;
  if (isNodeOfType(expression, "ArrayExpression")) return false;
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = resolveConstIdentifierAlias(expression, context.scopes);
  if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isKnownNonArrayObjectValue(symbol.initializer, context, visitedSymbolIds);
};

const isStaticArrayProducerCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression") || !isNodeOfType(callee.object, "Identifier")) {
    return false;
  }
  const producerMethods = STATIC_ARRAY_PRODUCERS.get(callee.object.name);
  const methodName = getStaticPropertyName(callee);
  return Boolean(
    producerMethods &&
    methodName &&
    producerMethods.has(methodName) &&
    context.scopes.isGlobalReference(callee.object),
  );
};

const isArrayProducingCall = (expression: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(expression, "CallExpression")) return false;
  if (isStaticArrayProducerCall(expression, context)) return true;
  const callee = stripParenExpression(expression.callee);
  return (
    isNodeOfType(callee, "MemberExpression") &&
    ARRAY_PRODUCING_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
    !isKnownNonArrayObjectValue(callee.object, context)
  );
};

// The expression (or branch) that provably produces a fresh array identity
// on every render, or null when the reference may be stable. Identifiers
// only count when they resolve to a const created inside the same component
// body — module-scope arrays and memoized/state values keep their identity.
const findFreshArrayNode = (
  rawExpression: EsTreeNode,
  enclosingComponent: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds = new Set<number>(),
): EsTreeNode | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "ArrayExpression")) return expression;
  if (isArrayProducingCall(expression, context)) return expression;
  if (isNodeOfType(expression, "LogicalExpression")) {
    // `data ?? []` allocates the fallback on every render the left side is
    // nullish; either branch being fresh makes the option unstable.
    return (
      findFreshArrayNode(expression.left, enclosingComponent, context, visitedSymbolIds) ??
      findFreshArrayNode(expression.right, enclosingComponent, context, visitedSymbolIds)
    );
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      findFreshArrayNode(expression.consequent, enclosingComponent, context, visitedSymbolIds) ??
      findFreshArrayNode(expression.alternate, enclosingComponent, context, visitedSymbolIds)
    );
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(expression, context.scopes);
  if (!symbol || symbol.kind !== "const" || !symbol.initializer) return null;
  if (findEnclosingFunction(symbol.declarationNode) !== enclosingComponent) return null;
  if (visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  return findFreshArrayNode(symbol.initializer, enclosingComponent, context, visitedSymbolIds)
    ? expression
    : null;
};

const getRenderScopedOptionsObject = (
  rawExpression: EsTreeNode,
  enclosingComponent: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "ObjectExpression")) return expression;
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(expression, context.scopes);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    findEnclosingFunction(symbol.declarationNode) !== enclosingComponent
  ) {
    return null;
  }
  const initializer = stripParenExpression(symbol.initializer);
  return isNodeOfType(initializer, "ObjectExpression") ? initializer : null;
};

export const tanstackTableNoUnstableDataOrColumns = defineRule({
  id: "tanstack-table-no-unstable-data-or-columns",
  title: "Table data or columns recreated every render",
  severity: "warn",
  category: "Correctness",
  requires: ["tanstack-table"],
  recommendation:
    "Give the table's data and columns options stable references: useMemo or useState inside the component, or a module-scope constant, so row and column models are not rebuilt on every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isTanstackTableHookCall(node, context)) return;
      const enclosingComponent = findEnclosingFunction(node);
      if (!enclosingComponent) return;
      const optionsArgument = node.arguments[0];
      if (!optionsArgument) return;
      const optionsObject = getRenderScopedOptionsObject(
        optionsArgument,
        enclosingComponent,
        context,
      );
      if (!optionsObject) return;
      for (const property of optionsObject.properties) {
        if (!isNodeOfType(property, "Property")) continue;
        const optionName = getStaticPropertyKeyName(property);
        if (optionName === null || !CHECKED_OPTION_NAMES.has(optionName)) continue;
        const freshArrayNode = findFreshArrayNode(property.value, enclosingComponent, context);
        if (!freshArrayNode) continue;
        context.report({
          node: freshArrayNode,
          message: `This \`${optionName}\` option gets a new array identity on every render, so the table rebuilds its ${optionName === "columns" ? "column and header structures" : "row models"} each render and auto-reset features can re-render in a loop. Memoize it with useMemo/useState or hoist it to module scope.`,
        });
      }
    },
  }),
});
