import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

// Preact code conventionally imports the namespace as `Preact` (e.g.
// `import * as Preact from "preact"; class Foo extends Preact.Component`).
// The shared `isEs6Component` helper only recognises the React pragma, so
// for the Preact-bucket rule we add a local check that covers the
// equivalent Preact-namespace pattern. Not folded into the shared helper
// to avoid changing behaviour of every other rule that depends on it.
const PREACT_COMPONENT_NAMESPACES = new Set(["Preact"]);
const PREACT_COMPONENT_NAMES = new Set(["Component", "PureComponent"]);

const isPreactNamespaceComponentRef = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression")) return false;
  if (!isNodeOfType(node.object, "Identifier")) return false;
  if (!PREACT_COMPONENT_NAMESPACES.has(node.object.name)) return false;
  if (!isNodeOfType(node.property, "Identifier")) return false;
  return PREACT_COMPONENT_NAMES.has(node.property.name);
};

const isPreactOrReactComponentClass = (node: EsTreeNode): boolean => {
  if (isEs6Component(node)) return true;
  if (!isNodeOfType(node, "ClassDeclaration") && !isNodeOfType(node, "ClassExpression")) {
    return false;
  }
  const superClass = node.superClass;
  if (!superClass) return false;
  return isPreactNamespaceComponentRef(superClass);
};

const RENDER_ARGUMENTS_MESSAGE =
  "Your users hit `undefined` props under `preact/compat` when you read `render(props, state)` from arguments, since compat uses React's parameterless render, so read from `this.props` & `this.state` instead.";

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
  return isPreactOrReactComponentClass(owningClass);
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

// Preact forwards `props` and `state` as positional arguments to `render()`,
// letting class components read them from the parameter list instead of
// `this.props` / `this.state`. The shape is Preact-specific (not deprecated
// — the docs ship it as a "Features unique to Preact" item), but it has
// three real costs:
//
//   1. Harder to type cleanly in TypeScript — `Component<Props, State>`
//      generics drive `this.props` / `this.state` for free, while the
//      positional `(props, state)` shape needs the parameter signature
//      duplicated and kept in sync by hand.
//   2. Breaks under `preact/compat`, which mirrors React's parameterless
//      `render()` signature — the same component now reads `undefined`
//      from `props`/`state` if the project ever flips to compat.
//   3. Quietly diverges from every other Preact lifecycle method
//      (`componentDidMount`, `getSnapshotBeforeUpdate`, …) which all
//      use `this.props` / `this.state`. Mixing both styles in one
//      component is just noise.
//
// We only flag class components that extend `Component` / `PureComponent`
// (or `React.Component` / `React.PureComponent`) — function components
// and non-component classes are untouched.
export const preactNoRenderArguments = defineRule<Rule>({
  id: "preact-no-render-arguments",
  title: "render() reads props from arguments",
  requires: ["preact"],
  severity: "warn",
  recommendation:
    "Read from `this.props` and `this.state` because `preact/compat` uses React's parameterless `render()` and positional props/state become undefined.",
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
