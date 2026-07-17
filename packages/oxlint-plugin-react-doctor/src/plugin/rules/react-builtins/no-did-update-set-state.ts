import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../utils/find-enclosing-class.js";
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

const getStateSourcePath = (
  node: EsTreeNode,
  previousSourceDomains: ReadonlyMap<string, string>,
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
  const domain = previousSourceDomains.get(currentNode.name);
  return domain ? { domain, members, source: "previous" } : null;
};

const haveMatchingStateSourcePaths = (left: StateSourcePath, right: StateSourcePath): boolean =>
  left.domain === right.domain &&
  left.members.length === right.members.length &&
  left.members.every((member, index) => member === right.members[index]);

const collectConjunctiveStateSourceComparisons = (
  test: EsTreeNode,
  previousSourceDomains: ReadonlyMap<string, string>,
  comparisons: StateSourceComparison[],
): void => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
    collectConjunctiveStateSourceComparisons(
      expression.left as EsTreeNode,
      previousSourceDomains,
      comparisons,
    );
    collectConjunctiveStateSourceComparisons(
      expression.right as EsTreeNode,
      previousSourceDomains,
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
  const leftPath = getStateSourcePath(expression.left as EsTreeNode, previousSourceDomains);
  const rightPath = getStateSourcePath(expression.right as EsTreeNode, previousSourceDomains);
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
  previousSourceDomains: ReadonlyMap<string, string>,
): boolean => {
  const comparisons: StateSourceComparison[] = [];
  collectConjunctiveStateSourceComparisons(test, previousSourceDomains, comparisons);
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
    !isNodeOfType(stripParenExpression(unwrappedNode.object as EsTreeNode), "ThisExpression")
  ) {
    return null;
  }
  return getStaticMemberName(unwrappedNode);
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

const getCallbackRefAssignedField = (
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const parameters = (callback as { params?: EsTreeNode[] }).params ?? [];
  const firstParameter = parameters[0];
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return null;
  const parameterSymbolId = scopes.symbolFor(firstParameter)?.id;
  if (parameterSymbolId === undefined) return null;
  const body = (callback as { body?: EsTreeNode }).body;
  if (!body) return null;
  let assignedFieldName: string | null = null;
  walkAst(body, (node) => {
    if (node !== body && (FUNCTION_NODE_TYPES.has(node.type) || CLASS_NODE_TYPES.has(node.type))) {
      return false;
    }
    if (
      !isNodeOfType(node, "AssignmentExpression") ||
      node.operator !== "=" ||
      !isDirectRefParameterValue(node.right as EsTreeNode, parameterSymbolId, scopes)
    ) {
      return;
    }
    const fieldName = getThisFieldName(node.left as EsTreeNode);
    if (fieldName) assignedFieldName = fieldName;
  });
  return assignedFieldName;
};

const getClassMemberCallback = (classNode: EsTreeNode, memberName: string): EsTreeNode | null => {
  const classBody = (classNode as { body?: { body?: EsTreeNode[] } }).body?.body ?? [];
  for (const member of classBody) {
    if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) {
      continue;
    }
    const key = member.key as EsTreeNode;
    const keyName =
      (isNodeOfType(key, "Identifier") && key.name) ||
      (isNodeOfType(key, "Literal") && typeof key.value === "string" && key.value) ||
      null;
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
    const fieldName = getCallbackRefAssignedField(unwrappedExpression, scopes);
    if (fieldName) fieldNames.add(fieldName);
    return;
  }
  const handlerName = getThisFieldName(unwrappedExpression);
  if (handlerName) {
    const callback = getClassMemberCallback(classNode, handlerName);
    const fieldName = callback && getCallbackRefAssignedField(callback, scopes);
    if (fieldName) fieldNames.add(fieldName);
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
): boolean => {
  let qualifies = false;
  walkAst(test, (node) => {
    if (qualifies) return false;
    if (!isNodeOfType(node, "BinaryExpression") || !DIFFERENCE_OPERATORS.has(node.operator)) {
      return;
    }
    const leftFieldName = getThisStateFieldName(node.left as EsTreeNode);
    const rightFieldName = getThisStateFieldName(node.right as EsTreeNode);
    const fieldName = leftFieldName ?? rightFieldName;
    const comparedValue = leftFieldName ? (node.right as EsTreeNode) : (node.left as EsTreeNode);
    if (!fieldName || (!leftFieldName && !rightFieldName)) return;
    const assignedValue = getSetStateFieldValue(setStateCall, fieldName);
    if (!assignedValue || !areExpressionsStructurallyEqual(comparedValue, assignedValue)) return;
    if (
      !isUndefinedIdentifier(comparedValue) &&
      !derivesFromPostMountValue(comparedValue, localInitializers, callbackRefFieldNames)
    ) {
      return;
    }
    qualifies = true;
    return false;
  });
  return qualifies;
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
): boolean => {
  const expression = stripParenExpression(test);
  if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
    return (
      isDiffGuardTest(expression.left as EsTreeNode, paramNames, derivedNames) ||
      isDiffGuardTest(expression.right as EsTreeNode, paramNames, derivedNames)
    );
  }
  if (
    !isNodeOfType(expression, "BinaryExpression") ||
    !DIFFERENCE_OPERATORS.has(expression.operator)
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
  const previousSourceDomains = new Map<string, string>();
  const [previousPropsParameter, previousStateParameter] = parameters;
  if (isNodeOfType(previousPropsParameter, "Identifier")) {
    previousSourceDomains.set(previousPropsParameter.name, "props");
  }
  if (isNodeOfType(previousStateParameter, "Identifier")) {
    previousSourceDomains.set(previousStateParameter.name, "state");
  }
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
    const guardTest =
      (isNodeOfType(ancestor, "IfStatement") && child !== ancestor.test && ancestor.test) ||
      (isNodeOfType(ancestor, "ConditionalExpression") &&
        child !== ancestor.test &&
        ancestor.test) ||
      (isNodeOfType(ancestor, "LogicalExpression") &&
        ancestor.operator === "&&" &&
        child === ancestor.right &&
        ancestor.left) ||
      null;
    if (
      guardTest &&
      (isDiffGuardTest(guardTest, paramNames, derivedNames) ||
        isHistoricalToCurrentTransitionGuard(guardTest, previousSourceDomains) ||
        isConvergentPostMountGuard(
          guardTest,
          setStateCall,
          localInitializers,
          callbackRefFieldNames,
        ) ||
        isConvergentUndefinedClearGuard(guardTest, setStateCall))
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
