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
// preventDefault suppresses the report.
const handlerCallsPreventDefault = (handler: EsTreeNode | undefined): boolean => {
  if (!isFunctionLike(handler)) return false;
  let didFindPreventDefault = false;
  walkAst(handler, (child) => {
    if (didFindPreventDefault) return;
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

const asHandlerFunction = (value: EsTreeNode | null | undefined): EsTreeNode | undefined => {
  if (!value) return undefined;
  if (isNodeOfType(value, "FunctionExpression") || isNodeOfType(value, "ArrowFunctionExpression")) {
    return value;
  }
  return undefined;
};

// Resolve a member-expression handler (`this.handleMove`, `obj.onMove`) to the
// function it points at: a class method/field for `this.x`, or an object
// method/field for a locally-declared `obj`. Returns undefined when the target
// can't be traced in this file.
const resolveMemberHandlerFunction = (
  handler: EsTreeNodeOfType<"MemberExpression">,
): EsTreeNode | undefined => {
  const property = handler.property;
  if (!isNodeOfType(property, "Identifier")) return undefined;
  const propertyName = property.name;
  const objectNode = handler.object;

  if (isNodeOfType(objectNode, "ThisExpression")) {
    let ancestor: EsTreeNode | null | undefined = handler.parent;
    while (ancestor) {
      if (isNodeOfType(ancestor, "ClassBody")) {
        for (const element of ancestor.body ?? []) {
          if (
            (isNodeOfType(element, "MethodDefinition") ||
              isNodeOfType(element, "PropertyDefinition")) &&
            isNodeOfType(element.key, "Identifier") &&
            element.key.name === propertyName
          ) {
            const resolved = asHandlerFunction(element.value);
            if (resolved) return resolved;
          }
        }
        return undefined;
      }
      ancestor = ancestor.parent ?? null;
    }
    return undefined;
  }

  if (isNodeOfType(objectNode, "Identifier")) {
    const binding = findVariableInitializer(objectNode, objectNode.name);
    const initializer = binding?.initializer;
    if (initializer && isNodeOfType(initializer, "ObjectExpression")) {
      for (const objectProperty of initializer.properties ?? []) {
        if (
          isNodeOfType(objectProperty, "Property") &&
          isNodeOfType(objectProperty.key, "Identifier") &&
          objectProperty.key.name === propertyName
        ) {
          const resolved = asHandlerFunction(objectProperty.value);
          if (resolved) return resolved;
        }
      }
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
    return handlerCallsPreventDefault(binding?.initializer ?? undefined);
  }
  if (isNodeOfType(handler, "MemberExpression")) {
    const resolved = resolveMemberHandlerFunction(handler);
    // An unresolved member handler (`this.x` / `obj.y` we can't trace) may call
    // preventDefault — recommending `{ passive: true }` would silently break
    // it, so suppress conservatively rather than assume it's passive-safe.
    if (!resolved) return true;
    return handlerCallsPreventDefault(resolved);
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
