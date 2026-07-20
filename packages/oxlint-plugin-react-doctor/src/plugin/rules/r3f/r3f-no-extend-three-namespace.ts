import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getModuleNamespaceSource } from "./utils/get-module-namespace-source.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";

const TREE_SHAKING_UNSAFE_NAMESPACE_MODULES = new Set(["three"]);
const EMPTY_VISITORS: RuleVisitors = {};

const containsThreeNamespaceSpread = (
  expression: EsTreeNode,
  context: RuleContext,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = context.scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return containsThreeNamespaceSpread(symbol.initializer, context, visitedSymbolIds);
  }
  if (!isNodeOfType(candidate, "ObjectExpression")) return false;
  return candidate.properties.some(
    (property) =>
      isNodeOfType(property, "SpreadElement") &&
      TREE_SHAKING_UNSAFE_NAMESPACE_MODULES.has(
        getModuleNamespaceSource(property.argument, context.scopes) ?? "",
      ),
  );
};

export const r3fNoExtendThreeNamespace = defineRule({
  id: "r3f-no-extend-three-namespace",
  title: "Whole Three.js namespace registered with R3F",
  category: "Performance",
  severity: "warn",
  recommendation:
    "Pass extend an object containing only the Three.js constructors used by JSX so bundlers can tree-shake the rest of the namespace",
  create: (context: RuleContext) => {
    if (isTestlikeFilename(context.filename)) return EMPTY_VISITORS;
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isR3fApiCall(node, "extend", context.scopes)) return;
        const catalogueArgument = node.arguments[0];
        if (!catalogueArgument || isNodeOfType(catalogueArgument, "SpreadElement")) return;
        const unwrappedArgument = stripParenExpression(catalogueArgument);
        const argumentSymbol = isNodeOfType(unwrappedArgument, "Identifier")
          ? context.scopes.symbolFor(unwrappedArgument)
          : null;
        if (
          (argumentSymbol && hasSymbolWriteBefore(argumentSymbol, node, context.scopes)) ||
          (!TREE_SHAKING_UNSAFE_NAMESPACE_MODULES.has(
            getModuleNamespaceSource(catalogueArgument, context.scopes) ?? "",
          ) &&
            !containsThreeNamespaceSpread(catalogueArgument, context))
        ) {
          return;
        }
        context.report({
          node: catalogueArgument,
          message:
            "Registering the whole Three.js namespace keeps every export in R3F's catalogue and undermines tree-shaking. Pass only the constructors used by JSX",
        });
      },
    };
  },
});
