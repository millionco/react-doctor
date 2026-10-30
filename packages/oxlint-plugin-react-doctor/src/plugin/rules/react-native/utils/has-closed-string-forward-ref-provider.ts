import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isProvenGlobalNamespaceReference } from "../../../utils/is-proven-global-namespace-reference.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  STRING_PROP_RUNTIME_TYPESCRIPT_NODES,
  STRING_PROP_PROVIDER_HAZARD_NAMES,
  STRING_PROP_PROVIDER_ESCAPE_MEMBER_NAMES,
  STRING_PROP_GLOBAL_CARRIER_NAMES,
} from "./constants.js";

const providerClosureByAnalysis = new WeakMap<ScopeAnalysis, Map<string, boolean>>();

export const hasClosedStringForwardRefProvider = (
  scopes: ScopeAnalysis,
  moduleSource: string,
): boolean => {
  let providerClosures = providerClosureByAnalysis.get(scopes);
  if (!providerClosures) {
    providerClosures = new Map();
    providerClosureByAnalysis.set(scopes, providerClosures);
  }
  const cachedResult = providerClosures.get(moduleSource);
  if (cachedResult !== undefined) return cachedResult;
  let hasUnsupportedRuntime = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasUnsupportedRuntime) return false;
    if (
      node.type === "WithStatement" ||
      STRING_PROP_RUNTIME_TYPESCRIPT_NODES.has(node.type) ||
      ((isNodeOfType(node, "TSEnumDeclaration") || isNodeOfType(node, "TSModuleDeclaration")) &&
        !node.declare)
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "Identifier")) {
      const binding = scopes.symbolFor(node);
      const reference = findTransparentExpressionRoot(node);
      const parent = reference.parent;
      const isCarrier = STRING_PROP_GLOBAL_CARRIER_NAMES.has(node.name);
      const isCarrierMember =
        isNodeOfType(parent, "MemberExpression") && parent.object === reference;
      const memberName = isCarrierMember ? getStaticPropertyName(parent) : null;
      const isHarmlessCarrierCheck =
        isNodeOfType(parent, "UnaryExpression") &&
        (parent.operator === "typeof" || parent.operator === "void");
      const exposesProvider = isCarrier
        ? isCarrierMember
          ? memberName === null || STRING_PROP_PROVIDER_HAZARD_NAMES.includes(memberName)
          : !isHarmlessCarrierCheck
        : STRING_PROP_PROVIDER_HAZARD_NAMES.includes(node.name);
      if (
        exposesProvider &&
        binding?.bindingIdentifier !== node &&
        (scopes.isGlobalReference(node) ||
          Boolean(
            binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding),
          ))
      ) {
        hasUnsupportedRuntime = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "ImportExpression") ||
      (isNodeOfType(node, "ImportDeclaration") &&
        !isTypeOnlyImport(node) &&
        (node.source.value === "module" || node.source.value === "node:module")) ||
      ((isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))) &&
        STRING_PROP_PROVIDER_ESCAPE_MEMBER_NAMES.has(
          getResolvedStaticPropertyName(node, scopes, { allowConstTemplateLiteral: true }) ?? "",
        )) ||
      STRING_PROP_PROVIDER_HAZARD_NAMES.some((name) =>
        isProvenGlobalNamespaceReference(node, name, scopes),
      )
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }

    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.source.value === moduleSource &&
      !isTypeOnlyImport(node)
    ) {
      for (const importedSpecifier of node.specifiers) {
        const isNamedForwardRef =
          isNodeOfType(importedSpecifier, "ImportSpecifier") &&
          importedSpecifier.importKind !== "type" &&
          getImportedName(importedSpecifier) === "forwardRef";
        const isNamespaceProvider =
          isNodeOfType(importedSpecifier, "ImportDefaultSpecifier") ||
          isNodeOfType(importedSpecifier, "ImportNamespaceSpecifier") ||
          (isNodeOfType(importedSpecifier, "ImportSpecifier") &&
            importedSpecifier.importKind !== "type" &&
            getImportedName(importedSpecifier) === "default");
        if (!isNamedForwardRef && !isNamespaceProvider) continue;
        const importedSymbol = scopes.symbolFor(importedSpecifier.local);
        if (!importedSymbol) {
          hasUnsupportedRuntime = true;
          return false;
        }
        for (const reference of importedSymbol.references) {
          if (isTypeScriptTypePosition(reference.identifier)) continue;
          let referenceRoot: EsTreeNode = reference.identifier;
          while (
            isNodeOfType(referenceRoot.parent, "MemberExpression") &&
            !referenceRoot.parent.computed &&
            !referenceRoot.parent.optional &&
            referenceRoot.parent.object === referenceRoot
          ) {
            referenceRoot = referenceRoot.parent;
          }
          if (
            isNodeOfType(referenceRoot.parent, "TSInterfaceHeritage") &&
            referenceRoot.parent.expression === referenceRoot &&
            isTypeScriptTypePosition(referenceRoot)
          )
            continue;
          const parent = reference.identifier.parent;
          if (
            reference.flag !== "read" ||
            isWithinAssignmentTarget(reference.identifier) ||
            (isNamedForwardRef &&
              (!isNodeOfType(parent, "CallExpression") ||
                parent.callee !== reference.identifier)) ||
            (isNamespaceProvider &&
              (!isNodeOfType(parent, "MemberExpression") ||
                parent.object !== reference.identifier ||
                parent.computed ||
                !isNodeOfType(parent.parent, "CallExpression") ||
                parent.parent.callee !== parent))
          ) {
            hasUnsupportedRuntime = true;
            return false;
          }
        }
      }
    }
    return undefined;
  });
  const hasClosedProvider = !hasUnsupportedRuntime;
  providerClosures.set(moduleSource, hasClosedProvider);
  return hasClosedProvider;
};
