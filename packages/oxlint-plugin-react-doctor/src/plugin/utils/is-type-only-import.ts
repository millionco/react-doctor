import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";

// True when an import emits no runtime code: a declaration-level
// `import type … from "x"`, or a named import where every specifier is
// individually `type`-qualified (`import { type A, type B } from "x"`).
// TypeScript erases both at emit, so they ship nothing to the bundle. A
// bare side-effect import (`import "x"`, no specifiers) is NOT type-only.
export const isTypeOnlyImport = (node: EsTreeNodeOfType<"ImportDeclaration">): boolean => {
  if (node.importKind === "type") return true;
  const specifiers = node.specifiers ?? [];
  if (specifiers.length === 0) return false;
  return specifiers.every(
    (specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type",
  );
};
