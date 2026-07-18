import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { createComponentPropStackTracker } from "../../utils/create-component-prop-stack-tracker.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { walkAst } from "../../utils/walk-ast.js";
import { findTriggeredSideEffectCalleeName } from "./utils/find-triggered-side-effect-callee-name.js";
import { hasDocumentClassListMutation } from "./utils/has-document-class-list-mutation.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { hasCleanup } from "./utils/effect/react.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";

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

const collectLeadingEarlyReturnGuards = (statements: EsTreeNode[]): GuardExpression[] => {
  const guardExpressions: GuardExpression[] = [];
  for (const statement of statements) {
    if (isNodeOfType(statement, "VariableDeclaration")) continue;
    if (
      !isNodeOfType(statement, "IfStatement") ||
      statement.alternate ||
      !isReturnOnlyStatement(statement.consequent)
    ) {
      break;
    }
    collectGuardExpressions(statement.test, guardExpressions);
  }
  return guardExpressions;
};

const collectImmutableExpressionOrigins = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode[] => {
  const origins: EsTreeNode[] = [];
  const visitedSymbolIds = new Set<number>();
  let currentExpression: EsTreeNode | null = stripParenExpression(expression);
  while (currentExpression) {
    origins.push(currentExpression);
    if (!isNodeOfType(currentExpression, "Identifier")) break;
    const bindingSymbol = scopes.symbolFor(currentExpression);
    if (
      !bindingSymbol ||
      bindingSymbol.kind !== "const" ||
      visitedSymbolIds.has(bindingSymbol.id) ||
      !bindingSymbol.initializer
    ) {
      break;
    }
    visitedSymbolIds.add(bindingSymbol.id);
    currentExpression = stripParenExpression(bindingSymbol.initializer);
  }
  return origins;
};

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

const hasAliasedDependencyMatch = (
  guardExpression: GuardExpression,
  dependencyExpressions: Array<EsTreeNode | null | undefined>,
  scopes: ScopeAnalysis,
): boolean => {
  const guardOrigins = collectImmutableExpressionOrigins(guardExpression.expression, scopes);
  return dependencyExpressions.some((dependencyExpression) => {
    if (!dependencyExpression) return false;
    const dependencyOrigins = collectImmutableExpressionOrigins(dependencyExpression, scopes);
    return guardOrigins.some((guardOrigin) =>
      dependencyOrigins.some((dependencyOrigin) =>
        areExpressionsStructurallyEqual(guardOrigin, dependencyOrigin),
      ),
    );
  });
};

const isStaticallyTrue = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  collectImmutableExpressionOrigins(expression, scopes).some(
    (origin) => isNodeOfType(origin, "Literal") && origin.value === true,
  );

const isReactRouterReplacementNavigation = (
  node: EsTreeNode,
  rootIdentifierNames: Set<string>,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindNavigation = false;
  let didFindOtherTriggeredSideEffect = false;
  walkAst(node, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const isTriggeredSideEffect =
      findTriggeredSideEffectCalleeName(child) !== null || hasDocumentClassListMutation(child);
    if (!isTriggeredSideEffect) return;
    const destinationExpression = child.arguments?.[0];
    const doesDestinationReferenceReconciliationValue = Boolean(
      destinationExpression &&
      collectImmutableExpressionOrigins(destinationExpression, scopes).some((origin) =>
        doesNodeReferenceAnyRoot(origin, rootIdentifierNames),
      ),
    );
    if (!isNodeOfType(child.callee, "Identifier") || !doesDestinationReferenceReconciliationValue) {
      didFindOtherTriggeredSideEffect = true;
      return;
    }
    const navigationSymbol = scopes.symbolFor(child.callee);
    const navigationInitializer = navigationSymbol?.initializer
      ? stripParenExpression(navigationSymbol.initializer)
      : null;
    if (
      navigationSymbol?.kind !== "const" ||
      !isNodeOfType(navigationInitializer, "CallExpression") ||
      !isNodeOfType(navigationInitializer.callee, "Identifier")
    ) {
      didFindOtherTriggeredSideEffect = true;
      return;
    }
    if (scopes.symbolFor(navigationInitializer.callee)?.kind !== "import") {
      didFindOtherTriggeredSideEffect = true;
      return;
    }
    const importedHookName =
      getImportedNameFromModule(
        navigationInitializer.callee,
        navigationInitializer.callee.name,
        "react-router-dom",
      ) ??
      getImportedNameFromModule(
        navigationInitializer.callee,
        navigationInitializer.callee.name,
        "react-router",
      );
    if (importedHookName !== "useNavigate") {
      didFindOtherTriggeredSideEffect = true;
      return;
    }
    const navigationOptionsArgument = child.arguments?.[1];
    const navigationOptions = navigationOptionsArgument
      ? stripParenExpression(navigationOptionsArgument)
      : null;
    if (!isNodeOfType(navigationOptions, "ObjectExpression")) {
      didFindOtherTriggeredSideEffect = true;
      return;
    }
    let isReplacementGuaranteed = false;
    for (const property of navigationOptions.properties) {
      if (isNodeOfType(property, "SpreadElement")) {
        isReplacementGuaranteed = false;
        continue;
      }
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (propertyName === null) {
        isReplacementGuaranteed = false;
        continue;
      }
      if (propertyName !== "replace") continue;
      isReplacementGuaranteed = isStaticallyTrue(property.value, scopes);
    }
    if (isReplacementGuaranteed) {
      didFindNavigation = true;
      return;
    }
    didFindOtherTriggeredSideEffect = true;
  });
  return didFindNavigation && !didFindOtherTriggeredSideEffect;
};

