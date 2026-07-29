import { defineRule } from "../../utils/define-rule.js";
import { collectMutationReceiverKinds } from "../../utils/collect-mutation-receiver-kinds.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../utils/find-enclosing-class.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetStateCallInLifecycle } from "../../utils/is-set-state-in-lifecycle.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getCallbackRefFieldNames } from "./no-did-update-set-state.js";

const LIFECYCLE_NAMES = new Set(["componentDidMount"]);
const MESSAGE =
  "Your users see an extra render right after mount when you call `setState` in `componentDidMount`.";

const getEnclosingLifecycleFunction = (setStateCall: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = setStateCall.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const parent = ancestor.parent;
      if (
        (isNodeOfType(parent, "MethodDefinition") ||
          isNodeOfType(parent, "PropertyDefinition") ||
          isNodeOfType(parent, "Property")) &&
        isNodeOfType(parent.key, "Identifier") &&
        LIFECYCLE_NAMES.has(parent.key.name)
      ) {
        return ancestor;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// `this.setState({ hasMounted: true })` — flipping a boolean flag to `true`
// right after mount is the deliberate two-pass render pattern (hydration
// gates, enter animations): the second render IS the point, and no initial
// state or getDerivedStateFromProps can replace it.
const isMountFlagArgument = (argument: EsTreeNode | undefined): boolean => {
  if (!argument || !isNodeOfType(argument, "ObjectExpression")) return false;
  const properties = argument.properties ?? [];
  if (properties.length === 0) return false;
  return properties.every(
    (property) =>
      isNodeOfType(property, "Property") &&
      property.computed !== true &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === true,
  );
};

// Sources whose values genuinely cannot exist before mount — the doc's
// explicit carve-out ("reserve componentDidMount setState for values that
// can only exist post-mount, e.g. a measured DOM size").
const POST_MOUNT_MEMBER_NAMES = new Set([
  "current",
  "textContent",
  "innerText",
  "offsetWidth",
  "offsetHeight",
  "offsetTop",
  "offsetLeft",
  "clientWidth",
  "clientHeight",
  "scrollWidth",
  "scrollHeight",
  "scrollTop",
  "scrollLeft",
  "getBoundingClientRect",
]);
const OBSERVER_CONSTRUCTOR_PATTERN = /Observer$/;

const getStaticThisFieldName = (node: EsTreeNode): string | null => {
  const candidate = stripParenExpression(node);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(candidate.object as EsTreeNode), "ThisExpression")
  ) {
    return null;
  }
  return getStaticPropertyKeyName(candidate, { allowComputedString: true });
};

const containsPostMountSource = (node: EsTreeNode): boolean => {
  let didFindSource = false;
  walkAst(node, (descendant) => {
    if (didFindSource) return false;
    if (
      descendant !== node &&
      isFunctionLike(descendant) &&
      !isImmediatelyInvokedFunction(descendant)
    ) {
      return false;
    }
    if (
      isNodeOfType(descendant, "NewExpression") &&
      isNodeOfType(descendant.callee, "Identifier") &&
      OBSERVER_CONSTRUCTOR_PATTERN.test(descendant.callee.name)
    ) {
      didFindSource = true;
      return false;
    }
    if (
      isNodeOfType(descendant, "MemberExpression") &&
      isNodeOfType(descendant.property, "Identifier") &&
      descendant.computed !== true &&
      POST_MOUNT_MEMBER_NAMES.has(descendant.property.name)
    ) {
      didFindSource = true;
      return false;
    }
  });
  return didFindSource;
};

const containsCallbackRefField = (
  node: EsTreeNode,
  callbackRefFieldNames: ReadonlySet<string>,
): boolean => {
  let didFindCallbackRefField = false;
  walkAst(node, (descendant) => {
    if (
      descendant !== node &&
      isFunctionLike(descendant) &&
      !isImmediatelyInvokedFunction(descendant)
    ) {
      return false;
    }
    const fieldName = getStaticThisFieldName(descendant);
    if (fieldName && callbackRefFieldNames.has(fieldName)) {
      didFindCallbackRefField = true;
      return false;
    }
    return undefined;
  });
  return didFindCallbackRefField;
};

