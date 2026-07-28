import ts from "typescript";
import {
  KNOWN_IMPURE_RENDER_CALLS,
  KNOWN_PURE_GLOBAL_CALLS,
  KNOWN_PURE_METHOD_NAMES,
  MUTATING_METHOD_NAMES,
  REACT_MODELED_HOOK_NAMES,
  REACT_UNMODELED_HOOK_NAMES,
} from "./constants.js";
import { collectBindingIdentifiers } from "./collect-binding-identifiers.js";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { collectReachableFunctionGraph } from "./collect-reachable-functions.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { getCanonicalHookName } from "./get-canonical-hook-name.js";
import { getCallName } from "./get-call-name.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isNodeWithin } from "./is-node-within.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { isAssignmentOperator } from "./utils/is-assignment-operator.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

const KNOWN_RENDER_SIDE_EFFECT_CALLS = new Set([
  "alert",
  "console.error",
  "console.info",
  "console.log",
  "console.warn",
  "document.write",
  "fetch",
  "localStorage.clear",
  "localStorage.removeItem",
  "localStorage.setItem",
  "sessionStorage.clear",
  "sessionStorage.removeItem",
  "sessionStorage.setItem",
]);

const isProtectedMutation = (
  expression: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
  protectedSymbols: ReadonlySet<ts.Symbol>,
): boolean => {
  const rootIdentifier = getRootIdentifier(expression);
  if (!rootIdentifier) return true;
  const rootSymbol = context.typeChecker.getSymbolAtLocation(rootIdentifier);
  if (!rootSymbol) return true;
  const hasLocalBinding = Boolean(
    rootSymbol.declarations?.some(
      (declaration) =>
        (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) &&
        isNodeWithin(declaration, functionNode),
    ),
  );
  if (ts.isIdentifier(unwrapTypescriptExpression(expression)) && hasLocalBinding) return false;
  if (protectedSymbols.has(rootSymbol)) return true;
  if (!hasLocalBinding) return true;
  return !isFreshLocalMutation(expression, functionNode, context);
};

const isFreshLocalMutation = (
  expression: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): boolean => {
  const rootIdentifier = getRootIdentifier(expression);
  if (!rootIdentifier) return false;
  const rootSymbol = context.typeChecker.getSymbolAtLocation(rootIdentifier);
  return Boolean(
    rootSymbol?.declarations?.some(
      (declaration) =>
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        isNodeWithin(declaration, functionNode) &&
        (ts.isArrayLiteralExpression(unwrapTypescriptExpression(declaration.initializer)) ||
          ts.isObjectLiteralExpression(unwrapTypescriptExpression(declaration.initializer)) ||
          ts.isNewExpression(unwrapTypescriptExpression(declaration.initializer))),
    ),
  );
};

