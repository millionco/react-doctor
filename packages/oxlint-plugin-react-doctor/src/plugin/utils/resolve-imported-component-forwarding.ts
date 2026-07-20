import { findProgramRoot } from "./find-program-root.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { resolveCrossFileFunctionExport } from "./resolve-cross-file-function-export.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
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
  scopes: ScopeAnalysis,
  fromFilename: string,
  localName: string,
  isTextHandlingRoot: (elementName: string, contextNode: EsTreeNode) => boolean,
  isNonTextHostRoot: (elementName: string, contextNode: EsTreeNode) => boolean,
): ChildrenForwardingKind | null => {
  if (!isNodeOfType(contextNode, "JSXElement")) return null;
  const jsxName = contextNode.openingElement.name;
  if (!isNodeOfType(jsxName, "JSXIdentifier") || jsxName.name !== localName) return null;
  const symbol = scopes.symbolFor(jsxName);
  if (
    !symbol ||
    (!isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier"))
  ) {
    return null;
  }
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
  // `Inner` → a host element) resolves instead of bailing to "unknown".
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
    (elementName, node) => isTextHandlingRoot(elementName, node) || textWrappers.has(elementName),
    (elementName, node) => isNonTextHostRoot(elementName, node) || nonTextWrappers.has(elementName),
  );
};
