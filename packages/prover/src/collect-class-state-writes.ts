import ts from "typescript";
import { CLASS_STATE_MUTATING_METHOD_NAMES } from "./constants.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import {
  ReactClassStateWriteKind,
  ReactClassStateWriteStatus,
  ReactExecutionPhase,
} from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import type { ReactAnalysisContext } from "./types.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { getStaticAccessMemberName } from "./utils/get-static-access-member-name.js";
import { getStaticPropertyName } from "./utils/get-static-property-name.js";
import { isPlatformDeclarationSymbol } from "./utils/is-platform-declaration-symbol.js";
import { isAssignmentOperator } from "./utils/is-assignment-operator.js";

export interface ClassStateWriteDescriptor {
  callbackId: string;
  kind: ReactClassStateWriteKind;
  node: ts.Node;
  phase:
    | ReactExecutionPhase.ClassMount
    | ReactExecutionPhase.ClassUnmount
    | ReactExecutionPhase.ClassUpdate
    | ReactExecutionPhase.Deferred
    | ReactExecutionPhase.StateTransition;
  status: ReactClassStateWriteStatus;
}

export interface ClassStateWriteRootDescriptor {
  callbackId: string;
  functionNode: ts.FunctionLikeDeclaration;
  phase:
    | ReactExecutionPhase.ClassMount
    | ReactExecutionPhase.ClassUnmount
    | ReactExecutionPhase.ClassUpdate
    | ReactExecutionPhase.Deferred
    | ReactExecutionPhase.StateTransition;
}

const isThisStateExpression = (expression: ts.Expression): boolean => {
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
  return currentExpression.kind === ts.SyntaxKind.ThisKeyword && members[0] === "state";
};

const isThisStateAssignmentTarget = (node: ts.Node): boolean => {
  if (ts.isExpression(node) && isThisStateExpression(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isThisStateAssignmentTarget(node.expression);
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some(isThisStateAssignmentTarget);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) {
        return isThisStateAssignmentTarget(property.initializer);
      }
      if (ts.isSpreadAssignment(property)) {
        return isThisStateAssignmentTarget(property.expression);
      }
      return false;
    });
  }
  return false;
};

const isDefinitelyPrimitiveType = (type: ts.Type): boolean => {
  if (type.isUnionOrIntersection()) {
    return type.types.length > 0 && type.types.every(isDefinitelyPrimitiveType);
  }
  return Boolean(
    type.flags &
    (ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.ESSymbolLike |
      ts.TypeFlags.Null |
      ts.TypeFlags.Undefined |
      ts.TypeFlags.Void |
      ts.TypeFlags.Never),
  );
};

const isObjectAssignMutation = (
  callExpression: ts.CallExpression,
  context: ReactAnalysisContext,
): boolean => {
  const callTarget = unwrapTypescriptExpression(callExpression.expression);
  return Boolean(
    ts.isPropertyAccessExpression(callTarget) &&
    ts.isIdentifier(callTarget.expression) &&
    callTarget.expression.text === "Object" &&
    callTarget.name.text === "assign" &&
    isPlatformDeclarationSymbol(getResolvedSymbol(callTarget.name, context.typeChecker)) &&
    callExpression.arguments[0] &&
    isThisStateExpression(callExpression.arguments[0]),
  );
};

const getMethodOwnerName = (symbol: ts.Symbol): string | null => {
  for (const declaration of symbol.declarations ?? []) {
    let currentNode: ts.Node | undefined = declaration.parent;
    while (currentNode) {
      if (
        (ts.isInterfaceDeclaration(currentNode) || ts.isClassDeclaration(currentNode)) &&
        currentNode.name
      ) {
        return currentNode.name.text;
      }
      currentNode = currentNode.parent;
    }
  }
  return null;
};

const isKnownMutatingMethod = (
  property: ts.PropertyName,
  methodName: string,
  context: ReactAnalysisContext,
): boolean => {
  const methodSymbol = getResolvedSymbol(property, context.typeChecker);
  if (!methodSymbol || !isPlatformDeclarationSymbol(methodSymbol)) return false;
  const ownerName = getMethodOwnerName(methodSymbol);
  if (!ownerName) return false;
  if (methodName === "add") return ownerName === "Set";
  if (methodName === "set") return ownerName === "Map" || ownerName === "WeakMap";
  if (methodName === "clear") return ownerName === "Map" || ownerName === "Set";
  if (methodName === "delete") {
    return (
      ownerName === "Map" ||
      ownerName === "Set" ||
      ownerName === "WeakMap" ||
      ownerName === "WeakSet"
    );
  }
  return ownerName === "Array";
};

