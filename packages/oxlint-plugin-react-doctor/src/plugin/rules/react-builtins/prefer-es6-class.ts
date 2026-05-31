import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import type { Rule } from "../../utils/rule.js";

const ALWAYS_MESSAGE = "`createReactClass` is legacy & adds a dependency.";
const NEVER_MESSAGE = "This component is defined inconsistently.";

interface PreferEs6ClassSettings {
  mode?: "always" | "never";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): PreferEs6ClassSettings => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return {};
  return (reactDoctor as { preferEs6Class?: PreferEs6ClassSettings }).preferEs6Class ?? {};
};

// Port of `oxc_linter::rules::react::prefer_es6_class`. By default
// (mode = "always") flags `createReactClass({...})` calls. With
// mode = "never" flips: flags `class X extends React.Component`.
export const preferEs6Class = defineRule<Rule>({
  id: "prefer-es6-class",
  title: "createClass instead of ES6 class",
  severity: "warn",
  recommendation:
    "Pick one component style for the whole codebase: `class extends React.Component` (default) or `createReactClass` (legacy).",
  category: "Architecture",
  create: (context) => {
    const { mode = "always" } = resolveSettings(context.settings);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (mode !== "always") return;
        const callExpressionNode: EsTreeNode = node;
        if (!isEs5Component(callExpressionNode)) return;
        context.report({ node: callExpressionNode, message: ALWAYS_MESSAGE });
      },
      ClassDeclaration(node: EsTreeNodeOfType<"ClassDeclaration">) {
        if (mode === "always") return;
        const classNode: EsTreeNode = node;
        if (!isEs6Component(classNode)) return;
        context.report({ node: node.id ?? classNode, message: NEVER_MESSAGE });
      },
      ClassExpression(node: EsTreeNodeOfType<"ClassExpression">) {
        if (mode === "always") return;
        const classNode: EsTreeNode = node;
        if (!isEs6Component(classNode)) return;
        context.report({ node: node.id ?? classNode, message: NEVER_MESSAGE });
      },
    };
  },
});
