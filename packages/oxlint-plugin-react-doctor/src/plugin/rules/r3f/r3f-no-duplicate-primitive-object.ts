import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const findAncestor = (node: EsTreeNode, type: string): EsTreeNode | null => {
  let current = node.parent;
  while (current) {
    if (current.type === type) return current;
    current = current.parent;
  }
  return null;
};

const findLogicalGuard = (node: EsTreeNode): EsTreeNode | null => {
  let current = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "LogicalExpression") &&
      current.operator === "&&" &&
      isAstDescendant(node, current.right)
    ) {
      return current.left;
    }
    current = current.parent;
  }
  return null;
};

const areComplementaryGuards = (
  first: EsTreeNode,
  second: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedFirst = stripParenExpression(first);
  const unwrappedSecond = stripParenExpression(second);
  const firstNegated =
    isNodeOfType(unwrappedFirst, "UnaryExpression") && unwrappedFirst.operator === "!"
      ? stripParenExpression(unwrappedFirst.argument)
      : null;
  const secondNegated =
    isNodeOfType(unwrappedSecond, "UnaryExpression") && unwrappedSecond.operator === "!"
      ? stripParenExpression(unwrappedSecond.argument)
      : null;
  const positiveIdentifier = firstNegated ? unwrappedSecond : unwrappedFirst;
  const negatedIdentifier = firstNegated ?? secondNegated;
  if (
    !negatedIdentifier ||
    Boolean(firstNegated) === Boolean(secondNegated) ||
    !isNodeOfType(positiveIdentifier, "Identifier") ||
    !isNodeOfType(negatedIdentifier, "Identifier")
  ) {
    return false;
  }
  const positiveSymbol = scopes.symbolFor(positiveIdentifier);
  const negatedSymbol = scopes.symbolFor(negatedIdentifier);
  return Boolean(positiveSymbol && negatedSymbol && positiveSymbol.id === negatedSymbol.id);
};

const canMountTogether = (
  first: EsTreeNode,
  second: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const firstReturn = findAncestor(first, "ReturnStatement");
  const secondReturn = findAncestor(second, "ReturnStatement");
  if (firstReturn && secondReturn && firstReturn !== secondReturn) return false;
  const firstGuard = findLogicalGuard(first);
  const secondGuard = findLogicalGuard(second);
  if (firstGuard && secondGuard && areComplementaryGuards(firstGuard, secondGuard, scopes)) {
    return false;
  }
  let current = first.parent;
  while (current) {
    if (
      isNodeOfType(current, "ConditionalExpression") &&
      ((isAstDescendant(first, current.consequent) && isAstDescendant(second, current.alternate)) ||
        (isAstDescendant(first, current.alternate) && isAstDescendant(second, current.consequent)))
    ) {
      return false;
    }
    if (
      isNodeOfType(current, "IfStatement") &&
      current.alternate &&
      ((isAstDescendant(first, current.consequent) && isAstDescendant(second, current.alternate)) ||
        (isAstDescendant(first, current.alternate) && isAstDescendant(second, current.consequent)))
    ) {
      return false;
    }
    current = current.parent;
  }
  return true;
};

export const r3fNoDuplicatePrimitiveObject = defineRule({
  id: "r3f-no-duplicate-primitive-object",
  title: "Primitive object mounted twice",
  tags: ["react-jsx-only"],
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Mount a Three.js object through one <primitive>, or clone it deliberately when two independent instances are required",
  create: (context: RuleContext) => {
    const seenByFunction = new WeakMap<EsTreeNode, Map<number, EsTreeNode[]>>();
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "primitive") return;
        const objectAttribute = findJsxAttribute(node.attributes, "object");
        if (
          !objectAttribute?.value ||
          !isNodeOfType(objectAttribute.value, "JSXExpressionContainer") ||
          isNodeOfType(objectAttribute.value.expression, "JSXEmptyExpression")
        ) {
          return;
        }
        const objectExpression = stripParenExpression(objectAttribute.value.expression);
        if (!isNodeOfType(objectExpression, "Identifier")) return;
        const objectSymbol = context.scopes.symbolFor(objectExpression);
        const owningFunction = findEnclosingFunction(node);
        if (!objectSymbol || !owningFunction) return;
        const seenSymbols = seenByFunction.get(owningFunction) ?? new Map<number, EsTreeNode[]>();
        seenByFunction.set(owningFunction, seenSymbols);
        const previousMounts = seenSymbols.get(objectSymbol.id) ?? [];
        seenSymbols.set(objectSymbol.id, [...previousMounts, node]);
        if (
          !previousMounts.some((previousMount) =>
            canMountTogether(previousMount, node, context.scopes),
          )
        ) {
          return;
        }
        context.report({
          node: objectExpression,
          message:
            "The same Three.js object is mounted by more than one <primitive> in this render tree. Use one owner or clone it into independent instances",
        });
      },
    };
  },
});
