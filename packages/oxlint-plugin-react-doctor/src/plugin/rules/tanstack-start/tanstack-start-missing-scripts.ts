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

const getJsxMemberRootIdentifier = (
  node: EsTreeNodeOfType<"JSXMemberExpression">,
): EsTreeNodeOfType<"JSXIdentifier"> | null => {
  if (isNodeOfType(node.object, "JSXIdentifier")) return node.object;
  if (isNodeOfType(node.object, "JSXMemberExpression")) {
    return getJsxMemberRootIdentifier(node.object);
  }
  return null;
};

const getJsxMemberPropertyName = (node: EsTreeNodeOfType<"JSXMemberExpression">): string | null =>
  isNodeOfType(node.property, "JSXIdentifier") ? node.property.name : null;

const getMemberRootIdentifier = (
  node: EsTreeNodeOfType<"MemberExpression">,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (isNodeOfType(node.object, "Identifier")) return node.object;
  if (isNodeOfType(node.object, "MemberExpression")) return getMemberRootIdentifier(node.object);
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

const getEnclosingComponentIdentifier = (
  node: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isNodeOfType(currentNode, "FunctionDeclaration")) {
      return isNodeOfType(currentNode.id, "Identifier") ? currentNode.id : null;
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
        return parentNode.id;
      }
      return null;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const getBindingDeclaration = (node: EsTreeNode, context: RuleContext): EsTreeNode | null =>
  context.scopes.symbolFor(node)?.declarationNode ?? null;

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
    const scriptsComponentDeclarations = new Set<EsTreeNode>();
    const tanstackRouterNamespaceDeclarations = new Set<EsTreeNode>();
    const bodyChildComponentDeclarations = new Set<EsTreeNode>();
    const scriptsWrapperComponentDeclarations = new Set<EsTreeNode>();
    const componentDependencyDeclarations = new Map<EsTreeNode, Set<EsTreeNode>>();

    const collectImportBindings = (node: EsTreeNode): void => {
      if (!isNodeOfType(node, "ImportDeclaration")) return;
      const isTanstackRouterImport = node.source.value === TANSTACK_ROUTER_PACKAGE;
      for (const specifier of node.specifiers ?? []) {
        if (isTanstackRouterImport && isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
          const namespaceDeclaration = getBindingDeclaration(specifier.local, context);
          if (namespaceDeclaration) tanstackRouterNamespaceDeclarations.add(namespaceDeclaration);
          continue;
        }
        if (
          isNodeOfType(specifier, "ImportSpecifier") &&
          isNodeOfType(specifier.imported, "Identifier") &&
          specifier.imported.name === SCRIPTS_COMPONENT_NAME
        ) {
          const scriptsComponentDeclaration = getBindingDeclaration(specifier.local, context);
          if (scriptsComponentDeclaration) {
            scriptsComponentDeclarations.add(scriptsComponentDeclaration);
          }
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
      const aliasDeclaration = getBindingDeclaration(node.id, context);
      if (!aliasDeclaration) return false;
      if (isNodeOfType(node.init, "Identifier")) {
        const initializerDeclaration = getBindingDeclaration(node.init, context);
        if (initializerDeclaration && scriptsComponentDeclarations.has(initializerDeclaration)) {
          const previousSize = scriptsComponentDeclarations.size;
          scriptsComponentDeclarations.add(aliasDeclaration);
          return scriptsComponentDeclarations.size !== previousSize;
        }
        if (
          initializerDeclaration &&
          tanstackRouterNamespaceDeclarations.has(initializerDeclaration)
        ) {
          const previousSize = tanstackRouterNamespaceDeclarations.size;
          tanstackRouterNamespaceDeclarations.add(aliasDeclaration);
          return tanstackRouterNamespaceDeclarations.size !== previousSize;
        }
        return false;
      }
      if (!isNodeOfType(node.init, "MemberExpression")) return false;
      const rootIdentifier = getMemberRootIdentifier(node.init);
      const rootDeclaration = rootIdentifier
        ? getBindingDeclaration(rootIdentifier, context)
        : null;
      const propertyName = getMemberPropertyName(node.init);
      if (
        !rootDeclaration ||
        !tanstackRouterNamespaceDeclarations.has(rootDeclaration) ||
        propertyName !== SCRIPTS_COMPONENT_NAME
      ) {
        return false;
      }
      const previousSize = scriptsComponentDeclarations.size;
      scriptsComponentDeclarations.add(aliasDeclaration);
      return scriptsComponentDeclarations.size !== previousSize;
    };

    const isScriptsElementName = (name: EsTreeNodeOfType<"JSXOpeningElement">["name"]): boolean => {
      if (isNodeOfType(name, "JSXIdentifier")) {
        const componentDeclaration = getBindingDeclaration(name, context);
        return componentDeclaration
          ? scriptsComponentDeclarations.has(componentDeclaration)
          : name.name === SCRIPTS_COMPONENT_NAME;
      }
      if (!isNodeOfType(name, "JSXMemberExpression")) return false;
      const rootIdentifier = getJsxMemberRootIdentifier(name);
      const rootDeclaration = rootIdentifier
        ? getBindingDeclaration(rootIdentifier, context)
        : null;
      return Boolean(
        rootDeclaration &&
        tanstackRouterNamespaceDeclarations.has(rootDeclaration) &&
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
          const wrapperComponentIdentifier = getEnclosingComponentIdentifier(node);
          const wrapperComponentDeclaration = wrapperComponentIdentifier
            ? getBindingDeclaration(wrapperComponentIdentifier, context)
            : null;
          if (wrapperComponentDeclaration) {
            scriptsWrapperComponentDeclarations.add(wrapperComponentDeclaration);
          }
          return;
        }

        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const childComponentDeclaration = getBindingDeclaration(node.name, context);
        if (!childComponentDeclaration) return;
        if (isInsideBody) bodyChildComponentDeclarations.add(childComponentDeclaration);

        const enclosingComponentIdentifier = getEnclosingComponentIdentifier(node);
        const enclosingComponentDeclaration = enclosingComponentIdentifier
          ? getBindingDeclaration(enclosingComponentIdentifier, context)
          : null;
        if (!enclosingComponentDeclaration) return;
        const dependencyDeclarations =
          componentDependencyDeclarations.get(enclosingComponentDeclaration) ??
          new Set<EsTreeNode>();
        dependencyDeclarations.add(childComponentDeclaration);
        componentDependencyDeclarations.set(enclosingComponentDeclaration, dependencyDeclarations);
      },
      "Program:exit"(programNode: EsTreeNode) {
        const reachableComponentDeclarations = new Set(bodyChildComponentDeclarations);
        let hasScriptsWrapperInsideBody = false;
        for (const componentDeclaration of reachableComponentDeclarations) {
          if (scriptsWrapperComponentDeclarations.has(componentDeclaration)) {
            hasScriptsWrapperInsideBody = true;
            break;
          }
          for (const dependencyDeclaration of componentDependencyDeclarations.get(
            componentDeclaration,
          ) ?? []) {
            reachableComponentDeclarations.add(dependencyDeclaration);
          }
        }
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
