import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

type FunctionLikeNode =
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression">;

// Render-prop callbacks (e.g. `<Show>{(value) => ...}</Show>`) are
// not components — the destructure happens inside Solid's reactive
// child mapping where reactivity still flows.
const isRenderPropCallback = (node: FunctionLikeNode): boolean => {
  const parent = node.parent;
  if (!parent) return false;
  return isNodeOfType(parent, "JSXExpressionContainer");
};

// Port of `solid/no-destructure` — flag destructured props in a
// component's parameter list because destructuring captures values
// at call time and breaks Solid's reactivity. The autofix in the
// upstream rule rewrites the function body; we report only here
// (autofix would require source manipulation we don't track in this
// plugin yet).
export const solidNoDestructure = defineRule<Rule>({
  id: "solid-no-destructure",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Use property access (`props.foo`) instead of destructuring component props — destructuring breaks reactivity.",
  create: (context: RuleContext) => {
    const visitFunction = (node: FunctionLikeNode): void => {
      if (node.params.length !== 1) return;
      const firstParameter = node.params[0];
      if (!isNodeOfType(firstParameter, "ObjectPattern")) return;
      if (isRenderPropCallback(node)) return;
      if (!containsJsxElement(node as EsTreeNode)) return;
      context.report({
        node: firstParameter,
        message:
          "Destructuring component props breaks Solid's reactivity; use property access instead.",
      });
    };
    return {
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        visitFunction(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        visitFunction(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        visitFunction(node);
      },
    };
  },
});
