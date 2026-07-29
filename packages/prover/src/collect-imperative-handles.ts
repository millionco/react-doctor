import ts from "typescript";
import { collectHookCalls } from "./collect-hook-calls.js";
import { REACT_IMPERATIVE_HANDLE_HOOK_NAMES } from "./constants.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getComponentPropName } from "./get-component-prop-name.js";
import { resolveFunction } from "./resolve-function.js";
import { summarizeFunctionReturns } from "./summarize-function-returns.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { getStaticPropertyName } from "./utils/get-static-property-name.js";

export enum ImperativeHandleRefKind {
  ForwardedRef = "forwarded-ref",
  RefProp = "ref-prop",
}

export interface ImperativeHandleMethodDescriptor {
  functionNode: ts.FunctionLikeDeclaration;
  name: string;
}

export interface ImperativeHandleDescriptor {
  callExpression: ts.CallExpression;
  factoryExpression: ts.Expression | null;
  factoryFunction: ts.FunctionLikeDeclaration | null;
  methods: ReadonlyArray<ImperativeHandleMethodDescriptor>;
  refExpression: ts.Expression | null;
  refKind: ImperativeHandleRefKind | null;
  refName: string | null;
  shapeComplete: boolean;
  targetComplete: boolean;
}

const getForwardedRefName = (
  expression: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): string | null => {
  if (!ts.isIdentifier(expression)) return null;
  const refParameter = functionNode.parameters[1];
  if (!refParameter || !ts.isIdentifier(refParameter.name)) return null;
  const expressionSymbol = typeChecker.getSymbolAtLocation(expression);
  const parameterSymbol = typeChecker.getSymbolAtLocation(refParameter.name);
  if (!expressionSymbol || expressionSymbol !== parameterSymbol) return null;
  const parentCall = ts.isCallExpression(functionNode.parent) ? functionNode.parent : null;
  return parentCall && getCanonicalReactApiName(parentCall.expression, typeChecker) === "forwardRef"
    ? refParameter.name.text
    : null;
};

const getRefTarget = (
  expression: ts.Expression | null,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): {
  kind: ImperativeHandleRefKind | null;
  name: string | null;
} => {
  if (!expression) return { kind: null, name: null };
  const propName = getComponentPropName(expression, functionNode, typeChecker);
  if (propName === "ref") {
    return { kind: ImperativeHandleRefKind.RefProp, name: expression.getText() };
  }
  const forwardedRefName = getForwardedRefName(expression, functionNode, typeChecker);
  return forwardedRefName
    ? { kind: ImperativeHandleRefKind.ForwardedRef, name: forwardedRefName }
    : { kind: null, name: null };
};

const collectObjectMethods = (
  objectExpression: ts.ObjectLiteralExpression,
  typeChecker: ts.TypeChecker,
): {
  methods: ReadonlyArray<ImperativeHandleMethodDescriptor>;
  complete: boolean;
} => {
  const methodsByName = new Map<string, ImperativeHandleMethodDescriptor>();
  let complete = true;
  for (const property of objectExpression.properties) {
    if (ts.isSpreadAssignment(property)) {
      complete = false;
      continue;
    }
    const propertyName = getStaticPropertyName(property.name);
    if (!propertyName || methodsByName.has(propertyName)) {
      complete = false;
      continue;
    }
    if (ts.isMethodDeclaration(property)) {
      methodsByName.set(propertyName, { functionNode: property, name: propertyName });
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      const propertyFunction = resolveFunction(property.initializer, typeChecker);
      const propertyType = typeChecker.getTypeAtLocation(property.initializer);
      if (propertyFunction) {
        methodsByName.set(propertyName, {
          functionNode: propertyFunction,
          name: propertyName,
        });
      } else if (propertyType.getCallSignatures().length > 0) {
        complete = false;
      }
      continue;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      const propertyFunction = resolveFunction(property.name, typeChecker);
      if (propertyFunction) {
        methodsByName.set(propertyName, {
          functionNode: propertyFunction,
          name: propertyName,
        });
      } else if (typeChecker.getTypeAtLocation(property.name).getCallSignatures().length > 0) {
        complete = false;
      }
      continue;
    }
    complete = false;
  }
  return { methods: [...methodsByName.values()], complete };
};

const collectHandleMethods = (
  factoryFunction: ts.FunctionLikeDeclaration | null,
  typeChecker: ts.TypeChecker,
): {
  methods: ReadonlyArray<ImperativeHandleMethodDescriptor>;
  complete: boolean;
} => {
  if (!factoryFunction) return { methods: [], complete: false };
  const returnSummary = summarizeFunctionReturns(factoryFunction, typeChecker);
  if (
    !returnSummary.isComplete ||
    returnSummary.canFallThrough ||
    returnSummary.expressions.length !== 1
  ) {
    return { methods: [], complete: false };
  }
  const returnExpression = unwrapTypescriptExpression(returnSummary.expressions[0].expression);
  if (!ts.isObjectLiteralExpression(returnExpression)) {
    return { methods: [], complete: false };
  }
  return collectObjectMethods(returnExpression, typeChecker);
};

export const collectImperativeHandles = (
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): ReadonlyArray<ImperativeHandleDescriptor> =>
  collectHookCalls(functionNode, REACT_IMPERATIVE_HANDLE_HOOK_NAMES, typeChecker).map(
    (callExpression) => {
      const refExpression = callExpression.arguments[0] ?? null;
      const factoryExpression = callExpression.arguments[1] ?? null;
      const factoryFunction = factoryExpression
        ? resolveFunction(factoryExpression, typeChecker)
        : null;
      const refTarget = getRefTarget(refExpression, functionNode, typeChecker);
      const handleMethods = collectHandleMethods(factoryFunction, typeChecker);
      return {
        callExpression,
        factoryExpression,
        factoryFunction,
        methods: handleMethods.methods,
        refExpression,
        refKind: refTarget.kind,
        refName: refTarget.name,
        shapeComplete: handleMethods.complete,
        targetComplete: Boolean(refTarget.kind && refTarget.name),
      };
    },
  );
