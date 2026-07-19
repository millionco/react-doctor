import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapReactRouterRule } from "../../utils/wrap-react-router-rule.js";

const isReactRouterDomSource = (source: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(source, "Literal") && source.value === "react-router-dom";

export const reactRouterV8NoReactRouterDomImport = wrapReactRouterRule(
  defineRule({
    id: "react-router-v8-no-react-router-dom-import",
    title: "Removed react-router-dom import",
    tags: ["migration-hint"],
    requires: ["react-router:8"],
    severity: "error",
    category: "Architecture",
    recommendation:
      "Import DOM-only APIs from react-router/dom and all other APIs from react-router.",
    create: (context: RuleContext) => ({
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (!isReactRouterDomSource(node.source)) return;
        context.report({
          node,
          message: "react-router-dom is removed in React Router v8.",
        });
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        if (!isReactRouterDomSource(node.source)) return;
        context.report({
          node,
          message: "react-router-dom is removed in React Router v8.",
        });
      },
      ExportAllDeclaration(node: EsTreeNodeOfType<"ExportAllDeclaration">) {
        if (!isReactRouterDomSource(node.source)) return;
        context.report({
          node,
          message: "react-router-dom is removed in React Router v8.",
        });
      },
      ImportExpression(node: EsTreeNodeOfType<"ImportExpression">) {
        if (!isReactRouterDomSource(node.source)) return;
        context.report({
          node,
          message: "react-router-dom is removed in React Router v8.",
        });
      },
    }),
  }),
);
