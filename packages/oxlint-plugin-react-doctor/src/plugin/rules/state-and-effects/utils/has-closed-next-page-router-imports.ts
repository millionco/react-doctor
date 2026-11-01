import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NEXT_PAGE_REDIRECT_DYNAMIC_GLOBALS,
  NEXT_PAGE_REDIRECT_EXPOSED_PROPERTIES,
  NEXT_PAGE_REDIRECT_GLOBAL_OBJECTS,
  NEXT_PAGE_REDIRECT_LOADER_MODULES,
  NEXT_PAGE_REDIRECT_PROVIDER_MODULES,
  NEXT_PAGE_REDIRECT_RUNTIME_TYPES,
  NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT,
} from "./constants.js";

export const hasClosedNextPageRouterImports = (scopes: ScopeAnalysis): boolean => {
  let admitted = true;
  let routerCalls = 0;
  walkAst(scopes.rootScope.node, (node) => {
    if (!admitted) return false;
    if (isNodeOfType(node, "Identifier") && !isTypeScriptTypePosition(node)) {
      const binding = scopes.symbolFor(node);
      if (
        binding &&
        binding.bindingIdentifier !== node &&
        (NEXT_PAGE_REDIRECT_DYNAMIC_GLOBALS.has(node.name) ||
          NEXT_PAGE_REDIRECT_GLOBAL_OBJECTS.has(node.name)) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        admitted = false;
        return false;
      }
    }
    if (
      NEXT_PAGE_REDIRECT_RUNTIME_TYPES.has(node.type) &&
      !("declare" in node && node.declare === true) &&
      !("importKind" in node && node.importKind === "type")
    ) {
      admitted = false;
      return false;
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      const source = node.source.value;
      if (typeof source !== "string") return;
      const isProvider = NEXT_PAGE_REDIRECT_PROVIDER_MODULES.has(source);
      const isUnsupportedModule =
        NEXT_PAGE_REDIRECT_LOADER_MODULES.has(source) ||
        source.startsWith("react/") ||
        source.startsWith("next/router/") ||
        source === "next/compat/router";
      if (!isProvider && !isUnsupportedModule) return;
      for (const specifier of node.specifiers) {
        const binding = scopes.symbolFor(specifier.local);
        if (!binding) {
          admitted = false;
          break;
        }
        const runtimeReferences = binding.references.filter(
          (reference) => !isTypeScriptTypePosition(reference.identifier),
        );
        if (
          isTypeOnlyImport(node) ||
          (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
        ) {
          if (runtimeReferences.length > 0) admitted = false;
          continue;
        }
        if (isUnsupportedModule) {
          admitted = false;
          break;
        }
        const importedName = getImportedName(specifier);
        if (
          source === "next/router" &&
          (!isNodeOfType(specifier, "ImportSpecifier") || importedName !== "useRouter")
        ) {
          admitted = false;
          break;
        }
        for (const reference of runtimeReferences) {
          const identifier = reference.identifier;
          const root = findTransparentExpressionRoot(identifier);
          const call = root.parent;
          if (
            source === "react" &&
            (isNodeOfType(specifier, "ImportDefaultSpecifier") ||
              isNodeOfType(specifier, "ImportNamespaceSpecifier")) &&
            reference.flag === "read" &&
            !isWithinAssignmentTarget(identifier) &&
            isNodeOfType(call, "MemberExpression") &&
            call.object === root &&
            !call.computed &&
            !call.optional &&
            getStaticPropertyName(call) === "createElement"
          ) {
            const calleeRoot = findTransparentExpressionRoot(call);
            const invocation = calleeRoot.parent;
            if (
              isNodeOfType(invocation, "CallExpression") &&
              invocation.callee === calleeRoot &&
              !invocation.optional
            )
              continue;
          }
          if (
            reference.flag !== "read" ||
            isWithinAssignmentTarget(identifier) ||
            !isNodeOfType(specifier, "ImportSpecifier") ||
            importedName === "default" ||
            !isNodeOfType(call, "CallExpression") ||
            call.callee !== root ||
            call.optional
          ) {
            admitted = false;
            break;
          }
          if (source === "next/router") {
            if (call.arguments.length > 0) {
              admitted = false;
              break;
            }
            routerCalls += NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT;
          }
        }
      }
      if (isUnsupportedModule && !isTypeOnlyImport(node)) admitted = false;
      return false;
    }
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration")) &&
      node.exportKind !== "type" &&
      node.source &&
      typeof node.source.value === "string" &&
      (NEXT_PAGE_REDIRECT_PROVIDER_MODULES.has(node.source.value) ||
        NEXT_PAGE_REDIRECT_LOADER_MODULES.has(node.source.value) ||
        node.source.value.startsWith("react/") ||
        node.source.value.startsWith("next/router/") ||
        node.source.value === "next/compat/router")
    ) {
      admitted = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "WithStatement") || isNodeOfType(node, "ImportExpression")) {
      admitted = false;
      return false;
    }
    if (
      (isNodeOfType(node, "MemberExpression") || isNodeOfType(node, "Property")) &&
      NEXT_PAGE_REDIRECT_EXPOSED_PROPERTIES.has(
        getStaticPropertyKeyName(node, { allowComputedString: true }) ?? "",
      )
    )
      admitted = false;
    if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
      if (NEXT_PAGE_REDIRECT_DYNAMIC_GLOBALS.has(node.name)) admitted = false;
      if (NEXT_PAGE_REDIRECT_GLOBAL_OBJECTS.has(node.name)) {
        const root = findTransparentExpressionRoot(node);
        const member = root.parent;
        const name = isNodeOfType(member, "MemberExpression")
          ? getStaticPropertyName(member)
          : null;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== root ||
          name === null ||
          NEXT_PAGE_REDIRECT_DYNAMIC_GLOBALS.has(name) ||
          NEXT_PAGE_REDIRECT_GLOBAL_OBJECTS.has(name) ||
          name === "next" ||
          name === "Router"
        )
          admitted = false;
      }
    }
  });
  return admitted && routerCalls === NEXT_PAGE_REDIRECT_SINGLE_ITEM_COUNT;
};
