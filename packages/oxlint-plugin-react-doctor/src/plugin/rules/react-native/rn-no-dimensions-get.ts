import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const rnNoDimensionsGet = defineRule({
  id: "rn-no-dimensions-get",
  title: "Dimensions.get over useWindowDimensions",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `const { width, height } = useWindowDimensions()` so the size updates automatically on rotation and resize.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "MemberExpression")) return;
      if (
        !isNodeOfType(node.callee.object, "Identifier") ||
        node.callee.object.name !== "Dimensions"
      )
        return;

      // `Dimensions.get(...)` only means React Native's API when `Dimensions`
      // is that import. An import from another module, or a local binding
      // (e.g. `const Dimensions = new Map()`), is an unrelated `.get()`.
      const importSource = getImportSourceForName(node, "Dimensions");
      if (importSource !== null) {
        if (importSource !== "react-native") return;
      } else if (findVariableInitializer(node, "Dimensions")) {
        return;
      }

      if (isMemberProperty(node.callee, "get")) {
        context.report({
          node,
          message:
            "Your users see a stale layout on rotation or resize because Dimensions.get() does not update.",
        });
      }

      if (isMemberProperty(node.callee, "addEventListener")) {
        context.report({
          node,
          message:
            "Your users hit a crash from Dimensions.addEventListener(), which was removed in React Native 0.72.",
        });
      }
    },
  }),
});
