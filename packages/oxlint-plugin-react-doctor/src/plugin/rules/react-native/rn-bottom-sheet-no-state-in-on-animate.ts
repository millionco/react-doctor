import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveImportedJsxComponentName } from "../../utils/resolve-imported-jsx-component-name.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

const GORHOM_BOTTOM_SHEET_MODULE = "@gorhom/bottom-sheet";
const BOTTOM_SHEET_CONTAINER_NAMES: ReadonlySet<string> = new Set([
  "BottomSheet",
  "BottomSheetModal",
  "default",
]);

export const rnBottomSheetNoStateInOnAnimate = defineRule({
  id: "rn-bottom-sheet-no-state-in-on-animate",
  title: "React state update in Bottom Sheet onAnimate",
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Avoid starting React renders from onAnimate. Use animatedIndex or animatedPosition for animation-coupled UI, or onChange for committed index state.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const componentName = resolveImportedJsxComponentName(
        node,
        GORHOM_BOTTOM_SHEET_MODULE,
        context.scopes,
      );
      if (!componentName || !BOTTOM_SHEET_CONTAINER_NAMES.has(componentName)) return;
      const onAnimateAttribute = findJsxAttribute(node.attributes, "onAnimate");
      if (
        !onAnimateAttribute?.value ||
        !isNodeOfType(onAnimateAttribute.value, "JSXExpressionContainer")
      ) {
        return;
      }
      const handler = resolveExactLocalFunction(
        onAnimateAttribute.value.expression,
        context.scopes,
      );
      if (!handler) return;
      let stateSetterCall: EsTreeNodeOfType<"CallExpression"> | null = null;
      walkOwnFunctionScope(handler, (child: EsTreeNode) => {
        if (stateSetterCall) return false;
        if (!isNodeOfType(child, "CallExpression") || !isNodeOfType(child.callee, "Identifier")) {
          return;
        }
        if (!resolveReactUseStatePair(child.callee, context.scopes)) return;
        stateSetterCall = child;
        return false;
      });
      if (!stateSetterCall) return;
      context.report({
        node: stateSetterCall,
        message:
          "This onAnimate handler starts a React state update as the Bottom Sheet begins moving, adding render work to the transition. Use animatedIndex or animatedPosition for animation-coupled UI.",
      });
    },
  }),
});
