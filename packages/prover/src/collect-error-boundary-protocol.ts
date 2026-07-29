import ts from "typescript";
import { analyzeRenderPurity } from "./analyze-render-purity.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { summarizeFunctionReturns } from "./summarize-function-returns.js";
import { ReactErrorBoundaryProtocolStatus, ReactObligationStatus } from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import type { ReactAnalysisContext } from "./types.js";
import { getClassMethodDeclaration } from "./utils/get-class-method-declaration.js";
import { getStaticAccessMemberName } from "./utils/get-static-access-member-name.js";
import { getStaticClassMethodDeclaration } from "./utils/get-static-class-method-declaration.js";
import { getStaticPropertyName } from "./utils/get-static-property-name.js";

export interface ErrorBoundaryProtocolDescriptor {
  componentDidCatchMethod: ts.MethodDeclaration | null;
  derivedStateMethod: ts.MethodDeclaration | null;
  derivedStateStatus: ReactErrorBoundaryProtocolStatus;
  fallbackRenderStatus: ReactErrorBoundaryProtocolStatus;
  fallbackStateKey: string | null;
  isCandidate: boolean;
  isSourceComplete: boolean;
}

const getObjectPropertyValue = (property: ts.ObjectLiteralElementLike): ts.Expression | null => {
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return null;
};

const collectTrueStateKeys = (expression: ts.Expression): ReadonlySet<string> | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrappedExpression)) return null;
  const trueKeys = new Set<string>();
  for (const property of unwrappedExpression.properties) {
    const propertyName =
      ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
        ? getStaticPropertyName(property.name)
        : null;
    const propertyValue = getObjectPropertyValue(property);
    if (!propertyName || !propertyValue) return null;
    if (unwrapTypescriptExpression(propertyValue).kind === ts.SyntaxKind.TrueKeyword) {
      trueKeys.add(propertyName);
    }
  }
  return trueKeys;
};

const getDerivedStateProtocol = (
  derivedStateMethod: ts.MethodDeclaration | null,
  context: ReactAnalysisContext,
): {
  fallbackStateKey: string | null;
  status: ReactErrorBoundaryProtocolStatus;
} => {
  if (!derivedStateMethod) {
    return {
      fallbackStateKey: null,
      status: ReactErrorBoundaryProtocolStatus.Invalid,
    };
  }
  const returnSummary = summarizeFunctionReturns(derivedStateMethod, context.typeChecker);
  if (
    returnSummary.canFallThrough ||
    returnSummary.canThrow ||
    returnSummary.expressions.length === 0
  ) {
    return {
      fallbackStateKey: null,
      status: ReactErrorBoundaryProtocolStatus.Invalid,
    };
  }
  if (!returnSummary.isComplete) {
    return {
      fallbackStateKey: null,
      status: ReactErrorBoundaryProtocolStatus.Unknown,
    };
  }
  const returnStateKeys = returnSummary.expressions.map((descriptor) =>
    collectTrueStateKeys(descriptor.expression),
  );
  if (returnStateKeys.some((stateKeys) => stateKeys === null)) {
    return {
      fallbackStateKey: null,
      status: ReactErrorBoundaryProtocolStatus.Unknown,
    };
  }
  const firstStateKeys = returnStateKeys[0];
  const fallbackStateKey = firstStateKeys
    ? [...firstStateKeys].find((stateKey) =>
        returnStateKeys.every((stateKeys) => stateKeys?.has(stateKey)),
      )
    : null;
  if (!fallbackStateKey) {
    return {
      fallbackStateKey: null,
      status: ReactErrorBoundaryProtocolStatus.Invalid,
    };
  }
  const purity = analyzeRenderPurity(derivedStateMethod, context).status;
  if (purity === ReactObligationStatus.Violated) {
    return {
      fallbackStateKey,
      status: ReactErrorBoundaryProtocolStatus.Invalid,
    };
  }
  return {
    fallbackStateKey,
    status:
      purity === ReactObligationStatus.Proved
        ? ReactErrorBoundaryProtocolStatus.Valid
        : ReactErrorBoundaryProtocolStatus.Unknown,
  };
};

const getThisStateMemberName = (expression: ts.Expression): string | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    !ts.isPropertyAccessExpression(unwrappedExpression) &&
    !ts.isElementAccessExpression(unwrappedExpression)
  ) {
    return null;
  }
  const stateExpression = unwrapTypescriptExpression(unwrappedExpression.expression);
  if (
    (!ts.isPropertyAccessExpression(stateExpression) &&
      !ts.isElementAccessExpression(stateExpression)) ||
    unwrapTypescriptExpression(stateExpression.expression).kind !== ts.SyntaxKind.ThisKeyword ||
    getStaticAccessMemberName(stateExpression) !== "state"
  ) {
    return null;
  }
  return getStaticAccessMemberName(unwrappedExpression);
};

