import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { hasAutomaticClassicRemixJsx } from "../../utils/has-automatic-classic-remix-jsx.js";
import { hasAutomaticElectronRendererJsx } from "../../utils/has-automatic-electron-renderer-jsx.js";
import { hasAutomaticStockCraJsx } from "../../utils/has-automatic-stock-cra-jsx.js";
import { hasAutomaticStockKktJsx } from "../../utils/has-automatic-stock-kkt-jsx.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const MESSAGE = "This JSX crashes because `React` isn't in scope.";

const jsxTagEvaluatesReact = (tag: EsTreeNodeOfType<"JSXOpeningElement">["name"]): boolean => {
  let component = tag;
  while (isNodeOfType(component, "JSXMemberExpression")) component = component.object;
  return isNodeOfType(component, "JSXIdentifier") && component.name === "React";
};

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
export const reactInJsxScope = defineRule({
  id: "react-in-jsx-scope",
  title: "React not in scope for JSX",
  severity: "warn",
  // Default off because the rule is obsolete for any project on React 17+
  // with the automatic JSX runtime (`jsx: "react-jsx"` in tsconfig, or
  // `runtime: "automatic"` in Babel/SWC) — which is the configuration
  // every modern React tool ships out of the box. Opt in via config if
  // you're stuck on the classic transform.
  defaultEnabled: false,
  recommendation:
    "If you're on React 17+ with the new JSX transform, disable this rule. Otherwise import `React` at the top of the file.",
  create: (context) => {
    let hasAutomaticFactory: boolean | undefined;
    const usesAutomaticFactory = () => {
      hasAutomaticFactory ??=
        hasAutomaticElectronRendererJsx(context) ||
        hasAutomaticClassicRemixJsx(context) ||
        hasAutomaticStockCraJsx(context) ||
        hasAutomaticStockKktJsx(context);
      return hasAutomaticFactory;
    };
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          findVariableInitializer(node, "React") ||
          (!jsxTagEvaluatesReact(node.name) && usesAutomaticFactory())
        ) {
          return;
        }
        context.report({ node: node.name, message: MESSAGE });
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        if (findVariableInitializer(node, "React") || usesAutomaticFactory()) return;
        context.report({ node: node.openingFragment, message: MESSAGE });
      },
    };
  },
});