const collectReferencedNames = (node: EsTreeNode, into: Set<string>): void => {
  walkAst(node, (descendant) => {
    if (!isNodeOfType(descendant, "Identifier")) return;
    const parent = descendant.parent;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.property === descendant &&
      parent.computed !== true
    ) {
      return;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.key === descendant &&
      parent.value !== descendant
    ) {
      return;
    }
    into.add(descendant.name);
  });
};

const expressionCallsPostMountHelper = (
  node: EsTreeNode,
  localFunctions: ReadonlyMap<string, EsTreeNode>,
  callbackRefFieldNames: ReadonlySet<string>,
  visitedFunctionNames: ReadonlySet<string> = new Set(),
): boolean => {
  let didFindPostMountHelper = false;
  walkAst(node, (descendant) => {
    if (didFindPostMountHelper) return false;
    if (
      descendant !== node &&
      isFunctionLike(descendant) &&
      !isImmediatelyInvokedFunction(descendant)
    ) {
      return false;
    }
    if (!isNodeOfType(descendant, "CallExpression")) return;
    const callee = stripParenExpression(descendant.callee);
    if (!isNodeOfType(callee, "Identifier") || visitedFunctionNames.has(callee.name)) return;
    const localFunction = localFunctions.get(callee.name);
    if (!localFunction) return;
    const functionBody = (localFunction as { body?: EsTreeNode }).body;
    if (!functionBody) return;
    const nextVisitedFunctionNames = new Set([...visitedFunctionNames, callee.name]);
    if (
      containsPostMountSource(functionBody) ||
      containsCallbackRefField(functionBody, callbackRefFieldNames) ||
      expressionCallsPostMountHelper(
        functionBody,
        localFunctions,
        callbackRefFieldNames,
        nextVisitedFunctionNames,
      )
    ) {
      didFindPostMountHelper = true;
      return false;
    }
  });
  return didFindPostMountHelper;
};

// True when the setState argument reads a post-mount-only source directly,
// or references a local declared in the lifecycle body whose initializer
// (transitively) does — `const el = this.ref.current; const z = calc(el);
// this.setState({ z })`.
const argumentDerivesFromPostMountSource = (
  setStateCall: EsTreeNodeOfType<"CallExpression">,
  lifecycleFunction: EsTreeNode,
  callbackRefFieldNames: ReadonlySet<string>,
): boolean => {
  const argumentNode = setStateCall.arguments[0];
  if (!argumentNode || isNodeOfType(argumentNode, "SpreadElement")) return false;
  if (containsPostMountSource(argumentNode)) return true;
  if (containsCallbackRefField(argumentNode, callbackRefFieldNames)) return true;

  const localInitializers = new Map<string, EsTreeNode>();
  const localFunctions = new Map<string, EsTreeNode>();
  const ambiguousLocalNames = new Set<string>();
  const registerLocalBinding = (name: string, initializer: EsTreeNode): void => {
    if (ambiguousLocalNames.has(name)) return;
    if (localInitializers.has(name)) {
      ambiguousLocalNames.add(name);
      localInitializers.delete(name);
      localFunctions.delete(name);
      return;
    }
    localInitializers.set(name, initializer);
    if (isFunctionLike(stripParenExpression(initializer))) {
      localFunctions.set(name, initializer);
    }
  };
  walkAst(lifecycleFunction, (descendant) => {
    if (
      isNodeOfType(descendant, "VariableDeclarator") &&
      isNodeOfType(descendant.id, "Identifier") &&
      descendant.init
    ) {
      registerLocalBinding(descendant.id.name, descendant.init);
    } else if (
      descendant !== lifecycleFunction &&
      isNodeOfType(descendant, "FunctionDeclaration") &&
      descendant.id
    ) {
      registerLocalBinding(descendant.id.name, descendant);
    }
    if (descendant !== lifecycleFunction && isFunctionLike(descendant)) return false;
  });
  if (expressionCallsPostMountHelper(argumentNode, localFunctions, callbackRefFieldNames)) {
    return true;
  }
  if (localInitializers.size === 0) return false;

  const reachedNames = new Set<string>();
  collectReferencedNames(argumentNode, reachedNames);
  const pendingNames = [...reachedNames];
  while (pendingNames.length > 0) {
    const name = pendingNames.pop();
    if (name === undefined) break;
    const initializer = localInitializers.get(name);
    if (!initializer) continue;
    if (isFunctionLike(stripParenExpression(initializer))) continue;
    if (
      containsPostMountSource(initializer) ||
      containsCallbackRefField(initializer, callbackRefFieldNames) ||
      expressionCallsPostMountHelper(initializer, localFunctions, callbackRefFieldNames)
    ) {
      return true;
    }
    const referencedNames = new Set<string>();
    collectReferencedNames(initializer, referencedNames);
    for (const referencedName of referencedNames) {
      if (reachedNames.has(referencedName)) continue;
      reachedNames.add(referencedName);
      pendingNames.push(referencedName);
    }
  }
  return false;
};

