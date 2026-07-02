import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

// True when every named specifier on a declaration is an inline `type`
// specifier (`import { type A, type B } from "x"`, `export { type A } from "x"`)
// — the whole declaration is type-only even though `importKind`/`exportKind` is
// `"value"`. A default/namespace/value specifier, or no specifiers at all (a bare
// side-effect import), makes this false. `kindField` is `importKind` for imports
// and `exportKind` for named re-exports.
export const isEverySpecifierInlineType = (
  specifiers: ReadonlyArray<EsTreeNode> | undefined,
  specifierType: "ImportSpecifier" | "ExportSpecifier",
  kindField: "importKind" | "exportKind",
): boolean => {
  if (!specifiers || specifiers.length === 0) return false;
  return specifiers.every(
    (specifier) =>
      isNodeOfType(specifier, specifierType) &&
      (specifier as { [key: string]: unknown })[kindField] === "type",
  );
};

// True when an import emits no runtime code: a declaration-level
// `import type … from "x"`, or a named import where every specifier is
// individually `type`-qualified. A bare side-effect import (`import "x"`, no
// specifiers) is NOT type-only.
export const isTypeOnlyImport = (node: EsTreeNodeOfType<"ImportDeclaration">): boolean =>
  node.importKind === "type" ||
  isEverySpecifierInlineType(node.specifiers, "ImportSpecifier", "importKind");
