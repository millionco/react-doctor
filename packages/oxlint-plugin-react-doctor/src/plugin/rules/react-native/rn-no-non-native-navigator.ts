import { defineRule } from "../../utils/define-rule.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// Documented scope is the two JS-driven navigator packages only —
// bottom-tabs has no drop-in native replacement before react-navigation v7,
// so flagging it hands users an unactionable fix.
const NON_NATIVE_NAVIGATOR_PACKAGES = new Map<string, string>([
  ["@react-navigation/stack", "@react-navigation/native-stack"],
  [
    "@react-navigation/drawer",
    "expo-router Drawer (no native equivalent exists for standalone React Navigation)",
  ],
]);

const NAVIGATOR_FACTORY_PATTERN = /^create\w*Navigator$/;

// Only an import that binds the navigator factory (or a namespace/default
// binding that can reach it) instantiates a JS-driven navigator. Helper-only
// imports — `useDrawerStatus` reading drawer state, `CardStyleInterpolators`
// configuring options — don't create JS transitions, and the rename fix does
// not apply to them.
const bindsNavigatorFactory = (node: EsTreeNodeOfType<"ImportDeclaration">): boolean =>
  (node.specifiers ?? []).some((specifier) => {
    if (
      isNodeOfType(specifier, "ImportDefaultSpecifier") ||
      isNodeOfType(specifier, "ImportNamespaceSpecifier")
    ) {
      return true;
    }
    if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type") {
      return false;
    }
    const importedName = getImportedName(specifier);
    return importedName !== undefined && NAVIGATOR_FACTORY_PATTERN.test(importedName);
  });

// HACK: @react-navigation/stack uses a JS-implemented stack with
// imperfect native gesture/feel. native-stack uses platform-native
// UINavigationController / Fragment, giving real iOS/Android transitions,
// swipe-back, and large titles for free.
export const rnNoNonNativeNavigator = defineRule({
  id: "rn-no-non-native-navigator",
  defaultEnabled: false,
  title: "Non-native JS navigator",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `@react-navigation/native-stack` for stack navigation. Treat drawers separately because standalone React Navigation has no native drawer replacement.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      const source = node.source?.value;
      if (typeof source !== "string") return;
      if (isTypeOnlyImport(node)) return;
      const replacement = NON_NATIVE_NAVIGATOR_PACKAGES.get(source);
      if (!replacement) return;
      if (!bindsNavigatorFactory(node)) return;
      context.report({
        node,
        message: `Users get JS-driven transitions and gestures from ${source}, instead of platform-native navigation behavior.`,
      });
    },
  }),
});
