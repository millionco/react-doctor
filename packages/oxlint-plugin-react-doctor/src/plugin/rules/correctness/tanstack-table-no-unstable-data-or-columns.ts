import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
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

const isArrayProducingCall = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "CallExpression") &&
  isNodeOfType(expression.callee, "MemberExpression") &&
  !expression.callee.computed &&
  isNodeOfType(expression.callee.property, "Identifier") &&
  ARRAY_PRODUCING_METHOD_NAMES.has(expression.callee.property.name);

// The expression (or branch) that provably produces a fresh array identity
// on every render, or null when the reference may be stable. Identifiers
// only count when they resolve to a const created inside the same component
// body — module-scope arrays and memoized/state values keep their identity.
const findFreshArrayNode = (
  rawExpression: EsTreeNode,
  enclosingComponent: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "ArrayExpression")) return expression;
  if (isArrayProducingCall(expression)) return expression;
  if (isNodeOfType(expression, "LogicalExpression")) {
    // `data ?? []` allocates the fallback on every render the left side is
    // nullish; either branch being fresh makes the option unstable.
    return (
      findFreshArrayNode(expression.left, enclosingComponent, context) ??
      findFreshArrayNode(expression.right, enclosingComponent, context)
    );
  }
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      findFreshArrayNode(expression.consequent, enclosingComponent, context) ??
      findFreshArrayNode(expression.alternate, enclosingComponent, context)
    );
  }
  if (!isNodeOfType(expression, "Identifier")) return null;
  const symbol = resolveConstIdentifierAlias(expression, context.scopes);
  if (!symbol || symbol.kind !== "const" || !symbol.initializer) return null;
  if (findEnclosingFunction(symbol.declarationNode) !== enclosingComponent) return null;
  const initializer = stripParenExpression(symbol.initializer);
  return isNodeOfType(initializer, "ArrayExpression") || isArrayProducingCall(initializer)
    ? expression
    : null;
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
      const callee = node.callee;
      if (!isNodeOfType(callee, "Identifier")) return;
      const importedName = getImportedNameFromModule(node, callee.name, TANSTACK_TABLE_MODULE);
      if (importedName === null || !TABLE_HOOK_NAMES.has(importedName)) return;
      const optionsArgument = node.arguments[0];
      if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return;
      const enclosingComponent = findEnclosingFunction(node);
      if (!enclosingComponent) return;
      for (const property of optionsArgument.properties) {
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
