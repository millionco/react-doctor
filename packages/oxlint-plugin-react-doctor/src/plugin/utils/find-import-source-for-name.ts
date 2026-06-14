import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { isAstNode } from "./is-ast-node.js";

interface ImportInfo {
  source: string;
  imported: string | null;
  isDefault: boolean;
  isNamespace: boolean;
}

const collectFromProgram = (programRoot: EsTreeNode): Map<string, ImportInfo> => {
  const lookup = new Map<string, ImportInfo>();
  const visit = (node: EsTreeNode): void => {
    if (node.type === "ImportDeclaration" && "source" in node && node.source) {
      const source = (node.source as { value?: unknown }).value;
      if (typeof source !== "string") return;
      if ("specifiers" in node && Array.isArray(node.specifiers)) {
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
      return;
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(programRoot);
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
