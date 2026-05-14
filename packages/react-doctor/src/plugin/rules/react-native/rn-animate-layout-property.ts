import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const REANIMATED_LAYOUT_KEYS = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
]);

const findReturnedObject = (callback: EsTreeNode): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return null;
  }
  const body = callback.body;
  if (isNodeOfType(body, "ObjectExpression")) return body;
  if (!isNodeOfType(body, "BlockStatement")) return null;
  for (const stmt of body.body ?? []) {
    if (isNodeOfType(stmt, "ReturnStatement") && isNodeOfType(stmt.argument, "ObjectExpression")) {
      return stmt.argument;
    }
  }
  return null;
};

// HACK: in Reanimated, `useAnimatedStyle(() => ({ height: …, width: … }))`
// runs the animation on the JS layout thread (or worse, triggers actual
// layout passes per frame). transform / opacity stay on the GPU
// compositor. For anything driven by `withTiming` / `withSpring` /
// shared values, animate `transform: [{ translateX/Y }, { scale }]` or
// `opacity` instead.
export const rnAnimateLayoutProperty = defineRule<Rule>({
  id: "rn-animate-layout-property",
  requires: ["react-native"],
  framework: "react-native",
  severity: "error",
  category: "React Native",
  recommendation:
    "Animate `transform: [{ translateX/Y }, { scale }]` and `opacity` instead of layout props — layout runs on the JS thread; transform/opacity run on the GPU compositor",
  examples: [
    {
      before: "const style = useAnimatedStyle(() => ({ width: progress.value * 200 }));",
      after: "const style = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.value }] }));",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "useAnimatedStyle")
        return;
      const callback = node.arguments?.[0];
      if (!callback) return;
      const returnedObject = findReturnedObject(callback);
      if (!returnedObject) return;

      for (const property of returnedObject.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        if (!isNodeOfType(property.key, "Identifier")) continue;
        if (!REANIMATED_LAYOUT_KEYS.has(property.key.name)) continue;

        context.report({
          node: property,
          message: `useAnimatedStyle animating "${property.key.name}" — layout properties run on the layout thread; use transform: [{ translateX/Y }, { scale }] or opacity for GPU-accelerated animation`,
        });
      }
    },
  }),
});
