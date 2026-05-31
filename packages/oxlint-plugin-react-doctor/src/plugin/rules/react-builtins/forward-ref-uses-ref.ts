import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "The parent can't reach this component's node because the `forwardRef` wrapper ignores `ref`.";

// Port of `oxc_linter::rules::react::forward_ref_uses_ref`. Reports
// `forwardRef((props) => …)` and `React.forwardRef((props) => …)` —
// when the inner function's arity is exactly 1 (no `ref` parameter),
// `forwardRef` is a no-op wrapper.
export const forwardRefUsesRef = defineRule<Rule>({
  id: "forward-ref-uses-ref",
  title: "forwardRef without ref parameter",
  severity: "warn",
  recommendation: "Either accept a `ref` parameter, or drop the `forwardRef` wrapper.",
  category: "Architecture",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (getCalleeName(node) !== "forwardRef") return;
      const firstArgument = node.arguments[0];
      if (!firstArgument) return;
      let inner: EsTreeNode | null = null;
      if (
        isNodeOfType(firstArgument, "ArrowFunctionExpression") ||
        isNodeOfType(firstArgument, "FunctionExpression")
      ) {
        inner = firstArgument;
      } else {
        return;
      }
      if (!("params" in inner) || !Array.isArray(inner.params)) return;
      // forwardRef expects exactly two parameters; flag arity-1 (no rest).
      if (inner.params.length !== 1) return;
      // Accept rest params: skip if last param is RestElement (means
      // multiple/dynamic args — can't be sure).
      const onlyParam = inner.params[0];
      if (isNodeOfType(onlyParam as EsTreeNode, "RestElement")) return;
      context.report({ node: inner, message: MESSAGE });
    },
  }),
});
