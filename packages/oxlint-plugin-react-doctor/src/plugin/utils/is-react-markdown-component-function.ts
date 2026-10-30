import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const MARKDOWN_MODULE_SOURCE = "react-markdown";
const UNSUPPORTED_RUNTIME_NAMES = new Set([
  "eval",
  "Function",
  "Object",
  "Reflect",
  "require",
  "module",
  "process",
]);
const hasUnsupportedRuntimeByScopes = new WeakMap<ScopeAnalysis, boolean>();
const componentFunctionsByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();

const hasUnsupportedRuntime = (scopes: ScopeAnalysis): boolean => {
  const cached = hasUnsupportedRuntimeByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let hasUnsupportedExposure = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (isNodeOfType(node, "Identifier") && !isTypeScriptTypePosition(node)) {
      const reference = findTransparentExpressionRoot(node);
      const member = reference.parent;
      const isGlobalCarrier = ["globalThis", "window", "self", "global"].includes(node.name);
      const providerName = isGlobalCarrier
        ? isNodeOfType(member, "MemberExpression") && member.object === reference
          ? getStaticPropertyName(member)
          : null
        : node.name;
      const hasOpaqueCarrierUse =
        isGlobalCarrier &&
        !(
          isNodeOfType(member, "MemberExpression") &&
          member.object === reference &&
          getStaticPropertyName(member) !== null
        ) &&
        !(
          isNodeOfType(member, "UnaryExpression") &&
          (member.operator === "typeof" || member.operator === "void")
        );
      const symbol =
        hasOpaqueCarrierUse ||
        (providerName &&
          ["Object", "Reflect", "Function", "require", "module", "process"].includes(providerName))
          ? scopes.symbolFor(node)
          : null;
      if (
        symbol &&
        symbol.bindingIdentifier !== node &&
        isErasedTypeScriptBinding(symbol) &&
        !hasRuntimeValueBinding(symbol)
      ) {
        hasUnsupportedExposure = true;
        return false;
      }
    }
    if (hasUnsupportedExposure) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "WithStatement") || isNodeOfType(node, "ImportExpression")) {
      hasUnsupportedExposure = true;
      return false;
    }
    for (const namespaceName of UNSUPPORTED_RUNTIME_NAMES) {
      if (isProvenGlobalNamespaceReference(node, namespaceName, scopes)) {
        hasUnsupportedExposure = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getStaticPropertyKeyName(node, {
        allowComputedString: true,
        stringifyNonStringLiterals: true,
      });
      if (
        propertyName === null ||
        propertyName === "constructor" ||
        (isNodeOfType(node, "MemberExpression") &&
          isProvenGlobalObjectReference(node.object, scopes) &&
          UNSUPPORTED_RUNTIME_NAMES.has(propertyName))
      ) {
        hasUnsupportedExposure = true;
        return false;
      }
    }
    const dependencySource = getRuntimeStaticDependencySource(node);
    if (dependencySource === "module" || dependencySource === "node:module") {
      hasUnsupportedExposure = true;
    }
  });
  hasUnsupportedRuntimeByScopes.set(scopes, hasUnsupportedExposure);
  return hasUnsupportedExposure;
};

const isReadonlyJsxRenderer = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => {
    const identifier = reference.identifier;
    const parent = identifier.parent;
    return (
      reference.flag === "read" &&
      !isBindingAssignmentTarget(identifier) &&
      isNodeOfType(identifier, "JSXIdentifier") &&
      (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
      parent.name === identifier
    );
  });

