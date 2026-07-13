import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ComparatorAbstractValue {
  readonly kind:
    | "boolean"
    | "number"
    | "string"
    | "undefined"
    | "props"
    | "empty-array"
    | "empty-object"
    | "symbol"
    | "unknown";
  readonly value?: boolean | number | string;
}

interface ComparatorEvaluationState {
  readonly activeFunctions: ReadonlySet<EsTreeNode>;
  readonly bindings: ReadonlyMap<string, ComparatorAbstractValue>;
  readonly emptyReferencesAreEqual: boolean;
  readonly emptyLiteralKind: "array" | "object";
  readonly propName: string;
  readonly scopes: ScopeAnalysis;
}

const UNKNOWN_VALUE: ComparatorAbstractValue = { kind: "unknown" };
const TRUE_VALUE: ComparatorAbstractValue = { kind: "boolean", value: true };
const FALSE_VALUE: ComparatorAbstractValue = { kind: "boolean", value: false };
const UNDEFINED_VALUE: ComparatorAbstractValue = { kind: "undefined" };
const PROPS_VALUE: ComparatorAbstractValue = { kind: "props" };
const EMPTY_ARRAY_VALUE: ComparatorAbstractValue = { kind: "empty-array" };
const EMPTY_OBJECT_VALUE: ComparatorAbstractValue = { kind: "empty-object" };
const OBJECT_PROTOTYPE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "constructor",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);
const PROVABLY_CALLABLE_GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "Boolean",
  "Number",
  "String",
]);

const booleanValue = (value: boolean): ComparatorAbstractValue =>
  value ? TRUE_VALUE : FALSE_VALUE;

const evaluateEquality = (
  left: ComparatorAbstractValue,
  right: ComparatorAbstractValue,
  emptyReferencesAreEqual: boolean,
): boolean | null => {
  if (left.kind === "unknown" || right.kind === "unknown") return null;
  if (left.kind === "empty-array" || left.kind === "empty-object") {
    return left.kind === right.kind && emptyReferencesAreEqual;
  }
  if (right.kind === "empty-array" || right.kind === "empty-object") return false;
  if (left.kind !== right.kind) return false;
  if (left.kind === "props") return null;
  if (left.kind === "symbol" && left.value !== right.value) return null;
  return left.value === right.value;
};

const getReturnedExpression = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (!isFunctionLike(functionNode)) return null;
  if (isNodeOfType(functionNode, "ArrowFunctionExpression")) {
    const body = functionNode.body;
    if (!isNodeOfType(body, "BlockStatement")) return body;
  }
  const body = functionNode.body;
  if (!isNodeOfType(body, "BlockStatement") || body.body.length !== 1) return null;
  const returnStatement = body.body[0];
  return isNodeOfType(returnStatement, "ReturnStatement") && returnStatement.argument
    ? returnStatement.argument
    : null;
};

const isProvablyCallable = (expression: EsTreeNode, state: ComparatorEvaluationState): boolean => {
  const node = stripParenExpression(expression);
  if (isFunctionLike(node)) return true;
  if (
    isNodeOfType(node, "Identifier") &&
    PROVABLY_CALLABLE_GLOBAL_NAMES.has(node.name) &&
    state.scopes.isGlobalReference(node)
  ) {
    return true;
  }
  return isFunctionLike(resolveExactLocalFunction(node, state.scopes));
};

