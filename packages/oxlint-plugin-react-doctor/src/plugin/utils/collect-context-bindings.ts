import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { isCreateContextCall } from "./is-create-context-call.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Top-level `const X = createContext(...)` binding names — the
// conventional place context objects are declared, and the shape the
// React 19 `<X value={…}>` provider shorthand is detected against.
// In-render `createContext` is `no-create-context-in-render`'s concern.
export const collectContextBindings = (programRoot: EsTreeNode): Set<string> => {
  const bindings = new Set<string>();
  if (!isNodeOfType(programRoot, "Program")) return bindings;
  for (const topLevel of programRoot.body ?? []) {
    let declaration: EsTreeNode | null = topLevel;
    if (isNodeOfType(topLevel, "ExportNamedDeclaration") && topLevel.declaration) {
      declaration = topLevel.declaration;
    }
    if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) continue;
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!declarator.init || !isAstNode(declarator.init)) continue;
      if (!isCreateContextCall(declarator.init)) continue;
      bindings.add(declarator.id.name);
    }
  }
  return bindings;
};
