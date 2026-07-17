import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { isCreateContextCall } from "./is-create-context-call.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Top-level `const X = createContext(...)` binding names — the
// conventional place context objects are declared, and the shape the
// React 19 `<X value={…}>` provider shorthand is detected against.
// In-render `createContext` is `no-create-context-in-render`'s concern.
export const collectContextBindings = (
  programRoot: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<number> => {
  const bindings = new Set<number>();
  if (!isNodeOfType(programRoot, "Program")) return bindings;
  for (const topLevel of programRoot.body ?? []) {
    let declaration: EsTreeNode | null = topLevel;
    if (isNodeOfType(topLevel, "ExportNamedDeclaration") && topLevel.declaration) {
      declaration = topLevel.declaration;
    }
    if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) continue;
    if (declaration.kind !== "const") continue;
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!declarator.init || !isAstNode(declarator.init)) continue;
      if (!isCreateContextCall(declarator.init, scopes)) continue;
      const symbol = scopes.symbolFor(declarator.id);
      if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) continue;
      bindings.add(symbol.id);
    }
  }
  return bindings;
};
