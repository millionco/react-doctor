import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../utils/find-enclosing-class.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getPropertyKeyName } from "../../utils/get-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isSetStateCallInLifecycle } from "../../utils/is-set-state-in-lifecycle.js";
import { readsPostMountValue } from "../../utils/reads-post-mount-value.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const LIFECYCLE_NAMES = new Set(["componentDidUpdate"]);
const MESSAGE =
  "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.";

const DIFFERENCE_OPERATORS = new Set(["!=", "!=="]);
const EQUALITY_OPERATORS = new Set(["==", "===", "!=", "!=="]);
const FUNCTION_NODE_TYPES = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
const CLASS_NODE_TYPES = new Set<string>(["ClassDeclaration", "ClassExpression"]);
const callbackRefFieldNamesByClass = new WeakMap<EsTreeNode, ReadonlySet<string>>();

const isLifecycleMethodFunction = (node: EsTreeNode): boolean => {
  if (!FUNCTION_NODE_TYPES.has(node.type)) return false;
  const parent = node.parent;
  if (
    !parent ||
    (!isNodeOfType(parent, "MethodDefinition") &&
      !isNodeOfType(parent, "Property") &&
      !isNodeOfType(parent, "PropertyDefinition"))
  ) {
    return false;
  }
  const key = (parent as { key?: EsTreeNode }).key;
  if (!key) return false;
  if (isNodeOfType(key, "Identifier")) return LIFECYCLE_NAMES.has(key.name);
  if (isNodeOfType(key, "Literal") && typeof key.value === "string") {
    return LIFECYCLE_NAMES.has(key.value);
  }
  return false;
};

const findEnclosingLifecycleFunction = (setStateCall: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = setStateCall.parent;
  while (ancestor) {
    if (isLifecycleMethodFunction(ancestor)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const isThisStateOrPropsMember = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  isNodeOfType(node.object, "ThisExpression") &&
  isNodeOfType(node.property, "Identifier") &&
  (node.property.name === "state" || node.property.name === "props");

const containsThisStateOrProps = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (isThisStateOrPropsMember(child)) {
      found = true;
      return false;
    }
  });
  return found;
};

const referencesAnyName = (node: EsTreeNode, names: ReadonlySet<string>): boolean => {
  if (names.size === 0) return false;
  const referenced = new Set<string>();
  collectReferenceIdentifierNames(node, referenced);
  for (const name of names) {
    if (referenced.has(name)) return true;
  }
  return false;
};

// Locals initialized from a lifecycle parameter (`prevProps` / `prevState` /
// snapshot) or from `this.state` / `this.props` — e.g.
// `const { isKeyboardOpen: wasKeyboardOpen } = prevState.keyboard`.
const collectDiffSourceLocalNames = (
  lifecycleFunction: EsTreeNode,
  paramNames: ReadonlySet<string>,
): Set<string> => {
  const derivedNames = new Set<string>();
  const body = (lifecycleFunction as { body?: EsTreeNode }).body;
  if (!body) return derivedNames;
  walkAst(body, (node) => {
    if (FUNCTION_NODE_TYPES.has(node.type) && !isImmediatelyInvokedFunction(node)) return false;
    if (!isNodeOfType(node, "VariableDeclarator")) return;
    const init = node.init;
    if (!init) return;
    if (
      !referencesAnyName(init, paramNames) &&
      !referencesAnyName(init, derivedNames) &&
      !containsThisStateOrProps(init)
    ) {
      return;
    }
    collectPatternNames(node.id, derivedNames);
  });
  return derivedNames;
};

const isStatefulOperand = (
  node: EsTreeNode,
  paramNames: ReadonlySet<string>,
  derivedNames: ReadonlySet<string>,
): boolean =>
  referencesAnyName(node, paramNames) ||
  referencesAnyName(node, derivedNames) ||
  containsThisStateOrProps(node);

const getStaticMemberName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "MemberExpression") || node.computed === true) return null;
  return isNodeOfType(node.property, "Identifier") ? node.property.name : null;
};