const isStateMutatingCall = (
  callExpression: ts.CallExpression,
  context: ReactAnalysisContext,
): boolean => {
  if (isObjectAssignMutation(callExpression, context)) return true;
  const callTarget = unwrapTypescriptExpression(callExpression.expression);
  if (!ts.isPropertyAccessExpression(callTarget)) {
    return false;
  }
  const methodName = getStaticPropertyName(callTarget.name);
  return Boolean(
    methodName &&
    CLASS_STATE_MUTATING_METHOD_NAMES.has(methodName) &&
    isThisStateExpression(callTarget.expression) &&
    isKnownMutatingMethod(callTarget.name, methodName, context),
  );
};

const isStateReferenceEscape = (
  expression: ts.Expression,
  context: ReactAnalysisContext,
): boolean => {
  if (!isThisStateExpression(expression)) return false;
  if (isDefinitelyPrimitiveType(context.typeChecker.getTypeAtLocation(expression))) return false;
  const parent = expression.parent;
  if (
    (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
    parent.expression === expression
  ) {
    return false;
  }
  if (ts.isBinaryExpression(parent)) {
    if (isAssignmentOperator(parent.operatorToken.kind)) return parent.right === expression;
    if (
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      return true;
    }
    if (
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      parent.operatorToken.kind === ts.SyntaxKind.CommaToken
    ) {
      return parent.right === expression;
    }
    return false;
  }
  if (ts.isConditionalExpression(parent)) return parent.condition !== expression;
  if (ts.isAwaitExpression(parent) || ts.isYieldExpression(parent)) return true;
  if (
    ts.isPrefixUnaryExpression(parent) ||
    ts.isPostfixUnaryExpression(parent) ||
    ts.isDeleteExpression(parent)
  ) {
    return false;
  }
  if (ts.isCallExpression(parent)) {
    const callTarget = unwrapTypescriptExpression(parent.expression);
    return (
      parent.arguments.includes(expression) &&
      !(
        ts.isPropertyAccessExpression(callTarget) &&
        callTarget.expression.kind === ts.SyntaxKind.ThisKeyword &&
        callTarget.name.text === "setState"
      )
    );
  }
  if (ts.isNewExpression(parent)) return parent.arguments?.includes(expression) ?? false;
  if (ts.isVariableDeclaration(parent)) return parent.initializer === expression;
  if (ts.isReturnStatement(parent)) return parent.expression === expression;
  if (ts.isPropertyAssignment(parent)) return parent.initializer === expression;
  if (ts.isArrayLiteralExpression(parent)) return parent.elements.includes(expression);
  if (ts.isSpreadAssignment(parent) || ts.isSpreadElement(parent)) return true;
  return false;
};

const collectMethodStateWrites = (
  descriptor: ClassStateWriteRootDescriptor,
  context: ReactAnalysisContext,
): ReadonlyArray<ClassStateWriteDescriptor> => {
  const writes: ClassStateWriteDescriptor[] = [];
  const addWrite = (
    node: ts.Node,
    kind: ReactClassStateWriteKind,
    status: ReactClassStateWriteStatus,
  ): void => {
    writes.push({
      callbackId: descriptor.callbackId,
      kind,
      node,
      phase: descriptor.phase,
      status,
    });
  };
  const visit = (node: ts.Node): void => {
    if (node !== descriptor.functionNode && isFunctionBoundary(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentOperator(node.operatorToken.kind) &&
      isThisStateAssignmentTarget(node.left)
    ) {
      addWrite(node, ReactClassStateWriteKind.Assignment, ReactClassStateWriteStatus.Forbidden);
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      isThisStateExpression(node.operand)
    ) {
      addWrite(node, ReactClassStateWriteKind.Update, ReactClassStateWriteStatus.Forbidden);
      return;
    }
    if (ts.isDeleteExpression(node) && isThisStateExpression(node.expression)) {
      addWrite(node, ReactClassStateWriteKind.Delete, ReactClassStateWriteStatus.Forbidden);
      return;
    }
    if (ts.isCallExpression(node) && isStateMutatingCall(node, context)) {
      addWrite(node, ReactClassStateWriteKind.MutatingCall, ReactClassStateWriteStatus.Forbidden);
      return;
    }
    if (ts.isExpression(node) && isStateReferenceEscape(node, context)) {
      addWrite(node, ReactClassStateWriteKind.ReferenceEscape, ReactClassStateWriteStatus.Unknown);
      return;
    }
    node.forEachChild(visit);
  };
  descriptor.functionNode.forEachChild(visit);
  return writes;
};

export const collectClassStateWrites = (
  roots: ReadonlyArray<ClassStateWriteRootDescriptor>,
  context: ReactAnalysisContext,
): ReadonlyArray<ClassStateWriteDescriptor> =>
  roots.flatMap((descriptor) => collectMethodStateWrites(descriptor, context));