const isFallbackStateGuard = (expression: ts.Expression, fallbackStateKey: string): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (getThisStateMemberName(unwrappedExpression) === fallbackStateKey) return true;
  if (!ts.isBinaryExpression(unwrappedExpression)) return false;
  const operator = unwrappedExpression.operatorToken.kind;
  if (
    operator !== ts.SyntaxKind.EqualsEqualsToken &&
    operator !== ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    return false;
  }
  return (
    (getThisStateMemberName(unwrappedExpression.left) === fallbackStateKey &&
      unwrapTypescriptExpression(unwrappedExpression.right).kind === ts.SyntaxKind.TrueKeyword) ||
    (getThisStateMemberName(unwrappedExpression.right) === fallbackStateKey &&
      unwrapTypescriptExpression(unwrappedExpression.left).kind === ts.SyntaxKind.TrueKeyword)
  );
};

const collectReturnedExpressions = (node: ts.Node): ReadonlyArray<ts.Expression> => {
  const expressions: ts.Expression[] = [];
  const visit = (currentNode: ts.Node): void => {
    if (currentNode !== node && isFunctionBoundary(currentNode)) return;
    if (ts.isReturnStatement(currentNode) && currentNode.expression) {
      expressions.push(currentNode.expression);
      return;
    }
    currentNode.forEachChild(visit);
  };
  visit(node);
  return expressions;
};

const isChildrenExpression = (expression: ts.Expression): boolean => {
  let currentExpression = unwrapTypescriptExpression(expression);
  const members: string[] = [];
  while (
    ts.isPropertyAccessExpression(currentExpression) ||
    ts.isElementAccessExpression(currentExpression)
  ) {
    const memberName = getStaticAccessMemberName(currentExpression);
    if (!memberName) return false;
    members.unshift(memberName);
    currentExpression = unwrapTypescriptExpression(currentExpression.expression);
  }
  if (
    currentExpression.kind === ts.SyntaxKind.ThisKeyword &&
    members.join(".") === "props.children"
  ) {
    return true;
  }
  return false;
};

const getFallbackRenderStatus = (
  renderMethod: ts.MethodDeclaration,
  fallbackStateKey: string | null,
  derivedStateStatus: ReactErrorBoundaryProtocolStatus,
): ReactErrorBoundaryProtocolStatus => {
  if (!fallbackStateKey) {
    return derivedStateStatus === ReactErrorBoundaryProtocolStatus.Unknown
      ? ReactErrorBoundaryProtocolStatus.Unknown
      : ReactErrorBoundaryProtocolStatus.Invalid;
  }
  const fallbackGuards: ts.IfStatement[] = [];
  const visit = (node: ts.Node): void => {
    if (fallbackGuards.length > 0 || (node !== renderMethod && isFunctionBoundary(node))) return;
    if (ts.isIfStatement(node) && isFallbackStateGuard(node.expression, fallbackStateKey)) {
      fallbackGuards.push(node);
      return;
    }
    node.forEachChild(visit);
  };
  renderMethod.forEachChild(visit);
  const fallbackGuard = fallbackGuards[0];
  if (!fallbackGuard) return ReactErrorBoundaryProtocolStatus.Unknown;
  const fallbackExpressions = collectReturnedExpressions(fallbackGuard.thenStatement);
  if (fallbackExpressions.length === 0) return ReactErrorBoundaryProtocolStatus.Invalid;
  if (fallbackExpressions.some(isChildrenExpression)) {
    return ReactErrorBoundaryProtocolStatus.Invalid;
  }
  return ReactErrorBoundaryProtocolStatus.Valid;
};

export const collectErrorBoundaryProtocol = (
  classNode: ts.ClassDeclaration,
  renderMethod: ts.MethodDeclaration,
  context: ReactAnalysisContext,
): ErrorBoundaryProtocolDescriptor => {
  const derivedStateMethod = getStaticClassMethodDeclaration(classNode, "getDerivedStateFromError");
  const componentDidCatchMethod = getClassMethodDeclaration(classNode, "componentDidCatch");
  const isCandidate = Boolean(
    derivedStateMethod ||
    componentDidCatchMethod ||
    classNode.members.some(
      (member) =>
        ts.isMethodDeclaration(member) &&
        getStaticPropertyName(member.name) === "getDerivedStateFromError",
    ),
  );
  if (!isCandidate) {
    return {
      componentDidCatchMethod,
      derivedStateMethod,
      derivedStateStatus: ReactErrorBoundaryProtocolStatus.Unknown,
      fallbackRenderStatus: ReactErrorBoundaryProtocolStatus.Unknown,
      fallbackStateKey: null,
      isCandidate: false,
      isSourceComplete: true,
    };
  }
  const derivedStateProtocol = getDerivedStateProtocol(derivedStateMethod, context);
  const fallbackRenderStatus = getFallbackRenderStatus(
    renderMethod,
    derivedStateProtocol.fallbackStateKey,
    derivedStateProtocol.status,
  );
  return {
    componentDidCatchMethod,
    derivedStateMethod,
    derivedStateStatus: derivedStateProtocol.status,
    fallbackRenderStatus,
    fallbackStateKey: derivedStateProtocol.fallbackStateKey,
    isCandidate,
    isSourceComplete:
      derivedStateProtocol.status !== ReactErrorBoundaryProtocolStatus.Unknown &&
      fallbackRenderStatus !== ReactErrorBoundaryProtocolStatus.Unknown,
  };
};
