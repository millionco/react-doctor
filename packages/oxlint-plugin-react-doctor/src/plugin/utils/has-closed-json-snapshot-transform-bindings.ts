import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { ClosedJsonSnapshotModule } from "./get-closed-json-snapshot-project.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { isClosedJsonSnapshotInactiveBranch } from "./is-closed-json-snapshot-inactive-branch.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";
import {
  CLOSED_JSON_SNAPSHOT_TRANSFORM_MAX_NODES,
  CLOSED_JSON_SNAPSHOT_TRANSFORM_MAX_SCOPE_DEPTH,
  CLOSED_JSON_SNAPSHOT_TRANSFORM_NATIVE_NAMES,
} from "./closed-json-snapshot-transform/constants.js";

const getVisibleTransformSymbol = (
  node: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  let scope = scopes.scopeFor(node);
  for (let depth = 0; depth < CLOSED_JSON_SNAPSHOT_TRANSFORM_MAX_SCOPE_DEPTH; depth += 1) {
    const symbol = scope.symbolsByName.get(name);
    if (symbol) return symbol;
    if (!scope.parent) return null;
    scope = scope.parent;
  }
  return null;
};

const hasGenuineClassicReactBinding = (
  node: EsTreeNode,
  module: ClosedJsonSnapshotModule,
): boolean => {
  const symbol = getVisibleTransformSymbol(node, "React", module.scopes);
  if (
    !symbol ||
    symbol.kind !== "import" ||
    (!isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") &&
      !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier"))
  )
    return false;
  const declaration = getImportDeclarationForSymbol(symbol);
  return (
    declaration?.source.value === "react" &&
    declaration.importKind !== "type" &&
    symbol.references.every(
      (reference) =>
        reference.flag === "read" || isClosedJsonSnapshotInactiveBranch(reference.identifier),
    )
  );
};

export const hasClosedJsonSnapshotTransformBindings = (
  module: ClosedJsonSnapshotModule,
  requiredNativeNames: ReadonlyArray<string> = [],
): boolean => {
  const nativeNames = new Set([
    ...CLOSED_JSON_SNAPSHOT_TRANSFORM_NATIVE_NAMES,
    ...requiredNativeNames,
  ]);
  let hasClosedBindings = true;
  let visitedNodes = 0;
  walkAst(module.program, (node) => {
    if (!hasClosedBindings) return false;
    visitedNodes += 1;
    if (visitedNodes > CLOSED_JSON_SNAPSHOT_TRANSFORM_MAX_NODES) {
      hasClosedBindings = false;
      return false;
    }
    if (isClosedJsonSnapshotInactiveBranch(node)) return false;
    if (isNodeOfType(node, "Identifier") && nativeNames.has(node.name)) {
      const symbol = module.scopes.symbolFor(node);
      if (
        symbol?.bindingIdentifier === node &&
        symbol.kind !== "ts-interface" &&
        symbol.kind !== "ts-type-alias"
      )
        hasClosedBindings = false;
    }
    if (!isNodeOfType(node, "JSXOpeningElement") && !isNodeOfType(node, "JSXFragment")) return;
    if (!hasGenuineClassicReactBinding(node, module)) {
      hasClosedBindings = false;
      return false;
    }
    for (const name of nativeNames) {
      if (getVisibleTransformSymbol(node, name, module.scopes)) {
        hasClosedBindings = false;
        return false;
      }
    }
  });
  return hasClosedBindings;
};
