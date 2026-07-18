import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionReturnsMatchingExpression } from "../../utils/function-returns-matching-expression.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";

interface MountGuard {
  identifier: EsTreeNodeOfType<"Identifier">;
  isNegated: boolean;
}

const findAncestor = (node: EsTreeNode, type: string): EsTreeNode | null => {
  let current = node.parent;
  while (current) {
    if (current.type === type) return current;
    current = current.parent;
  }
  return null;
};

const readMountGuard = (expression: EsTreeNode, isNegated = false): MountGuard | null => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Identifier")) return { identifier: candidate, isNegated };
  if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "!") {
    return readMountGuard(candidate.argument, !isNegated);
  }
  return null;
};

const findMountGuards = (node: EsTreeNode): MountGuard[] => {
  const guards: MountGuard[] = [];
  let current = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "LogicalExpression") &&
      (current.operator === "&&" || current.operator === "||") &&
      isAstDescendant(node, current.right)
    ) {
      const guard = readMountGuard(current.left, current.operator === "||");
      if (guard) guards.push(guard);
    }
    if (isNodeOfType(current, "ConditionalExpression")) {
      const isConsequent = isAstDescendant(node, current.consequent);
      const isAlternate = isAstDescendant(node, current.alternate);
      if (isConsequent || isAlternate) {
        const guard = readMountGuard(current.test, isAlternate);
        if (guard) guards.push(guard);
      }
    }
    if (isNodeOfType(current, "IfStatement")) {
      const isConsequent = isAstDescendant(node, current.consequent);
      const isAlternate = Boolean(current.alternate && isAstDescendant(node, current.alternate));
      if (isConsequent || isAlternate) {
        const guard = readMountGuard(current.test, isAlternate);
        if (guard) guards.push(guard);
      }
    }
    current = current.parent;
  }
  return guards;
};

const findMountingRenderOwner = (node: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  const nearestFunction = findEnclosingFunction(node);
  if (!nearestFunction) return null;
  const renderOwner = findRenderPhaseComponentOrHook(node, scopes);
  if (!renderOwner || nearestFunction === renderOwner) return nearestFunction;
  let currentFunction = nearestFunction;
  while (currentFunction !== renderOwner) {
    const nextFunction = findEnclosingFunction(currentFunction);
    const functionRoot = findTransparentExpressionRoot(currentFunction);
    const call = functionRoot.parent;
    if (!nextFunction || !call || !isNodeOfType(call, "CallExpression")) return nearestFunction;
    let current = call.parent;
    while (current && current !== nextFunction) {
      if (isNodeOfType(current, "JSXExpressionContainer")) return renderOwner;
      current = current.parent;
    }
    if (
      !functionReturnsMatchingExpression(nextFunction, scopes, (expression) => expression === call)
    ) {
      return nearestFunction;
    }
    currentFunction = nextFunction;
  }
  return renderOwner;
};

const areComplementaryMountGuards = (
  first: MountGuard,
  second: MountGuard,
  scopes: ScopeAnalysis,
): boolean => {
  if (first.isNegated === second.isNegated) return false;
  const firstSymbol = scopes.symbolFor(first.identifier);
  const secondSymbol = scopes.symbolFor(second.identifier);
  return Boolean(firstSymbol && secondSymbol && firstSymbol.id === secondSymbol.id);
};

const canMountTogether = (
  first: EsTreeNode,
  second: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const firstReturn = findAncestor(first, "ReturnStatement");
  const secondReturn = findAncestor(second, "ReturnStatement");
  const firstReturnFunction = firstReturn ? findEnclosingFunction(firstReturn) : null;
  const secondReturnFunction = secondReturn ? findEnclosingFunction(secondReturn) : null;
  if (
    firstReturn &&
    secondReturn &&
    firstReturn !== secondReturn &&
    firstReturnFunction &&
    firstReturnFunction === secondReturnFunction
  ) {
    return false;
  }
  const firstGuards = findMountGuards(first);
  const secondGuards = findMountGuards(second);
  if (
    firstGuards.some((firstGuard) =>
      secondGuards.some((secondGuard) =>
        areComplementaryMountGuards(firstGuard, secondGuard, scopes),
      ),
    )
  ) {
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

const findMountSites = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  owningFunction: EsTreeNode,
  context: RuleContext,
): EsTreeNode[] => {
  const element = node.parent;
  if (!element || !isNodeOfType(element, "JSXElement")) return [node];
  const elementRoot = findTransparentExpressionRoot(element);
  const declarator = elementRoot.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== elementRoot ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return [node];
  }
  const elementSymbol = context.scopes.symbolFor(declarator.id);
  if (!elementSymbol) return [node];
  const renderedReferences = elementSymbol.references
    .filter(
      (reference) =>
        reference.flag !== "write" &&
        functionReturnsMatchingExpression(
          owningFunction,
          context.scopes,
          (returnedExpression) => isAstDescendant(reference.identifier, returnedExpression),
          context.cfg,
        ),
    )
    .map((reference) => reference.identifier);
  return renderedReferences.length > 0 ? renderedReferences : [node];
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
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          !importsReactThreeFiber ||
          !isNodeOfType(node.name, "JSXIdentifier") ||
          node.name.name !== "primitive"
        ) {
          return;
        }
        const objectAttribute = getAuthoritativeJsxAttribute(node.attributes, "object");
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
        const owningFunction = findMountingRenderOwner(node, context.scopes);
        if (!objectSymbol || !owningFunction) return;
        const mountSites = findMountSites(node, owningFunction, context);
        const seenSymbols = seenByFunction.get(owningFunction) ?? new Map<number, EsTreeNode[]>();
        seenByFunction.set(owningFunction, seenSymbols);
        const previousMounts = seenSymbols.get(objectSymbol.id) ?? [];
        seenSymbols.set(objectSymbol.id, [...previousMounts, ...mountSites]);
        if (
          !previousMounts.some((previousMount) =>
            mountSites.some((mountSite) =>
              canMountTogether(previousMount, mountSite, context.scopes),
            ),
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
