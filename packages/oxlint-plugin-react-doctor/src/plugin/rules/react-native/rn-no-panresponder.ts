import { defineRule } from "../../utils/define-rule.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `PanResponder` runs its gesture math on the JS thread, so every
// touch frame round-trips through the bridge — under load the gesture
// stutters and drops frames. `react-native-gesture-handler` processes
// the same gestures on the native UI thread (and composes with
// Reanimated worklets), so the interaction stays at 60fps even when JS
// is busy. We key off the named import from `react-native` (resolving
// aliases) so a same-named local symbol or a re-export from another
// package never trips the rule.
export const rnNoPanresponder = defineRule<Rule>({
  id: "rn-no-panresponder",
  title: "PanResponder over react-native-gesture-handler",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `react-native-gesture-handler` (`Gesture.Pan()`) instead of `PanResponder`. It runs gestures on the native UI thread, so they stay smooth even when the JS thread is busy.",
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
      if (node.source?.value !== "react-native") return;
      // Type-only imports are erased at build time, so `import type { ... }`
      // (and the inline `import { type PanResponder }`) leave no runtime
      // PanResponder — the JS-thread perf concern doesn't apply.
      if (node.importKind === "type") return;
      for (const specifier of node.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
        if (specifier.importKind === "type") continue;
        if (getImportedName(specifier) !== "PanResponder") continue;
        context.report({
          node: specifier,
          message:
            "PanResponder runs gesture handling on the JS thread, which stutters under load. Use react-native-gesture-handler (`Gesture.Pan()`) so gestures run on the native UI thread.",
        });
      }
    },
  }),
});
