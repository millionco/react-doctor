import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const RENDER_ARGUMENTS_MESSAGE =
  "Preact's `render(props, state)` argument shape is deprecated — read `this.props` / `this.state` instead so the component still works under `preact/compat`.";

const isInstanceMethodNamedRender = (
  node: EsTreeNode,
): node is EsTreeNodeOfType<"MethodDefinition"> =>
  isNodeOfType(node, "MethodDefinition") &&
  node.kind === "method" &&
  // `static render(...)` on a Component subclass is never invoked by
  // the Preact / React renderer — it's a user-defined utility that
  // happens to share a name. Only instance methods are the lifecycle.
  node.static !== true &&
  isNodeOfType(node.key, "Identifier") &&
  node.key.name === "render";

const isInsideEs6Component = (methodDefinition: EsTreeNode): boolean => {
  const classBody = methodDefinition.parent;
  if (!classBody || !isNodeOfType(classBody, "ClassBody")) return false;
  const owningClass = classBody.parent;
  if (!owningClass) return false;
  return isEs6Component(owningClass);
};

// TypeScript lets users type the `this` binding via a leading `this:` parameter
// declaration that has no runtime presence. It still surfaces in the ESTree AST
// as `params[0]` with `name === "this"`, so we have to peel it off before
// inspecting the actual user-supplied parameter list.
const stripThisParameter = (params: ReadonlyArray<EsTreeNode>): ReadonlyArray<EsTreeNode> => {
  const first = params[0];
  if (!first) return params;
  if (isNodeOfType(first, "Identifier") && first.name === "this") {
    return params.slice(1);
  }
  return params;
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
      if (!isInstanceMethodNamedRender(node)) return;
      if (!isInsideEs6Component(node)) return;
      const renderFunction = node.value;
      if (!renderFunction || !isNodeOfType(renderFunction, "FunctionExpression")) return;
      const runtimeParams = stripThisParameter(renderFunction.params);
      const firstParameter = runtimeParams[0];
      if (!firstParameter) return;
      context.report({ node: firstParameter, message: RENDER_ARGUMENTS_MESSAGE });
    },
  }),
});
