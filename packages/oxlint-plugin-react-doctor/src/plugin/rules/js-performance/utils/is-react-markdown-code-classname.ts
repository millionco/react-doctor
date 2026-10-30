import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveImportedJsxComponentName } from "../../../utils/resolve-imported-jsx-component-name.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasClosedReactMarkdownCodeProvider } from "./has-closed-react-markdown-code-provider.js";
import {
  REACT_MARKDOWN_FIRST_VALUE_INDEX,
  REACT_MARKDOWN_SINGLE_VALUE_COUNT,
} from "./constants.js";

const classnameProofs = new WeakMap<ScopeAnalysis, WeakMap<SymbolDescriptor, boolean>>();

export const isReactMarkdownCodeClassname = (
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(identifier);
  if (!symbol || symbol.kind !== "parameter") return false;
  let proofs = classnameProofs.get(scopes);
  if (!proofs) {
    proofs = new WeakMap();
    classnameProofs.set(scopes, proofs);
  }
  const cached = proofs.get(symbol);
  if (cached !== undefined) return cached;
  proofs.set(symbol, false);
  const property = symbol.bindingIdentifier.parent;
  const pattern = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    getStaticKeyName(property.key) !== "className" ||
    property.value !== symbol.bindingIdentifier ||
    !isNodeOfType(pattern, "ObjectPattern") ||
    pattern.properties.some((entry) => isNodeOfType(entry, "Property") && entry.computed) ||
    pattern.properties.filter(
      (entry) => isNodeOfType(entry, "Property") && getStaticKeyName(entry.key) === "className",
    ).length !== REACT_MARKDOWN_SINGLE_VALUE_COUNT ||
    symbol.references.some(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
  ) {
    return false;
  }
  const renderer = pattern.parent;
  if (
    (!isNodeOfType(renderer, "FunctionExpression") &&
      !isNodeOfType(renderer, "ArrowFunctionExpression")) ||
    renderer.async ||
    (isNodeOfType(renderer, "FunctionExpression") && (renderer.generator || renderer.id)) ||
    renderer.params.length !== REACT_MARKDOWN_SINGLE_VALUE_COUNT ||
    renderer.params[REACT_MARKDOWN_FIRST_VALUE_INDEX] !== pattern
  ) {
    return false;
  }
  const rendererProperty = renderer.parent;
  const components = rendererProperty?.parent;
  if (
    !isNodeOfType(rendererProperty, "Property") ||
    rendererProperty.computed ||
    rendererProperty.kind !== "init" ||
    rendererProperty.value !== renderer ||
    getStaticKeyName(rendererProperty.key) !== "code" ||
    !isNodeOfType(components, "ObjectExpression") ||
    components.properties.some(
      (entry) => !isNodeOfType(entry, "Property") || entry.computed || entry.kind !== "init",
    ) ||
    components.properties.filter(
      (entry) => isNodeOfType(entry, "Property") && getStaticKeyName(entry.key) === "code",
    ).length !== REACT_MARKDOWN_SINGLE_VALUE_COUNT
  ) {
    return false;
  }
  const container = components.parent;
  const attribute = container?.parent;
  const opening = attribute?.parent;
  if (
    !isNodeOfType(container, "JSXExpressionContainer") ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.name, "JSXIdentifier") ||
    attribute.name.name !== "components" ||
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    opening.attributes.some((entry) => isNodeOfType(entry, "JSXSpreadAttribute")) ||
    opening.attributes.filter(
      (entry) =>
        isNodeOfType(entry, "JSXAttribute") &&
        isNodeOfType(entry.name, "JSXIdentifier") &&
        entry.name.name === "components",
    ).length !== REACT_MARKDOWN_SINGLE_VALUE_COUNT ||
    resolveImportedJsxComponentName(opening, "react-markdown", scopes) !== "default"
  ) {
    return false;
  }
  const provider = scopes.symbolFor(opening.name);
  if (!provider || !isNodeOfType(provider.declarationNode, "ImportDefaultSpecifier")) return false;
  if (!hasClosedReactMarkdownCodeProvider(scopes)) return false;
  let hasRendererExposure = false;
  walkAst(renderer, (node) => {
    if (hasRendererExposure) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Identifier") &&
        node.name === "arguments" &&
        scopes.referenceFor(node) !== null)
    ) {
      hasRendererExposure = true;
      return false;
    }
    return undefined;
  });
  const isSupported = !hasRendererExposure;
  proofs.set(symbol, isSupported);
  return isSupported;
};
