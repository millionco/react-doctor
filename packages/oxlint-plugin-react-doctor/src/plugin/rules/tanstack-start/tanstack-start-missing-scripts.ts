import { EMPTY_RULE_VISITORS } from "../../utils/empty-rule-visitors.js";
import { TANSTACK_ROOT_ROUTE_FILE_PATTERN } from "../../constants/tanstack.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../utils/find-enclosing-class.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getClassBindingSymbol } from "../../utils/get-class-binding-symbol.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const TANSTACK_ROUTER_PACKAGE = "@tanstack/react-router";
const TANSTACK_ROOT_ROUTE_FACTORY_NAMES = new Set([
  "createRootRoute",
  "createRootRouteWithContext",
]);
const SCRIPTS_COMPONENT_NAME = "Scripts";
const DOCUMENT_BODY_ELEMENT_NAME = "body";
const CLASS_RENDER_METHOD_NAME = "render";
const ROOT_DOCUMENT_COMPONENT_PROPERTY_NAMES = ["component", "shellComponent"];

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

const isDocumentBodyElement = (node: EsTreeNode): node is EsTreeNodeOfType<"JSXElement"> =>
  isNodeOfType(node, "JSXElement") &&
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  node.openingElement.name.name === DOCUMENT_BODY_ELEMENT_NAME;

const getEnclosingDocumentBodyElement = (
  node: EsTreeNode,
): EsTreeNodeOfType<"JSXElement"> | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isDocumentBodyElement(currentNode)) return currentNode;
    currentNode = currentNode.parent;
  }
  return null;
};

const getClassComponentDeclaration = (
  node: EsTreeNodeOfType<"ClassDeclaration" | "ClassExpression">,
  context: RuleContext,
): EsTreeNode => getClassBindingSymbol(node, context.scopes)?.declarationNode ?? node;

