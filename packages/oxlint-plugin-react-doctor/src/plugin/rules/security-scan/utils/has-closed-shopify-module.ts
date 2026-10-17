import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  SHOPIFY_API_MODULE,
  SHOPIFY_NODE_ADAPTER_MODULE,
  SHOPIFY_FORBIDDEN_SELECTORS,
  SHOPIFY_FORBIDDEN_RUNTIME_NAMES,
  SHOPIFY_VALIDATION_ARGUMENT_COUNT,
} from "./shopify-webhook-constants.js";

export const hasClosedShopifyModule = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let isClosed = true;
  let factoryImportCount = 0;
  walkAst(program, (node) => {
    if (!isClosed) return false;
    if (
      node.type.startsWith("TS") ||
      ("declare" in node && node.declare) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression")
    ) {
      isClosed = false;
      return false;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      scopes.referenceFor(node) &&
      SHOPIFY_FORBIDDEN_RUNTIME_NAMES.has(node.name)
    ) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "MemberExpression") || isNodeOfType(node, "Property")) {
      const propertyName = getResolvedStaticPropertyName(node, scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        (node.computed && propertyName === null) ||
        (propertyName !== null && SHOPIFY_FORBIDDEN_SELECTORS.has(propertyName))
      ) {
        isClosed = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "ImportDeclaration") || typeof node.source.value !== "string") return;
    const source = node.source.value;
    if (source === SHOPIFY_NODE_ADAPTER_MODULE) {
      if (node.specifiers.length !== 0) isClosed = false;
      return;
    }
    if (source !== SHOPIFY_API_MODULE) {
      if (source.startsWith(`${SHOPIFY_API_MODULE}/`)) isClosed = false;
      return;
    }
    if (node.importKind === "type") {
      isClosed = false;
      return;
    }
    for (const specifier of node.specifiers) {
      if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type") {
        isClosed = false;
        return;
      }
      const importedName = getImportedName(specifier);
      if (importedName === "shopifyApi") {
        factoryImportCount += 1;
        continue;
      }
      const symbol = scopes.symbolFor(specifier.local);
      if (
        importedName !== "LogSeverity" ||
        !symbol ||
        !symbol.references.every((reference) => {
          const parent = reference.identifier.parent;
          return (
            reference.flag === "read" &&
            isNodeOfType(parent, "MemberExpression") &&
            parent.object === reference.identifier &&
            !parent.computed &&
            !parent.optional &&
            !isWithinAssignmentTarget(parent)
          );
        })
      )
        isClosed = false;
    }
  });
  return isClosed && factoryImportCount <= SHOPIFY_VALIDATION_ARGUMENT_COUNT;
};
