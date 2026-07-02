import { defineRule } from "../../utils/define-rule.js";
import { findDeclaratorForBinding } from "../../utils/find-declarator-for-binding.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { getInitializerModuleSource } from "../../utils/get-initializer-module-source.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const IMPORT_SPECIFIER_TYPES = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);

// Classifies the in-scope `Dimensions` binding. An import is React Native's
// module only when its source is "react-native"; a variable declarator is
// React Native when initialized from `require("react-native")` (including
// destructures and `require("react-native").Dimensions`) or from a
// react-native namespace import (`const { Dimensions } = RN` / the member
// alias `const Dimensions = RN.Dimensions`). An initializer-less declaration
// (`let Dimensions;` later assigned) keeps reporting — detection wins. Any
// other initializer (`new Map()`, another module's require) is an unrelated
// local binding.
const isBindingReactNativeDimensions = (node: EsTreeNode, binding: BindingInfo): boolean => {
  if (binding.initializer && IMPORT_SPECIFIER_TYPES.has(binding.initializer.type)) {
    return getImportSourceForName(node, "Dimensions") === "react-native";
  }
  const declarator = findDeclaratorForBinding(binding.bindingIdentifier);
  if (declarator === null) return false;
  const declaratorInitializer = declarator.init;
  if (!declaratorInitializer) return true;
  return getInitializerModuleSource(node, declaratorInitializer) === "react-native";
};

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

      // Binding-first so lexical scoping wins: a function-local
      // `const Dimensions = new Map()` shadows a module-level react-native
      // import. No binding at all is an ambient/global reference — report.
      const binding = findVariableInitializer(node, "Dimensions");
      if (binding !== null && !isBindingReactNativeDimensions(node, binding)) return;

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
