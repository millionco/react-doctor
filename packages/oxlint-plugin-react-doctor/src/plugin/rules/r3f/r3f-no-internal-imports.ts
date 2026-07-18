import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getModuleNamespaceSource } from "./utils/get-module-namespace-source.js";

const isPrivateR3fPath = (source: unknown): source is string =>
  typeof source === "string" &&
  (source.startsWith("@react-three/fiber/dist/") || source.startsWith("@react-three/fiber/src/"));

export const r3fNoInternalImports = defineRule({
  id: "r3f-no-internal-imports",
  title: "Private R3F import",
  category: "Architecture",
  severity: "warn",
  recommendation:
    "Import from @react-three/fiber or one of its documented public entry points instead of a dist or src implementation path",
  create: (context: RuleContext) => {
    const reportSource = (node: EsTreeNode, source: unknown): void => {
      if (!isPrivateR3fPath(source)) return;
      context.report({
        node,
        message: `Importing ${source} couples this code to private package layout that can change between releases. Use a documented public entry point`,
      });
    };
    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        reportSource(node.source, node.source.value);
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        if (node.source) reportSource(node.source, node.source.value);
      },
      ExportAllDeclaration(node: EsTreeNodeOfType<"ExportAllDeclaration">) {
        reportSource(node.source, node.source.value);
      },
      ImportExpression(node: EsTreeNodeOfType<"ImportExpression">) {
        if (isNodeOfType(node.source, "Literal")) reportSource(node.source, node.source.value);
      },
      TSImportEqualsDeclaration(node: EsTreeNodeOfType<"TSImportEqualsDeclaration">) {
        reportSource(node, getModuleNamespaceSource(node.id, context.scopes));
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "Identifier") ||
          node.callee.name !== "require" ||
          !context.scopes.isGlobalReference(node.callee)
        ) {
          return;
        }
        const source = node.arguments[0];
        if (source && isNodeOfType(source, "Literal")) reportSource(source, source.value);
      },
    };
  },
});
