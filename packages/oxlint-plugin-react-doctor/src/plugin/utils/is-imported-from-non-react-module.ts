import { REACT_RUNTIME_MODULE_SOURCES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportSourceForName } from "./find-import-source-for-name.js";

// True when `localIdentifierName` is EXPLICITLY imported into the enclosing
// module from a package that is not a React runtime — e.g. a homegrown
// `useEffectEvent` from "@rocket.chat/fuselage-hooks", which is a stable-callback
// helper meant to be stored and passed as props rather than React's experimental
// effect event. Effect-event rules key off the hook NAME (to stay in parity with
// eslint-plugin-react-hooks, whose fixtures call a bare global), so a same-named
// custom hook would otherwise be a false positive. Returns false for an
// unimported bare/global name so that parity behaviour is preserved.
export const isImportedFromNonReactModule = (
  contextNode: EsTreeNode,
  localIdentifierName: string,
): boolean => {
  const importSource = getImportSourceForName(contextNode, localIdentifierName);
  if (importSource === null) return false;
  return !REACT_RUNTIME_MODULE_SOURCES.has(importSource);
};
