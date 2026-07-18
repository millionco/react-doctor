import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getMotionReactApiPath } from "../../utils/get-motion-react-api-path.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const ANIMATION_CONTROL_HOOKS: ReadonlySet<string> = new Set([
  "useAnimation",
  "useAnimationControls",
]);

const MOTION_VALUE_HOOKS: ReadonlySet<string> = new Set([
  "useMotionValue",
  "useSpring",
  "useTime",
  "useTransform",
  "useVelocity",
]);

const isHookResultExpression = (
  rawNode: EsTreeNode,
  hookNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const node = stripParenExpression(rawNode);
  if (isNodeOfType(node, "CallExpression")) {
    const apiPath = getMotionReactApiPath(node.callee, scopes);
    return Boolean(apiPath && hookNames.has(apiPath));
  }
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (symbol?.kind !== "const" || !symbol.initializer || visitedSymbolIds.has(symbol.id)) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return isHookResultExpression(symbol.initializer, hookNames, scopes, visitedSymbolIds);
};

const isUseAnimateFunction = (
  rawNode: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean => {
  const node = stripParenExpression(rawNode);
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (symbol?.kind !== "const" || visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  if (symbol.initializer && symbol.initializer !== node) {
    const initializer = stripParenExpression(symbol.initializer);
    if (isNodeOfType(initializer, "Identifier")) {
      return isUseAnimateFunction(initializer, scopes, visitedSymbolIds);
    }
  }
  const declaration = symbol.declarationNode;
  if (!isNodeOfType(declaration, "VariableDeclarator")) return false;
  if (!isNodeOfType(declaration.id, "ArrayPattern")) return false;
  if (declaration.id.elements[1] !== symbol.bindingIdentifier) return false;
  const initializer = declaration.init && stripParenExpression(declaration.init);
  return Boolean(
    initializer &&
    isNodeOfType(initializer, "CallExpression") &&
    getMotionReactApiPath(initializer.callee, scopes) === "useAnimate",
  );
};

const getImperativeAnimationKind = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): "animate" | "controls" | "motion-value" | null => {
  if (getMotionReactApiPath(node.callee, scopes) === "animate") return "animate";
  if (isUseAnimateFunction(node.callee, scopes, new Set<number>())) return "animate";
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(node.callee);
  if (
    methodName === "start" &&
    isHookResultExpression(node.callee.object, ANIMATION_CONTROL_HOOKS, scopes, new Set<number>())
  ) {
    return "controls";
  }
  if (
    (methodName === "set" || methodName === "jump") &&
    isHookResultExpression(node.callee.object, MOTION_VALUE_HOOKS, scopes, new Set<number>())
  ) {
    return "motion-value";
  }
  return null;
};

export const motionImperativeAnimationInRender = defineRule({
  id: "motion-imperative-animation-in-render",
  title: "Imperative Motion animation runs during render",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Start imperative animations from an effect or user interaction, and derive render output declaratively from props and state.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const animationKind = getImperativeAnimationKind(node, context.scopes);
      if (!animationKind || !findRenderPhaseComponentOrHook(node, context.scopes)) return;
      let operation = "This imperative animation";
      if (animationKind === "controls") operation = "Animation controls start";
      if (animationKind === "motion-value") operation = "This Motion value write";
      context.report({
        node,
        message: `${operation} during render, so React retries and re-renders can replay the side effect. Move it to an effect or event handler.`,
      });
    },
  }),
});
