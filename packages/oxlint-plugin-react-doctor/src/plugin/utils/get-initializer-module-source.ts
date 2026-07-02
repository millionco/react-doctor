import type { EsTreeNode } from "./es-tree-node.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { getRequireCallSource } from "./get-require-call-source.js";
import { getRootIdentifierName } from "./get-root-identifier-name.js";

// Module source a VariableDeclarator initializer draws its value from:
// a `require("mod")` call (member access unwrapped, so
// `require("mod").X` counts) or a reference rooted at a namespace
// import — `const { X } = NS` and the member alias `const X = NS.X`
// both resolve to "mod" when `import * as NS from "mod"`. Null for any
// other initializer shape (a local value, a named-import alias, a call
// result), which callers treat as a local rebinding.
export const getInitializerModuleSource = (
  contextNode: EsTreeNode,
  initializer: EsTreeNode,
): string | null => {
  const requireSource = getRequireCallSource(initializer);
  if (requireSource !== null) return requireSource;
  const rootIdentifierName = getRootIdentifierName(initializer);
  if (rootIdentifierName === null) return null;
  const rootImportBinding = getImportBindingForName(contextNode, rootIdentifierName);
  if (rootImportBinding === null || !rootImportBinding.isNamespace) return null;
  return rootImportBinding.source;
};
