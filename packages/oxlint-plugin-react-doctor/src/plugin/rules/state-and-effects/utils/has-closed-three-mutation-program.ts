import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../../utils/is-type-only-import.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { R3F_PUBLIC_MODULES } from "../../r3f/utils/r3f-public-modules.js";
import {
  THREE_REF_EXPOSED_GLOBAL_NAMES,
  THREE_REF_EXPOSED_PROPERTY_NAMES,
  THREE_REF_FIBER_APIS,
  THREE_REF_LOADER_MODULES,
  THREE_REF_REACT_APIS,
  THREE_REF_EMPTY_COUNT,
  THREE_REF_FIRST_ARGUMENT_INDEX,
  THREE_REF_SINGLE_ARGUMENT_COUNT,
} from "./constants.js";

const admissionByScopes = new WeakMap<ScopeAnalysis, boolean>();

export const hasClosedThreeMutationProgram = (scopes: ScopeAnalysis): boolean => {
  const cached = admissionByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let admitted = true;
  walkAst(scopes.rootScope.node, (candidate) => {
    if (!admitted || isTypeScriptTypePosition(candidate)) return false;
    if (isNodeOfType(candidate, "Identifier") && !isTypeScriptTypePosition(candidate)) {
      const binding = scopes.symbolFor(candidate);
      if (
        binding &&
        binding.bindingIdentifier !== candidate &&
        THREE_REF_EXPOSED_GLOBAL_NAMES.has(candidate.name) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)
      ) {
        admitted = false;
        return false;
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
      THREE_REF_EXPOSED_GLOBAL_NAMES.has(candidate.name) &&
      scopes.isGlobalReference(candidate)
    )
      admitted = false;
    if (
      isNodeOfType(candidate, "MemberExpression") &&
      (candidate.computed ||
        isWithinAssignmentTarget(candidate) ||
        THREE_REF_EXPOSED_PROPERTY_NAMES.has(getStaticPropertyName(candidate) ?? ""))
    )
      admitted = false;
    if (
      isNodeOfType(candidate, "Property") &&
      isNodeOfType(candidate.parent, "ObjectPattern") &&
      THREE_REF_EXPOSED_PROPERTY_NAMES.has(
        getStaticPropertyKeyName(candidate, { allowComputedString: true }) ?? "",
      )
    )
      admitted = false;
    if (!isNodeOfType(candidate, "ImportDeclaration") || isTypeOnlyImport(candidate)) return;
    const source = candidate.source.value;
    if (typeof source !== "string") {
      admitted = false;
      return;
    }
    if (
      THREE_REF_LOADER_MODULES.has(source) ||
      source.startsWith("react/") ||
      source.startsWith("three/") ||
      source === "three-stdlib" ||
      source.startsWith("@react-three/fiber/") ||
      source === "react-three-fiber"
    ) {
      admitted = false;
      return;
    }
    if (source !== "react" && source !== "three" && !R3F_PUBLIC_MODULES.has(source)) return;
    if (source !== "react" && source !== "three" && source !== "@react-three/fiber") {
      admitted = false;
      return;
    }
    for (const specifier of candidate.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      if (!isNodeOfType(specifier, "ImportSpecifier")) {
        admitted = false;
        return;
      }
      const symbol = scopes.symbolFor(specifier.local);
      const importedName = getImportedName(specifier);
      if (
        !symbol ||
        getValueImportSource(symbol) !== source ||
        !importedName ||
        importedName === "default" ||
        (source === "react" && !THREE_REF_REACT_APIS.has(importedName)) ||
        (source === "@react-three/fiber" && !THREE_REF_FIBER_APIS.has(importedName))
      ) {
        admitted = false;
        return;
      }
      for (const reference of symbol.references) {
        if (isTypeScriptTypePosition(reference.identifier)) continue;
        const root = findTransparentExpressionRoot(reference.identifier);
        const invocation = root.parent;
        if (
          reference.flag !== "read" ||
          isWithinAssignmentTarget(reference.identifier) ||
          (source === "three"
            ? !isNodeOfType(invocation, "NewExpression")
            : !isNodeOfType(invocation, "CallExpression") || invocation.optional) ||
          !invocation ||
          !("callee" in invocation) ||
          invocation.callee !== root
        ) {
          admitted = false;
          return;
        }
        if (source === "@react-three/fiber" && importedName === "useFrame") {
          if (!isNodeOfType(invocation, "CallExpression")) return;
          const callback = invocation.arguments[THREE_REF_FIRST_ARGUMENT_INDEX];
          if (
            invocation.arguments.length !== THREE_REF_SINGLE_ARGUMENT_COUNT ||
            !isNodeOfType(callback, "ArrowFunctionExpression") ||
            callback.async ||
            callback.generator ||
            callback.params.length !== THREE_REF_EMPTY_COUNT
          ) {
            admitted = false;
            return;
          }
        }
      }
    }
  });
  admissionByScopes.set(scopes, admitted);
  return admitted;
};
