import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findVariableInitializer } from "../../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getStaticMemberPropertyName } from "./static-member-property-name.js";

// Lodash mutator function names. Each one takes the target object as
// its FIRST argument and mutates it in place. The opposite-named
// `lodash/fp` package is non-mutating; we skip detection when the
// import comes from `lodash/fp` (or the local name resolves to it).
const LODASH_MUTATOR_NAMES = new Set([
  "set",
  "unset",
  "update",
  "merge",
  "defaults",
  "defaultsDeep",
  "assign",
  "assignIn",
  "pull",
  "pullAll",
  "pullAllBy",
  "pullAt",
  "remove",
  "fill",
]);

const LODASH_MUTATING_MODULES = new Set([
  "lodash",
  "lodash-es",
  // Per-method imports like `lodash/set`, `lodash-es/set`. Matched
  // via prefix check below — these can't go in a Set.
]);

const isLodashMutatingImport = (sourceValue: string): boolean => {
  if (LODASH_MUTATING_MODULES.has(sourceValue)) return true;
  // Per-method or namespaced sub-paths: `lodash/set`, `lodash-es/set`
  // are mutating. `lodash/fp` and `lodash/fp/set` are immutable.
  if (sourceValue.startsWith("lodash/fp") || sourceValue.startsWith("lodash-es/fp")) return false;
  if (sourceValue.startsWith("lodash/") || sourceValue.startsWith("lodash-es/")) return true;
  return false;
};

// Returns true if `callExpression` invokes a known lodash mutator
// (`_.set`, `_.merge`, `set` from `lodash/set`, etc.) resolved
// against the file's imports. Skipped for `lodash/fp` (non-mutating).
//
// Three callee shapes are handled:
//
//   1. `set(state, ...)` — bare identifier, must be imported from a
//      mutating lodash module by name `set` (or any LODASH_MUTATOR_NAMES).
//   2. `_.set(state, ...)` / `lodash.set(state, ...)` — namespace
//      MemberExpression. The receiver Identifier must resolve to a
//      namespace/default import from a mutating lodash module.
//   3. Computed access (`_["set"](state)`) is skipped.
export const isLodashMutatorCall = (callExpression: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = callExpression.callee;

  if (isNodeOfType(callee, "Identifier")) {
    if (!LODASH_MUTATOR_NAMES.has(callee.name)) return false;
    const binding = findVariableInitializer(callee, callee.name);
    const initializer = binding?.initializer;
    if (!initializer) return false;
    // The binding must come from an import specifier (its parent is
    // an ImportDeclaration whose `source.value` we can inspect).
    if (
      !isNodeOfType(initializer, "ImportSpecifier") &&
      !isNodeOfType(initializer, "ImportDefaultSpecifier") &&
      !isNodeOfType(initializer, "ImportNamespaceSpecifier")
    ) {
      return false;
    }
    const importDeclaration = initializer.parent;
    if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return false;
    const sourceValue = importDeclaration.source?.value;
    if (typeof sourceValue !== "string") return false;
    return isLodashMutatingImport(sourceValue);
  }

  if (isNodeOfType(callee, "MemberExpression") && !callee.computed) {
    const propertyName = getStaticMemberPropertyName(callee);
    if (!propertyName || !LODASH_MUTATOR_NAMES.has(propertyName)) return false;
    const receiver = callee.object;
    if (!isNodeOfType(receiver, "Identifier")) return false;
    // `_` and `lodash` are conventional but we don't trust the name
    // alone — resolve through the binding to confirm the source.
    const binding = findVariableInitializer(receiver, receiver.name);
    const initializer = binding?.initializer;
    if (!initializer) return false;
    if (
      !isNodeOfType(initializer, "ImportNamespaceSpecifier") &&
      !isNodeOfType(initializer, "ImportDefaultSpecifier")
    ) {
      return false;
    }
    const importDeclaration = initializer.parent;
    if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return false;
    const sourceValue = importDeclaration.source?.value;
    if (typeof sourceValue !== "string") return false;
    return isLodashMutatingImport(sourceValue);
  }

  return false;
};