const getMemberIdentity = (property: EsTreeNode): string | null => {
  const propertyName = getPropertyKeyName(property);
  if (propertyName !== undefined) {
    return isNodeOfType(property, "PrivateIdentifier") ? `#${propertyName}` : propertyName;
  }
  return isNodeOfType(property, "Literal") && typeof property.value === "string"
    ? property.value
    : null;
};

interface StateSourcePath {
  domain: string;
  members: string[];
  source: "current" | "previous";
}

interface StateSourceComparison {
  comparedValue: EsTreeNode;
  isDifference: boolean;
  path: StateSourcePath;
}

const collectPreviousSourcePaths = (
  pattern: EsTreeNode | null | undefined,
  domain: string,
  members: ReadonlyArray<string>,
  previousSourcePaths: Map<string, StateSourcePath>,
): void => {
  if (!pattern) return;
  const unwrappedPattern = stripParenExpression(pattern);
  if (isNodeOfType(unwrappedPattern, "Identifier")) {
    previousSourcePaths.set(unwrappedPattern.name, {
      domain,
      members: [...members],
      source: "previous",
    });
    return;
  }
  if (isNodeOfType(unwrappedPattern, "AssignmentPattern")) {
    collectPreviousSourcePaths(unwrappedPattern.left, domain, members, previousSourcePaths);
    return;
  }
  if (!isNodeOfType(unwrappedPattern, "ObjectPattern")) return;
  for (const property of unwrappedPattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) continue;
    collectPreviousSourcePaths(
      property.value,
      domain,
      [...members, propertyName],
      previousSourcePaths,
    );
  }
};

const getStateSourcePath = (
  node: EsTreeNode,
  previousSourcePaths: ReadonlyMap<string, StateSourcePath>,
): StateSourcePath | null => {
  let currentNode = stripParenExpression(node);
  const members: string[] = [];
  while (isNodeOfType(currentNode, "MemberExpression")) {
    const memberName = getStaticMemberName(currentNode);
    if (!memberName) return null;
    members.unshift(memberName);
    currentNode = stripParenExpression(currentNode.object as EsTreeNode);
  }
  if (isNodeOfType(currentNode, "ThisExpression")) {
    const [domain, ...pathMembers] = members;
    if (domain !== "props" && domain !== "state") return null;
    return { domain, members: pathMembers, source: "current" };
  }
  if (!isNodeOfType(currentNode, "Identifier")) return null;
  const previousSourcePath = previousSourcePaths.get(currentNode.name);
  return previousSourcePath
    ? {
        ...previousSourcePath,
        members: [...previousSourcePath.members, ...members],
      }
    : null;
};

const haveMatchingStateSourcePaths = (left: StateSourcePath, right: StateSourcePath): boolean =>
  left.domain === right.domain &&
  left.members.length === right.members.length &&
  left.members.every((member, index) => member === right.members[index]);

const collectConjunctiveStateSourceComparisons = (
  test: EsTreeNode,
  previousSourcePaths: ReadonlyMap<string, StateSourcePath>,
  comparisons: StateSourceComparison[],
): void => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
    collectConjunctiveStateSourceComparisons(
      expression.left as EsTreeNode,
      previousSourcePaths,
      comparisons,
    );
    collectConjunctiveStateSourceComparisons(
      expression.right as EsTreeNode,
      previousSourcePaths,
      comparisons,
    );
    return;
  }
  if (
    !isNodeOfType(expression, "BinaryExpression") ||
    !EQUALITY_OPERATORS.has(expression.operator)
  ) {
    return;
  }
  const leftPath = getStateSourcePath(expression.left as EsTreeNode, previousSourcePaths);
  const rightPath = getStateSourcePath(expression.right as EsTreeNode, previousSourcePaths);
  if (Boolean(leftPath) === Boolean(rightPath)) return;
  const path = leftPath ?? rightPath;
  if (!path) return;
  comparisons.push({
    comparedValue: (leftPath ? expression.right : expression.left) as EsTreeNode,
    isDifference: DIFFERENCE_OPERATORS.has(expression.operator),
    path,
  });
};

