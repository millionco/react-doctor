import { TANSTACK_ROOT_ROUTE_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
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

const getMemberRootName = (node: EsTreeNodeOfType<"MemberExpression">): string | null => {
  if (isNodeOfType(node.object, "Identifier")) return node.object.name;
  if (isNodeOfType(node.object, "MemberExpression")) return getMemberRootName(node.object);
  return null;
};

const getMemberPropertyName = (node: EsTreeNodeOfType<"MemberExpression">): string | null => {
  if (isNodeOfType(node.property, "Identifier")) return node.property.name;
  return null;
};

const isDocumentHeadElement = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXElement") &&
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  node.openingElement.name.name === DOCUMENT_HEAD_ELEMENT_NAME;

const isInsideDocumentHeadElement = (node: EsTreeNode): boolean => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isDocumentHeadElement(currentNode)) return true;
    currentNode = currentNode.parent;
  }
  return false;
};

const isCustomJsxElementName = (node: EsTreeNodeOfType<"JSXOpeningElement">["name"]): boolean => {
  if (isNodeOfType(node, "JSXIdentifier")) {
    const firstCharacter = node.name.charAt(0);
    return (
      firstCharacter.toUpperCase() === firstCharacter &&
      firstCharacter.toLowerCase() !== firstCharacter
    );
  }
  if (!isNodeOfType(node, "JSXMemberExpression")) return false;
  const rootName = getJsxMemberRootName(node);
  if (!rootName) return false;
  const firstCharacter = rootName.charAt(0);
  return (
    firstCharacter.toUpperCase() === firstCharacter &&
    firstCharacter.toLowerCase() !== firstCharacter
  );
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
    let hasCustomHeadChildElement = false;
    const headContentComponentNames = new Set([HEAD_CONTENT_COMPONENT_NAME]);
    const tanstackRouterNamespaceNames = new Set<string>();

    const collectImportBindings = (node: EsTreeNode): void => {
      if (!isNodeOfType(node, "ImportDeclaration")) return;

      const isTanstackRouterImport = node.source.value === TANSTACK_ROUTER_PACKAGE;

      const specifiers = node.specifiers ?? [];
      for (const specifier of specifiers) {
        // Namespace imports are only trusted from TanStack Router because
        // `<Namespace.HeadContent />` otherwise has no portable meaning.
        if (isTanstackRouterImport && isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
          tanstackRouterNamespaceNames.add(specifier.local.name);
          continue;
        }

        // Named `HeadContent` imports are trusted from any source to avoid
        // false positives for project barrels that re-export TanStack's component.
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (
          !isNodeOfType(specifier.imported, "Identifier") ||
          specifier.imported.name !== HEAD_CONTENT_COMPONENT_NAME
        )
          continue;
        headContentComponentNames.add(specifier.local.name);
      }
    };

    const collectVariableAlias = (node: EsTreeNode): void => {
      if (!isNodeOfType(node, "VariableDeclarator")) return;
      if (!isNodeOfType(node.id, "Identifier")) return;

      const initializer = node.init;
      if (!initializer) return;

      if (isNodeOfType(initializer, "Identifier")) {
        // Propagate simple aliases like `const AppHead = HeadContent` and
        // namespace aliases like `const Router = TanStackRouter`.
        if (headContentComponentNames.has(initializer.name)) {
          headContentComponentNames.add(node.id.name);
        }
        if (tanstackRouterNamespaceNames.has(initializer.name)) {
          tanstackRouterNamespaceNames.add(node.id.name);
        }
        return;
      }

      if (!isNodeOfType(initializer, "MemberExpression")) return;

      const rootName = getMemberRootName(initializer);
      const propertyName = getMemberPropertyName(initializer);
      if (
        rootName &&
        tanstackRouterNamespaceNames.has(rootName) &&
        propertyName === HEAD_CONTENT_COMPONENT_NAME
      ) {
        // Captures `const AppHead = TanStackRouter.HeadContent`.
        headContentComponentNames.add(node.id.name);
      }
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        const statements = node.body ?? [];
        // Pre-scan top-level imports before JSX visits so late import
        // declarations do not make alias detection source-order dependent.
        for (const statement of statements) {
          collectImportBindings(statement);
        }
        // Then collect top-level aliases once the import namespace/name sets
        // are populated.
        for (const statement of statements) {
          if (!isNodeOfType(statement, "VariableDeclaration")) continue;
          for (const declaration of statement.declarations ?? []) {
            collectVariableAlias(declaration);
          }
        }
      },
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;
        collectImportBindings(node);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        const filename = context.getFilename?.() ?? "";
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;
        collectVariableAlias(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const filename = normalizeFilename(context.getFilename?.() ?? "");
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        if (isNodeOfType(node.name, "JSXIdentifier")) {
          if (node.name.name === DOCUMENT_HEAD_ELEMENT_NAME) {
            hasDocumentHeadElement = true;
          }
          if (headContentComponentNames.has(node.name.name)) {
            hasHeadContentElement = true;
          }
          // Any custom component under `<head>` may wrap HeadContent from
          // another module. Treat it as a safe signal rather than guessing.
          if (isInsideDocumentHeadElement(node) && isCustomJsxElementName(node.name)) {
            hasCustomHeadChildElement = true;
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
        // Same conservative treatment for `<Namespace.DocumentHead />`.
        if (isInsideDocumentHeadElement(node) && isCustomJsxElementName(node.name)) {
          hasCustomHeadChildElement = true;
        }
      },
      "Program:exit"(programNode: EsTreeNode) {
        const filename = normalizeFilename(context.getFilename?.() ?? "");
        const isRootRouteFile = TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(filename);
        if (!isRootRouteFile) return;

        if (hasDocumentHeadElement && !hasHeadContentElement && !hasCustomHeadChildElement) {
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
