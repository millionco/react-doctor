import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { areExpressionsStructurallyEqual } from "../../utils/are-expressions-structurally-equal.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isSetStateCallInLifecycle } from "../../utils/is-set-state-in-lifecycle.js";
import { readsPostMountValue } from "../../utils/reads-post-mount-value.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const LIFECYCLE_NAMES = new Set(["componentDidUpdate"]);
const MESSAGE =
  "Calling setState in componentDidUpdate can trigger another update immediately, loop forever, and freeze the component.";

const EQUALITY_OPERATORS = new Set(["==", "===", "!=", "!=="]);
const FUNCTION_NODE_TYPES = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

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
  visitedNames: ReadonlySet<string> = new Set(),
): boolean => {
  if (readsPostMountValue(node)) return true;
  const referencedNames = new Set<string>();
  collectReferenceIdentifierNames(node, referencedNames);
  for (const referencedName of referencedNames) {
    if (visitedNames.has(referencedName)) continue;
    const initializer = localInitializers.get(referencedName);
    if (!initializer) continue;
    const nextVisitedNames = new Set([...visitedNames, referencedName]);
    if (derivesFromPostMountValue(initializer, localInitializers, nextVisitedNames)) return true;
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
): boolean => {
  let qualifies = false;
  walkAst(test, (node) => {
    if (qualifies) return false;
    if (!isNodeOfType(node, "BinaryExpression") || !EQUALITY_OPERATORS.has(node.operator)) return;
    const leftFieldName = getThisStateFieldName(node.left as EsTreeNode);
    const rightFieldName = getThisStateFieldName(node.right as EsTreeNode);
    const fieldName = leftFieldName ?? rightFieldName;
    const comparedValue = leftFieldName ? (node.right as EsTreeNode) : (node.left as EsTreeNode);
    if (!fieldName || (!leftFieldName && !rightFieldName)) return;
    const assignedValue = getSetStateFieldValue(setStateCall, fieldName);
    if (!assignedValue || !areExpressionsStructurallyEqual(comparedValue, assignedValue)) return;
    if (!derivesFromPostMountValue(comparedValue, localInitializers)) return;
    qualifies = true;
    return false;
  });
  return qualifies;
};

// The doc's sanctioned escape hatch: `if (prevProps.x !== this.props.x)` and
// equivalents (`snapshot.shouldUpdate`, `wasOpen !== isOpen` via locals
// destructured from prevState/this.state, `newState !== this.state`).
const isDiffGuardTest = (
  test: EsTreeNode,
  paramNames: ReadonlySet<string>,
  derivedNames: ReadonlySet<string>,
): boolean => {
  if (referencesAnyName(test, paramNames)) return true;
  let qualifies = false;
  walkAst(test, (node) => {
    if (qualifies) return false;
    if (!isNodeOfType(node, "BinaryExpression")) return;
    if (!EQUALITY_OPERATORS.has(node.operator)) return;
    if (
      isStatefulOperand(node.left, paramNames, derivedNames) &&
      isStatefulOperand(node.right, paramNames, derivedNames) &&
      (referencesAnyName(node.left, derivedNames) || referencesAnyName(node.right, derivedNames))
    ) {
      qualifies = true;
      return false;
    }
  });
  return qualifies;
};

const isInsideDiffGuard = (setStateCall: EsTreeNode): boolean => {
  const lifecycleFunction = findEnclosingLifecycleFunction(setStateCall);
  if (!lifecycleFunction) return false;
  const paramNames = new Set<string>();
  for (const param of (lifecycleFunction as { params?: EsTreeNode[] }).params ?? []) {
    collectPatternNames(param, paramNames);
  }
  const derivedNames = collectDiffSourceLocalNames(lifecycleFunction, paramNames);
  const localInitializers = collectLocalInitializers(lifecycleFunction);

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
        isConvergentPostMountGuard(guardTest, setStateCall, localInitializers))
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
        if (isInsideDiffGuard(node)) return;
        context.report({ node: node.callee, message: MESSAGE });
      },
    };
  },
});