const isHistoricalToCurrentTransitionGuard = (
  test: EsTreeNode,
  previousSourcePaths: ReadonlyMap<string, StateSourcePath>,
): boolean => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "||") {
    return (
      isHistoricalToCurrentTransitionGuard(expression.left as EsTreeNode, previousSourcePaths) &&
      isHistoricalToCurrentTransitionGuard(expression.right as EsTreeNode, previousSourcePaths)
    );
  }
  const comparisons: StateSourceComparison[] = [];
  collectConjunctiveStateSourceComparisons(expression, previousSourcePaths, comparisons);
  return comparisons.some((comparison, index) =>
    comparisons
      .slice(index + 1)
      .some(
        (candidate) =>
          comparison.path.source !== candidate.path.source &&
          comparison.isDifference !== candidate.isDifference &&
          haveMatchingStateSourcePaths(comparison.path, candidate.path) &&
          areExpressionsStructurallyEqual(comparison.comparedValue, candidate.comparedValue),
      ),
  );
};

const getThisFieldName = (node: EsTreeNode): string | null => {
  const unwrappedNode = stripParenExpression(node);
  if (
    !isNodeOfType(unwrappedNode, "MemberExpression") ||
    unwrappedNode.computed === true ||
    !isNodeOfType(stripParenExpression(unwrappedNode.object as EsTreeNode), "ThisExpression")
  ) {
    return null;
  }
  return getMemberIdentity(unwrappedNode.property);
};

const isUndefinedIdentifier = (node: EsTreeNode): boolean => {
  const unwrappedNode = stripParenExpression(node);
  return isNodeOfType(unwrappedNode, "Identifier") && unwrappedNode.name === "undefined";
};

const isDirectRefParameterValue = (
  node: EsTreeNode,
  parameterSymbolId: number,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedNode = stripParenExpression(node);
  if (isNodeOfType(unwrappedNode, "Identifier")) {
    return scopes.symbolFor(unwrappedNode)?.id === parameterSymbolId;
  }
  if (!isNodeOfType(unwrappedNode, "LogicalExpression") || unwrappedNode.operator !== "??") {
    return false;
  }
  const left = stripParenExpression(unwrappedNode.left as EsTreeNode);
  return (
    isNodeOfType(left, "Identifier") &&
    scopes.symbolFor(left)?.id === parameterSymbolId &&
    isUndefinedIdentifier(unwrappedNode.right as EsTreeNode)
  );
};

const getCallbackRefAssignedFields = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlySet<string> => {
  const parameters = (callback as { params?: EsTreeNode[] }).params ?? [];
  const firstParameter = parameters[0];
  if (!firstParameter) return new Set();
  const parameterIdentifier = isNodeOfType(firstParameter, "AssignmentPattern")
    ? firstParameter.left
    : firstParameter;
  if (!isNodeOfType(parameterIdentifier, "Identifier")) return new Set();
  const parameterSymbolId = scopes.symbolFor(parameterIdentifier)?.id;
  if (parameterSymbolId === undefined) return new Set();
  const body = (callback as { body?: EsTreeNode }).body;
  if (!body) return new Set();
  const assignedFieldNames = new Set<string>();
  walkAst(body, (node) => {
    if (
      node !== body &&
      ((FUNCTION_NODE_TYPES.has(node.type) && !isImmediatelyInvokedFunction(node)) ||
        CLASS_NODE_TYPES.has(node.type))
    ) {
      return false;
    }
    const assignmentTarget =
      (isNodeOfType(node, "AssignmentExpression") && (node.left as EsTreeNode)) ||
      (isNodeOfType(node, "UpdateExpression") && (node.argument as EsTreeNode)) ||
      (isNodeOfType(node, "UnaryExpression") &&
        node.operator === "delete" &&
        (node.argument as EsTreeNode)) ||
      null;
    if (!assignmentTarget) return;
    const fieldName = getThisFieldName(assignmentTarget);
    if (!fieldName) return;
    if (
      isNodeOfType(node, "AssignmentExpression") &&
      node.operator === "=" &&
      isDirectRefParameterValue(node.right as EsTreeNode, parameterSymbolId, scopes)
    ) {
      assignedFieldNames.add(fieldName);
      return;
    }
    assignedFieldNames.delete(fieldName);
  });
  return assignedFieldNames;
};