export const analyzeRenderPurity = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  const protectedSymbols = new Set([
    ...hookBindings.refs,
    ...hookBindings.stateValues,
    ...functionNode.parameters.flatMap((parameter) =>
      collectBindingIdentifiers(parameter.name).flatMap((identifier) => {
        const parameterSymbol = context.typeChecker.getSymbolAtLocation(identifier);
        return parameterSymbol ? [parameterSymbol] : [];
      }),
    ),
  ]);
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  const visitedFunctions = new Set<ts.FunctionLikeDeclaration>([functionNode]);
  const reachableFunctionGraph = collectReachableFunctionGraph(functionNode, context.typeChecker);
  const modeledCallExpressions = new Set(
    reachableFunctionGraph.calls.map((functionCall) => functionCall.callExpression),
  );

  const visitFunction = (currentFunction: ts.FunctionLikeDeclaration): void => {
    const visit = (node: ts.Node): void => {
      if (node !== currentFunction && isFunctionBoundary(node)) {
        return;
      }
      if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
        if (isProtectedMutation(node.left, currentFunction, context, protectedSymbols)) {
          violations.push(
            createEvidence(
              node,
              context.rootDirectory,
              `${node.left.getText()} is mutated during render`,
              ["render", `write ${node.left.getText()}`, "observable mutation"],
            ),
          );
        }
      }
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        isProtectedMutation(node.operand, currentFunction, context, protectedSymbols)
      ) {
        violations.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${node.operand.getText()} is mutated during render`,
            ["render", `write ${node.operand.getText()}`, "observable mutation"],
          ),
        );
      }
      if (ts.isNewExpression(node) && node.expression.getText() === "Date") {
        violations.push(
          createEvidence(
            node,
            context.rootDirectory,
            "new Date() is non-idempotent during render",
            ["render", "read current time", "render output"],
          ),
        );
      }
      if (ts.isCallExpression(node)) {
        const callName = getCallName(node);
        const finalCallName = getCanonicalHookName(node, context.typeChecker);
        const callSymbol = context.typeChecker.getSymbolAtLocation(node.expression);
        if (callSymbol && hookBindings.stateSetters.has(callSymbol)) {
          violations.push(
            createEvidence(
              node,
              context.rootDirectory,
              `${callName ?? "state setter"} updates state during render`,
              ["render", callName ?? "state setter", "schedule render"],
            ),
          );
          return;
        }
        if (
          callName &&
          (KNOWN_IMPURE_RENDER_CALLS.has(callName) || KNOWN_RENDER_SIDE_EFFECT_CALLS.has(callName))
        ) {
          violations.push(
            createEvidence(node, context.rootDirectory, `${callName} is not pure during render`, [
              "render",
              callName,
              "observable result or side effect",
            ]),
          );
          return;
        }
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          MUTATING_METHOD_NAMES.has(node.expression.name.text)
        ) {
          if (
            isProtectedMutation(
              node.expression.expression,
              currentFunction,
              context,
              protectedSymbols,
            )
          ) {
            violations.push(
              createEvidence(
                node,
                context.rootDirectory,
                `${callName ?? node.expression.name.text} mutates an input during render`,
                ["render", callName ?? node.expression.name.text, "observable mutation"],
              ),
            );
            return;
          }
          if (isFreshLocalMutation(node.expression.expression, currentFunction, context)) {
            return;
          }
        }
        if (
          finalCallName &&
          (REACT_MODELED_HOOK_NAMES.has(finalCallName) ||
            REACT_UNMODELED_HOOK_NAMES.has(finalCallName))
        ) {
          if (finalCallName === "useMemo" || finalCallName === "useState") {
            const callbackExpression = node.arguments[0];
            const callback = callbackExpression
              ? resolveFunction(callbackExpression, context.typeChecker)
              : null;
            if (callback && !visitedFunctions.has(callback)) {
              visitedFunctions.add(callback);
              visitFunction(callback);
            }
          }
          return;
        }
        if (
          (callName && KNOWN_PURE_GLOBAL_CALLS.has(callName)) ||
          (ts.isPropertyAccessExpression(node.expression) &&
            KNOWN_PURE_METHOD_NAMES.has(node.expression.name.text))
        ) {
          for (const argument of node.arguments) {
            if (ts.isFunctionExpression(argument) || ts.isArrowFunction(argument)) {
              visitFunction(argument);
            }
          }
          return;
        }
        const resolvedFunction = resolveFunction(node.expression, context.typeChecker);
        if (resolvedFunction && !visitedFunctions.has(resolvedFunction)) {
          visitedFunctions.add(resolvedFunction);
          visitFunction(resolvedFunction);
          return;
        }
        if (modeledCallExpressions.has(node)) return;
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            `${callName ?? node.expression.getText()} has no render-purity contract`,
            ["render", callName ?? node.expression.getText(), "opaque call"],
          ),
        );
        return;
      }
      node.forEachChild(visit);
    };
    currentFunction.forEachChild(visit);
  };

  visitFunction(functionNode);
  for (const reachableFunction of reachableFunctionGraph.functions) {
    if (visitedFunctions.has(reachableFunction.functionNode)) continue;
    visitedFunctions.add(reachableFunction.functionNode);
    visitFunction(reachableFunction.functionNode);
  }
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.RenderPurity,
      ReactObligationStatus.Violated,
      "Render has an observable mutation, update, or non-idempotent operation",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.RenderPurity,
      ReactObligationStatus.Unknown,
      "Render purity depends on calls without proof contracts",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.RenderPurity,
    ReactObligationStatus.Proved,
    "Render is pure for every represented path",
  );
};
