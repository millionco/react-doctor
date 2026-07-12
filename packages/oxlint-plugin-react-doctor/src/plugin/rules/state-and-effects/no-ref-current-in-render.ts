import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findRenderPhaseComponentOrHook } from "../../utils/find-render-phase-component-or-hook.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveReactRefSymbol } from "../../utils/react-ref-origin.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const REPEATED_ANCESTOR_TYPES = new Set([
  "DoWhileStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "WhileStatement",
]);

const isSameRefCurrentMember = (
  node: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || getStaticPropertyName(node) !== "current") {
    return false;
  }
  const receiver = stripParenExpression(node.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    resolveConstIdentifierAlias(receiver, scopes)?.id === refSymbol.id
  );
};

const isSameRefCurrentAlias = (
  node: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (isSameRefCurrentMember(node, refSymbol, scopes)) return true;
  if (!isNodeOfType(node, "Identifier")) return false;
  const aliasSymbol = scopes.symbolFor(node);
  return (
    aliasSymbol?.kind === "const" &&
    aliasSymbol.initializer !== null &&
    isSameRefCurrentMember(stripParenExpression(aliasSymbol.initializer), refSymbol, scopes)
  );
};

const isEmptySentinel = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  (isNodeOfType(node, "Literal") && node.value === null) ||
  (isNodeOfType(node, "Identifier") && node.name === "undefined" && scopes.isGlobalReference(node));

const hasRepeatedExecutionAncestor = (node: EsTreeNode, stop: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor && ancestor !== stop) {
    if (isFunctionLike(ancestor) || REPEATED_ANCESTOR_TYPES.has(ancestor.type)) return true;
    ancestor = ancestor.parent;
  }
  return ancestor !== stop;
};

const getBranchConstraints = (
  node: EsTreeNode,
  branchRoot: EsTreeNode,
): Map<EsTreeNode, boolean> => {
  const constraints = new Map<EsTreeNode, boolean>();
  let descendant = node;
  let ancestor = descendant.parent;
  while (ancestor && descendant !== branchRoot) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (ancestor.consequent === descendant) constraints.set(ancestor, true);
      if (ancestor.alternate === descendant) constraints.set(ancestor, false);
    }
    descendant = ancestor;
    ancestor = ancestor.parent;
  }
  return constraints;
};

const canExecuteTogether = (
  firstConstraints: Map<EsTreeNode, boolean>,
  secondConstraints: Map<EsTreeNode, boolean>,
): boolean => {
  for (const [statement, branch] of firstConstraints) {
    const otherBranch = secondConstraints.get(statement);
    if (otherBranch !== undefined && otherBranch !== branch) return false;
  }
  return true;
};

const hasNoPriorCoExecutableWrite = (
  assignmentExpression: EsTreeNodeOfType<"AssignmentExpression">,
  branchRoot: EsTreeNode,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const assignmentConstraints = getBranchConstraints(assignmentExpression, branchRoot);
  const assignmentStart = getRangeStart(assignmentExpression);
  let hasCoExecutableWrite = false;
  walkAst(branchRoot, (child: EsTreeNode): boolean | void => {
    if (hasCoExecutableWrite) return false;
    const childStart = getRangeStart(child);
    if (
      child === assignmentExpression ||
      !isNodeOfType(child, "AssignmentExpression") ||
      assignmentStart === null ||
      childStart === null ||
      childStart >= assignmentStart ||
      resolveReactRefSymbol(child.left, scopes)?.id !== refSymbol.id ||
      hasRepeatedExecutionAncestor(child, branchRoot)
    ) {
      return;
    }
    if (canExecuteTogether(assignmentConstraints, getBranchConstraints(child, branchRoot))) {
      hasCoExecutableWrite = true;
      return false;
    }
  });
  return !hasCoExecutableWrite;
};

const isDocumentedLazyInitialization = (
  assignmentExpression: EsTreeNodeOfType<"AssignmentExpression">,
  refSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (assignmentExpression.operator === "??=" || assignmentExpression.operator === "||=") {
    return true;
  }
  if (assignmentExpression.operator !== "=") return false;
  let descendant: EsTreeNode = assignmentExpression;
  let ancestor = descendant.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      isNodeOfType(ancestor.test, "BinaryExpression") &&
      ["===", "==", "!==", "!="].includes(ancestor.test.operator)
    ) {
      const { left, right } = ancestor.test;
      const comparesEmptySentinel =
        (isSameRefCurrentAlias(left, refSymbol, scopes) && isEmptySentinel(right, scopes)) ||
        (isSameRefCurrentAlias(right, refSymbol, scopes) && isEmptySentinel(left, scopes));
      const isEquality = ancestor.test.operator === "===" || ancestor.test.operator === "==";
      const guardedBranch = isEquality ? ancestor.consequent : ancestor.alternate;
      if (
        comparesEmptySentinel &&
        guardedBranch === descendant &&
        guardedBranch &&
        !hasRepeatedExecutionAncestor(assignmentExpression, guardedBranch) &&
        hasNoPriorCoExecutableWrite(assignmentExpression, guardedBranch, refSymbol, scopes)
      )
        return true;
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
