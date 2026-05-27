import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

const SOLID_SOURCE_PATTERN = /^solid-js(?:\/.+)?$/;

// Tracks `import { createEffect, createEffect as e } from "solid-js"`
// across the visit. Returns helpers to register import declarations
// and to ask "is `<local name>` an alias for any of `<importedNames>`
// from a solid-js module?". Mirrors `trackImports` in
// `eslint-plugin-solid/src/utils.ts`.
export interface SolidImportTracker {
  handleImportDeclaration: (node: EsTreeNodeOfType<"ImportDeclaration">) => void;
  matchImport: (importedNames: ReadonlyArray<string>, localName: string) => string | undefined;
}

export const createSolidImportTracker = (
  fromModulePattern: RegExp = SOLID_SOURCE_PATTERN,
): SolidImportTracker => {
  const localNameByImportedName = new Map<string, string>();
  return {
    handleImportDeclaration: (node: EsTreeNodeOfType<"ImportDeclaration">) => {
      const source = node.source?.value;
      if (typeof source !== "string") return;
      if (!fromModulePattern.test(source)) return;
      for (const specifier of node.specifiers) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        const importedIdentifier = specifier.imported;
        if (!isNodeOfType(importedIdentifier, "Identifier")) continue;
        localNameByImportedName.set(importedIdentifier.name, specifier.local.name);
      }
    },
    matchImport: (importedNames, localName) => {
      for (const importedName of importedNames) {
        if (localNameByImportedName.get(importedName) === localName) return importedName;
      }
      return undefined;
    },
  };
};
