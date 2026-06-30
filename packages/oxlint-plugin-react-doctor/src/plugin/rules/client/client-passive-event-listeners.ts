import { PASSIVE_EVENT_NAMES } from "../../constants/dom.js";
import { defineRule } from "../../utils/define-rule.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

// A handler that calls `event.preventDefault()` MUST run non-passively —
// passive listeners silently ignore preventDefault(). Recommending
// `{ passive: true }` here is exactly backwards (the rule's own
// recommendation says so), so an inline handler that calls
// preventDefault suppresses the report.
const handlerCallsPreventDefault = (handler: EsTreeNode | undefined): boolean => {
  if (
    !handler ||
    (!isNodeOfType(handler, "ArrowFunctionExpression") &&
      !isNodeOfType(handler, "FunctionExpression"))
  ) {
    return false;
  }
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
      if (handlerCallsPreventDefault(node.arguments[1] as EsTreeNode | undefined)) return;

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
