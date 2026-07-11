import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";

const resolveReactRefSymbol = (
  memberExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (
    !isNodeOfType(memberExpression, "MemberExpression") ||
    memberExpression.computed ||
    !isNodeOfType(memberExpression.property, "Identifier") ||
    memberExpression.property.name !== "current" ||
    !isNodeOfType(memberExpression.object, "Identifier")
  ) {
    return null;
  }
  const symbol = resolveConstIdentifierAlias(memberExpression.object, scopes);
  if (!symbol?.initializer || !isNodeOfType(symbol.initializer, "CallExpression")) return null;
  return isReactApiCall(symbol.initializer, "useRef", scopes, {
    allowGlobalReactNamespace: true,
  })
    ? symbol
    : null;
};

const isSameRefCurrentMember = (
  node: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "current" &&
  isNodeOfType(node.object, "Identifier") &&
  resolveConstIdentifierAlias(node.object, scopes)?.id === refSymbol.id;

const isDocumentedLazyInitialization = (
  assignmentExpression: EsTreeNodeOfType<"AssignmentExpression">,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    assignmentExpression.operator !== "=" ||
    !isNodeOfType(assignmentExpression.right, "NewExpression")
  ) {
    return false;
  }
  let descendant: EsTreeNode = assignmentExpression;
  let ancestor = descendant.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === descendant &&
      isNodeOfType(ancestor.test, "BinaryExpression") &&
      (ancestor.test.operator === "===" || ancestor.test.operator === "==")
    ) {
      const { left, right } = ancestor.test;
      if (
        (isSameRefCurrentMember(left, refSymbol, scopes) &&
          isNodeOfType(right, "Literal") &&
          right.value === null) ||
        (isSameRefCurrentMember(right, refSymbol, scopes) &&
          isNodeOfType(left, "Literal") &&
          left.value === null)
      ) {
        return true;
      }
    }
    descendant = ancestor;
    ancestor = descendant.parent;
  }
  return false;
};

export const noRefCurrentInRender = defineRule({
  id: "no-ref-current-in-render",
  title: "Ref mutated during render",
  severity: "error",
  recommendation:
    "Move ref writes into an event handler or effect. Render must stay pure because React can replay or discard it. The predictable null-guarded lazy initialization pattern remains supported.",
  create: (context) => {
    const report = (memberExpression: EsTreeNode) => {
      if (!resolveReactRefSymbol(memberExpression, context.scopes)) return;
      if (!findRenderPhaseComponentOrHook(memberExpression, context.scopes)) return;
      context.report({
        node: memberExpression,
        message:
          "This ref is mutated during render. React can replay or discard render work, so the mutation can leak from UI that never commits.",
      });
    };

    return {
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const refSymbol = resolveReactRefSymbol(node.left, context.scopes);
        if (!refSymbol) return;
        if (isDocumentedLazyInitialization(node, refSymbol, context.scopes)) return;
        report(node.left);
      },
      UpdateExpression(node: EsTreeNodeOfType<"UpdateExpression">) {
        report(node.argument);
      },
    };
  },
});
