import { defineRule } from "../../utils/define-rule.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { hasDirective } from "../../utils/has-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const DERIVING_ARRAY_METHODS = new Set(["toSorted", "toReversed", "filter", "map", "slice"]);

const HOOK_NAME_PATTERN = /^use[A-Z0-9]/;

const isHookCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (isNodeOfType(node.callee, "Identifier")) return HOOK_NAME_PATTERN.test(node.callee.name);
  return (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.property, "Identifier") &&
    HOOK_NAME_PATTERN.test(node.callee.property.name)
  );
};

const getDerivingMethodName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  if (!isNodeOfType(node.callee, "MemberExpression")) return null;
  if (!isNodeOfType(node.callee.property, "Identifier")) return null;
  return node.callee.property.name;
};

// HACK: passing both `<Client list={items} sortedList={items.toSorted()} />`
// (or any pair of derivations of the same source) doubles the bytes
// React serializes across the RSC wire. The client gets two copies of
// roughly the same array; one of the props is redundant. Have the
// client derive what it needs from the single source prop instead.
//
// The RSC-wire premise only holds when the rendering component is a
// server component: a `"use client"` file or any file calling hooks
// (hooks cannot run in RSC) renders in the browser, where duplicate
// props cost nothing on a wire that does not exist — so reporting is
// deferred to Program:exit and dropped once a client signal appears.
export const serverDedupProps = defineRule({
  id: "server-dedup-props",
  title: "Duplicate data in server props",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Pass the source array once and build the other version on the client. Sending both ships the data twice to the browser.",
  create: (context: RuleContext) => {
    let fileIsClientSide = false;
    const pendingReports: Array<{ node: EsTreeNode; message: string }> = [];

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileIsClientSide = hasDirective(node, "use client");
        pendingReports.length = 0;
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!fileIsClientSide && isHookCall(node)) fileIsClientSide = true;
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (fileIsClientSide) return;
        const identifierAttributes: Map<string, string> = new Map();
        const derivedAttributes: Array<{ propName: string; rootName: string; node: EsTreeNode }> =
          [];

        for (const attr of node.attributes ?? []) {
          if (!isNodeOfType(attr, "JSXAttribute")) continue;
          if (!isNodeOfType(attr.name, "JSXIdentifier")) continue;
          if (attr.name.name === "key") continue;
          if (!isNodeOfType(attr.value, "JSXExpressionContainer")) continue;
          const expression = attr.value.expression;
          if (!expression) continue;

          if (isNodeOfType(expression, "Identifier")) {
            identifierAttributes.set(expression.name, attr.name.name);
          } else if (isNodeOfType(expression, "CallExpression")) {
            const derivingMethod = getDerivingMethodName(expression);
            if (!derivingMethod || !DERIVING_ARRAY_METHODS.has(derivingMethod)) continue;
            const root = getRootIdentifierName(expression, { followCallChains: true });
            if (!root) continue;
            derivedAttributes.push({ propName: attr.name.name, rootName: root, node: attr });
          }
        }

        for (const derived of derivedAttributes) {
          const sourcePropName = identifierAttributes.get(derived.rootName);
          if (sourcePropName) {
            pendingReports.push({
              node: derived.node,
              message: `Passing both "${derived.propName}" & "${sourcePropName}" ships the same data twice to your users (source: ${derived.rootName}).`,
            });
          }
        }
      },
      "Program:exit"() {
        if (fileIsClientSide) return;
        for (const report of pendingReports) {
          context.report(report);
        }
      },
    };
  },
});