const getEnclosingComponentDeclaration = (
  node: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (isNodeOfType(currentNode, "FunctionDeclaration")) {
      return currentNode;
    }
    if (
      isNodeOfType(currentNode, "ArrowFunctionExpression") ||
      isNodeOfType(currentNode, "FunctionExpression")
    ) {
      const parentNode = findTransparentExpressionRoot(currentNode).parent;
      if (
        parentNode &&
        (isNodeOfType(parentNode, "MethodDefinition") ||
          isNodeOfType(parentNode, "PropertyDefinition")) &&
        getStaticPropertyKeyName(parentNode, { allowComputedString: true }) ===
          CLASS_RENDER_METHOD_NAME
      ) {
        const classNode = findEnclosingClass(parentNode);
        if (classNode) return getClassComponentDeclaration(classNode, context);
      }
      if (
        parentNode &&
        isNodeOfType(parentNode, "VariableDeclarator") &&
        isNodeOfType(parentNode.id, "Identifier")
      ) {
        return context.scopes.symbolFor(parentNode.id)?.declarationNode ?? null;
      }
      return currentNode;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const getEnclosingVariableDeclaration = (
  node: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  let currentNode = node.parent;
  while (currentNode) {
    if (
      isNodeOfType(currentNode, "VariableDeclarator") &&
      isNodeOfType(currentNode.id, "Identifier")
    ) {
      return currentNode;
    }
    if (isFunctionLike(currentNode)) return null;
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
    if (!TANSTACK_ROOT_ROUTE_FILE_PATTERN.test(context.filename ?? "")) return EMPTY_RULE_VISITORS;

    const scriptsComponentDeclarations = new Set<EsTreeNode>();
    const tanstackRouterNamespaceDeclarations = new Set<EsTreeNode>();
    const rootRouteFactoryDeclarations = new Set<EsTreeNode>();
    const configuredRootComponentDeclarations = new Set<EsTreeNode>();
    const documentBodyElements = new Set<EsTreeNodeOfType<"JSXElement">>();
    const scriptsInsideBodyElements = new Set<EsTreeNodeOfType<"JSXElement">>();
    const scriptsValueDeclarations = new Set<EsTreeNode>();
    const scriptsWrapperComponentDeclarations = new Set<EsTreeNode>();
    const componentDependencyDeclarations = new Map<EsTreeNode, Set<EsTreeNode>>();
    const bodyChildComponentDeclarations = new Map<
      EsTreeNodeOfType<"JSXElement">,
      Set<EsTreeNode>
    >();
    const bodyExpressionDeclarations = new Map<EsTreeNodeOfType<"JSXElement">, Set<EsTreeNode>>();

    const collectImportBindings = (node: EsTreeNode): void => {
      if (!isNodeOfType(node, "ImportDeclaration")) return;
      const isTanstackRouterImport = node.source.value === TANSTACK_ROUTER_PACKAGE;
      for (const specifier of node.specifiers ?? []) {
        const bindingDeclaration = getBindingDeclaration(specifier.local, context);
        if (!bindingDeclaration) continue;
        if (
          isNodeOfType(specifier, "ImportDefaultSpecifier") &&
          specifier.local.name === SCRIPTS_COMPONENT_NAME
        ) {
          scriptsComponentDeclarations.add(bindingDeclaration);
          continue;
        }
        if (isTanstackRouterImport && isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
          tanstackRouterNamespaceDeclarations.add(bindingDeclaration);
          continue;
        }
        if (
          !isNodeOfType(specifier, "ImportSpecifier") ||
          !isNodeOfType(specifier.imported, "Identifier")
        ) {
          continue;
        }
        if (specifier.imported.name === SCRIPTS_COMPONENT_NAME) {
          scriptsComponentDeclarations.add(bindingDeclaration);
        }
        if (
          isTanstackRouterImport &&
          TANSTACK_ROOT_ROUTE_FACTORY_NAMES.has(specifier.imported.name)
        ) {
          rootRouteFactoryDeclarations.add(bindingDeclaration);
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
        let didCollectAlias = false;
        if (initializerDeclaration && scriptsComponentDeclarations.has(initializerDeclaration)) {
          const previousSize = scriptsComponentDeclarations.size;
          scriptsComponentDeclarations.add(aliasDeclaration);
          didCollectAlias = scriptsComponentDeclarations.size !== previousSize;
        }
        if (
          initializerDeclaration &&
          tanstackRouterNamespaceDeclarations.has(initializerDeclaration)
        ) {
          const previousSize = tanstackRouterNamespaceDeclarations.size;
          tanstackRouterNamespaceDeclarations.add(aliasDeclaration);
          didCollectAlias =
            tanstackRouterNamespaceDeclarations.size !== previousSize || didCollectAlias;
        }
        if (initializerDeclaration && rootRouteFactoryDeclarations.has(initializerDeclaration)) {
          const previousSize = rootRouteFactoryDeclarations.size;
          rootRouteFactoryDeclarations.add(aliasDeclaration);
          didCollectAlias = rootRouteFactoryDeclarations.size !== previousSize || didCollectAlias;
        }
        return didCollectAlias;
      }
      if (!isNodeOfType(node.init, "MemberExpression")) return false;
      const rootIdentifier = getMemberRootIdentifier(node.init);
      const rootDeclaration = rootIdentifier
        ? getBindingDeclaration(rootIdentifier, context)
        : null;
      const propertyName = getMemberPropertyName(node.init);
      if (!rootDeclaration || !tanstackRouterNamespaceDeclarations.has(rootDeclaration)) {
        return false;
      }
      if (propertyName === SCRIPTS_COMPONENT_NAME) {
        const previousSize = scriptsComponentDeclarations.size;
        scriptsComponentDeclarations.add(aliasDeclaration);
        return scriptsComponentDeclarations.size !== previousSize;
      }
      if (propertyName && TANSTACK_ROOT_ROUTE_FACTORY_NAMES.has(propertyName)) {
        const previousSize = rootRouteFactoryDeclarations.size;
        rootRouteFactoryDeclarations.add(aliasDeclaration);
        return rootRouteFactoryDeclarations.size !== previousSize;
      }
      return false;
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

    const isRootRouteFactoryCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
      let callee = stripParenExpression(node.callee);
      while (isNodeOfType(callee, "CallExpression")) {
        callee = stripParenExpression(callee.callee);
      }
      if (isNodeOfType(callee, "Identifier")) {
        const factoryDeclaration = getBindingDeclaration(callee, context);
        return factoryDeclaration
          ? rootRouteFactoryDeclarations.has(factoryDeclaration)
          : TANSTACK_ROOT_ROUTE_FACTORY_NAMES.has(callee.name);
      }
      if (!isNodeOfType(callee, "MemberExpression")) return false;
      const rootIdentifier = getMemberRootIdentifier(callee);
      const rootDeclaration = rootIdentifier
        ? getBindingDeclaration(rootIdentifier, context)
        : null;
      const propertyName = getMemberPropertyName(callee);
      return Boolean(
        rootDeclaration &&
        tanstackRouterNamespaceDeclarations.has(rootDeclaration) &&
        propertyName &&
        TANSTACK_ROOT_ROUTE_FACTORY_NAMES.has(propertyName),
      );
    };

    const collectConfiguredRootComponent = (componentValue: EsTreeNode): void => {
      const unwrappedComponentValue = stripParenExpression(componentValue);
      if (isFunctionLike(unwrappedComponentValue)) {
        configuredRootComponentDeclarations.add(unwrappedComponentValue);
        return;
      }
      if (isNodeOfType(unwrappedComponentValue, "ClassExpression")) {
        configuredRootComponentDeclarations.add(
          getClassComponentDeclaration(unwrappedComponentValue, context),
        );
        return;
      }
      if (!isNodeOfType(unwrappedComponentValue, "Identifier")) return;
      const componentDeclaration = getBindingDeclaration(unwrappedComponentValue, context);
      if (componentDeclaration) configuredRootComponentDeclarations.add(componentDeclaration);
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
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isRootRouteFactoryCall(node)) return;
        const optionsArgument = node.arguments[0];
        if (!optionsArgument || isNodeOfType(optionsArgument, "SpreadElement")) return;
        const optionsObject = resolveStableOptionsObject(
          optionsArgument,
          ROOT_DOCUMENT_COMPONENT_PROPERTY_NAMES,
          context.scopes,
          node,
        );
        if (!optionsObject) return;
        for (const property of optionsObject.properties) {
          if (
            !isNodeOfType(property, "Property") ||
            !ROOT_DOCUMENT_COMPONENT_PROPERTY_NAMES.includes(
              getStaticPropertyKeyName(property, { allowComputedString: true }) ?? "",
            )
          ) {
            continue;
          }
          collectConfiguredRootComponent(property.value);
        }
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const enclosingBodyElement = getEnclosingDocumentBodyElement(node);
        if (
          isNodeOfType(node.name, "JSXIdentifier") &&
          node.name.name === DOCUMENT_BODY_ELEMENT_NAME
        ) {
          if (enclosingBodyElement) documentBodyElements.add(enclosingBodyElement);
          return;
        }

        if (isScriptsElementName(node.name)) {
          const scriptsValueDeclaration = getEnclosingVariableDeclaration(node);
          if (scriptsValueDeclaration) {
            scriptsValueDeclarations.add(scriptsValueDeclaration);
          }
          if (enclosingBodyElement) {
            scriptsInsideBodyElements.add(enclosingBodyElement);
            return;
          }
          const wrapperComponentDeclaration = getEnclosingComponentDeclaration(node, context);
          if (wrapperComponentDeclaration) {
            scriptsWrapperComponentDeclarations.add(wrapperComponentDeclaration);
          }
          return;
        }

        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const childComponentDeclaration = getBindingDeclaration(node.name, context);
        if (!childComponentDeclaration) return;
        if (enclosingBodyElement) {
          const bodyChildDeclarations =
            bodyChildComponentDeclarations.get(enclosingBodyElement) ?? new Set<EsTreeNode>();
          bodyChildDeclarations.add(childComponentDeclaration);
          bodyChildComponentDeclarations.set(enclosingBodyElement, bodyChildDeclarations);
        }

        const enclosingComponentDeclaration = getEnclosingComponentDeclaration(node, context);
        if (!enclosingComponentDeclaration) return;
        const dependencyDeclarations =
          componentDependencyDeclarations.get(enclosingComponentDeclaration) ??
          new Set<EsTreeNode>();
        dependencyDeclarations.add(childComponentDeclaration);
        componentDependencyDeclarations.set(enclosingComponentDeclaration, dependencyDeclarations);
      },
      JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
        const enclosingBodyElement = getEnclosingDocumentBodyElement(node);
        if (!enclosingBodyElement || !isNodeOfType(node.expression, "Identifier")) return;
        const expressionDeclaration = getBindingDeclaration(node.expression, context);
        if (!expressionDeclaration) return;
        const expressionDeclarations =
          bodyExpressionDeclarations.get(enclosingBodyElement) ?? new Set<EsTreeNode>();
        expressionDeclarations.add(expressionDeclaration);
        bodyExpressionDeclarations.set(enclosingBodyElement, expressionDeclarations);
      },
      "Program:exit"(programNode: EsTreeNode) {
        const reachableRootComponentDeclarations = new Set(configuredRootComponentDeclarations);
        for (const componentDeclaration of reachableRootComponentDeclarations) {
          for (const dependencyDeclaration of componentDependencyDeclarations.get(
            componentDeclaration,
          ) ?? []) {
            reachableRootComponentDeclarations.add(dependencyDeclaration);
          }
        }

        for (const documentBodyElement of documentBodyElements) {
          const bodyOwnerDeclaration = getEnclosingComponentDeclaration(
            documentBodyElement,
            context,
          );
          if (
            !bodyOwnerDeclaration ||
            !reachableRootComponentDeclarations.has(bodyOwnerDeclaration)
          ) {
            continue;
          }
          if (scriptsInsideBodyElements.has(documentBodyElement)) continue;
          const renderedExpressionDeclarations =
            bodyExpressionDeclarations.get(documentBodyElement) ?? [];
          if (
            [...renderedExpressionDeclarations].some((declaration) =>
              scriptsValueDeclarations.has(declaration),
            )
          ) {
            continue;
          }

          const reachableBodyChildDeclarations = new Set(
            bodyChildComponentDeclarations.get(documentBodyElement) ?? [],
          );
          let hasScriptsWrapperInsideBody = false;
          for (const componentDeclaration of reachableBodyChildDeclarations) {
            if (scriptsWrapperComponentDeclarations.has(componentDeclaration)) {
              hasScriptsWrapperInsideBody = true;
              break;
            }
            for (const dependencyDeclaration of componentDependencyDeclarations.get(
              componentDeclaration,
            ) ?? []) {
              reachableBodyChildDeclarations.add(dependencyDeclaration);
            }
          }
          if (hasScriptsWrapperInsideBody) continue;

          context.report({
            node: programNode,
            message:
              "Without <Scripts /> inside <body>, the __root route does not load TanStack Start's client-side JavaScript.",
          });
          return;
        }
      },
    };
  },
});