const isMarkdownComponentsValue = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const valueRoot = findTransparentExpressionRoot(expression);
  const container = valueRoot.parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    container.expression !== valueRoot ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "components" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.attributes.some(
      (candidate) =>
        isNodeOfType(candidate, "JSXSpreadAttribute") ||
        (candidate !== attribute &&
          isNodeOfType(candidate, "JSXAttribute") &&
          isNodeOfType(candidate.name, "JSXIdentifier") &&
          candidate.name.name === "components"),
    )
  ) {
    return false;
  }
  const rendererSymbol = scopes.symbolFor(opening.name);
  const declaration = rendererSymbol ? getImportDeclarationForSymbol(rendererSymbol) : null;
  return Boolean(
    rendererSymbol &&
    declaration &&
    isNodeOfType(rendererSymbol.declarationNode, "ImportDefaultSpecifier") &&
    declaration.source.value === MARKDOWN_MODULE_SOURCE &&
    declaration.importKind !== "type" &&
    isReadonlyJsxRenderer(rendererSymbol),
  );
};

const isClosedMapInitializer = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const initializerRoot = findTransparentExpressionRoot(expression);
  if (isMarkdownComponentsValue(initializerRoot, scopes)) return true;
  const declaration = initializerRoot.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== initializerRoot ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    isNodeOfType(declaration.parent.parent, "ExportNamedDeclaration")
  ) {
    return false;
  }
  const symbol = scopes.symbolFor(declaration.id);
  return Boolean(
    symbol &&
    symbol.references.some((reference) =>
      isMarkdownComponentsValue(reference.identifier, scopes),
    ) &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" &&
        !isBindingAssignmentTarget(reference.identifier) &&
        isMarkdownComponentsValue(reference.identifier, scopes),
    ),
  );
};

const isOwnFunctionMap = (componentMap: EsTreeNode): boolean => {
  if (!isNodeOfType(componentMap, "ObjectExpression")) return false;
  const propertyNames = new Set<string>();
  return componentMap.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      !isNodeOfType(stripParenExpression(property.value), "ArrowFunctionExpression")
    ) {
      return false;
    }
    const key = getStaticPropertyKeyName(property);
    if (key === null || key === "__proto__" || propertyNames.has(key)) return false;
    propertyNames.add(key);
    return true;
  });
};

const hasMarkdownComponentRole = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(functionNode, "ArrowFunctionExpression")) return false;
  const functionRoot = findTransparentExpressionRoot(functionNode);
  const property = functionRoot.parent;
  const componentMap = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.value !== functionRoot ||
    !componentMap ||
    !isOwnFunctionMap(componentMap) ||
    hasUnsupportedRuntime(scopes)
  ) {
    return false;
  }
  if (isClosedMapInitializer(componentMap, scopes)) return true;
  const mapRoot = findTransparentExpressionRoot(componentMap);
  const producer = mapRoot.parent;
  const producerRoot = producer ? findTransparentExpressionRoot(producer) : null;
  const memoCall = producerRoot?.parent;
  if (
    !isNodeOfType(producer, "ArrowFunctionExpression") ||
    producer.async ||
    producer.body !== mapRoot ||
    !isNodeOfType(memoCall, "CallExpression")
  ) {
    return false;
  }
  const [memoCallback] = memoCall.arguments;
  const receiver = getRootIdentifier(memoCall.callee);
  const symbol = receiver ? scopes.symbolFor(receiver) : null;
  const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  return (
    Boolean(
      symbol &&
      declaration &&
      declaration.importKind !== "type" &&
      declaration.source.value === "react" &&
      (!isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
        symbol.declarationNode.importKind !== "type"),
    ) &&
    memoCallback === producerRoot &&
    isProvenUnmodifiedReactApiCall(memoCall, "useMemo", scopes) &&
    !hasReactDefaultProviderMutation("useMemo", scopes) &&
    isClosedMapInitializer(memoCall, scopes)
  );
};

export const isReactMarkdownComponentFunction = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let componentFunctions = componentFunctionsByScopes.get(scopes);
  if (!componentFunctions) {
    componentFunctions = new WeakMap();
    componentFunctionsByScopes.set(scopes, componentFunctions);
  }
  const cached = componentFunctions.get(functionNode);
  if (cached !== undefined) return cached;
  const isComponent = hasMarkdownComponentRole(functionNode, scopes);
  componentFunctions.set(functionNode, isComponent);
  return isComponent;
};
