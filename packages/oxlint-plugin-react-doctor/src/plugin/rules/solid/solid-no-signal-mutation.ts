import { createSolidImportTracker } from "../../utils/create-solid-import-tracker.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const SIGNAL_CREATORS: ReadonlyArray<string> = ["createSignal", "createMemo"];

const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const isSignalGetterCall = (node: EsTreeNode, signalGetterNames: ReadonlySet<string>): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier")) return false;
  return signalGetterNames.has(node.callee.name);
};

export const solidNoSignalMutation = defineRule<Rule>({
  id: "solid-no-signal-mutation",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Solid signals track by reference — in-place mutation (`.push()`, `.key = ...`) won't trigger updates. Use the setter with a new value or `produce` from `solid-js/store`.",
  create: (context: RuleContext) => {
    const importTracker = createSolidImportTracker();
    const signalGetterNames = new Set<string>();
    const memoNames = new Set<string>();
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        importTracker.handleImportDeclaration(node);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.init, "CallExpression")) return;
        if (!isNodeOfType(node.init.callee, "Identifier")) return;

        const matchedImport = importTracker.matchImport(SIGNAL_CREATORS, node.init.callee.name);
        if (!matchedImport) return;

        if (matchedImport === "createSignal") {
          if (!isNodeOfType(node.id, "ArrayPattern")) return;
          const firstElement = node.id.elements[0];
          if (firstElement && isNodeOfType(firstElement, "Identifier")) {
            signalGetterNames.add(firstElement.name);
          }
        } else if (matchedImport === "createMemo") {
          if (isNodeOfType(node.id, "Identifier")) {
            memoNames.add(node.id.name);
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        const property = node.callee.property;
        if (!isNodeOfType(property, "Identifier")) return;
        if (!MUTATING_METHODS.has(property.name)) return;
        const object = node.callee.object as EsTreeNode;
        if (isSignalGetterCall(object, signalGetterNames)) {
          context.report({
            node,
            message: `Mutating a signal's value via \`.${property.name}()\` won't trigger reactivity — Solid tracks by reference. Use the setter with a new value instead.`,
          });
        }
        if (
          isNodeOfType(object, "CallExpression") &&
          isNodeOfType(object.callee, "Identifier") &&
          memoNames.has(object.callee.name)
        ) {
          context.report({
            node,
            message: `Mutating a memo's value via \`.${property.name}()\` won't trigger reactivity. Memos are read-only derived values.`,
          });
        }
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (!isNodeOfType(node.left, "MemberExpression")) return;
        const object = node.left.object as EsTreeNode;
        const property = node.left.property;
        const propertyName = isNodeOfType(property, "Identifier") ? `.${property.name}` : "[...]";
        if (isSignalGetterCall(object, signalGetterNames)) {
          context.report({
            node,
            message: `Assigning to \`signal()${propertyName}\` won't trigger reactivity — Solid tracks by reference. Use the setter with a new object instead.`,
          });
        }
        if (
          isNodeOfType(object, "CallExpression") &&
          isNodeOfType(object.callee, "Identifier") &&
          memoNames.has(object.callee.name)
        ) {
          context.report({
            node,
            message: `Assigning to \`memo()${propertyName}\` won't trigger reactivity. Memos are read-only derived values.`,
          });
        }
      },
    };
  },
});