const evaluateExpression = (
  expression: EsTreeNode,
  state: ComparatorEvaluationState,
): ComparatorAbstractValue => {
  const node = stripParenExpression(expression);
  if (isNodeOfType(node, "Literal")) {
    if (typeof node.value === "boolean") return booleanValue(node.value);
    if (typeof node.value === "number") return { kind: "number", value: node.value };
    if (typeof node.value === "string") return { kind: "string", value: node.value };
    return node.value === undefined ? UNDEFINED_VALUE : UNKNOWN_VALUE;
  }
  if (isNodeOfType(node, "Identifier")) {
    if (node.name === "undefined" && state.scopes.isGlobalReference(node)) return UNDEFINED_VALUE;
    return state.bindings.get(node.name) ?? UNKNOWN_VALUE;
  }
  if (isNodeOfType(node, "MemberExpression")) {
    const objectValue = evaluateExpression(node.object, state);
    if (
      (objectValue.kind === "empty-array" || objectValue.kind === "empty-object") &&
      node.computed &&
      isNodeOfType(node.property, "Literal") &&
      (typeof node.property.value === "number" ||
        (typeof node.property.value === "string" && /^\d+$/.test(node.property.value)))
    ) {
      return UNDEFINED_VALUE;
    }
    const propertyName = getStaticPropertyName(node);
    if (propertyName === null) return UNKNOWN_VALUE;
    if (objectValue.kind === "props") {
      if (propertyName === state.propName) {
        return state.emptyLiteralKind === "array" ? EMPTY_ARRAY_VALUE : EMPTY_OBJECT_VALUE;
      }
      return { kind: "symbol", value: `prop:${propertyName}` };
    }
    if (objectValue.kind === "empty-array" && propertyName === "length") {
      return { kind: "number", value: 0 };
    }
    if (objectValue.kind === "empty-object" && !OBJECT_PROTOTYPE_PROPERTY_NAMES.has(propertyName)) {
      return UNDEFINED_VALUE;
    }
    return UNKNOWN_VALUE;
  }
  if (isNodeOfType(node, "UnaryExpression") && node.operator === "!") {
    const argument = evaluateExpression(node.argument, state);
    return argument.kind === "boolean" ? booleanValue(argument.value !== true) : UNKNOWN_VALUE;
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    const left = evaluateExpression(node.left, state);
    if (left.kind !== "boolean") return UNKNOWN_VALUE;
    if (node.operator === "&&") {
      return left.value === false ? FALSE_VALUE : evaluateExpression(node.right, state);
    }
    if (node.operator === "||") {
      return left.value === true ? TRUE_VALUE : evaluateExpression(node.right, state);
    }
    return UNKNOWN_VALUE;
  }
  if (isNodeOfType(node, "BinaryExpression")) {
    const left = evaluateExpression(node.left, state);
    const right = evaluateExpression(node.right, state);
    if (["===", "==", "!==", "!="].includes(node.operator)) {
      const equality = evaluateEquality(left, right, state.emptyReferencesAreEqual);
      if (equality === null) return UNKNOWN_VALUE;
      return booleanValue(node.operator === "!==" || node.operator === "!=" ? !equality : equality);
    }
    if (left.kind !== "number" || right.kind !== "number") return UNKNOWN_VALUE;
    if (node.operator === "<") return booleanValue(Number(left.value) < Number(right.value));
    if (node.operator === "<=") return booleanValue(Number(left.value) <= Number(right.value));
    if (node.operator === ">") return booleanValue(Number(left.value) > Number(right.value));
    if (node.operator === ">=") return booleanValue(Number(left.value) >= Number(right.value));
    return UNKNOWN_VALUE;
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    const test = evaluateExpression(node.test, state);
    if (test.kind !== "boolean") return UNKNOWN_VALUE;
    return evaluateExpression(test.value === true ? node.consequent : node.alternate, state);
  }
  if (!isNodeOfType(node, "CallExpression")) return UNKNOWN_VALUE;

  const callee = stripParenExpression(node.callee);
  if (isNodeOfType(callee, "MemberExpression")) {
    const receiver = evaluateExpression(callee.object, state);
    const methodName = getStaticPropertyName(callee);
    const callback = node.arguments[0];
    if (
      receiver.kind === "empty-array" &&
      (methodName === "every" || methodName === "some") &&
      callback &&
      !isNodeOfType(callback, "SpreadElement") &&
      isProvablyCallable(callback, state)
    ) {
      return methodName === "every" ? TRUE_VALUE : FALSE_VALUE;
    }
    if (
      isNodeOfType(callee.object, "Identifier") &&
      callee.object.name === "Object" &&
      state.scopes.isGlobalReference(callee.object) &&
      (methodName === "keys" || methodName === "values") &&
      node.arguments.length === 1 &&
      !isNodeOfType(node.arguments[0], "SpreadElement")
    ) {
      const argument = evaluateExpression(node.arguments[0], state);
      if (argument.kind === "empty-object") return EMPTY_ARRAY_VALUE;
    }
    return UNKNOWN_VALUE;
  }

  if (!isNodeOfType(callee, "Identifier")) return UNKNOWN_VALUE;
  const localFunction = resolveExactLocalFunction(callee, state.scopes);
  if (
    !isFunctionLike(localFunction) ||
    localFunction.async ||
    localFunction.generator ||
    state.activeFunctions.has(localFunction)
  ) {
    return UNKNOWN_VALUE;
  }
  const returnedExpression = getReturnedExpression(localFunction);
  if (!returnedExpression) return UNKNOWN_VALUE;
  const parameters = localFunction.params ?? [];
  if (parameters.length !== node.arguments.length) return UNKNOWN_VALUE;
  const bindings = new Map(state.bindings);
  for (const [parameterIndex, parameter] of parameters.entries()) {
    const argument = node.arguments[parameterIndex];
    if (
      !isNodeOfType(parameter, "Identifier") ||
      !argument ||
      isNodeOfType(argument, "SpreadElement")
    ) {
      return UNKNOWN_VALUE;
    }
    bindings.set(parameter.name, evaluateExpression(argument, state));
  }
  return evaluateExpression(returnedExpression, {
    ...state,
    activeFunctions: new Set([...state.activeFunctions, localFunction]),
    bindings,
  });
};

export const comparatorProvesEmptyPropDoesNotBreakMemo = (
  comparatorExpression: EsTreeNode,
  propName: string,
  emptyLiteralKind: "array" | "object",
  scopes: ScopeAnalysis,
): boolean => {
  const comparator = resolveExactLocalFunction(comparatorExpression, scopes);
  if (!isFunctionLike(comparator) || comparator.async || comparator.generator) return false;
  const returnedExpression = getReturnedExpression(comparator);
  if (!returnedExpression) return false;
  const parameters = comparator.params ?? [];
  if (
    parameters.length !== 2 ||
    !isNodeOfType(parameters[0], "Identifier") ||
    !isNodeOfType(parameters[1], "Identifier")
  ) {
    return false;
  }
  const bindings = new Map<string, ComparatorAbstractValue>([
    [parameters[0].name, PROPS_VALUE],
    [parameters[1].name, PROPS_VALUE],
  ]);
  const evaluateComparator = (emptyReferencesAreEqual: boolean): ComparatorAbstractValue =>
    evaluateExpression(returnedExpression, {
      activeFunctions: new Set([comparator]),
      bindings,
      emptyLiteralKind,
      emptyReferencesAreEqual,
      propName,
      scopes,
    });
  const distinctReferenceResult = evaluateComparator(false);
  if (distinctReferenceResult.kind !== "boolean") return false;
  if (distinctReferenceResult.value === true) return true;
  const sharedReferenceResult = evaluateComparator(true);
  return sharedReferenceResult.kind === "boolean" && sharedReferenceResult.value === false;
};
