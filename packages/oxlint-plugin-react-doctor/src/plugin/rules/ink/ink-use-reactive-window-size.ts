import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { componentRendersInk } from "../../utils/component-renders-ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isProcessStdoutMember } from "../../utils/is-process-stdout-member.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const WINDOW_DIMENSION_NAMES = new Set(["columns", "rows"]);
const RESIZE_LISTENER_METHOD_NAMES = new Set(["addListener", "on", "once"]);
const REACTIVE_HOOK_NAMES = new Set(["useReducer", "useState"]);

const resolveListenerFunction = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  if (!node) return null;
  const unwrappedNode = stripParenExpression(node);
  if (
    isNodeOfType(unwrappedNode, "ArrowFunctionExpression") ||
    isNodeOfType(unwrappedNode, "FunctionExpression")
  ) {
    return unwrappedNode;
  }
  if (!isNodeOfType(unwrappedNode, "Identifier")) return null;
  const symbol = scopes.symbolFor(unwrappedNode);
  if (!symbol || visitedSymbolIds.has(symbol.id) || !symbol.initializer) return null;
  visitedSymbolIds.add(symbol.id);
  return resolveListenerFunction(symbol.initializer, scopes, visitedSymbolIds);
};

const isReactStateUpdater = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "VariableDeclarator")) return false;
  const declarator = symbol.declarationNode;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
  const setterElement = declarator.id.elements[1];
  const setterIdentifier = isNodeOfType(setterElement, "AssignmentPattern")
    ? setterElement.left
    : setterElement;
  if (setterIdentifier !== symbol.bindingIdentifier) return false;
  return Boolean(
    isNodeOfType(declarator.init, "CallExpression") &&
    isReactApiCall(declarator.init, REACTIVE_HOOK_NAMES, scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    }),
  );
};

const listenerTriggersRender = (listenerNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let doesTriggerRender = false;
  walkAst(listenerNode, (descendantNode) => {
    if (descendantNode !== listenerNode && /Function/.test(descendantNode.type)) return false;
    if (
      isNodeOfType(descendantNode, "CallExpression") &&
      isReactStateUpdater(descendantNode.callee, scopes)
    ) {
      doesTriggerRender = true;
      return false;
    }
  });
  return doesTriggerRender;
};

const listenerBelongsToComponent = (
  listenerRegistration: EsTreeNode,
  componentNode: EsTreeNode,
): boolean => {
  let enclosingFunction = findEnclosingFunction(listenerRegistration);
  while (enclosingFunction && enclosingFunction !== componentNode) {
    if (componentOrHookDisplayNameForFunction(enclosingFunction)) return false;
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return enclosingFunction === componentNode;
};

const hasStdoutResizeListener = (componentNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let hasListener = false;
  walkAst(componentNode, (descendantNode) => {
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      !isNodeOfType(descendantNode.callee, "MemberExpression") ||
      !RESIZE_LISTENER_METHOD_NAMES.has(getStaticPropertyName(descendantNode.callee) ?? "") ||
      !isProcessStdoutMember(descendantNode.callee.object, scopes) ||
      !isNodeOfType(descendantNode.arguments[0], "Literal") ||
      descendantNode.arguments[0].value !== "resize" ||
      !listenerBelongsToComponent(descendantNode, componentNode)
    ) {
      return;
    }
    const listenerArgument = descendantNode.arguments[1];
    const listenerNode = resolveListenerFunction(listenerArgument, scopes);
    if (
      (!listenerArgument || !isReactStateUpdater(listenerArgument, scopes)) &&
      (!listenerNode || !listenerTriggersRender(listenerNode, scopes))
    ) {
      return;
    }
    hasListener = true;
    return false;
  });
  return hasListener;
};

export const inkUseReactiveWindowSize = defineRule({
  id: "ink-use-reactive-window-size",
  title: "Terminal dimensions read non-reactively",
  severity: "warn",
  minimumInkVersion: MINIMUM_INK_VERSIONS.modernHooks,
  recommendation: "Use Ink's `useWindowSize()` so resize events trigger a render.",
  create: (context) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const dimensionName = getStaticPropertyName(node);
      if (!dimensionName || !WINDOW_DIMENSION_NAMES.has(dimensionName)) return;
      const componentNode = findRenderPhaseComponentOrHook(node, context.scopes);
      if (
        !isNodeOfType(node.object, "MemberExpression") ||
        !isProcessStdoutMember(node.object, context.scopes) ||
        !componentNode ||
        !componentRendersInk(componentNode, context.scopes) ||
        hasStdoutResizeListener(componentNode, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message: `\`process.stdout.${dimensionName}\` does not make an Ink component react to resize.`,
      });
    },
  }),
});
