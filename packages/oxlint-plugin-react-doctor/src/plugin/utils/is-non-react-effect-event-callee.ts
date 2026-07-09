import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isImportedFromNonReactModule } from "./is-imported-from-non-react-module.js";
import { isNodeOfType } from "./is-node-of-type.js";

// React's effect-event semantics (call-only identity that changes every
// render on purpose) apply to React's own `useEffectEvent`. A same-named
// hook that is EXPLICITLY imported from another package (e.g.
// `@floating-ui/react/utils`, `@rocket.chat/fuselage-hooks`) or DEFINED in
// this module (the userland polyfill — a stable-callback helper designed to
// be stored, listed in deps, and passed as props) carries different
// semantics, so effect-event reports on it are false positives. Only a
// bare/unresolved `useEffectEvent` is still treated as React's, to preserve
// parity with eslint-plugin-react-hooks.
const resolvesToLocalNonImportBinding = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.referenceFor(identifier)?.resolvedSymbol;
  return Boolean(symbol && symbol.kind !== "import");
};

export const isNonReactEffectEventCallee = (
  callee: EsTreeNode,
  contextNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    return (
      isImportedFromNonReactModule(contextNode, callee.name) ||
      resolvesToLocalNonImportBinding(callee, scopes)
    );
  }
  // `Utils.useEffectEvent(...)` through a namespace/binding imported from a
  // non-React package is the same polyfill origin spelled as a member access
  // (floating-ui-style util namespaces). `React.useEffectEvent` keeps firing
  // because "react" is a React runtime source, and a bare unimported
  // `Hook.useEffectEvent(...)` object stays treated as React's for parity.
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.object, "Identifier")
  ) {
    return isImportedFromNonReactModule(contextNode, callee.object.name);
  }
  return false;
};
