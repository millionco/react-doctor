import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "`React` must be in scope when using JSX (the classic JSX transform expands `<a/>` to `React.createElement('a')`).";

// Port of `oxc_linter::rules::react::react_in_jsx_scope`. Only relevant
// for the legacy classic JSX runtime; tsconfig `jsx: "react-jsx"` (or
// Babel's automatic runtime) makes this unnecessary. Rule fires per
// JSX site when `React` isn't visible from that site's scope chain.
//
// Scope-aware: uses `findVariableInitializer` to resolve `React` from
// the JSX site, so a `React` binding in a sibling function scope no
// longer silences JSX in an unrelated function. The common shape
// (module-level `import React from 'react'`) is still detected
// because module-scope bindings are visible from every nested site.
export const reactInJsxScope = defineRule<Rule>({
  id: "react-in-jsx-scope",
  severity: "warn",
  // Default off because the rule is obsolete for any project on React 17+
  // with the automatic JSX runtime (`jsx: "react-jsx"` in tsconfig, or
  // `runtime: "automatic"` in Babel/SWC) — which is the configuration
  // every modern React tool ships out of the box. Opt in via config if
  // you're stuck on the classic transform.
  defaultEnabled: false,
  recommendation:
    "If you're on React 17+ with the new JSX transform, disable this rule. Otherwise import `React` at the top of the file.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (findVariableInitializer(node, "React")) return;
      context.report({ node: node.name, message: MESSAGE });
    },
    JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
      if (findVariableInitializer(node, "React")) return;
      context.report({ node: node.openingFragment, message: MESSAGE });
    },
  }),
});
