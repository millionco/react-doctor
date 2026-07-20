import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { hasR3fRuntimeImport } from "./utils/has-r3f-runtime-import.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { resolveR3fJsxEventHandler } from "./utils/resolve-r3f-jsx-event-handler.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";
import {
  isGuardedStateTransition,
  resolveStateSetterBinding,
} from "./r3f-no-state-in-use-frame.js";

const DISCRETE_POINTER_HIT_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "batchId",
  "faceIndex",
  "instanceId",
]);
const NUMERIC_BINARY_OPERATORS: ReadonlySet<string> = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "|",
  "&",
  "^",
  "<<",
  ">>",
  ">>>",
]);
const NUMERIC_UNARY_OPERATORS: ReadonlySet<string> = new Set(["+", "-", "~"]);
const NUMERIC_QUANTIZER_NAMES: ReadonlySet<string> = new Set(["ceil", "floor", "round", "trunc"]);

const analyzePointerBucketExpression = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number>,
): boolean | null => {
  for (const propertyName of DISCRETE_POINTER_HIT_PROPERTY_NAMES) {
    if (isR3fCallbackStateProperty(expression, callback, propertyName, scopes)) {
      return true;
    }
  }

  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) {
    return typeof candidate.value === "number" ? false : null;
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read") ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    return analyzePointerBucketExpression(symbol.initializer, callback, scopes, visitedSymbolIds);
  }
  if (
    isNodeOfType(candidate, "UnaryExpression") &&
    NUMERIC_UNARY_OPERATORS.has(candidate.operator)
  ) {
    return analyzePointerBucketExpression(candidate.argument, callback, scopes, visitedSymbolIds);
  }
  if (
    (isNodeOfType(candidate, "BinaryExpression") &&
      NUMERIC_BINARY_OPERATORS.has(candidate.operator)) ||
    (isNodeOfType(candidate, "LogicalExpression") &&
      (candidate.operator === "||" || candidate.operator === "??"))
  ) {
    const leftAnalysis = analyzePointerBucketExpression(
      candidate.left,
      callback,
      scopes,
      new Set(visitedSymbolIds),
    );
    const rightAnalysis = analyzePointerBucketExpression(
      candidate.right,
      callback,
      scopes,
      new Set(visitedSymbolIds),
    );
    if (leftAnalysis === null || rightAnalysis === null) return null;
    return leftAnalysis || rightAnalysis;
  }
  if (!isNodeOfType(candidate, "CallExpression") || candidate.arguments.length !== 1) {
    return null;
  }
  const callee = stripParenExpression(candidate.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const receiver = stripParenExpression(callee.object);
  const quantizerName = getStaticPropertyName(callee);
  const quantizerArgument = candidate.arguments[0];
  if (
    !isNodeOfType(receiver, "Identifier") ||
    receiver.name !== "Math" ||
    !scopes.isGlobalReference(receiver) ||
    !quantizerName ||
    !NUMERIC_QUANTIZER_NAMES.has(quantizerName) ||
    !quantizerArgument ||
    isNodeOfType(quantizerArgument, "SpreadElement")
  ) {
    return null;
  }
  return analyzePointerBucketExpression(quantizerArgument, callback, scopes, visitedSymbolIds);
};

const isBoundedPointerBucketUpdate = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const nextState = setterCall.arguments[0];
  if (!nextState || isNodeOfType(nextState, "SpreadElement")) return false;
  return analyzePointerBucketExpression(nextState, callback, scopes, new Set()) === true;
};

export const r3fNoStateInPointerMove = defineRule({
  id: "r3f-no-state-in-pointer-move",
  title: "React state update inside an R3F pointer-move handler",
  severity: "warn",
  recommendation:
    "Keep pointer-move previews in Three.js refs or transient state and publish one semantic React update when the interaction commits",
  create: (context: RuleContext) => {
    let importsReactThreeFiber = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        importsReactThreeFiber = hasR3fRuntimeImport(node, context.scopes);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!importsReactThreeFiber) return;
        const callback = resolveR3fJsxEventHandler(node, "onPointerMove", context);
        if (!callback) return;
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          if (
            !isNodeOfType(candidate, "CallExpression") ||
            !resolveStateSetterBinding(candidate.callee, context.scopes) ||
            isGuardedStateTransition(candidate, callback, context.scopes) ||
            isBoundedPointerBucketUpdate(candidate, callback, context.scopes)
          ) {
            return;
          }
          context.report({
            node: candidate,
            message:
              "This React state update can render on every pointer movement. Keep the preview in a ref or transient store and publish one semantic update on pointer-up",
          });
        });
      },
    };
  },
});