// `if (mode === 'trialregistration') return;` followed by the side effect
// excludes ONE prop value and runs the effect for every other value —
// including the initial render. That is default-path data loading keyed to
// a programmatic prop (the doc's routing FP case), not "fire when the prop
// flips". Negated equality (`!==`) still gates on reaching a specific
// value, so it keeps firing.
const isEqualityToLiteralGuard = (guardExpression: GuardExpression): boolean => {
  const parent = guardExpression.expression.parent;
  if (!isNodeOfType(parent, "BinaryExpression")) return false;
  if (parent.operator !== "===" && parent.operator !== "==") return false;
  const otherSide = parent.left === guardExpression.expression ? parent.right : parent.left;
  return isNodeOfType(otherSide, "Literal") || isNodeOfType(otherSide, "TemplateLiteral");
};

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

export const noEffectEventHandler = defineRule({
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
        if (
          !isReactHookCall(node, EFFECT_HOOK_NAMES, context.scopes) ||
          (node.arguments?.length ?? 0) < 2
        ) {
          return;
        }

        const callback = getEffectCallback(node);
        if (!callback) return;

        // An effect that returns a cleanup is synchronizing with an
        // external system (body scroll lock, abortable fetch, cancellable
        // subscription) — the cleanup half CANNOT live in an event
        // handler, so the effect is not simulating one. Every corpus FP
        // for this rule (prod telemetry review 2026-07) had a cleanup.
        const analysis = getProgramAnalysis(node);
        if (analysis && hasCleanup(analysis, node)) return;

        const depsNode = node.arguments[1];
        if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;

        const dependencyExpressions = depsNode.elements ?? [];

        const statements = getCallbackStatements(callback);
        if (statements.length === 0) return;

        const soleStatement = statements[0];
        if (!isNodeOfType(soleStatement, "IfStatement")) return;

        const initialGuardExpressions: GuardExpression[] = [];
        collectGuardExpressions(soleStatement.test, initialGuardExpressions);
        const guardExpressions = collectLeadingEarlyReturnGuards(statements);
        if (guardExpressions.length === 0) {
          guardExpressions.push(...initialGuardExpressions);
        }
        const matchingPropGuardExpressions = initialGuardExpressions.filter(
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
        // Only the early-return shape: there the equality guard EXCLUDES a
        // value and the side effect is the default path (runs on mount).
        // In the single-guarded shape an equality test gates ENTERING the
        // side effect, which is the true-positive "when prop becomes X".
        if (
          isEarlyReturnGuardedEventLikeBody &&
          !isSingleGuardedEventLikeStatement &&
          matchingPropGuardExpressions.every(isEqualityToLiteralGuard)
        ) {
          return;
        }

        const hasUnmatchedGuardExpression = initialGuardExpressions.some(
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

        if (isEarlyReturnGuardedEventLikeBody) {
          const reconciliationGuardRootNames = new Set(
            guardExpressions
              .filter(
                (guardExpression) =>
                  !propStackTracker.isPropName(guardExpression.rootIdentifierName, node) &&
                  hasAliasedDependencyMatch(
                    guardExpression,
                    dependencyExpressions,
                    context.scopes,
                  ) &&
                  guardExpressions.some((comparisonGuardExpression) => {
                    if (
                      comparisonGuardExpression.rootIdentifierName !==
                      guardExpression.rootIdentifierName
                    ) {
                      return false;
                    }
                    const comparisonExpression = comparisonGuardExpression.expression.parent;
                    if (
                      !isNodeOfType(comparisonExpression, "BinaryExpression") ||
                      (comparisonExpression.operator !== "===" &&
                        comparisonExpression.operator !== "==")
                    ) {
                      return false;
                    }
                    const comparedExpression =
                      comparisonExpression.left === comparisonGuardExpression.expression
                        ? comparisonExpression.right
                        : comparisonExpression.left;
                    const comparedRootIdentifierName = getRootIdentifierName(comparedExpression);
                    return Boolean(
                      comparedRootIdentifierName &&
                      propStackTracker.isPropName(comparedRootIdentifierName, node),
                    );
                  }),
              )
              .map((guardExpression) => guardExpression.rootIdentifierName),
          );
          if (reconciliationGuardRootNames.size > 0) {
            const matchingPropRootNames = new Set(
              matchingPropGuardExpressions.map(
                (guardExpression) => guardExpression.rootIdentifierName,
              ),
            );
            const eventLikeStatements = statements.slice(1);
            const triggeredStatements = eventLikeStatements.filter(hasEventLikeNode);
            if (
              triggeredStatements.length > 0 &&
              triggeredStatements.every((statement) =>
                isReactRouterReplacementNavigation(
                  statement,
                  reconciliationGuardRootNames,
                  context.scopes,
                ),
              ) &&
              !doesAnyEventLikeCallReferenceAnyRoot(eventLikeStatements, matchingPropRootNames)
            ) {
              return;
            }
          }
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
