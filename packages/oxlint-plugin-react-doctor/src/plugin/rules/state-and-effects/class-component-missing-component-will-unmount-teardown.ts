import { defineRule } from "../../utils/define-rule.js";
import { getCallMethodName } from "../../utils/get-call-method-name.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This class registers a listener or timer on mount but declares no `componentWillUnmount`, so the subscription/timer keeps firing after the component unmounts; release it in `componentWillUnmount`.";

// Listener-registration methods that hand back a resource which must be
// explicitly removed on unmount. Sound: each has a matching removal API.
const LISTENER_REGISTRATION_METHODS = new Set([
  "on",
  "once",
  "subscribe",
  "addEventListener",
  "addListener",
]);

const GLOBAL_OBJECT_NAMES = new Set(["window", "globalThis", "global", "self"]);

// Walks a function body without descending into nested functions, so a
// hazard belongs to the mount body itself (not an event-driven callback).
const walkMountBody = (functionBody: EsTreeNode, visit: (node: EsTreeNode) => void): void => {
  walkAst(functionBody, (child: EsTreeNode) => {
    if (child !== functionBody && isFunctionLike(child)) return false;
    visit(child);
  });
};

const getBareCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  return isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;
};

// Timers are registered either bare (`setInterval(...)`) or via the global
// object (`window.setInterval(...)`, the TS idiom for a `number` timer id).
const getTimerCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const bareName = getBareCalleeName(node);
  if (bareName) return bareName;
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.object, "Identifier") &&
    GLOBAL_OBJECT_NAMES.has(node.callee.object.name)
  ) {
    return getCallMethodName(node.callee);
  }
  return null;
};

// A `setTimeout` is a hazard only when its callback actually mutates the
// component — `this.setState(...)`, `runInAction(...)`, or any direct
// `this.<action>(...)` call. A one-shot field write (`this.x = true`) or a
// ref/focus nudge (`this.inputRef.current?.focus()`) leaks nothing.
const timeoutCallbackMutatesComponent = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback)) return false;
  const body = callback.body;
  if (!body) return false;
  let mutates = false;
  walkMountBody(body, (node) => {
    if (mutates) return;
    if (getBareCalleeName(node) === "runInAction") {
      mutates = true;
      return;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "ThisExpression")
    ) {
      mutates = true;
    }
  });
  return mutates;
};

const getMemberChainBase = (node: EsTreeNode): EsTreeNode => {
  let base = node;
  while (isNodeOfType(base, "MemberExpression")) base = base.object;
  return base;
};

// `addEventListener(..., { once: true })` self-removes after firing, so there
// is usually nothing left to release on unmount.
const isOneShotListenerOptions = (optionsArgument: EsTreeNode | undefined): boolean => {
  if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return false;
  return (optionsArgument.properties ?? []).some(
    (property: EsTreeNode) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      property.key.name === "once" &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === true,
  );
};

// Variables declared inside the mount body whose values never escape it
// (never assigned onto `this` or another object): a listener registered on
// such a locally constructed emitter dies with the component, so it needs
// no teardown.
const collectMountLocalReceiverNames = (mountBody: EsTreeNode): Set<string> => {
  const declaredNames = new Set<string>();
  const escapedNames = new Set<string>();
  walkMountBody(mountBody, (node) => {
    if (isNodeOfType(node, "VariableDeclarator") && isNodeOfType(node.id, "Identifier")) {
      declaredNames.add(node.id.name);
    }
    if (
      isNodeOfType(node, "AssignmentExpression") &&
      isNodeOfType(node.left, "MemberExpression") &&
      isNodeOfType(node.right, "Identifier")
    ) {
      escapedNames.add(node.right.name);
    }
  });
  for (const escapedName of escapedNames) declaredNames.delete(escapedName);
  return declaredNames;
};

const isMountHazard = (node: EsTreeNode, localReceiverNames: Set<string>): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const methodName = getCallMethodName(node.callee);
  if (
    methodName &&
    LISTENER_REGISTRATION_METHODS.has(methodName) &&
    isNodeOfType(node.callee, "MemberExpression")
  ) {
    const callArguments = node.arguments ?? [];
    const isFunctionFactoryOnce = methodName === "once" && callArguments.length < 2;
    const receiverBase = getMemberChainBase(node.callee.object);
    const isLocalReceiver =
      isNodeOfType(receiverBase, "Identifier") && localReceiverNames.has(receiverBase.name);
    const isSelfRemovingListener =
      methodName === "addEventListener" && isOneShotListenerOptions(callArguments[2]);
    return !isFunctionFactoryOnce && !isLocalReceiver && !isSelfRemovingListener;
  }

  const timerCalleeName = getTimerCalleeName(node);
  if (timerCalleeName === "setInterval") return true;
  if (timerCalleeName === "setTimeout" && node.arguments?.[0]) {
    return timeoutCallbackMutatesComponent(node.arguments[0]);
  }
  return false;
};

const getMemberFunctionBody = (member: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) {
    return null;
  }
  const value = member.value;
  if (!value || !isFunctionLike(value)) return null;
  return value.body ?? null;
};

const getClassMemberName = (member: EsTreeNode): string | null => {
  if (isNodeOfType(member, "MethodDefinition") && member.kind === "constructor") {
    return "constructor";
  }
  if (!isNodeOfType(member, "MethodDefinition") && !isNodeOfType(member, "PropertyDefinition")) {
    return null;
  }
  return isNodeOfType(member.key, "Identifier") ? member.key.name : null;
};

// MobX auto-manages teardown when `disposeOnUnmount` is used anywhere in the
// class, so the missing `componentWillUnmount` is not a leak.
const classUsesDisposeOnUnmount = (classNode: EsTreeNode): boolean => {
  let found = false;
  walkAst(classNode, (child: EsTreeNode) => {
    if (found) return false;
    if (isNodeOfType(child, "Identifier") && child.name === "disposeOnUnmount") {
      found = true;
      return false;
    }
  });
  return found;
};

export const classComponentMissingComponentWillUnmountTeardown = defineRule({
  id: "class-component-missing-component-will-unmount-teardown",
  title: "Class component acquires a resource with no teardown",
  severity: "warn",
  category: "Bugs",
  requires: ["react"],
  recommendation:
    "Release listeners and timers acquired in `componentDidMount`/`constructor` by adding a `componentWillUnmount` that removes them (or use MobX `disposeOnUnmount`).",
  create: (context: RuleContext) => ({
    ClassBody(node: EsTreeNodeOfType<"ClassBody">) {
      const classNode = node.parent;
      if (!classNode || !isEs6Component(classNode)) return;

      const members = node.body ?? [];
      const hasComponentWillUnmount = members.some(
        (member) => getClassMemberName(member) === "componentWillUnmount",
      );
      if (hasComponentWillUnmount) return;
      if (classUsesDisposeOnUnmount(classNode)) return;

      for (const member of members) {
        const memberName = getClassMemberName(member);
        if (memberName !== "constructor" && memberName !== "componentDidMount") continue;
        const body = getMemberFunctionBody(member);
        if (!body) continue;

        const localReceiverNames = collectMountLocalReceiverNames(body);
        let hazardNode: EsTreeNode | null = null;
        walkMountBody(body, (candidate) => {
          if (hazardNode) return;
          if (isMountHazard(candidate, localReceiverNames)) hazardNode = candidate;
        });
        if (hazardNode) {
          context.report({ node: hazardNode, message: MESSAGE });
          return;
        }
      }
    },
  }),
});
