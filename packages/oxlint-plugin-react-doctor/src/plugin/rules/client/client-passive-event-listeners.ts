import { PASSIVE_EVENT_NAMES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

// A handler that calls `event.preventDefault()` MUST run non-passively —
// passive listeners silently ignore preventDefault(). Recommending
// `{ passive: true }` here is exactly backwards (the rule's own
// recommendation says so), so an inline handler that calls
// preventDefault suppresses the report. Nested functions are pruned:
// a preventDefault inside a callback the handler merely creates runs
// outside the listener call, so it says nothing about this listener.
const handlerCallsPreventDefault = (handler: EsTreeNode | undefined): boolean => {
  if (!isFunctionLike(handler)) return false;
  let didFindPreventDefault = false;
  walkAst(handler, (child) => {
    if (didFindPreventDefault) return false;
    if (child !== handler && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      child.callee.property.name === "preventDefault"
    ) {
      didFindPreventDefault = true;
    }
  });
  return didFindPreventDefault;
};

// Later writes to a `let` binding (`let onTouchMove; onTouchMove = (e) =>
// e.preventDefault()`) don't show up as the declarator initializer, so scan
// the binding's scope for plain assignments to the same name.
const assignedHandlerCallsPreventDefault = (
  scopeOwner: EsTreeNode,
  handlerName: string,
): boolean => {
  let didFindPreventDefault = false;
  walkAst(scopeOwner, (child) => {
    if (didFindPreventDefault) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === handlerName &&
      handlerCallsPreventDefault(child.right)
    ) {
      didFindPreventDefault = true;
    }
  });
  return didFindPreventDefault;
};

const asHandlerFunction = (value: EsTreeNode | null | undefined): EsTreeNode | undefined => {
  if (!value) return undefined;
  if (isNodeOfType(value, "FunctionExpression") || isNodeOfType(value, "ArrowFunctionExpression")) {
    return value;
  }
  return undefined;
};

const memberKeyName = (keyNode: EsTreeNode | null | undefined): string | undefined => {
  if (isNodeOfType(keyNode, "Identifier") || isNodeOfType(keyNode, "PrivateIdentifier")) {
    return keyNode.name;
  }
  return undefined;
};

const resolveFromClassBody = (
  classBody: EsTreeNodeOfType<"ClassBody">,
  propertyName: string,
): EsTreeNode | undefined => {
  for (const element of classBody.body ?? []) {
    if (!isNodeOfType(element, "MethodDefinition") && !isNodeOfType(element, "PropertyDefinition"))
      continue;
    if (memberKeyName(element.key) !== propertyName) continue;
    const resolved = asHandlerFunction(element.value);
    if (resolved) return resolved;
  }
  return undefined;
};

const resolveFromObjectExpression = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): EsTreeNode | undefined => {
  for (const objectProperty of objectExpression.properties ?? []) {
    if (!isNodeOfType(objectProperty, "Property")) continue;
    if (memberKeyName(objectProperty.key) !== propertyName) continue;
    const resolved = asHandlerFunction(objectProperty.value);
    if (resolved) return resolved;
  }
  return undefined;
};

// Resolve a member-expression handler (`this.handleMove`, `this.#handleMove`,
// `obj.onMove`) to the function it points at: a class method/field or
// object-literal method for `this.x`, or an object method/field for a
// locally-declared `obj`. Returns undefined when the target can't be traced
// in this file.
const resolveMemberHandlerFunction = (
  handler: EsTreeNodeOfType<"MemberExpression">,
): EsTreeNode | undefined => {
  const propertyName = memberKeyName(handler.property);
  if (propertyName === undefined) return undefined;
  const objectNode = handler.object;

  if (isNodeOfType(objectNode, "ThisExpression")) {
    let ancestor: EsTreeNode | null | undefined = handler.parent;
    while (ancestor) {
      if (isNodeOfType(ancestor, "ClassBody")) {
        return resolveFromClassBody(ancestor, propertyName);
      }
      if (isNodeOfType(ancestor, "ObjectExpression")) {
        const resolved = resolveFromObjectExpression(ancestor, propertyName);
        if (resolved) return resolved;
      }
      ancestor = ancestor.parent ?? null;
    }
    return undefined;
  }

  if (isNodeOfType(objectNode, "Identifier")) {
    const binding = findVariableInitializer(objectNode, objectNode.name);
    const initializer = binding?.initializer;
    if (initializer && isNodeOfType(initializer, "ObjectExpression")) {
      return resolveFromObjectExpression(initializer, propertyName);
    }
  }

  return undefined;
};

