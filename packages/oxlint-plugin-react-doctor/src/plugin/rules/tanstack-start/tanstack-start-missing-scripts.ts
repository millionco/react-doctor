import { TANSTACK_ROOT_ROUTE_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

const TANSTACK_ROUTER_PACKAGE = "@tanstack/react-router";
const SCRIPTS_COMPONENT_NAME = "Scripts";
const DOCUMENT_BODY_ELEMENT_NAME = "body";

const getJsxMemberRootName = (node: EsTreeNodeOfType<"JSXMemberExpression">): string | null => {
  if (isNodeOfType(node.object, "JSXIdentifier")) return node.object.name;
  if (isNodeOfType(node.object, "JSXMemberExpression")) return getJsxMemberRootName(node.object);
  return null;
};

const getJsxMemberPropertyName = (node: EsTreeNodeOfType<"JSXMemberExpression">): string | null =>
  isNodeOfType(node.property, "JSXIdentifier") ? node.property.name : null;

const getMemberRootName = (node: EsTreeNodeOfType<"MemberExpression">): string | null => {
  if (isNodeOfType(node.object, "Identifier")) return node.object.name;
  if (isNodeOfType(node.object, "MemberExpression")) return getMemberRootName(node.object);
  return null;
};

const getMemberPropertyName = (node: EsTreeNodeOfType<"MemberExpression">): string | null =>
  isNodeOfType(node.property, "Identifier") ? node.property.name : null;

const isDocumentBodyElement = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "JSXElement") &&
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  node.openingElement.name.name === DOCUMENT_BODY_ELEMENT_NAME;

const isInsideDocumentBodyElement = (node: EsTreeNode): boolean => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isDocumentBodyElement(currentNode)) return true;
    currentNode = currentNode.parent;
  }
  return false;
};

