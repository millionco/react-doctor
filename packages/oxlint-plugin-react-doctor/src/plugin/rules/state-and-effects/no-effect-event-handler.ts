import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { walkAst } from "../../utils/walk-ast.js";
import { findTriggeredSideEffectCalleeName } from "./utils/find-triggered-side-effect-callee-name.js";
import { hasDocumentClassListMutation } from "./utils/has-document-class-list-mutation.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface GuardExpression {
  expression: EsTreeNode;
  rootIdentifierName: string;
}

const hasEventLikeNode = (node: EsTreeNode): boolean =>
  findTriggeredSideEffectCalleeName(node) !== null || hasDocumentClassListMutation(node);

const unwrapChainExpression = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!node) return null;
  if (isNodeOfType(node, "ChainExpression")) return node.expression;
  return node;
};

const collectGuardExpressions = (
  node: EsTreeNode | null | undefined,
  into: GuardExpression[],
): void => {
  if (!node) return;
  const unwrappedNode = unwrapChainExpression(node);
  if (!unwrappedNode) return;

  const rootIdentifierName = getRootIdentifierName(unwrappedNode);
  if (rootIdentifierName) {
    into.push({ expression: unwrappedNode, rootIdentifierName });
    return;
  }

  if (isNodeOfType(unwrappedNode, "UnaryExpression")) {
    collectGuardExpressions(unwrappedNode.argument, into);
    return;
  }

  if (
    isNodeOfType(unwrappedNode, "BinaryExpression") ||
    isNodeOfType(unwrappedNode, "LogicalExpression")
  ) {
    collectGuardExpressions(unwrappedNode.left, into);
    collectGuardExpressions(unwrappedNode.right, into);
    return;
  }

  if (isNodeOfType(unwrappedNode, "ConditionalExpression")) {
    collectGuardExpressions(unwrappedNode.test, into);
    collectGuardExpressions(unwrappedNode.consequent, into);
    collectGuardExpressions(unwrappedNode.alternate, into);
  }
};

const isReturnOnlyStatement = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "ReturnStatement")) return true;
  return (
    isNodeOfType(node, "BlockStatement") &&
    (node.body?.length ?? 0) === 1 &&
    isNodeOfType(node.body?.[0], "ReturnStatement")
  );
};

const hasEventLikeRemainingStatements = (statements: EsTreeNode[]): boolean =>
  statements.some(
    (statement) => !isNodeOfType(statement, "ReturnStatement") && hasEventLikeNode(statement),
  );

const doesGuardMatchDependency = (
  guardExpression: GuardExpression,
  dependencyExpression: EsTreeNode | null | undefined,
): boolean => {
  const unwrappedDependencyExpression = unwrapChainExpression(dependencyExpression);
  if (!unwrappedDependencyExpression) return false;
  if (areExpressionsStructurallyEqual(guardExpression.expression, unwrappedDependencyExpression)) {
    return true;
  }
  return (
    isNodeOfType(unwrappedDependencyExpression, "Identifier") &&
    unwrappedDependencyExpression.name === guardExpression.rootIdentifierName
  );
};

const hasDependencyMatch = (
  guardExpression: GuardExpression,
  dependencyExpressions: Array<EsTreeNode | null | undefined>,
): boolean =>
  dependencyExpressions.some((dependencyExpression) =>
    doesGuardMatchDependency(guardExpression, dependencyExpression),
  );

const isStandaloneIdentifier = (node: EsTreeNode): node is EsTreeNodeOfType<"Identifier"> =>
  isNodeOfType(node, "Identifier") &&
  !(
    isNodeOfType(node.parent, "MemberExpression") &&
    node.parent.property === node &&
    node.parent.computed !== true
  );