// Handlers are usually passed by reference inside an effect (`const onTouchMove
// = (e) => { e.preventDefault(); … }; el.addEventListener("touchmove",
// onTouchMove)`) so they can be removed in cleanup. Resolve the binding so the
// preventDefault escape hatch also covers the referenced form — otherwise the
// rule would recommend `{ passive: true }`, which silently breaks
// preventDefault().
const handlerArgumentCallsPreventDefault = (handler: EsTreeNode | undefined): boolean => {
  if (!handler) return false;
  if (handlerCallsPreventDefault(handler)) return true;
  if (isNodeOfType(handler, "Identifier")) {
    const binding = findVariableInitializer(handler, handler.name);
    if (!binding) return false;
    if (handlerCallsPreventDefault(binding.initializer ?? undefined)) return true;
    return assignedHandlerCallsPreventDefault(binding.scopeOwner, handler.name);
  }
  if (isNodeOfType(handler, "MemberExpression")) {
    const resolved = resolveMemberHandlerFunction(handler);
    return resolved ? handlerCallsPreventDefault(resolved) : false;
  }
  return false;
};

// An explicit `{ passive: false }` is a deliberate opt-out (the author
// needs preventDefault to work). Treat it like `passive: true` for the
// purposes of this rule: not a forgotten passive flag.
const hasExplicitPassiveValue = (
  optionsArgument: EsTreeNodeOfType<"ObjectExpression">,
  expected: boolean,
): boolean =>
  Boolean(
    optionsArgument.properties?.some(
      (property: EsTreeNode) =>
        isNodeOfType(property, "Property") &&
        isNodeOfType(property.key, "Identifier") &&
        property.key.name === "passive" &&
        isNodeOfType(property.value, "Literal") &&
        property.value.value === expected,
    ),
  );

export const clientPassiveEventListeners = defineRule({
  id: "client-passive-event-listeners",
  title: "Non-passive scroll listener",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Add `{ passive: true }` as the third argument: `addEventListener('scroll', handler, { passive: true })`. Only do this if the handler doesn't call `event.preventDefault()`, since passive listeners ignore it (which breaks pull-to-refresh, custom gestures, and nested scrolling).",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isMemberProperty(node.callee, "addEventListener")) return;
      if ((node.arguments?.length ?? 0) < 2) return;

      const eventNameNode = node.arguments[0];
      if (
        !isNodeOfType(eventNameNode, "Literal") ||
        typeof eventNameNode.value !== "string" ||
        !PASSIVE_EVENT_NAMES.has(eventNameNode.value)
      )
        return;

      const eventName = eventNameNode.value;

      // A handler that needs preventDefault() can't be passive — skip it
      // regardless of how (or whether) options are passed.
      if (handlerArgumentCallsPreventDefault(node.arguments[1] as EsTreeNode | undefined)) return;

      const optionsArgument = node.arguments[2];

      if (!optionsArgument) {
        context.report({
          node,
          message: `"${eventName}" listener without { passive: true } makes scrolling janky for your users. Only add it if the handler doesn't call event.preventDefault(), since passive listeners silently ignore preventDefault().`,
        });
        return;
      }

      if (!isNodeOfType(optionsArgument, "ObjectExpression")) return;

      // Explicit `{ passive: false }` is an intentional opt-out, not a
      // forgotten flag.
      if (hasExplicitPassiveValue(optionsArgument, false)) return;

      const hasPassiveTrue = hasExplicitPassiveValue(optionsArgument, true);

      if (!hasPassiveTrue) {
        context.report({
          node,
          message: `"${eventName}" listener without { passive: true } makes scrolling janky for your users. Only add it if the handler doesn't call event.preventDefault(), since passive listeners silently ignore preventDefault().`,
        });
      }
    },
  }),
});