const getClassMemberCallback = (classNode: EsTreeNode, memberName: string): EsTreeNode | null => {
  const classBody = (classNode as { body?: { body?: EsTreeNode[] } }).body?.body ?? [];
  for (const member of classBody) {
    if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) {
      continue;
    }
    if (member.static === true) continue;
    const key = member.key as EsTreeNode;
    const keyName = getMemberIdentity(key);
    if (keyName !== memberName) continue;
    const value = member.value as EsTreeNode | null | undefined;
    return value && FUNCTION_NODE_TYPES.has(value.type) ? value : null;
  }
  return null;
};

const collectCallbackRefFieldsFromExpression = (
  expression: EsTreeNode,
  classNode: EsTreeNode,
  fieldNames: Set<string>,
  scopes: ScopeAnalysis,
): void => {
  const unwrappedExpression = stripParenExpression(expression);
  if (FUNCTION_NODE_TYPES.has(unwrappedExpression.type)) {
    for (const fieldName of getCallbackRefAssignedFields(unwrappedExpression, scopes)) {
      fieldNames.add(fieldName);
    }
    return;
  }
  const handlerName = getThisFieldName(unwrappedExpression);
  if (handlerName) {
    const callback = getClassMemberCallback(classNode, handlerName);
    if (callback) {
      for (const fieldName of getCallbackRefAssignedFields(callback, scopes)) {
        fieldNames.add(fieldName);
      }
    }
    return;
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    collectCallbackRefFieldsFromExpression(
      unwrappedExpression.consequent as EsTreeNode,
      classNode,
      fieldNames,
      scopes,
    );
    collectCallbackRefFieldsFromExpression(
      unwrappedExpression.alternate as EsTreeNode,
      classNode,
      fieldNames,
      scopes,
    );
    return;
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    if (unwrappedExpression.operator !== "&&") {
      collectCallbackRefFieldsFromExpression(
        unwrappedExpression.left as EsTreeNode,
        classNode,
        fieldNames,
        scopes,
      );
    }
    collectCallbackRefFieldsFromExpression(
      unwrappedExpression.right as EsTreeNode,
      classNode,
      fieldNames,
      scopes,
    );
  }
};

const getCallbackRefFieldNames = (
  classNode: EsTreeNode | null,
  scopes: ScopeAnalysis,
): ReadonlySet<string> => {
  if (!classNode) return new Set();
  const cachedFieldNames = callbackRefFieldNamesByClass.get(classNode);
  if (cachedFieldNames) return cachedFieldNames;
  const fieldNames = new Set<string>();
  const classBody = (classNode as { body?: EsTreeNode }).body;
  if (classBody) {
    walkAst(classBody, (node) => {
      if (node !== classBody && CLASS_NODE_TYPES.has(node.type)) return false;
      if (
        !isNodeOfType(node, "JSXAttribute") ||
        !isNodeOfType(node.name, "JSXIdentifier") ||
        node.name.name !== "ref" ||
        !node.value ||
        !isNodeOfType(node.value, "JSXExpressionContainer") ||
        !node.value.expression
      ) {
        return;
      }
      collectCallbackRefFieldsFromExpression(
        node.value.expression as EsTreeNode,
        classNode,
        fieldNames,
        scopes,
      );
    });
  }
  callbackRefFieldNamesByClass.set(classNode, fieldNames);
  return fieldNames;
};

const collectLifecycleWrittenFieldNames = (lifecycleFunction: EsTreeNode): ReadonlySet<string> => {
  const fieldNames = new Set<string>();
  const body = (lifecycleFunction as { body?: EsTreeNode }).body;
  if (!body) return fieldNames;
  walkAst(body, (node) => {
    if (FUNCTION_NODE_TYPES.has(node.type) && !isImmediatelyInvokedFunction(node)) return false;
    const target =
      (isNodeOfType(node, "AssignmentExpression") && (node.left as EsTreeNode)) ||
      (isNodeOfType(node, "UpdateExpression") && (node.argument as EsTreeNode)) ||
      null;
    if (!target) return;
    const fieldName = getThisFieldName(target);
    if (fieldName) fieldNames.add(fieldName);
  });
  return fieldNames;
};

