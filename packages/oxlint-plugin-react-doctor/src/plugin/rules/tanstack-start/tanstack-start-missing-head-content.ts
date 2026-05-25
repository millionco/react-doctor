import { TANSTACK_ROOT_ROUTE_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const TANSTACK_ROUTER_PACKAGE = "@tanstack/react-router";
const HEAD_CONTENT_COMPONENT_NAME = "HeadContent";
const DOCUMENT_HEAD_ELEMENT_NAME = "head";

const getJsxMemberRootName = (node: EsTreeNodeOfType<"JSXMemberExpression">): string | null => {
  if (isNodeOfType(node.object, "JSXIdentifier")) return node.object.name;
  if (isNodeOfType(node.object, "JSXMemberExpression")) return getJsxMemberRootName(node.object);
  return null;
};

const getJsxMemberPropertyName = (node: EsTreeNodeOfType<"JSXMemberExpression">): string | null => {
  if (isNodeOfType(node.property, "JSXIdentifier")) return node.property.name;
  return null;
};

export const tanstackStartMissingHeadContent = defineRule<Rule>({
  id: "tanstack-start-missing-head-content",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "Add `<HeadContent />` inside `<head>` in your __root route — without it, route `head()` meta tags are silently dropped",
  create: (context: RuleContext) => {
    let hasHeadContentElement = false;
    let hasDocumentHeadElement = false;
    const headContentComponentNames = new Set([HEAD_CONTENT_COMPONENT_NAME]);
    const tanstackRouterNamespaceNames = new Set<string>();

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;
        if (node.source.value !== TANSTACK_ROUTER_PACKAGE) return;

        const specifiers = node.specifiers ?? [];
        for (const specifier of specifiers) {
          if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
            tanstackRouterNamespaceNames.add(specifier.local.name);
            continue;
          }

          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          if (
            !isNodeOfType(specifier.imported, "Identifier") ||
            specifier.imported.name !== HEAD_CONTENT_COMPONENT_NAME
          )
            continue;
          headContentComponentNames.add(specifier.local.name);
        }
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        if (isNodeOfType(node.name, "JSXIdentifier")) {
          if (node.name.name === DOCUMENT_HEAD_ELEMENT_NAME) {
            hasDocumentHeadElement = true;
          }
          if (headContentComponentNames.has(node.name.name)) {
            hasHeadContentElement = true;
          }
          return;
        }

        if (!isNodeOfType(node.name, "JSXMemberExpression")) return;

        const rootName = getJsxMemberRootName(node.name);
        const propertyName = getJsxMemberPropertyName(node.name);
        if (
          rootName &&
          tanstackRouterNamespaceNames.has(rootName) &&
          propertyName === HEAD_CONTENT_COMPONENT_NAME
        ) {
          hasHeadContentElement = true;
        }
      },
      "Program:exit"(programNode: EsTreeNode) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        if (hasDocumentHeadElement && !hasHeadContentElement) {
          context.report({
            node: programNode,
            message:
              "Root route (__root) without <HeadContent /> — route head() meta tags won't render",
          });
        }
      },
    };
  },
});