const isUndefinedOrNull = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return true;
  const value = stripParenExpression(node);
  const voidOperand = isNodeOfType(value, "UnaryExpression")
    ? stripParenExpression(value.argument)
    : null;
  return (
    (isNodeOfType(value, "Identifier") && value.name === "undefined") ||
    (isNodeOfType(value, "Literal") && value.value === null) ||
    (isNodeOfType(value, "UnaryExpression") &&
      value.operator === "void" &&
      isNodeOfType(voidOperand, "Literal") &&
      voidOperand.value === 0)
  );
};

const objectExpressionMayDefineField = (node: EsTreeNode, fieldName: string): boolean => {
  const candidate = stripParenExpression(node);
  if (!isNodeOfType(candidate, "ObjectExpression")) return true;
  return candidate.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    return propertyName === null || propertyName === fieldName;
  });
};

const callMayWriteThisField = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  fieldName: string,
  receiverKinds: ReadonlyMap<string, "object" | "reflect">,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverKind = receiverKinds.get(receiver.name);
  if (!receiverKind) return false;
  const methodName = getStaticPropertyKeyName(callee, { allowComputedString: true });
  const [target, propertyOrSource, ...remainingArguments] = callExpression.arguments;
  if (
    !target ||
    isNodeOfType(target, "SpreadElement") ||
    !isNodeOfType(stripParenExpression(target as EsTreeNode), "ThisExpression")
  ) {
    return false;
  }
  if (receiverKind === "object" && methodName === "assign") {
    const sources = [propertyOrSource, ...remainingArguments];
    return sources.some(
      (source) =>
        !source ||
        isNodeOfType(source, "SpreadElement") ||
        objectExpressionMayDefineField(source as EsTreeNode, fieldName),
    );
  }
  if (receiverKind === "object" && methodName === "defineProperties") {
    return (
      !propertyOrSource ||
      isNodeOfType(propertyOrSource, "SpreadElement") ||
      objectExpressionMayDefineField(propertyOrSource as EsTreeNode, fieldName)
    );
  }
  if (
    (receiverKind === "object" && methodName === "defineProperty") ||
    (receiverKind === "reflect" &&
      (methodName === "defineProperty" || methodName === "deleteProperty" || methodName === "set"))
  ) {
    if (!propertyOrSource || isNodeOfType(propertyOrSource, "SpreadElement")) return true;
    const propertyName = stripParenExpression(propertyOrSource as EsTreeNode);
    return (
      !isNodeOfType(propertyName, "Literal") ||
      typeof propertyName.value !== "string" ||
      propertyName.value === fieldName
    );
  }
  return false;
};

const getEnclosingWriterFunction = (node: EsTreeNode, classNode: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== classNode && !isFunctionLike(ancestor)) {
    ancestor = ancestor.parent;
  }
  return ancestor && ancestor !== classNode ? ancestor : null;
};

