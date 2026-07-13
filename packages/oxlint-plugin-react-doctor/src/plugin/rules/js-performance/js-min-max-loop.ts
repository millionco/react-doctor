import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { MATH_EXTREMUM_SPREAD_MAX_ELEMENT_COUNT } from "../../constants/thresholds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";

const builtinMutationByProgram = new WeakMap<EsTreeNode, Map<string, boolean>>();
const RUNTIMELESS_SYMBOL_KINDS: ReadonlySet<SymbolDescriptor["kind"]> = new Set([
  "ts-interface",
  "ts-type-alias",
]);
const PROTOTYPE_METHOD_NAMES: ReadonlySet<string> = new Set(["getPrototypeOf"]);
const OBJECT_ASSIGN_METHOD_NAMES: ReadonlySet<string> = new Set(["assign"]);
const OBJECT_DEFINE_PROPERTIES_METHOD_NAMES: ReadonlySet<string> = new Set(["defineProperties"]);
const KEYED_MUTATION_METHOD_NAMES: ReadonlySet<string> = new Set([
  "defineProperty",
  "deleteProperty",
  "set",
]);

const numericComparatorDirection = (
  comparator: EsTreeNode | undefined,
): "ascending" | "descending" | null => {
  if (!isInlineFunctionExpression(comparator) || comparator.async || comparator.generator) {
    return null;
  }
  const parameters = comparator.params ?? [];
  if (parameters.length !== 2) return null;
  const [firstParameter, secondParameter] = parameters;
  if (!isNodeOfType(firstParameter, "Identifier") || !isNodeOfType(secondParameter, "Identifier")) {
    return null;
  }
  if (firstParameter.name === secondParameter.name) return null;

  let comparisonExpression: EsTreeNode | null = null;
  const comparatorBody = stripParenExpression(comparator.body);
  if (isNodeOfType(comparatorBody, "BinaryExpression")) {
    comparisonExpression = comparatorBody;
  } else if (isNodeOfType(comparatorBody, "BlockStatement")) {
    const statements = comparatorBody.body ?? [];
    if (statements.length !== 1) return null;
    const onlyStatement = statements[0];
    if (!isNodeOfType(onlyStatement, "ReturnStatement") || !onlyStatement.argument) return null;
    comparisonExpression = stripParenExpression(onlyStatement.argument as EsTreeNode);
  }

  if (
    !comparisonExpression ||
    !isNodeOfType(comparisonExpression, "BinaryExpression") ||
    comparisonExpression.operator !== "-" ||
    !isNodeOfType(comparisonExpression.left, "Identifier") ||
    !isNodeOfType(comparisonExpression.right, "Identifier")
  ) {
    return null;
  }

  const leftName = comparisonExpression.left.name;
  const rightName = comparisonExpression.right.name;
  if (leftName === firstParameter.name && rightName === secondParameter.name) return "ascending";
  if (leftName === secondParameter.name && rightName === firstParameter.name) return "descending";
  return null;
};

const getStaticFiniteNumericValue = (expression: EsTreeNode): number | null => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Literal")) {
    return typeof strippedExpression.value === "number" && Number.isFinite(strippedExpression.value)
      ? strippedExpression.value
      : null;
  }
  if (
    !isNodeOfType(strippedExpression, "UnaryExpression") ||
    (strippedExpression.operator !== "+" && strippedExpression.operator !== "-")
  ) {
    return null;
  }
  const argumentValue = getStaticFiniteNumericValue(strippedExpression.argument);
  if (argumentValue === null) return null;
  return strippedExpression.operator === "-" ? -argumentValue : argumentValue;
};

const isSafeFreshNumericArray = (arrayExpression: EsTreeNodeOfType<"ArrayExpression">): boolean => {
  if (
    arrayExpression.elements.length === 0 ||
    arrayExpression.elements.length > MATH_EXTREMUM_SPREAD_MAX_ELEMENT_COUNT
  ) {
    return false;
  }
  let didFindPositiveZero = false;
  let didFindNegativeZero = false;
  for (const element of arrayExpression.elements) {
    if (!element || isNodeOfType(element, "SpreadElement")) return false;
    const numericValue = getStaticFiniteNumericValue(element);
    if (numericValue === null) return false;
    if (Object.is(numericValue, 0)) didFindPositiveZero = true;
    if (Object.is(numericValue, -0)) didFindNegativeZero = true;
  }
  return !(didFindPositiveZero && didFindNegativeZero);
};

const isGlobalObjectReference = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<number>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (!isNodeOfType(strippedExpression, "Identifier")) return false;
  if (
    (strippedExpression.name === "globalThis" ||
      strippedExpression.name === "window" ||
      strippedExpression.name === "self" ||
      strippedExpression.name === "global") &&
    scopes.isGlobalReference(strippedExpression)
  ) {
    return true;
  }
  const symbol = scopes.symbolFor(strippedExpression);
  if (!symbol?.initializer || symbol.kind !== "const" || visitedSymbols.has(symbol.id)) {
    return false;
  }
  visitedSymbols.add(symbol.id);
  return isGlobalObjectReference(symbol.initializer, scopes, visitedSymbols);
};