const getThisStateFieldName = (node: EsTreeNode): string | null => {
  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "MemberExpression")) return null;
  const object = stripParenExpression(unwrappedNode.object as EsTreeNode);
  if (
    !isNodeOfType(object, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(object.object as EsTreeNode), "ThisExpression") ||
    getStaticMemberName(object) !== "state"
  ) {
    return null;
  }
  return getStaticMemberName(unwrappedNode);
};

const collectLocalInitializers = (lifecycleFunction: EsTreeNode): Map<string, EsTreeNode> => {
  const initializers = new Map<string, EsTreeNode>();
  const body = (lifecycleFunction as { body?: EsTreeNode }).body;
  if (!body) return initializers;
  walkAst(body, (node) => {
    if (FUNCTION_NODE_TYPES.has(node.type) && !isImmediatelyInvokedFunction(node)) return false;
    if (
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "Identifier") &&
      node.init
    ) {
      initializers.set(node.id.name, node.init as EsTreeNode);
    }
  });
  return initializers;
};

const derivesFromPostMountValue = (
  node: EsTreeNode,
  localInitializers: ReadonlyMap<string, EsTreeNode>,
  callbackRefFieldNames: ReadonlySet<string>,
  visitedNames: ReadonlySet<string> = new Set(),
): boolean => {
  if (readsPostMountValue(node)) return true;
  const fieldName = getThisFieldName(node);
  if (fieldName && callbackRefFieldNames.has(fieldName)) return true;
  const referencedNames = new Set<string>();
  collectReferenceIdentifierNames(node, referencedNames);
  for (const referencedName of referencedNames) {
    if (visitedNames.has(referencedName)) continue;
    const initializer = localInitializers.get(referencedName);
    if (!initializer) continue;
    const nextVisitedNames = new Set([...visitedNames, referencedName]);
    if (
      derivesFromPostMountValue(
        initializer,
        localInitializers,
        callbackRefFieldNames,
        nextVisitedNames,
      )
    ) {
      return true;
    }
  }
  return false;
};

const getSetStateFieldValue = (setStateCall: EsTreeNode, fieldName: string): EsTreeNode | null => {
  if (!isNodeOfType(setStateCall, "CallExpression")) return null;
  const argument = setStateCall.arguments?.[0];
  if (!argument || !isNodeOfType(argument, "ObjectExpression")) return null;
  for (const property of argument.properties ?? []) {
    if (!isNodeOfType(property, "Property") || property.computed === true) continue;
    const propertyName =
      (isNodeOfType(property.key, "Identifier") && property.key.name) ||
      (isNodeOfType(property.key, "Literal") &&
        typeof property.key.value === "string" &&
        property.key.value) ||
      null;
    if (propertyName === fieldName) return property.value as EsTreeNode;
  }
  return null;
};

const isConvergentPostMountGuard = (
  test: EsTreeNode,
  setStateCall: EsTreeNode,
  localInitializers: ReadonlyMap<string, EsTreeNode>,
  callbackRefFieldNames: ReadonlySet<string>,
  isTruthfulBranch: boolean,
): boolean => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator !== "&&" && expression.operator !== "||") return false;
    const leftIsConvergent = isConvergentPostMountGuard(
      expression.left as EsTreeNode,
      setStateCall,
      localInitializers,
      callbackRefFieldNames,
      isTruthfulBranch,
    );
    const rightIsConvergent = isConvergentPostMountGuard(
      expression.right as EsTreeNode,
      setStateCall,
      localInitializers,
      callbackRefFieldNames,
      isTruthfulBranch,
    );
    const requiresEveryBranch =
      (isTruthfulBranch && expression.operator === "||") ||
      (!isTruthfulBranch && expression.operator === "&&");
    return requiresEveryBranch
      ? leftIsConvergent && rightIsConvergent
      : leftIsConvergent || rightIsConvergent;
  }
  if (
    !isNodeOfType(expression, "BinaryExpression") ||
    !(isTruthfulBranch
      ? DIFFERENCE_OPERATORS.has(expression.operator)
      : EQUALITY_OPERATORS.has(expression.operator) &&
        !DIFFERENCE_OPERATORS.has(expression.operator))
  ) {
    return false;
  }
  const leftFieldName = getThisStateFieldName(expression.left as EsTreeNode);
  const rightFieldName = getThisStateFieldName(expression.right as EsTreeNode);
  const fieldName = leftFieldName ?? rightFieldName;
  const comparedValue = leftFieldName
    ? (expression.right as EsTreeNode)
    : (expression.left as EsTreeNode);
  if (!fieldName) return false;
  const assignedValue = getSetStateFieldValue(setStateCall, fieldName);
  if (!assignedValue || !areExpressionsStructurallyEqual(comparedValue, assignedValue)) {
    return false;
  }
  return (
    isUndefinedIdentifier(comparedValue) ||
    derivesFromPostMountValue(comparedValue, localInitializers, callbackRefFieldNames)
  );
};

