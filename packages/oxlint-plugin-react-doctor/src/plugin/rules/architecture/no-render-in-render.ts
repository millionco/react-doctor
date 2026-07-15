import { RENDER_FUNCTION_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isComponentFunction } from "../../utils/is-component-function.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

// A `render*` call inside JSX is only a problem when the helper carries
// REACT-COMPONENT semantics — i.e. its execution reaches hooks. Such a helper
// is a component in disguise: invoking it inline splices its hooks into
// the caller's hook order, so a conditional call (or a changed call
// count) corrupts hook state. A hook-free render helper is just a
// function that returns JSX — calling it inline is byte-for-byte
// equivalent to writing the JSX in place (no identity, state, or
// memoization exists to lose), so it is NOT flagged. Hook-free class
// method calls (`this.renderHeader()`) are exempt for the same reason —
// but a class component's render() IS render context: a bare
// hook-calling helper invoked there still inlines hooks into a class
// render, which is always broken.
const isInsideComponentContext = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor) && isComponentFunction(cursor)) return true;
    if (isEs5Component(cursor) || isEs6Component(cursor)) return true;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const getFunctionFromDeclaration = (node: EsTreeNode): EsTreeNode | null => {
  if (isFunctionLike(node)) return node;
  if (isNodeOfType(node, "VariableDeclarator") && node.init && isFunctionLike(node.init)) {
    return node.init;
  }
  return null;
};

// React hooks are only ever called bare (`useState()`) or through a
// PascalCase namespace (`React.useState()`) — the same shape
// eslint-plugin-react-hooks accepts. Member calls on lowercase
// instances (`i18n.use(...)`, `app.use(plugin)`) are library idioms,
// not hooks.
const isHookCallee = (callee: EsTreeNode): boolean => {
  if (isNodeOfType(callee, "Identifier")) return isReactHookName(callee.name);
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier") &&
    isUppercaseName(callee.object.name) &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return isReactHookName(callee.property.name);
  }
  return false;
};

const containsReachableHookCall = (
  functionNode: EsTreeNode,
  rootFunction: EsTreeNode,
  context: RuleContext,
  visitedFunctions: Set<EsTreeNode>,
): boolean => {
  if (!isFunctionLike(functionNode) || visitedFunctions.has(functionNode)) return false;
  visitedFunctions.add(functionNode);
  let didFindReachableHook = false;
  walkAst(functionNode.body, (child: EsTreeNode) => {
    if (didFindReachableHook) return false;
    if (isFunctionLike(child) && !executesDuringRender(child, context.scopes)) return false;
    if (!isNodeOfType(child, "CallExpression") && !isNodeOfType(child, "NewExpression")) return;
    if (isNodeOfType(child, "CallExpression")) {
      if (isHookCallee(child.callee as EsTreeNode)) {
        didFindReachableHook = true;
        return false;
      }
      const calledFunction = resolveExactLocalFunction(child.callee, context.scopes);
      if (
        calledFunction &&
        isAstDescendant(calledFunction, rootFunction) &&
        containsReachableHookCall(calledFunction, rootFunction, context, visitedFunctions)
      ) {
        didFindReachableHook = true;
        return false;
      }
    }
    for (const callArgument of child.arguments ?? []) {
      if (!executesDuringRender(callArgument, context.scopes)) continue;
      const callbackFunction = resolveExactLocalFunction(callArgument, context.scopes);
      if (
        callbackFunction &&
        isAstDescendant(callbackFunction, rootFunction) &&
        containsReachableHookCall(callbackFunction, rootFunction, context, visitedFunctions)
      ) {
        didFindReachableHook = true;
        return false;
      }
    }
  });
  return didFindReachableHook;
};

// Fires only when the callee resolves to a LOCAL function whose synchronous
// execution reaches hooks. Everything unresolvable — render props, parameters,
// aliases, member calls — is a plain callable with no hook state to
// corrupt, so it stays silent.
const isHookCallingRenderHelper = (
  symbol: SymbolDescriptor | null,
  context: RuleContext,
): boolean => {
  if (!symbol) return false;
  const declaration = symbol.declarationNode;
  if (
    !isNodeOfType(declaration, "FunctionDeclaration") &&
    !isNodeOfType(declaration, "VariableDeclarator")
  ) {
    return false;
  }
  const functionNode = getFunctionFromDeclaration(declaration);
  if (!functionNode) return false;
  return containsReachableHookCall(functionNode, functionNode, context, new Set());
};

export const noRenderInRender = defineRule({
  id: "no-render-in-render",
  title: "Component rendered by inline function call",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Make it a named component rendered as JSX so React can track it and preserve its state.",
  create: (context: RuleContext) => ({
    JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
      // `renderRow?.()` parses as ChainExpression(CallExpression) — the
      // optional call splices hooks into the caller just the same.
      const expression = isNodeOfType(node.expression, "ChainExpression")
        ? node.expression.expression
        : node.expression;
      if (!isNodeOfType(expression, "CallExpression")) return;
      if (!isNodeOfType(expression.callee, "Identifier")) return;
      const calleeName = expression.callee.name;
      if (!RENDER_FUNCTION_PATTERN.test(calleeName)) return;
      if (!isInsideComponentContext(node)) return;
      if (!isHookCallingRenderHelper(context.scopes.symbolFor(expression.callee), context)) return;

      context.report({
        node: expression,
        message: `"${calleeName}()" hides a component behind an inline call, so pull it into its own component and render it as JSX so React can track it.`,
      });
    },
  }),
});
