import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Reads the originally-exported identifier off an `ImportSpecifier`.
// ES2022's arbitrary-module-namespace-identifier (`import { "string name" as
// foo } from "mod"`) makes `imported` a union of `Identifier | StringLiteral`,
// so callers that want a plain name string need both narrowings. Returns
// undefined for any other node shape so rules can early-return safely.
export const getImportedName = (importSpecifier: EsTreeNode): string | undefined => {
  if (!isNodeOfType(importSpecifier, "ImportSpecifier")) return undefined;
  const imported = importSpecifier.imported;
  if (isNodeOfType(imported, "Identifier")) return imported.name;
  if (isNodeOfType(imported, "Literal") && typeof imported.value === "string") {
    return imported.value;
  }
  return undefined;
};
