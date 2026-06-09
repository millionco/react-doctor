import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "This value is `undefined` because function components have no `this`.";

// Returns true if the enclosing scope is a class method or a custom
// class-factory call (e.g. `React.createClass({…})` when the project's
// `settings.react.createClass` pragma is set to `"createClass"`).
// Without that setting, only the standard `createReactClass` shapes
// match through `isEs5Component`.
const isInsideClassMethod = (
  node: EsTreeNode,
  customClassFactoryNames: ReadonlySet<string>,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "ClassDeclaration") || isNodeOfType(ancestor, "ClassExpression")) {
      return true;
    }
    if (isEs5Component(ancestor)) return true;
    if (customClassFactoryNames.size > 0 && isNodeOfType(ancestor, "CallExpression")) {
      const callee = ancestor.callee;
      if (isNodeOfType(callee, "Identifier") && customClassFactoryNames.has(callee.name)) {
        return true;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        customClassFactoryNames.has(callee.property.name)
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const findEnclosingFunctionComponent = (
  node: EsTreeNode,
): EsTreeNodeOfType<
  "FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression"
> | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "FunctionDeclaration") ||
      isNodeOfType(ancestor, "FunctionExpression") ||
      isNodeOfType(ancestor, "ArrowFunctionExpression")
    ) {
      return ancestor;
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// A function with an explicit TypeScript `this:` parameter is, by
// definition, NOT a stateless functional component — the author is
// using TS this-typing to declare a non-React calling convention
// (webpack loaders, class-component glue, Tiptap/ProseMirror
// extension methods, RxJS `this`-bound helpers, etc.). Skip the rule
// for these. The `this` parameter appears as the first param with
// `Identifier { name: "this" }`.
const hasExplicitThisParameter = (
  fn: EsTreeNodeOfType<"FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression">,
): boolean => {
  const firstParameter = fn.params?.[0] as EsTreeNode | undefined;
  if (!firstParameter) return false;
  if (!isNodeOfType(firstParameter, "Identifier")) return false;
  return firstParameter.name === "this";
};

const looksLikeFunctionComponent = (
  fn: EsTreeNodeOfType<"FunctionDeclaration" | "FunctionExpression" | "ArrowFunctionExpression">,
): boolean => {
  if (hasExplicitThisParameter(fn)) return false;
  if (isNodeOfType(fn, "FunctionDeclaration") && fn.id) {
    return isReactComponentName(fn.id.name);
  }
  // FunctionExpression / ArrowFunctionExpression assigned to a PascalCase name.
  let parent = fn.parent;
  while (parent) {
    if (isNodeOfType(parent, "VariableDeclarator")) {
      if (isNodeOfType(parent.id, "Identifier")) return isReactComponentName(parent.id.name);
      return false;
    }
    if (isNodeOfType(parent, "AssignmentExpression")) {
      if (isNodeOfType(parent.left, "Identifier")) return isReactComponentName(parent.left.name);
      return false;
    }
    // Object-property method (`{ addAttributes() {...} }` or `{ foo: () => ... }`)
    // is an object method, not a component candidate — its enclosing
    // PascalCase variable (e.g. `const ResizableImage = TiptapImage.extend({...})`)
    // is the wrapper expression, not a React function component. Stop
    // here so we don't misattribute `this` inside Tiptap / ProseMirror /
    // class-style object configs as being inside a React SFC.
    if (isNodeOfType(parent, "Property")) return false;
    if (
      isNodeOfType(parent, "FunctionDeclaration") ||
      isNodeOfType(parent, "FunctionExpression") ||
      isNodeOfType(parent, "ArrowFunctionExpression") ||
      isNodeOfType(parent, "ClassDeclaration") ||
      isNodeOfType(parent, "ClassExpression") ||
      isNodeOfType(parent, "MethodDefinition")
    ) {
      return false;
    }
    parent = parent.parent ?? null;
  }
  return false;
};

// Port of `oxc_linter::rules::react::no_this_in_sfc`. Flags
// `this.<member>` inside a function component (PascalCase name).
// LIMITATION: OXC additionally checks if the function body returns JSX
// or calls React.createElement; we approximate by relying on the
// PascalCase naming convention. Class components are excluded by the
// ancestor walk.
export const noThisInSfc = defineRule<Rule>({
  id: "no-this-in-sfc",
  title: "this used in function component",
  severity: "warn",
  recommendation:
    "Read from the `props` argument because function components do not have a React instance `this`.",
  create: (context) => {
    // Read settings.react.createClass — a string OR array OR a single
    // bare name. Always include the standard createReactClass shape
    // so callers who set the pragma don't accidentally lose default
    // detection.
    const reactBlock = (context.settings as { react?: { createClass?: unknown } } | undefined)
      ?.react;
    const configured = reactBlock?.createClass;
    const customClassFactoryNames = new Set<string>();
    if (typeof configured === "string") customClassFactoryNames.add(configured);
    else if (Array.isArray(configured)) {
      for (const entry of configured) {
        if (typeof entry === "string") customClassFactoryNames.add(entry);
      }
    }

    return {
      ThisExpression(node: EsTreeNodeOfType<"ThisExpression">) {
        const parent = node.parent;
        if (!parent || !isNodeOfType(parent, "MemberExpression")) return;
        if (isInsideClassMethod(node, customClassFactoryNames)) return;
        const enclosingFunction = findEnclosingFunctionComponent(node);
        if (!enclosingFunction) return;
        if (!looksLikeFunctionComponent(enclosingFunction)) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
