import type { EsTreeNode } from "./es-tree-node.js";
import { isImportedFromModule } from "./find-import-source-for-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const REACT_REDUX_MODULE = "react-redux";

// Collects file-local identifier names that are typed re-exports /
// re-bindings of `useSelector` from `react-redux`. The canonical
// pattern is the typed-selector wrapper that almost every TS Redux
// project ships in its `hooks.ts`:
//
//   import { useSelector } from "react-redux";
//   import type { TypedUseSelectorHook } from "react-redux";
//
//   export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
//
// We also recognise the untyped rebinding shape:
//
//   import { useSelector } from "react-redux";
//   const useAppSelector = useSelector;
//
// Returns the set of names that can be treated as `useSelector` for
// the rules' detection purposes. Always includes the literal name
// `"useSelector"` itself when it's imported from `react-redux`.
//
// Cross-file resolution (the more common case where `useAppSelector`
// lives in a separate `hooks.ts` file) is intentionally out of scope
// — it requires module-graph traversal which the lint pipeline
// doesn't have. The same-file shape is rare in production code but
// common in workshop / example / one-file-app fixtures, and is
// reasonably easy to detect.
export const collectReactReduxSelectorAliases = (programRoot: EsTreeNode): Set<string> => {
  const aliases = new Set<string>();
  if (!isNodeOfType(programRoot, "Program")) return aliases;

  // Track the canonical `useSelector` import (possibly renamed).
  // Discover by inspecting the import declarations directly so we
  // can detect bare-named, renamed, and typed import variants.
  for (const topLevel of programRoot.body ?? []) {
    if (!isNodeOfType(topLevel, "ImportDeclaration")) continue;
    if (typeof topLevel.source?.value !== "string") continue;
    if (topLevel.source.value !== REACT_REDUX_MODULE) continue;
    for (const specifier of topLevel.specifiers ?? []) {
      if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
      const imported = specifier.imported;
      const importedName =
        imported && "name" in imported && typeof imported.name === "string"
          ? imported.name
          : imported && "value" in imported && typeof imported.value === "string"
            ? imported.value
            : null;
      if (importedName !== "useSelector") continue;
      const local = specifier.local;
      if (isNodeOfType(local, "Identifier")) aliases.add(local.name);
    }
  }

  // Find re-bindings: `const X = useSelector` (or
  // `export const X: TypedUseSelectorHook<...> = useSelector`) at
  // module scope. Walks all top-level declarators.
  const collectDeclarations = (node: EsTreeNode): void => {
    if (!isNodeOfType(node, "VariableDeclaration")) return;
    for (const declarator of node.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!declarator.init) continue;
      const initialiser = stripParenExpression(declarator.init);
      if (!isNodeOfType(initialiser, "Identifier")) continue;
      if (!aliases.has(initialiser.name)) continue;
      // The initialiser references a known alias → the new binding
      // is also an alias.
      aliases.add(declarator.id.name);
    }
  };

  for (const topLevel of programRoot.body ?? []) {
    if (isNodeOfType(topLevel, "VariableDeclaration")) {
      collectDeclarations(topLevel);
    } else if (isNodeOfType(topLevel, "ExportNamedDeclaration") && topLevel.declaration) {
      collectDeclarations(topLevel.declaration as EsTreeNode);
    }
  }

  return aliases;
};

// True if `callee` is an Identifier that resolves to `useSelector`
// from `react-redux` directly OR via a same-file alias. Convenience
// wrapper used by the redux-useselector-* rules.
export const isUseSelectorIdentifier = (
  calleeNode: EsTreeNode,
  aliases: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(calleeNode, "Identifier")) return false;
  // The literal `useSelector` name imported from react-redux is the
  // common case — `aliases` already includes it when the import is
  // present. Aliases include both the canonical name and any
  // re-bindings.
  if (aliases.has(calleeNode.name)) return true;
  // Defensive: if `aliases` is empty (e.g. test without imports),
  // fall back to the original `isImportedFromModule` resolution to
  // match the previous behaviour.
  if (calleeNode.name !== "useSelector") return false;
  return isImportedFromModule(calleeNode, calleeNode.name, REACT_REDUX_MODULE);
};
