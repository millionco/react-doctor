import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { resolveCrossFileFunctionExport } from "../../../utils/resolve-cross-file-function-export.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import {
  classifyChildrenForwarding,
  type ChildrenForwardingKind,
} from "./collect-text-wrapper-components.js";

// Resolves a JSX element name imported from another first-party file (relative
// or tsconfig-alias) to how that component forwards its `children`, by parsing
// the source file and classifying the exported component the same way an
// in-file declaration is classified. Returns null when the name isn't a
// resolvable single-export import — a namespace import, a bare `node_modules`
// specifier (the resolver deliberately won't follow there), a barrel/re-export
// that doesn't bind to an analyzable function — so the caller stays
// conservative and leaves such an element unreported.
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
  return classifyChildrenForwarding(resolvedNode, isTextHandlingRoot, isNonTextHostRoot);
};
