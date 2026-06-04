import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// True for a non-computed `.<name>` member access (covers both the plain
// `.current` and the optional-chained `?.current` forms — the optional
// flag doesn't change the node shape, only `node.optional`).
const isStaticMemberNamed = (node: EsTreeNode, name: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === name;

// HACK: under the New Architecture (Fabric — the default since RN 0.76)
// React makes `setNativeProps` a warn-and-return no-op. Imperative code
// like `inputRef.current.setNativeProps({ text })` therefore silently
// stops updating the view after a New-Arch migration. We require the
// `*.current(?.)setNativeProps(...)` ref shape so we only flag the React
// ref escape hatch (host-component refs), not an unrelated object that
// happens to expose a `setNativeProps` method.
export const rnNoSetNativeProps = defineRule<Rule>({
  id: "rn-no-set-native-props",
  title: "Imperative setNativeProps (no-op under Fabric)",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Drive the prop through React state, an `Animated.Value` (with `useNativeDriver: true`), or a Reanimated shared value. `setNativeProps` is a silent no-op under the New Architecture.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      // Callee must be `<receiver>.setNativeProps` (static, non-computed).
      if (!isStaticMemberNamed(callee, "setNativeProps")) return;
      if (!isNodeOfType(callee, "MemberExpression")) return;
      // Receiver must be a `*.current` access — the React ref shape.
      if (!isStaticMemberNamed(callee.object, "current")) return;
      context.report({
        node,
        message:
          "`setNativeProps` is a silent no-op under the New Architecture (Fabric), so this imperative update won't change the view. Drive the prop via state, an Animated.Value, or a Reanimated shared value.",
      });
    },
  }),
});
