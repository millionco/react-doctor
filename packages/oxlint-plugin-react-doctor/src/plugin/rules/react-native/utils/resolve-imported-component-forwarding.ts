import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { resolveCrossFileFunctionExport } from "../../../utils/resolve-cross-file-function-export.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  classifyChildrenForwarding,
  collectTextWrapperComponents,
  type ChildrenForwardingKind,
} from "./collect-text-wrapper-components.js";

// Resolves a JSX element name imported from another first-party file (relative
// or tsconfig-alias) to how that component forwards its `children`, by parsing
// the source file and classifying its exported component like an in-file one.
// Returns null when the import isn't a resolvable single export — a namespace
// import, a `node_modules` specifier (deliberately not followed), or an export
// that doesn't bind to an analyzable function — so the caller stays conservative.
export const resolveImportedComponentForwarding = (
  contextNode: EsTreeNode,
  fromFilename: string,
  localName: string,
  isTextHandlingRoot: (elementName: string) => boolean,
  isNonTextHostRoot: (elementName: string) => boolean,
): ChildrenForwardingKind | null => {
  const binding = getImportBindingForName(contextNode, localName);
  if (!binding || binding.isNamespace || binding.exportedName === null) return null;
  const resolvedNode = resolveCrossFileFunctionExport(
    fromFilename,
    binding.source,
    binding.exportedName,
  );
  if (!resolvedNode) return null;

  // Classify against the resolved component's OWN module so a wrapper that
  // forwards its children through another component declared there (`Card` →
  // `Inner` → `<View>`) resolves instead of bailing to "unknown".
  // `collectTextWrapperComponents` does no further file I/O, so this stays
  // bounded to that module (a chain hopping into yet another file is left
  // unresolved). `parseSourceFile` attaches parents, so there's always a root.
  const moduleProgram = findProgramRoot(resolvedNode);
  if (moduleProgram === null) {
    return classifyChildrenForwarding(resolvedNode, isTextHandlingRoot, isNonTextHostRoot);
  }
  const { textWrappers, nonTextWrappers } = collectTextWrapperComponents(
    moduleProgram,
    isTextHandlingRoot,
    isNonTextHostRoot,
  );
  return classifyChildrenForwarding(
    resolvedNode,
    (elementName) => isTextHandlingRoot(elementName) || textWrappers.has(elementName),
    (elementName) => isNonTextHostRoot(elementName) || nonTextWrappers.has(elementName),
  );
};
