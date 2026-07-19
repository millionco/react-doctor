import { REACT_ROUTER_RUNTIME_PACKAGE_NAMES } from "../constants/react-router.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import type { RuleContext } from "./rule-context.js";

export const getImportedNameFromReactRouter = (
  context: RuleContext,
  contextNode: EsTreeNode,
  localIdentifierName: string,
): string | null => {
  if (context.scopes.symbolFor(contextNode)?.kind !== "import") return null;
  const binding = getImportBindingForName(contextNode, localIdentifierName);
  if (
    binding === null ||
    binding.exportedName === null ||
    !REACT_ROUTER_RUNTIME_PACKAGE_NAMES.has(binding.source)
  ) {
    return null;
  }
  return binding.exportedName;
};