const doesNodeReferenceAnyRoot = (node: EsTreeNode, rootIdentifierNames: Set<string>): boolean => {
  let didFindReference = false;
  const visit = (child: EsTreeNode): boolean | void => {
    if (didFindReference) return false;
    if (isNodeOfType(child, "MemberExpression")) {
      const rootIdentifierName = getRootIdentifierName(child);
      if (rootIdentifierName && rootIdentifierNames.has(rootIdentifierName)) {
        didFindReference = true;
        return false;
      }
    }
    if (isStandaloneIdentifier(child) && rootIdentifierNames.has(child.name)) {
      didFindReference = true;
      return false;
    }
  };
  walkAst(node, visit);
  return didFindReference;
};

const doesEventLikeCallReferenceAnyRoot = (
  node: EsTreeNode,
  rootIdentifierNames: Set<string>,
): boolean => {
  let didFindReference = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didFindReference) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    if (findTriggeredSideEffectCalleeName(child) === null && !hasDocumentClassListMutation(child)) {
      return;
    }
    if (doesNodeReferenceAnyRoot(child, rootIdentifierNames)) {
      didFindReference = true;
      return false;
    }
  });
  return didFindReference;
};

const doesAnyEventLikeCallReferenceAnyRoot = (
  nodes: EsTreeNode[],
  rootIdentifierNames: Set<string>,
): boolean => nodes.some((node) => doesEventLikeCallReferenceAnyRoot(node, rootIdentifierNames));

export const noEffectEventHandler = defineRule<Rule>({
  id: "no-effect-event-handler",
  title: "Effect used as an event handler",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move event logic into the handler that starts it so the side effect does not run late after an extra render.",
  create: (context: RuleContext) => {
    const propStackTracker = createComponentPropStackTracker();

    return {
      ...propStackTracker.visitors,
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

        const callback = getEffectCallback(node);
        if (!callback) return;

        const depsNode = node.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;

        const dependencyExpressions = depsNode.elements ?? [];

        const statements = getCallbackStatements(callback);
        if (statements.length === 0) return;

        const soleStatement = statements[0];
        if (!isNodeOfType(soleStatement, "IfStatement")) return;

        const guardExpressions: GuardExpression[] = [];
        collectGuardExpressions(soleStatement.test, guardExpressions);
        const matchingPropGuardExpressions = guardExpressions.filter(
          (guardExpression) =>
            hasDependencyMatch(guardExpression, dependencyExpressions) &&
            propStackTracker.isPropName(guardExpression.rootIdentifierName, node),
        );
        if (matchingPropGuardExpressions.length === 0) return;

        const isSingleGuardedEventLikeStatement =
          statements.length === 1 && hasEventLikeNode(soleStatement.consequent);
        const isEarlyReturnGuardedEventLikeBody =
          statements.length > 1 &&
          !soleStatement.alternate &&
          isReturnOnlyStatement(soleStatement.consequent) &&
          hasEventLikeRemainingStatements(statements.slice(1));
        if (!isSingleGuardedEventLikeStatement && !isEarlyReturnGuardedEventLikeBody) return;

        const hasUnmatchedGuardExpression = guardExpressions.some(
          (guardExpression) =>
            !matchingPropGuardExpressions.some(
              (matchingGuardExpression) =>
                matchingGuardExpression.expression === guardExpression.expression,
            ),
        );
        if (hasUnmatchedGuardExpression) {
          const matchingPropRootNames = new Set(
            matchingPropGuardExpressions.map(
              (guardExpression) => guardExpression.rootIdentifierName,
            ),
          );
          const doesEventLikeRegionReferenceMatchedProp = isSingleGuardedEventLikeStatement
            ? doesEventLikeCallReferenceAnyRoot(soleStatement.consequent, matchingPropRootNames)
            : doesAnyEventLikeCallReferenceAnyRoot(statements.slice(1), matchingPropRootNames);
          if (!doesEventLikeRegionReferenceMatchedProp) return;
        }

        context.report({
          node,
          message:
            "This useEffect is simulating an event handler, which costs an extra render & runs late.",
        });
      },
    };
  },
});