const resolvesToGlobalNamespace = (
  expression: EsTreeNode,
  namespaceName: string,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<number>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Identifier")) {
    if (strippedExpression.name === namespaceName && scopes.isGlobalReference(strippedExpression)) {
      return true;
    }
    const symbol = scopes.symbolFor(strippedExpression);
    if (!symbol?.initializer || symbol.kind !== "const" || visitedSymbols.has(symbol.id)) {
      return false;
    }
    visitedSymbols.add(symbol.id);
    return resolvesToGlobalNamespace(symbol.initializer, namespaceName, scopes, visitedSymbols);
  }
  return (
    isNodeOfType(strippedExpression, "MemberExpression") &&
    getStaticPropertyName(strippedExpression) === namespaceName &&
    isGlobalObjectReference(strippedExpression.object, scopes)
  );
};

const resolvesToGlobalMethod = (
  expression: EsTreeNode,
  namespaceName: string,
  methodNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<number>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(strippedExpression);
    if (!symbol?.initializer || symbol.kind !== "const" || visitedSymbols.has(symbol.id)) {
      return false;
    }
    visitedSymbols.add(symbol.id);
    return resolvesToGlobalMethod(
      symbol.initializer,
      namespaceName,
      methodNames,
      scopes,
      visitedSymbols,
    );
  }
  return (
    isNodeOfType(strippedExpression, "MemberExpression") &&
    methodNames.has(getStaticPropertyName(strippedExpression) ?? "") &&
    resolvesToGlobalNamespace(strippedExpression.object, namespaceName, scopes)
  );
};

