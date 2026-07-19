import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { MAX_SHADOWED_POINT_LIGHT_COUNT } from "./constants.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

const resolvesToTrue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) return candidate.value === true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return resolvesToTrue(symbol.initializer, scopes, visitedSymbolIds);
};

const getReturnedJsxRoot = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): EsTreeNode | null => {
  const element = openingElement.parent;
  if (!element || !isNodeOfType(element, "JSXElement")) return null;
  const owningFunction = findEnclosingFunction(openingElement);
  if (!owningFunction) return null;
  let root: EsTreeNode = element;
  let current = element.parent ?? null;
  while (current && current !== owningFunction) {
    if (isNodeOfType(current, "JSXElement") || isNodeOfType(current, "JSXFragment")) root = current;
    current = current.parent ?? null;
  }
  return functionReturnsMatchingExpression(
    owningFunction,
    context.scopes,
    (returnedExpression) => isAstDescendant(root, returnedExpression),
    context.cfg,
  )
    ? root
    : null;
};

const hasDynamicBranchBeforeRoot = (node: EsTreeNode, root: EsTreeNode): boolean => {
  let current = node.parent ?? null;
  while (current && current !== root) {
    if (
      isNodeOfType(current, "ConditionalExpression") ||
      isNodeOfType(current, "LogicalExpression")
    ) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
};

const isStaticallyShadowedPointLight = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(node.name, "JSXIdentifier") ||
    node.name.name !== "pointLight" ||
    node.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
  ) {
    return false;
  }
  const castShadowAttribute = getAuthoritativeJsxAttribute(node.attributes, "castShadow");
  if (!castShadowAttribute) return false;
  if (!castShadowAttribute.value) return true;
  return (
    isNodeOfType(castShadowAttribute.value, "JSXExpressionContainer") &&
    !isNodeOfType(castShadowAttribute.value.expression, "JSXEmptyExpression") &&
    resolvesToTrue(castShadowAttribute.value.expression, context.scopes)
  );
};

export const r3fLimitShadowedPointLights = defineRule({
  id: "r3f-limit-shadowed-point-lights",
  title: "Too many shadow-casting point lights",
  category: "Performance",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Keep at most two shadow-casting point lights in one scene, or replace them with cheaper directional, spot, baked, or fake shadows",
  create: (context: RuleContext) => {
    const pointLightCountByRoot = new Map<EsTreeNode, number>();
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber || !isStaticallyShadowedPointLight(node, context)) return;
        const returnedRoot = getReturnedJsxRoot(node, context);
        if (!returnedRoot || hasDynamicBranchBeforeRoot(node, returnedRoot)) return;
        const nextCount = (pointLightCountByRoot.get(returnedRoot) ?? 0) + 1;
        pointLightCountByRoot.set(returnedRoot, nextCount);
        if (nextCount <= MAX_SHADOWED_POINT_LIGHT_COUNT) return;
        context.report({
          node,
          message:
            "This is the third or later shadow-casting point light in the same returned scene. Each point-light shadow renders six cube faces, multiplying shadow passes",
        });
      },
    };
  },
});