const containsPositiveStateFieldTest = (test: EsTreeNode, fieldName: string): boolean => {
  const unwrappedTest = stripParenExpression(test);
  if (getThisStateFieldName(unwrappedTest) === fieldName) return true;
  return (
    isNodeOfType(unwrappedTest, "LogicalExpression") &&
    unwrappedTest.operator === "&&" &&
    (containsPositiveStateFieldTest(unwrappedTest.left as EsTreeNode, fieldName) ||
      containsPositiveStateFieldTest(unwrappedTest.right as EsTreeNode, fieldName))
  );
};

const isConvergentUndefinedClearGuard = (test: EsTreeNode, setStateCall: EsTreeNode): boolean => {
  if (!isNodeOfType(setStateCall, "CallExpression")) return false;
  const argument = setStateCall.arguments?.[0];
  if (!argument || !isNodeOfType(argument, "ObjectExpression")) return false;
  for (const property of argument.properties ?? []) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed === true ||
      !isUndefinedIdentifier(property.value as EsTreeNode)
    ) {
      continue;
    }
    const fieldName =
      (isNodeOfType(property.key, "Identifier") && property.key.name) ||
      (isNodeOfType(property.key, "Literal") &&
        typeof property.key.value === "string" &&
        property.key.value) ||
      null;
    if (fieldName && containsPositiveStateFieldTest(test, fieldName)) return true;
  }
  return false;
};

const isDiffGuardTest = (
  test: EsTreeNode,
  paramNames: ReadonlySet<string>,
  derivedNames: ReadonlySet<string>,
  isTruthfulBranch: boolean,
): boolean => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "LogicalExpression")) {
    if (expression.operator !== "&&" && expression.operator !== "||") return false;
    const leftIsDiffGuard = isDiffGuardTest(
      expression.left as EsTreeNode,
      paramNames,
      derivedNames,
      isTruthfulBranch,
    );
    const rightIsDiffGuard = isDiffGuardTest(
      expression.right as EsTreeNode,
      paramNames,
      derivedNames,
      isTruthfulBranch,
    );
    const requiresEveryBranch =
      (isTruthfulBranch && expression.operator === "||") ||
      (!isTruthfulBranch && expression.operator === "&&");
    return requiresEveryBranch
      ? leftIsDiffGuard && rightIsDiffGuard
      : leftIsDiffGuard || rightIsDiffGuard;
  }
  if (
    !isNodeOfType(expression, "BinaryExpression") ||
    !(isTruthfulBranch
      ? DIFFERENCE_OPERATORS.has(expression.operator)
      : EQUALITY_OPERATORS.has(expression.operator) &&
        !DIFFERENCE_OPERATORS.has(expression.operator))
  ) {
    return false;
  }
  return (
    isStatefulOperand(expression.left as EsTreeNode, paramNames, derivedNames) &&
    isStatefulOperand(expression.right as EsTreeNode, paramNames, derivedNames) &&
    (referencesAnyName(expression.left, paramNames) ||
      referencesAnyName(expression.right, paramNames) ||
      referencesAnyName(expression.left, derivedNames) ||
      referencesAnyName(expression.right, derivedNames))
  );
};

