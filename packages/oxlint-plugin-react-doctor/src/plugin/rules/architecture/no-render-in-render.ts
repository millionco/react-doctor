import { RENDER_FUNCTION_PATTERN } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isComponentFunction } from "../../utils/is-component-function.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";

// A `render*` call inside JSX is only a problem when the helper carries
// REACT-COMPONENT semantics — i.e. its body calls hooks. Such a helper
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

const functionBodyOf = (node: EsTreeNode): EsTreeNode | null => {
  if (isFunctionLike(node)) return node.body ?? null;
  if (isNodeOfType(node, "VariableDeclarator") && node.init && isFunctionLike(node.init)) {
    return node.init.body ?? null;
  }
  return null;
};

const containsHookCall = (body: EsTreeNode): boolean => {
  let found = false;
  walkAst(body, (child: EsTreeNode) => {
    if (found) return false;
    // A component DEFINED inside the helper owns its hooks — they run under
    // that child's fiber when it renders, not when the helper is invoked
    // inline — so its subtree must not make the helper itself hook-calling.
    // Non-component nested functions stay in the walk: a closure that calls
    // hooks and runs during the helper call still splices into the caller.
    if (child !== body && isFunctionLike(child) && isComponentFunction(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const name = getCalleeName(child);
    if (name && isReactHookName(name)) found = true;
  });
  return found;
};

// Fires only when the callee resolves to a LOCAL function whose body
// calls hooks. Everything unresolvable — render props, parameters,
// aliases, member calls — is a plain callable with no hook state to
// corrupt, so it stays silent.
const isHookCallingRenderHelper = (symbol: SymbolDescriptor | null): boolean => {
  if (!symbol) return false;
  const declaration = symbol.declarationNode;
  if (
    !isNodeOfType(declaration, "FunctionDeclaration") &&
    !isNodeOfType(declaration, "VariableDeclarator")
  ) {
    return false;
  }
  const body = functionBodyOf(declaration);
  if (!body) return false;
  return containsHookCall(body);
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
      const expression = node.expression;
      if (!isNodeOfType(expression, "CallExpression")) return;
      if (!isNodeOfType(expression.callee, "Identifier")) return;
      const calleeName = expression.callee.name;
      if (!RENDER_FUNCTION_PATTERN.test(calleeName)) return;
      if (!isInsideComponentContext(node)) return;
      if (!isHookCallingRenderHelper(context.scopes.symbolFor(expression.callee))) return;

      context.report({
        node: expression,
        message: `"${calleeName}()" hides a component behind an inline call, so pull it into its own component and render it as JSX so React can track it.`,
      });
    },
  }),
});
