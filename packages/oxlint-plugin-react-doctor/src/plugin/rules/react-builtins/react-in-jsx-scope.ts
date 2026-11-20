import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hasAutomaticTypeScriptJsxPragma,
  resolveDirectTypeScriptJsxRoot,
} from "../../utils/resolve-direct-typescript-jsx.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { defineRule } from "../../utils/define-rule.js";
import { EMPTY_RULE_VISITORS } from "../../utils/empty-rule-visitors.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";

const fileEmitsWithAutomaticTypeScriptJsx = (context: RuleContext): boolean => {
  const filename = context.filename;
  if (!filename?.endsWith(".tsx")) return false;
  let source: string;
  try {
    source = context.sourceCode?.getText?.() ?? readFileSync(filename, "utf8");
  } catch {
    return false;
  }
  if (!hasAutomaticTypeScriptJsxPragma(source)) return false;

  const compilerRoot = resolveDirectTypeScriptJsxRoot(filename);
  if (!compilerRoot) return false;
  const settings = context.settings?.["react-doctor"];
  return !(
    typeof settings === "object" &&
    settings !== null &&
    "rootDirectory" in settings &&
    typeof settings.rootDirectory === "string" &&
    resolve(settings.rootDirectory) !== compilerRoot
  );
};

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
    if (fileEmitsWithAutomaticTypeScriptJsx(context)) return EMPTY_RULE_VISITORS;
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (findVariableInitializer(node, "React")) return;
        context.report({ node: node.name, message: MESSAGE });
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        if (findVariableInitializer(node, "React")) return;
        context.report({ node: node.openingFragment, message: MESSAGE });
      },
    };
  },
});
