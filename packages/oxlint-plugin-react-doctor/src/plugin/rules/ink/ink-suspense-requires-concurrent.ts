import { MINIMUM_INK_VERSIONS } from "../../constants/ink.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { containsInkJsxElement } from "../../utils/contains-ink-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportedNameFromModule } from "../../utils/find-import-source-for-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveInkApiName } from "../../utils/resolve-ink-api-name.js";
import { walkAst } from "../../utils/walk-ast.js";

const hasConcurrentRender = (program: EsTreeNode, context: RuleContext): boolean => {
  let hasConcurrent = false;
  walkAst(program, (descendantNode) => {
    if (
      !isNodeOfType(descendantNode, "CallExpression") ||
      resolveInkApiName(descendantNode.callee, context.scopes) !== "render"
    ) {
      return;
    }
    for (const argumentNode of descendantNode.arguments) {
      if (!isNodeOfType(argumentNode, "ObjectExpression")) continue;
      hasConcurrent ||= argumentNode.properties.some(
        (propertyNode) =>
          isNodeOfType(propertyNode, "Property") &&
          getStaticPropertyKeyName(propertyNode, { allowComputedString: true }) === "concurrent" &&
          isNodeOfType(propertyNode.value, "Literal") &&
          propertyNode.value.value === true,
      );
    }
  });
  return hasConcurrent;
};

export const inkSuspenseRequiresConcurrent = defineRule({
  id: "ink-suspense-requires-concurrent",
  title: "Ink Suspense without concurrent rendering",
  severity: "error",
  minimumInkVersion: MINIMUM_INK_VERSIONS.concurrent,
  recommendation: "Enable `{concurrent: true}` on Ink `render()` when the tree uses Suspense.",
  create: (context) => ({
    Program(node: EsTreeNodeOfType<"Program">) {
      if (hasConcurrentRender(node, context)) return;
      walkAst(node, (descendantNode) => {
        if (
          !isNodeOfType(descendantNode, "JSXOpeningElement") ||
          !isNodeOfType(descendantNode.name, "JSXIdentifier") ||
          context.scopes.symbolFor(descendantNode.name)?.kind !== "import" ||
          getImportedNameFromModule(descendantNode, descendantNode.name.name, "react") !==
            "Suspense" ||
          !descendantNode.parent ||
          !containsInkJsxElement(descendantNode.parent, context.scopes)
        ) {
          return;
        }
        context.report({
          node: descendantNode,
          message: "Ink Suspense boundaries require the renderer's `concurrent` option.",
        });
      });
    },
  }),
});