const isInsideDiffGuard = (setStateCall: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const lifecycleFunction = findEnclosingLifecycleFunction(setStateCall);
  if (!lifecycleFunction) return false;
  const paramNames = new Set<string>();
  const parameters = (lifecycleFunction as { params?: EsTreeNode[] }).params ?? [];
  for (const param of parameters) {
    collectPatternNames(param, paramNames);
  }
  const previousSourcePaths = new Map<string, StateSourcePath>();
  const [previousPropsParameter, previousStateParameter] = parameters;
  collectPreviousSourcePaths(previousPropsParameter, "props", [], previousSourcePaths);
  collectPreviousSourcePaths(previousStateParameter, "state", [], previousSourcePaths);
  const derivedNames = collectDiffSourceLocalNames(lifecycleFunction, paramNames);
  const localInitializers = collectLocalInitializers(lifecycleFunction);
  const lifecycleWrittenFieldNames = collectLifecycleWrittenFieldNames(lifecycleFunction);
  const callbackRefFieldNames = new Set(
    [...getCallbackRefFieldNames(findEnclosingClass(lifecycleFunction), scopes)].filter(
      (fieldName) => !lifecycleWrittenFieldNames.has(fieldName),
    ),
  );

  let child: EsTreeNode = setStateCall;
  let ancestor: EsTreeNode | null | undefined = setStateCall.parent;
  while (ancestor && ancestor !== lifecycleFunction) {
    let guardTest: EsTreeNode | null = null;
    let isTruthfulBranch = true;
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (child === ancestor.consequent) {
        guardTest = ancestor.test as EsTreeNode;
      } else if (child === ancestor.alternate) {
        guardTest = ancestor.test as EsTreeNode;
        isTruthfulBranch = false;
      }
    } else if (isNodeOfType(ancestor, "ConditionalExpression")) {
      if (child === ancestor.consequent) {
        guardTest = ancestor.test as EsTreeNode;
      } else if (child === ancestor.alternate) {
        guardTest = ancestor.test as EsTreeNode;
        isTruthfulBranch = false;
      }
    } else if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.operator === "&&" &&
      child === ancestor.right
    ) {
      guardTest = ancestor.left as EsTreeNode;
    }
    if (
      guardTest &&
      (isDiffGuardTest(guardTest, paramNames, derivedNames, isTruthfulBranch) ||
        (isTruthfulBranch &&
          isHistoricalToCurrentTransitionGuard(guardTest, previousSourcePaths)) ||
        isConvergentPostMountGuard(
          guardTest,
          setStateCall,
          localInitializers,
          callbackRefFieldNames,
          isTruthfulBranch,
        ) ||
        (isTruthfulBranch && isConvergentUndefinedClearGuard(guardTest, setStateCall)))
    ) {
      return true;
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

interface SettingsShape {
  mode?: "allowed" | "disallow-in-func";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<SettingsShape> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noDidUpdateSetState?: SettingsShape }).noDidUpdateSetState ?? {})
      : {};
  return { mode: ruleSettings.mode ?? "allowed" };
};

// Port of `oxc_linter::rules::react::no_did_update_set_state`. Flags
// `this.setState(...)` inside `componentDidUpdate`. With
// `mode: "disallow-in-func"`, also flags nested-function call sites.
export const noDidUpdateSetState = defineRule({
  id: "no-did-update-set-state",
  title: "setState in componentDidUpdate",
  severity: "warn",
  recommendation:
    "Setting state in `componentDidUpdate` causes another render and can loop. Use `getDerivedStateFromProps` instead.",
  create: (context) => {
    const { mode } = resolveSettings(context.settings);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        if (!isNodeOfType(stripParenExpression(node.callee.object), "ThisExpression")) return;
        if (
          !isNodeOfType(node.callee.property, "Identifier") ||
          node.callee.property.name !== "setState"
        ) {
          return;
        }
        const shouldFlag = isSetStateCallInLifecycle(node, LIFECYCLE_NAMES, {
          disallowInNestedFunctions: mode === "disallow-in-func",
        });
        if (!shouldFlag) return;
        if (isInsideDiffGuard(node, context.scopes)) return;
        context.report({ node: node.callee, message: MESSAGE });
      },
    };
  },
});
