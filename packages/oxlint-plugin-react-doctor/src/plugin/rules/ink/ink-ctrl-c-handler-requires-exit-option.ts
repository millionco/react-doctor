import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const hasExitOnCtrlCDisabled = (program: EsTreeNode, context: RuleContext): boolean => {
  let isDisabled = false;
  walkAst(program, (descendantNode) => {
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      resolveInkApiName(descendantNode.callee, context.scopes) !== "render"
    ) {
      return;
    }
    for (const argumentNode of descendantNode.arguments) {
      if (!isNodeOfType(argumentNode, "ObjectExpression")) continue;
      for (const propertyNode of argumentNode.properties) {
        if (
          isNodeOfType(propertyNode, "Property") &&
          getStaticPropertyKeyName(propertyNode, { allowComputedString: true }) === "exitOnCtrlC" &&
          isNodeOfType(propertyNode.value, "Literal") &&
          propertyNode.value.value === false
        ) {
          isDisabled = true;
        }
      }
    }
  });
  return isDisabled;
};

const handlesCtrlC = (handler: EsTreeNode): boolean => {
  let hasCtrlRead = false;
  let hasCValue = false;
  walkAst(handler, (descendantNode) => {
    if (
      isNodeOfType(descendantNode, "MemberExpression") &&
      getStaticPropertyName(descendantNode) === "ctrl"
    ) {
      hasCtrlRead = true;
    }
    if (isNodeOfType(descendantNode, "Literal") && descendantNode.value === "c") hasCValue = true;
  });
  return hasCtrlRead && hasCValue;
};

export const inkCtrlCHandlerRequiresExitOption = defineRule({
  id: "ink-ctrl-c-handler-requires-exit-option",
  title: "Ctrl-C handler is unreachable",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.base,
  recommendation:
    "Pass `{exitOnCtrlC: false}` to `render()` before handling Ctrl-C with `useInput`.",
  create: (context) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      if (hasExitOnCtrlCDisabled(node, context)) return;
      walkAst(node, (descendantNode) => {
        if (
          !isNodeOfType(descendantNode, "CallExpression") ||
          resolveInkApiName(descendantNode.callee, context.scopes) !== "useInput"
        ) {
          return;
        }
        const handler = descendantNode.arguments[0];
        if (!handler || !handlesCtrlC(handler)) return;
        context.report({
          node: descendantNode,
          message:
            "Ink consumes Ctrl-C before `useInput` unless `render()` disables `exitOnCtrlC`.",
        });
      });
    },
  }),
});
