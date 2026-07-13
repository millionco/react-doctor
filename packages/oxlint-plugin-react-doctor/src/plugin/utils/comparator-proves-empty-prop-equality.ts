import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { MAX_MEMO_COMPARATOR_SYMBOLIC_ATOM_COUNT } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface ComparatorAbstractValue {
  readonly kind:
    | "boolean"
    | "boolean-formula"
    | "number"
    | "string"
    | "undefined"
    | "previous-props"
    | "next-props"
    | "prop-symbol"
    | "empty-array"
    | "empty-object"
    | "symbol"
    | "unknown";
  readonly value?: boolean | number | string;
  readonly formula?: ComparatorBooleanFormula;
  readonly referenceOrigin?: EsTreeNode | "previous-target" | "next-target";
  readonly propOwner?: "previous" | "next";
}

interface ComparatorBooleanFormula {
  readonly kind: "constant" | "atom" | "not" | "and" | "or" | "conditional";
  readonly value?: boolean;
  readonly atomKey?: string;
  readonly operand?: ComparatorBooleanFormula;
  readonly left?: ComparatorBooleanFormula;
  readonly right?: ComparatorBooleanFormula;
  readonly test?: ComparatorBooleanFormula;
  readonly consequent?: ComparatorBooleanFormula;
  readonly alternate?: ComparatorBooleanFormula;
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
const PREVIOUS_PROPS_VALUE: ComparatorAbstractValue = { kind: "previous-props" };
const NEXT_PROPS_VALUE: ComparatorAbstractValue = { kind: "next-props" };
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

const constantBooleanFormula = (value: boolean): ComparatorBooleanFormula => ({
  kind: "constant",
  value,
});

const getBooleanFormula = (value: ComparatorAbstractValue): ComparatorBooleanFormula | null => {
  if (value.kind === "boolean") return constantBooleanFormula(value.value === true);
  return value.kind === "boolean-formula" && value.formula ? value.formula : null;
};

const booleanFormulaValue = (formula: ComparatorBooleanFormula): ComparatorAbstractValue =>
  formula.kind === "constant"
    ? booleanValue(formula.value === true)
    : { kind: "boolean-formula", formula };

const negateBooleanFormula = (formula: ComparatorBooleanFormula): ComparatorBooleanFormula => {
  if (formula.kind === "constant") return constantBooleanFormula(formula.value !== true);
  if (formula.kind === "not" && formula.operand) return formula.operand;
  return { kind: "not", operand: formula };
};

const combineBooleanFormulas = (
  operator: "and" | "or",
  left: ComparatorBooleanFormula,
  right: ComparatorBooleanFormula,
): ComparatorBooleanFormula => {
  if (left.kind === "constant") {
    if (operator === "and") return left.value === true ? right : left;
    return left.value === true ? left : right;
  }
  if (right.kind === "constant") {
    if (operator === "and") return right.value === true ? left : right;
    return right.value === true ? right : left;
  }
  return { kind: operator, left, right };
};

const conditionalBooleanFormula = (
  test: ComparatorBooleanFormula,
  consequent: ComparatorBooleanFormula,
  alternate: ComparatorBooleanFormula,
): ComparatorBooleanFormula => {
  if (test.kind === "constant") return test.value === true ? consequent : alternate;
  return { kind: "conditional", test, consequent, alternate };
};

const collectBooleanFormulaAtomKeys = (
  formula: ComparatorBooleanFormula,
  atomKeys: Set<string>,
): void => {
  if (formula.kind === "atom") {
    if (formula.atomKey) atomKeys.add(formula.atomKey);
    return;
  }
  if (formula.operand) collectBooleanFormulaAtomKeys(formula.operand, atomKeys);
  if (formula.left) collectBooleanFormulaAtomKeys(formula.left, atomKeys);
  if (formula.right) collectBooleanFormulaAtomKeys(formula.right, atomKeys);
  if (formula.test) collectBooleanFormulaAtomKeys(formula.test, atomKeys);
  if (formula.consequent) collectBooleanFormulaAtomKeys(formula.consequent, atomKeys);
  if (formula.alternate) collectBooleanFormulaAtomKeys(formula.alternate, atomKeys);
};

const evaluateBooleanFormula = (
  formula: ComparatorBooleanFormula,
  atomValues: ReadonlyMap<string, boolean>,
): boolean | null => {
  if (formula.kind === "constant") return formula.value ?? null;
  if (formula.kind === "atom")
    return formula.atomKey ? (atomValues.get(formula.atomKey) ?? null) : null;
  if (formula.kind === "not") {
    const operand = formula.operand ? evaluateBooleanFormula(formula.operand, atomValues) : null;
    return operand === null ? null : !operand;
  }
  if (formula.kind === "and" || formula.kind === "or") {
    const left = formula.left ? evaluateBooleanFormula(formula.left, atomValues) : null;
    const right = formula.right ? evaluateBooleanFormula(formula.right, atomValues) : null;
    if (left === null || right === null) return null;
    return formula.kind === "and" ? left && right : left || right;
  }
  const test = formula.test ? evaluateBooleanFormula(formula.test, atomValues) : null;
  if (test === null) return null;
  const branch = test ? formula.consequent : formula.alternate;
  return branch ? evaluateBooleanFormula(branch, atomValues) : null;
};

const couldStableTargetReferencePreventRender = (
  distinctReferenceFormula: ComparatorBooleanFormula,
  sharedReferenceFormula: ComparatorBooleanFormula,
): boolean => {
  const atomKeys = new Set<string>();
  collectBooleanFormulaAtomKeys(distinctReferenceFormula, atomKeys);
  collectBooleanFormulaAtomKeys(sharedReferenceFormula, atomKeys);
  if (atomKeys.size > MAX_MEMO_COMPARATOR_SYMBOLIC_ATOM_COUNT) return true;
  const orderedAtomKeys = [...atomKeys];
  const assignmentCount = 2 ** orderedAtomKeys.length;
  for (let assignmentIndex = 0; assignmentIndex < assignmentCount; assignmentIndex += 1) {
    const atomValues = new Map<string, boolean>();
    for (const [atomIndex, atomKey] of orderedAtomKeys.entries()) {
      atomValues.set(atomKey, Boolean(assignmentIndex & (1 << atomIndex)));
    }
    const distinctReferenceResult = evaluateBooleanFormula(distinctReferenceFormula, atomValues);
    const sharedReferenceResult = evaluateBooleanFormula(sharedReferenceFormula, atomValues);
    if (distinctReferenceResult === null || sharedReferenceResult === null) return true;
    if (!distinctReferenceResult && sharedReferenceResult) return true;
  }
  return false;
};

const emptyReferenceValue = (
  kind: "empty-array" | "empty-object",
  referenceOrigin: EsTreeNode | "previous-target" | "next-target",
): ComparatorAbstractValue => ({ kind, referenceOrigin });

const evaluateEquality = (
  left: ComparatorAbstractValue,
  right: ComparatorAbstractValue,
  emptyReferencesAreEqual: boolean,
  equalityKind: "strict" | "loose",
): ComparatorAbstractValue => {
  if (left.kind === "unknown" || right.kind === "unknown") return UNKNOWN_VALUE;
  const leftBooleanFormula = getBooleanFormula(left);
  const rightBooleanFormula = getBooleanFormula(right);
  if (leftBooleanFormula || rightBooleanFormula) {
    if (!leftBooleanFormula || !rightBooleanFormula) return UNKNOWN_VALUE;
    const bothTrue = combineBooleanFormulas("and", leftBooleanFormula, rightBooleanFormula);
    const bothFalse = combineBooleanFormulas(
      "and",
      negateBooleanFormula(leftBooleanFormula),
      negateBooleanFormula(rightBooleanFormula),
    );
    return booleanFormulaValue(combineBooleanFormulas("or", bothTrue, bothFalse));
  }
  if (left.kind === "prop-symbol" || right.kind === "prop-symbol") {
    if (left.kind !== "prop-symbol" || right.kind !== "prop-symbol") return UNKNOWN_VALUE;
    if (left.propOwner === right.propOwner && left.value === right.value) return TRUE_VALUE;
    if (left.propOwner === right.propOwner || left.value !== right.value) return UNKNOWN_VALUE;
    return booleanFormulaValue({
      kind: "atom",
      atomKey: `${equalityKind}:${String(left.value)}`,
    });
  }
  if (left.kind === "empty-array" || left.kind === "empty-object") {
    if (left.kind !== right.kind) return FALSE_VALUE;
    if (left.referenceOrigin === right.referenceOrigin) return TRUE_VALUE;
    const comparesTargetReferences =
      (left.referenceOrigin === "previous-target" && right.referenceOrigin === "next-target") ||
      (left.referenceOrigin === "next-target" && right.referenceOrigin === "previous-target");
    return booleanValue(comparesTargetReferences && emptyReferencesAreEqual);
  }
  if (right.kind === "empty-array" || right.kind === "empty-object") return FALSE_VALUE;
  if (left.kind !== right.kind) return FALSE_VALUE;
  if (left.kind === "previous-props" || left.kind === "next-props") return UNKNOWN_VALUE;
  if (left.kind === "symbol" && left.value !== right.value) return UNKNOWN_VALUE;
  return booleanValue(left.value === right.value);
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
    if (objectValue.kind === "previous-props" || objectValue.kind === "next-props") {
      if (propertyName === state.propName) {
        const referenceOrigin =
          objectValue.kind === "previous-props" ? "previous-target" : "next-target";
        return emptyReferenceValue(
          state.emptyLiteralKind === "array" ? "empty-array" : "empty-object",
          referenceOrigin,
        );
      }
      return {
        kind: "prop-symbol",
        propOwner: objectValue.kind === "previous-props" ? "previous" : "next",
        value: propertyName,
      };
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
    const argumentFormula = getBooleanFormula(argument);
    return argumentFormula
      ? booleanFormulaValue(negateBooleanFormula(argumentFormula))
      : UNKNOWN_VALUE;
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    const left = evaluateExpression(node.left, state);
    const leftFormula = getBooleanFormula(left);
    if (!leftFormula) return UNKNOWN_VALUE;
    if (node.operator === "&&") {
      if (leftFormula.kind === "constant" && leftFormula.value === false) return FALSE_VALUE;
      const rightFormula = getBooleanFormula(evaluateExpression(node.right, state));
      return rightFormula
        ? booleanFormulaValue(combineBooleanFormulas("and", leftFormula, rightFormula))
        : UNKNOWN_VALUE;
    }
    if (node.operator === "||") {
      if (leftFormula.kind === "constant" && leftFormula.value === true) return TRUE_VALUE;
      const rightFormula = getBooleanFormula(evaluateExpression(node.right, state));
      return rightFormula
        ? booleanFormulaValue(combineBooleanFormulas("or", leftFormula, rightFormula))
        : UNKNOWN_VALUE;
    }
    return UNKNOWN_VALUE;
  }
  if (isNodeOfType(node, "BinaryExpression")) {
    const left = evaluateExpression(node.left, state);
    const right = evaluateExpression(node.right, state);
    if (["===", "==", "!==", "!="].includes(node.operator)) {
      const equality = evaluateEquality(
        left,
        right,
        state.emptyReferencesAreEqual,
        node.operator === "===" || node.operator === "!==" ? "strict" : "loose",
      );
      if (node.operator === "===" || node.operator === "==") return equality;
      const equalityFormula = getBooleanFormula(equality);
      return equalityFormula
        ? booleanFormulaValue(negateBooleanFormula(equalityFormula))
        : UNKNOWN_VALUE;
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
    const testFormula = getBooleanFormula(test);
    if (!testFormula) return UNKNOWN_VALUE;
    if (testFormula.kind === "constant") {
      return evaluateExpression(
        testFormula.value === true ? node.consequent : node.alternate,
        state,
      );
    }
    const consequentFormula = getBooleanFormula(evaluateExpression(node.consequent, state));
    const alternateFormula = getBooleanFormula(evaluateExpression(node.alternate, state));
    return consequentFormula && alternateFormula
      ? booleanFormulaValue(
          conditionalBooleanFormula(testFormula, consequentFormula, alternateFormula),
        )
      : UNKNOWN_VALUE;
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
      if (argument.kind === "empty-object") return emptyReferenceValue("empty-array", node);
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
    [parameters[0].name, PREVIOUS_PROPS_VALUE],
    [parameters[1].name, NEXT_PROPS_VALUE],
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
  const distinctReferenceFormula = getBooleanFormula(evaluateComparator(false));
  const sharedReferenceFormula = getBooleanFormula(evaluateComparator(true));
  return Boolean(
    distinctReferenceFormula &&
    sharedReferenceFormula &&
    !couldStableTargetReferencePreventRender(distinctReferenceFormula, sharedReferenceFormula),
  );
};
