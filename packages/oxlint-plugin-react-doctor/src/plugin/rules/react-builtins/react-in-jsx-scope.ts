import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isJsxFactoryBound } from "../../utils/is-jsx-factory-bound.js";
import { readJsxFactoryPragmas } from "../../utils/read-jsx-factory-pragmas.js";
import type { JsxFactoryPragmas } from "../../utils/read-jsx-factory-pragmas.js";

const MESSAGE = "This JSX crashes because `React` isn't in scope.";

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
    let factoryPragmas: JsxFactoryPragmas | null = null;
    return {
      Program(node) {
        factoryPragmas = readJsxFactoryPragmas(node, context.sourceComments ?? []);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (findVariableInitializer(node, "React")) return;
        if (factoryPragmas) {
          let tagRoot = node.name;
          while (tagRoot.type === "JSXMemberExpression") tagRoot = tagRoot.object;
          const hasReactTag = tagRoot.type === "JSXIdentifier" && tagRoot.name === "React";
          if (!hasReactTag && isJsxFactoryBound(node, factoryPragmas.elementFactory, context)) {
            return;
          }
        }
        context.report({ node: node.name, message: MESSAGE });
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        if (findVariableInitializer(node, "React")) return;
        if (factoryPragmas) {
          if (
            isJsxFactoryBound(node, factoryPragmas.elementFactory, context) &&
            isJsxFactoryBound(node, factoryPragmas.fragmentFactory, context)
          )
            return;
        }
        context.report({ node: node.openingFragment, message: MESSAGE });
      },
    };
  },
});