const resolvesToNativeArrayPrototype = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbols = new Set<number>(),
): boolean => {
  const strippedExpression = stripParenExpression(expression);
  if (isNodeOfType(strippedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(strippedExpression);
    if (!symbol?.initializer || symbol.kind !== "const" || visitedSymbols.has(symbol.id)) {
      return false;
    }
    visitedSymbols.add(symbol.id);
    return resolvesToNativeArrayPrototype(symbol.initializer, scopes, visitedSymbols);
  }
  if (isNodeOfType(strippedExpression, "MemberExpression")) {
    const propertyName = getStaticPropertyName(strippedExpression);
    if (propertyName === "prototype") {
      return resolvesToGlobalNamespace(strippedExpression.object, "Array", scopes);
    }
    return (
      propertyName === "__proto__" &&
      isNodeOfType(stripParenExpression(strippedExpression.object), "ArrayExpression")
    );
  }
  if (!isNodeOfType(strippedExpression, "CallExpression")) return false;
  if (
    !resolvesToGlobalMethod(strippedExpression.callee, "Object", PROTOTYPE_METHOD_NAMES, scopes) &&
    !resolvesToGlobalMethod(strippedExpression.callee, "Reflect", PROTOTYPE_METHOD_NAMES, scopes)
  ) {
    return false;
  }
  const argument = strippedExpression.arguments[0];
  return Boolean(argument && isNodeOfType(stripParenExpression(argument), "ArrayExpression"));
};

const isGlobalNamespaceReplacementTarget = (
  target: EsTreeNode,
  namespaceName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const strippedTarget = stripParenExpression(target);
  if (isNodeOfType(strippedTarget, "Identifier")) {
    return strippedTarget.name === namespaceName && scopes.isGlobalReference(strippedTarget);
  }
  return (
    isNodeOfType(strippedTarget, "MemberExpression") &&
    getStaticPropertyName(strippedTarget) === namespaceName &&
    isGlobalObjectReference(strippedTarget.object, scopes)
  );
};

const isUnsafeBuiltinMemberTarget = (
  target: EsTreeNode,
  targetFunction: string,
  scopes: ScopeAnalysis,
): boolean => {
  const strippedTarget = stripParenExpression(target);
  if (!isNodeOfType(strippedTarget, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(strippedTarget);
  if (resolvesToNativeArrayPrototype(strippedTarget.object, scopes)) {
    return propertyName === null || propertyName === "sort";
  }
  if (resolvesToGlobalNamespace(strippedTarget.object, "Math", scopes)) {
    return propertyName === null || propertyName === targetFunction;
  }
  return (
    isGlobalObjectReference(strippedTarget.object, scopes) &&
    (propertyName === null || propertyName === "Math")
  );
};

const isUnsafeBuiltinMutationApiCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  targetFunction: string,
  scopes: ScopeAnalysis,
): boolean => {
  const target = callExpression.arguments[0];
  if (!target) return false;
  let propertyName: string | null = null;
  if (resolvesToNativeArrayPrototype(target, scopes)) {
    propertyName = "sort";
  } else if (resolvesToGlobalNamespace(target, "Math", scopes)) {
    propertyName = targetFunction;
  } else if (isGlobalObjectReference(target, scopes)) {
    propertyName = "Math";
  }
  if (!propertyName) return false;
  const canObjectExpressionSetProperty = (properties: EsTreeNode): boolean => {
    if (!isNodeOfType(properties, "ObjectExpression")) return true;
    return properties.properties.some((property) => {
      if (isNodeOfType(property, "SpreadElement")) return true;
      const keyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      return keyName === propertyName || keyName === null;
    });
  };
  if (resolvesToGlobalMethod(callExpression.callee, "Object", OBJECT_ASSIGN_METHOD_NAMES, scopes)) {
    return callExpression.arguments
      .slice(1)
      .some((properties) => canObjectExpressionSetProperty(properties));
  }
  if (
    resolvesToGlobalMethod(
      callExpression.callee,
      "Object",
      OBJECT_DEFINE_PROPERTIES_METHOD_NAMES,
      scopes,
    )
  ) {
    const properties = callExpression.arguments[1];
    return !properties || canObjectExpressionSetProperty(properties);
  }
  if (
    !resolvesToGlobalMethod(callExpression.callee, "Object", KEYED_MUTATION_METHOD_NAMES, scopes) &&
    !resolvesToGlobalMethod(callExpression.callee, "Reflect", KEYED_MUTATION_METHOD_NAMES, scopes)
  ) {
    return false;
  }
  const propertyArgument = callExpression.arguments[1];
  if (!propertyArgument) return true;
  return isNodeOfType(propertyArgument, "Literal") ? propertyArgument.value === propertyName : true;
};

const hasUnsafeBuiltinMutation = (
  node: EsTreeNode,
  targetFunction: string,
  scopes: ScopeAnalysis,
): boolean => {
  const programRoot = findProgramRoot(node);
  if (!programRoot) return true;
  let mutationByTargetFunction = builtinMutationByProgram.get(programRoot);
  if (!mutationByTargetFunction) {
    mutationByTargetFunction = new Map();
    builtinMutationByProgram.set(programRoot, mutationByTargetFunction);
  }
  const cachedResult = mutationByTargetFunction.get(targetFunction);
  if (cachedResult !== undefined) return cachedResult;
  let didFindUnsafeMutation = false;
  walkAst(programRoot, (candidate) => {
    if (didFindUnsafeMutation) return false;
    if (isNodeOfType(candidate, "CallExpression")) {
      didFindUnsafeMutation = isUnsafeBuiltinMutationApiCall(candidate, targetFunction, scopes);
      return;
    }
    let mutationTarget: EsTreeNode | null = null;
    if (isNodeOfType(candidate, "AssignmentExpression")) mutationTarget = candidate.left;
    if (isNodeOfType(candidate, "UpdateExpression")) mutationTarget = candidate.argument;
    if (isNodeOfType(candidate, "UnaryExpression") && candidate.operator === "delete") {
      mutationTarget = candidate.argument;
    }
    if (!mutationTarget) return;
    didFindUnsafeMutation =
      isUnsafeBuiltinMemberTarget(mutationTarget, targetFunction, scopes) ||
      isGlobalNamespaceReplacementTarget(mutationTarget, "Math", scopes);
  });
  mutationByTargetFunction.set(targetFunction, didFindUnsafeMutation);
  return didFindUnsafeMutation;
};

const hasUnsafeMathBinding = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(node);
  while (scope) {
    const symbol = scope.symbolsByName.get("Math");
    if (symbol && !RUNTIMELESS_SYMBOL_KINDS.has(symbol.kind)) {
      return !(
        symbol.kind === "const" &&
        symbol.initializer &&
        resolvesToGlobalNamespace(symbol.initializer, "Math", scopes)
      );
    }
    scope = scope.parent;
  }
  return false;
};

export const jsMinMaxLoop = defineRule({
  id: "js-min-max-loop",
  title: "sort() to find min or max",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Use `Math.min(...array)` or `Math.max(...array)` instead of sorting the whole list just to read the first or last item",
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (!node.computed) return;

      const object = node.object;
      if (!isNodeOfType(object, "CallExpression") || !isMemberProperty(object.callee, "sort"))
        return;

      const sortReceiver = stripParenExpression(object.callee.object);
      if (!isNodeOfType(sortReceiver, "ArrayExpression") || !isSafeFreshNumericArray(sortReceiver))
        return;

      const comparator = object.arguments?.[0] as EsTreeNode | undefined;
      const direction = numericComparatorDirection(comparator);
      if (!direction) return;

      const isFirstElement = isNodeOfType(node.property, "Literal") && node.property.value === 0;
      if (!isFirstElement) return;
      const targetFunction = direction === "ascending" ? "min" : "max";
      if (
        hasUnsafeMathBinding(node, context.scopes) ||
        hasUnsafeBuiltinMutation(node, targetFunction, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message: `This is slow because array.sort()[0] sorts the whole list just to grab the smallest or largest, so use Math.${targetFunction}(...array) instead`,
      });
    },
  }),
});