const getEnclosingComponentName = (node: EsTreeNode): string | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isNodeOfType(currentNode, "FunctionDeclaration")) {
      return isNodeOfType(currentNode.id, "Identifier") ? currentNode.id.name : null;
    }
    if (
      isNodeOfType(currentNode, "ArrowFunctionExpression") ||
      isNodeOfType(currentNode, "FunctionExpression")
    ) {
      const parentNode = currentNode.parent;
      if (
        parentNode &&
        isNodeOfType(parentNode, "VariableDeclarator") &&
        isNodeOfType(parentNode.id, "Identifier")
      ) {
        return parentNode.id.name;
      }
      return null;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

export const tanstackStartMissingScripts = defineRule({
  id: "tanstack-start-missing-scripts",
  title: "Root route missing Scripts",
  tags: ["test-noise"],
  requires: ["tanstack-start"],
  severity: "warn",
  recommendation:
    "Render `<Scripts />` near the end of `<body>` in your __root route so TanStack Start can load client-side JavaScript.",
  create: (context: RuleContext): RuleVisitors => {
    if (!TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(context.filename ?? "")) return {};

    let hasDocumentBodyElement = false;
    let hasScriptsInsideBody = false;
    const scriptsComponentNames = new Set([SCRIPTS_COMPONENT_NAME]);
    const tanstackRouterNamespaceNames = new Set<string>();
    const bodyChildComponentNames = new Set<string>();
    const scriptsWrapperComponentNames = new Set<string>();

    const collectImportBindings = (node: EsTreeNode): void => {
      if (!isNodeOfType(node, "ImportDeclaration")) return;
      const isTanstackRouterImport = node.source.value === TANSTACK_ROUTER_PACKAGE;
      for (const specifier of node.specifiers ?? []) {
        if (isTanstackRouterImport && isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
          tanstackRouterNamespaceNames.add(specifier.local.name);
          continue;
        }
        if (
          isNodeOfType(specifier, "ImportSpecifier") &&
          isNodeOfType(specifier.imported, "Identifier") &&
          specifier.imported.name === SCRIPTS_COMPONENT_NAME
        ) {
          scriptsComponentNames.add(specifier.local.name);
        }
      }
    };

    const collectVariableAlias = (node: EsTreeNode): boolean => {
      if (
        !isNodeOfType(node, "VariableDeclarator") ||
        !isNodeOfType(node.id, "Identifier") ||
        !node.init
      ) {
        return false;
      }
      if (isNodeOfType(node.init, "Identifier")) {
        if (scriptsComponentNames.has(node.init.name)) {
          const previousSize = scriptsComponentNames.size;
          scriptsComponentNames.add(node.id.name);
          return scriptsComponentNames.size !== previousSize;
        }
        if (tanstackRouterNamespaceNames.has(node.init.name)) {
          const previousSize = tanstackRouterNamespaceNames.size;
          tanstackRouterNamespaceNames.add(node.id.name);
          return tanstackRouterNamespaceNames.size !== previousSize;
        }
        return false;
      }
      if (!isNodeOfType(node.init, "MemberExpression")) return false;
      const rootName = getMemberRootName(node.init);
      const propertyName = getMemberPropertyName(node.init);
      if (
        !rootName ||
        !tanstackRouterNamespaceNames.has(rootName) ||
        propertyName !== SCRIPTS_COMPONENT_NAME
      ) {
        return false;
      }
      const previousSize = scriptsComponentNames.size;
      scriptsComponentNames.add(node.id.name);
      return scriptsComponentNames.size !== previousSize;
    };

    const isScriptsElementName = (name: EsTreeNodeOfType<"JSXOpeningElement">["name"]): boolean => {
      if (isNodeOfType(name, "JSXIdentifier")) return scriptsComponentNames.has(name.name);
      if (!isNodeOfType(name, "JSXMemberExpression")) return false;
      const rootName = getJsxMemberRootName(name);
      return Boolean(
        rootName &&
        tanstackRouterNamespaceNames.has(rootName) &&
        getJsxMemberPropertyName(name) === SCRIPTS_COMPONENT_NAME,
      );
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        for (const statement of node.body ?? []) collectImportBindings(statement);
        const variableDeclarators = (node.body ?? [])
          .filter((statement) => isNodeOfType(statement, "VariableDeclaration"))
          .flatMap((statement) => statement.declarations ?? []);
        let didCollectAlias = false;
        do {
          didCollectAlias = false;
          for (const variableDeclarator of variableDeclarators) {
            didCollectAlias = collectVariableAlias(variableDeclarator) || didCollectAlias;
          }
        } while (didCollectAlias);
      },
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        collectImportBindings(node);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        collectVariableAlias(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          isNodeOfType(node.name, "JSXIdentifier") &&
          node.name.name === DOCUMENT_BODY_ELEMENT_NAME
        ) {
          hasDocumentBodyElement = true;
          return;
        }

        const isInsideBody = isInsideDocumentBodyElement(node);
        if (isScriptsElementName(node.name)) {
          if (isInsideBody) {
            hasScriptsInsideBody = true;
            return;
          }
          const wrapperComponentName = getEnclosingComponentName(node);
          if (wrapperComponentName) scriptsWrapperComponentNames.add(wrapperComponentName);
          return;
        }

        if (
          isInsideBody &&
          isNodeOfType(node.name, "JSXIdentifier") &&
          node.name.name.charAt(0) === node.name.name.charAt(0).toUpperCase()
        ) {
          bodyChildComponentNames.add(node.name.name);
        }
      },
      "Program:exit"(programNode: EsTreeNode) {
        const hasScriptsWrapperInsideBody = [...bodyChildComponentNames].some((componentName) =>
          scriptsWrapperComponentNames.has(componentName),
        );
        if (hasDocumentBodyElement && !hasScriptsInsideBody && !hasScriptsWrapperInsideBody) {
          context.report({
            node: programNode,
            message:
              "Without <Scripts /> inside <body>, the __root route does not load TanStack Start's client-side JavaScript.",
          });
        }
      },
    };
  },
});
