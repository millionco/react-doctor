import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";

interface ImportInfo {
  source: string;
  imported: string | null;
  isDefault: boolean;
  isNamespace: boolean;
}

const collectFromProgram = (programRoot: EsTreeNode): Map<string, ImportInfo> => {
  const lookup = new Map<string, ImportInfo>();
  // `ImportDeclaration` only occurs directly in `Program.body`, so one pass
  // over the top-level statements replaces a whole-program recursion.
  const bodyStatements = (programRoot as { body?: ReadonlyArray<EsTreeNode> }).body ?? [];
  for (const node of bodyStatements) {
    if (node.type !== "ImportDeclaration" || !("source" in node) || !node.source) continue;
    const source = (node.source as { value?: unknown }).value;
    if (typeof source !== "string") continue;
    if (!("specifiers" in node) || !Array.isArray(node.specifiers)) continue;
    for (const specifier of node.specifiers as ReadonlyArray<EsTreeNode>) {
      if (!("local" in specifier) || !specifier.local) continue;
      const local = specifier.local as { name?: string };
      if (typeof local.name !== "string") continue;
      if (specifier.type === "ImportDefaultSpecifier") {
        lookup.set(local.name, { source, imported: null, isDefault: true, isNamespace: false });
      } else if (specifier.type === "ImportNamespaceSpecifier") {
        lookup.set(local.name, { source, imported: null, isDefault: false, isNamespace: true });
      } else if (specifier.type === "ImportSpecifier") {
        const importedNode = (specifier as { imported?: { name?: string; value?: string } })
          .imported;
        const importedName =
          importedNode?.name ??
          (typeof importedNode?.value === "string" ? importedNode.value : null);
        lookup.set(local.name, {
          source,
          imported: importedName,
          isDefault: false,
          isNamespace: false,
        });
      }
    }
  }
  return lookup;
};

const importLookupCache = new WeakMap<EsTreeNode, Map<string, ImportInfo>>();

const getImportLookup = (node: EsTreeNode): Map<string, ImportInfo> | null => {
  const programRoot = findProgramRoot(node);
  if (!programRoot) return null;
  let cached = importLookupCache.get(programRoot);
  if (!cached) {
    cached = collectFromProgram(programRoot);
    importLookupCache.set(programRoot, cached);
  }
  return cached;
};

// True if the enclosing module imports anything from any of `moduleSources`.
// A cheap existence gate for detectors whose signal can only come from a
// specific library — when the import is absent, callers skip their AST walk
// entirely.
export const hasImportFromModules = (
  contextNode: EsTreeNode,
  moduleSources: ReadonlyArray<string>,
): boolean => {
  const lookup = getImportLookup(contextNode);
  if (!lookup) return false;
  for (const info of lookup.values()) {
    if (moduleSources.includes(info.source)) return true;
  }
  return false;
};

// True if `localIdentifierName` was imported from `moduleSource` in the
// enclosing module. Used to scope rules like `no-clone-element` to
// imports of React's actual `cloneElement` symbol (not a homegrown
// helper of the same name).
export const isImportedFromModule = (
  contextNode: EsTreeNode,
  localIdentifierName: string,
  moduleSource: string,
): boolean => {
  const lookup = getImportLookup(contextNode);
  if (!lookup) return false;
  const info = lookup.get(localIdentifierName);
  if (!info) return false;
  return info.source === moduleSource;
};

// True if `localIdentifierName` is a *namespace* import (`import * as X from
// "mod"`) from `moduleSource`. Stricter than `isImportedFromModule`, which also
// matches named/default imports by source — use this when only `<X.Member>`
// namespace access should qualify (not a named import reused via member access).
export const isNamespaceImportFromModule = (
  contextNode: EsTreeNode,
  localIdentifierName: string,
  moduleSource: string,
): boolean => {
  const lookup = getImportLookup(contextNode);
  if (!lookup) return false;
  const info = lookup.get(localIdentifierName);
  if (!info) return false;
  return info.isNamespace && info.source === moduleSource;
};

export const isDefaultImportFromModule = (
  contextNode: EsTreeNode,
  localIdentifierName: string,
  moduleSource: string,
): boolean => {
  const lookup = getImportLookup(contextNode);
  if (!lookup) return false;
  const info = lookup.get(localIdentifierName);
  if (!info) return false;
  return info.isDefault && info.source === moduleSource;
};

// Returns the originally-exported symbol name for a local binding that
// came from a specific module, resolving renamed imports like
// `import { useMemo as memoize } from "react"` so callers can match
// against the canonical name instead of the local alias.
//
// Returns null when:
//   - the local binding doesn't exist
//   - the binding's source module doesn't match `moduleSource`
//   - the binding is a default or namespace import (no "imported" name)
export const getImportedNameFromModule = (
  contextNode: EsTreeNode,
  localIdentifierName: string,
  moduleSource: string,
): string | null => {
  const lookup = getImportLookup(contextNode);
  if (!lookup) return null;
  const info = lookup.get(localIdentifierName);
  if (!info) return null;
  if (info.source !== moduleSource) return null;
  return info.imported;
};

// Module a local binding was imported from, or null when it has no import in
// the enclosing module (a global, a re-export, or a same-name local). Lets a
// rule disambiguate same-named hooks from different libraries (e.g. TanStack
// Query's `useQuery` vs Convex's `useQuery` from `convex/react`).
export const getImportSourceForName = (
  contextNode: EsTreeNode,
  localIdentifierName: string,
): string | null => {
  const lookup = getImportLookup(contextNode);
  if (!lookup) return null;
  return lookup.get(localIdentifierName)?.source ?? null;
};

export interface ImportBinding {
  source: string;
  // Original exported name in `source`: "default" for a default import, the
  // pre-rename name for a named import, null for a namespace import.
  exportedName: string | null;
  isNamespace: boolean;
}

// The full import binding for a local name (source + original exported name,
// resolving renames and default imports), or null when it has no import here.
// Use over `getImportSourceForName` when you need to follow the import into its
// source file and locate the right export.
export const getImportBindingForName = (
  contextNode: EsTreeNode,
  localIdentifierName: string,
): ImportBinding | null => {
  const lookup = getImportLookup(contextNode);
  const info = lookup?.get(localIdentifierName);
  if (!info) return null;
  if (info.isNamespace) return { source: info.source, exportedName: null, isNamespace: true };
  return {
    source: info.source,
    exportedName: info.isDefault ? "default" : info.imported,
    isNamespace: false,
  };
};
