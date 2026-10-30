import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NATIVE_EMITTER_EXPOSED_GLOBAL_NAMES,
  NATIVE_EMITTER_MODULE_CARRIER_NAMES,
  NATIVE_EMITTER_EXPOSED_PROPERTY_NAMES,
} from "./constants.js";

const programAdmissionByScopes = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedNativeEmitterProgram = (scopes: ScopeAnalysis): boolean => {
  const cachedAdmission = programAdmissionByScopes.get(scopes);
  if (cachedAdmission !== undefined) return cachedAdmission;
  let admitted = true;
  let providerCount = 0;
  let reactProviderCount = 0;
  walkAst(scopes.rootScope.node, (candidate) => {
    if (!admitted || isTypeScriptTypePosition(candidate)) return false;
    if (isNodeOfType(candidate, "Identifier") && !isTypeScriptTypePosition(candidate)) {
      const binding = scopes.symbolFor(candidate);
      if (
        binding &&
        binding.bindingIdentifier !== candidate &&
        NATIVE_EMITTER_EXPOSED_GLOBAL_NAMES.has(candidate.name) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        admitted = false;
        return false;
      }
    }
    if (isNodeOfType(candidate, "ImportDeclaration") && !isTypeOnlyImport(candidate)) {
      const source = candidate.source.value;
      if (
        typeof source === "string" &&
        (source.startsWith("react-native/") || NATIVE_EMITTER_MODULE_CARRIER_NAMES.has(source))
      )
        admitted = false;
      if (typeof source === "string" && source.startsWith("react/")) admitted = false;
      if (source === "react") {
        for (const specifier of candidate.specifiers) {
          if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
            continue;
          if (
            !isNodeOfType(specifier, "ImportNamespaceSpecifier") &&
            !isNodeOfType(specifier, "ImportDefaultSpecifier")
          )
            admitted = false;
          reactProviderCount += 1;
        }
      }
      if (source === "react-native") {
        for (const specifier of candidate.specifiers) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) {
            admitted = false;
            break;
          }
          if (
            specifier.importKind !== "type" &&
            getImportedName(specifier) === "DeviceEventEmitter"
          )
            providerCount += 1;
        }
      }
    }
    if (
      isNodeOfType(candidate, "ImportExpression") ||
      isNodeOfType(candidate, "WithStatement") ||
      isNodeOfType(candidate, "TSImportEqualsDeclaration")
    )
      admitted = false;
    if (
      isNodeOfType(candidate, "Identifier") &&
      NATIVE_EMITTER_EXPOSED_GLOBAL_NAMES.has(candidate.name) &&
      scopes.isGlobalReference(candidate)
    )
      admitted = false;
    if (
      isNodeOfType(candidate, "MemberExpression") &&
      NATIVE_EMITTER_EXPOSED_PROPERTY_NAMES.has(getStaticPropertyName(candidate) ?? "")
    )
      admitted = false;
    if (
      isNodeOfType(candidate, "Property") &&
      isNodeOfType(candidate.parent, "ObjectPattern") &&
      NATIVE_EMITTER_EXPOSED_PROPERTY_NAMES.has(
        getStaticPropertyKeyName(candidate, { allowComputedString: true }) ?? "",
      )
    )
      admitted = false;
  });
  admitted = admitted && providerCount === 1 && reactProviderCount === 1;
  programAdmissionByScopes.set(scopes, admitted);
  return admitted;
};
