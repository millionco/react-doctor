import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const RENDER_ARGUMENTS_MESSAGE =
  "Preact's `render(props, state)` argument shape is deprecated — read `this.props` / `this.state` instead so the component still works under `preact/compat`.";

const isClassMethodNamedRender = (node: EsTreeNode): node is EsTreeNodeOfType<"MethodDefinition"> =>
  isNodeOfType(node, "MethodDefinition") &&
  node.kind === "method" &&
  isNodeOfType(node.key, "Identifier") &&
  node.key.name === "render";

const isInsideEs6Component = (methodDefinition: EsTreeNode): boolean => {
  const classBody = methodDefinition.parent;
  if (!classBody || !isNodeOfType(classBody, "ClassBody")) return false;
  const owningClass = classBody.parent;
  if (!owningClass) return false;
  return isEs6Component(owningClass);
};

// Preact historically forwarded `props` and `state` as positional arguments
// to `render()`, letting class components read them from the parameter list
// instead of `this.props` / `this.state`. The pattern is Preact-specific and
// breaks under `preact/compat` (which mirrors React's signature), so the
// official `eslint-config-preact` set warns against it. We only flag class
// components that extend `Component` / `PureComponent` (or
// `React.Component` / `React.PureComponent`) — function components and
// non-component classes are untouched.
export const preactNoRenderArguments = defineRule<Rule>({
  id: "preact-no-render-arguments",
  requires: ["preact"],
  severity: "warn",
  recommendation:
    "Read state/props from `this.props` / `this.state` inside `render()` instead of declaring positional parameters.",
  create: (context) => ({
    MethodDefinition(node: EsTreeNodeOfType<"MethodDefinition">) {
      if (!isClassMethodNamedRender(node)) return;
      if (!isInsideEs6Component(node)) return;
      const renderFunction = node.value;
      if (!renderFunction || !isNodeOfType(renderFunction, "FunctionExpression")) return;
      if (renderFunction.params.length === 0) return;
      const firstParameter = renderFunction.params[0];
      if (!firstParameter) return;
      context.report({ node: firstParameter, message: RENDER_ARGUMENTS_MESSAGE });
    },
  }),
});
