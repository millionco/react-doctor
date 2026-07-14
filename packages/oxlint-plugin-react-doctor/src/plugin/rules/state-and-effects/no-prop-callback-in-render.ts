import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isResultDiscardedCall } from "../../utils/is-result-discarded-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getDownstreamRefs } from "./utils/effect/ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { isPropCallbackInvocationRef } from "./utils/effect/react.js";

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
      if (!findRenderPhaseComponentOrHook(node, context.scopes)) return;
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