const hasExclusiveCallbackRefFieldWrite = (classNode: EsTreeNode, fieldName: string): boolean => {
  if (fieldName.startsWith("#")) return false;
  const receiverKinds = collectMutationReceiverKinds(classNode);
  const writerFunctions = new Set<EsTreeNode>();
  let didFindUnsafeWrite = false;
  walkAst(classNode, (node) => {
    if (
      node !== classNode &&
      (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (
      isNodeOfType(node, "PropertyDefinition") &&
      node.static !== true &&
      getStaticPropertyKeyName(node, { allowComputedString: true }) === fieldName &&
      !isUndefinedOrNull(node.value as EsTreeNode | null | undefined)
    ) {
      didFindUnsafeWrite = true;
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      callMayWriteThisField(node, fieldName, receiverKinds)
    ) {
      const writerFunction = getEnclosingWriterFunction(node, classNode);
      if (!writerFunction) {
        didFindUnsafeWrite = true;
        return false;
      }
      writerFunctions.add(writerFunction);
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
    const unwrappedAssignmentTarget = stripParenExpression(assignmentTarget);
    if (
      !isNodeOfType(unwrappedAssignmentTarget, "MemberExpression") ||
      !isNodeOfType(
        stripParenExpression(unwrappedAssignmentTarget.object as EsTreeNode),
        "ThisExpression",
      )
    ) {
      return;
    }
    const assignmentFieldName = getStaticPropertyKeyName(unwrappedAssignmentTarget, {
      allowComputedString: true,
    });
    if (!assignmentFieldName) {
      didFindUnsafeWrite = true;
      return false;
    }
    if (assignmentFieldName !== fieldName) return;
    const writerFunction = getEnclosingWriterFunction(node, classNode);
    if (!writerFunction) {
      didFindUnsafeWrite = true;
      return false;
    }
    writerFunctions.add(writerFunction);
  });
  return !didFindUnsafeWrite && writerFunctions.size === 1;
};

// A setState after an `await` in an async componentDidMount is the
// promise-buried case: the continuation runs as a microtask callback, the
// same shape as `.then(() => this.setState(...))`, which the default
// "allowed" mode documents as NOT firing.
const isAfterAwaitInAsyncLifecycle = (
  setStateCall: EsTreeNode,
  lifecycleFunction: EsTreeNode,
): boolean => {
  if (!isFunctionLike(lifecycleFunction) || lifecycleFunction.async !== true) return false;
  const callStart = getNodeStartIndex(setStateCall);
  if (callStart < 0) return false;
  let didFindPrecedingAwait = false;
  walkAst(lifecycleFunction, (descendant) => {
    if (didFindPrecedingAwait) return false;
    if (!isNodeOfType(descendant, "AwaitExpression")) return;
    const awaitStart = getNodeStartIndex(descendant);
    if (awaitStart >= 0 && awaitStart < callStart) {
      didFindPrecedingAwait = true;
      return false;
    }
  });
  return didFindPrecedingAwait;
};

interface NoDidMountSetStateSettings {
  mode?: "allowed" | "disallow-in-func";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoDidMountSetStateSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noDidMountSetState?: NoDidMountSetStateSettings }).noDidMountSetState ??
        {})
      : {};
  return { mode: ruleSettings.mode ?? "allowed" };
};

// Port of `oxc_linter::rules::react::no_did_mount_set_state`. Flags
// `this.setState(...)` directly inside a `componentDidMount` lifecycle
// (default), or inside any nested function within `componentDidMount`
// when `mode: "disallow-in-func"`.
export const noDidMountSetState = defineRule({
  id: "no-did-mount-set-state",
  title: "setState in componentDidMount",
  severity: "warn",
  recommendation:
    "Setting state in `componentDidMount` triggers an extra render. Use `getDerivedStateFromProps` or initial state instead.",
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
        if (isMountFlagArgument(node.arguments?.[0])) return;
        const lifecycleFunction = getEnclosingLifecycleFunction(node);
        if (lifecycleFunction) {
          if (isAfterAwaitInAsyncLifecycle(node, lifecycleFunction)) return;
          const enclosingClass = findEnclosingClass(lifecycleFunction);
          const callbackRefFieldNames = getCallbackRefFieldNames(enclosingClass, context.scopes);
          const exclusivelyRefOwnedFieldNames = enclosingClass
            ? new Set(
                [...callbackRefFieldNames].filter((fieldName) =>
                  hasExclusiveCallbackRefFieldWrite(enclosingClass, fieldName),
                ),
              )
            : new Set<string>();
          if (
            argumentDerivesFromPostMountSource(
              node,
              lifecycleFunction,
              exclusivelyRefOwnedFieldNames,
            )
          ) {
            return;
          }
        }
        context.report({ node: node.callee, message: MESSAGE });
      },
    };
  },
});
