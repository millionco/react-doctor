import { COMPONENT_HOC_WRAPPER_NAMES, REACT_HOC_NAMES } from "../../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionHasReactComponentEvidence } from "../../utils/function-has-react-component-evidence.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getDownstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { isPropCallbackInvocationRef } from "./utils/effect/react.js";

const functionBindingSymbols = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  let bindingIdentifier: EsTreeNode | null = null;
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    bindingIdentifier = functionNode.id;
  } else {
    let bindingExpression = findTransparentExpressionRoot(functionNode);
    let parent = bindingExpression.parent;
    while (isNodeOfType(parent, "CallExpression") && parent.arguments[0] === bindingExpression) {
      const callee = parent.callee;
      const wrapperName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")
          ? callee.property.name
          : null;
      const isReactWrapper = isReactApiCall(parent, REACT_HOC_NAMES, scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
      });
      if (
        !isReactWrapper &&
        (!wrapperName ||
          REACT_HOC_NAMES.has(wrapperName) ||
          !COMPONENT_HOC_WRAPPER_NAMES.has(wrapperName))
      ) {
        break;
      }
      bindingExpression = findTransparentExpressionRoot(parent);
      parent = bindingExpression.parent;
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === bindingExpression &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      bindingIdentifier = parent.id;
    }
  }
  if (!bindingIdentifier) return [];
  let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(functionNode);
  while (scope) {
    const symbols = scope.symbols.filter(
      (symbol) => symbol.bindingIdentifier === bindingIdentifier,
    );
    if (symbols.length > 0) return symbols;
    scope = scope.parent;
  }
  return [];
};

const symbolHasReactComponentUse = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds = new Set<number>(),
): boolean => {
  if (visitedSymbolIds.has(symbol.id)) return false;
  visitedSymbolIds.add(symbol.id);
  for (const reference of symbol.references) {
    const identifier = reference.identifier;
    if (hasSymbolWriteBefore(symbol, identifier, scopes)) continue;
    const parent = identifier.parent;
    if (
      isNodeOfType(parent, "JSXOpeningElement") &&
      isNodeOfType(parent.name, "JSXIdentifier") &&
      parent.name === identifier
    ) {
      return true;
    }
    const expression = findTransparentExpressionRoot(identifier);
    const expressionParent = expression.parent;
    if (
      isNodeOfType(expressionParent, "CallExpression") &&
      expressionParent.arguments[0] === expression &&
      isReactApiCall(expressionParent, "createElement", scopes, { resolveNamedAliases: true })
    ) {
      return true;
    }
    if (
      !isNodeOfType(expressionParent, "VariableDeclarator") ||
      expressionParent.init !== expression ||
      !isNodeOfType(expressionParent.id, "Identifier") ||
      !isNodeOfType(expressionParent.parent, "VariableDeclaration") ||
      expressionParent.parent.kind !== "const"
    ) {
      continue;
    }
    const aliasSymbol = scopes.symbolFor(expressionParent.id);
    if (aliasSymbol && symbolHasReactComponentUse(aliasSymbol, scopes, visitedSymbolIds)) {
      return true;
    }
  }
  return false;
};

const functionHasReactComponentUse = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  return functionBindingSymbols(functionNode, scopes).some((symbol) =>
    symbolHasReactComponentUse(symbol, scopes),
  );
};

const isPreservedThroughConciseArrow = (
  callExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let node = callExpression;
  let parent = node.parent;
  while (parent) {
    if (isNodeOfType(parent, "ChainExpression")) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression") && parent.right === node) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === node || parent.alternate === node)
    ) {
      node = parent;
      parent = node.parent;
      continue;
    }
    if (isNodeOfType(parent, "SequenceExpression")) {
      const expressions = parent.expressions ?? [];
      if (expressions[expressions.length - 1] !== node) return false;
      node = parent;
      parent = node.parent;
      continue;
    }
    if (!isNodeOfType(parent, "ArrowFunctionExpression") || parent.body !== node) {
      return !isResultDiscardedCall(node);
    }
    const invocation = parent.parent;
    if (!isNodeOfType(invocation, "CallExpression") || !executesDuringRender(parent, scopes)) {
      return true;
    }
    if (invocation.arguments?.[0] === parent || invocation.arguments?.[1] === parent) {
      const callee = stripParenExpression(invocation.callee);
      return !(
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "forEach" &&
        invocation.arguments[0] === parent
      );
    }
    node = invocation;
    parent = node.parent;
  }
  return false;
};

export const noPropCallbackInRender = defineRule({
  id: "no-prop-callback-in-render",
  title: "Prop callback invoked during render",
  severity: "error",
  recommendation:
    "Invoke the callback from the event or asynchronous operation that produced the value, or from an effect when synchronizing with an external system. Render must stay pure because React can replay or discard it.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isResultDiscardedCall(node)) return;
      if (isPreservedThroughConciseArrow(node, context.scopes)) return;
      const renderPhaseOwner = findRenderPhaseComponentOrHook(node, context.scopes);
      if (!renderPhaseOwner) return;
      const renderPhaseOwnerName = componentOrHookDisplayNameForFunction(renderPhaseOwner);
      if (
        !renderPhaseOwnerName ||
        (!isReactHookName(renderPhaseOwnerName) &&
          !functionHasReactComponentEvidence(renderPhaseOwner, context.scopes, context.cfg) &&
          !functionHasReactComponentUse(renderPhaseOwner, context.scopes))
      ) {
        return;
      }
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      const callee = stripParenExpression(node.callee);
      if (isFunctionLike(callee)) return;
      if (
        !getDownstreamRefs(analysis, callee).some((reference) =>
          isPropCallbackInvocationRef(analysis, reference, {
            nativeMethodScopes: context.scopes,
          }),
        )
      ) {
        return;
      }
      context.report({
        node,
        message:
          "This prop callback runs during render. React can replay or discard render work, so the callback can fire more than once or for UI that never commits.",
      });
    },
  }),
});
