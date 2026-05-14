import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const PRESS_HANDLER_PROP_NAMES = new Set(["onPressIn", "onPressOut"]);

const handlerMutatesIdentifier = (
  handler: EsTreeNode,
  sharedValueBindings: Set<string>,
): boolean => {
  if (
    !isNodeOfType(handler, "ArrowFunctionExpression") &&
    !isNodeOfType(handler, "FunctionExpression")
  ) {
    return false;
  }
  if (sharedValueBindings.size === 0) return false;
  let didMutate = false;
  walkAst(handler.body, (child: EsTreeNode) => {
    if (didMutate) return;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.left, "MemberExpression") &&
      isNodeOfType(child.left.object, "Identifier") &&
      sharedValueBindings.has(child.left.object.name) &&
      isNodeOfType(child.left.property, "Identifier") &&
      child.left.property.name === "value"
    ) {
      didMutate = true;
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.object, "Identifier") &&
      sharedValueBindings.has(child.callee.object.name) &&
      isNodeOfType(child.callee.property, "Identifier") &&
      (child.callee.property.name === "set" || child.callee.property.name === "value")
    ) {
      didMutate = true;
    }
  });
  return didMutate;
};

// HACK: <Pressable onPressIn={() => sv.value = withTiming(0.95)}> bounces
// the gesture across the JS bridge twice (press in → JS handler → set
// shared value → animation kicks off), which is visibly stuttery on
// Android. The Reanimated GestureDetector + Gesture.Tap() runs entirely
// on the UI thread for native-feeling press feedback. We only flag when
// the receiver is actually a `useSharedValue` binding to avoid
// false-positives on `Map.prototype.set` / `ref.current.value =` etc.
export const rnPressableSharedValueMutation = defineRule<Rule>({
  requires: ["react-native"],
  framework: "react-native",
  severity: "warn",
  category: "React Native",
  recommendation:
    "Wrap in <GestureDetector gesture={Gesture.Tap()...}> so the press animation runs on the UI thread instead of bouncing across the JS bridge",
  examples: [
    {
      before:
        "<Pressable onPressIn={() => { scale.value = 0.95; }} onPressOut={() => { scale.value = 1; }} />",
      after:
        "const tap = Gesture.Tap().onBegin(() => { scale.value = 0.95; }).onFinalize(() => { scale.value = 1; });\n<GestureDetector gesture={tap}><Animated.View /></GestureDetector>",
    },
  ],
  create: (context: RuleContext) => {
    const sharedValueBindingsByComponent: Array<Set<string>> = [];

    const enterScope = (): void => {
      sharedValueBindingsByComponent.push(new Set());
    };
    const exitScope = (): void => {
      sharedValueBindingsByComponent.pop();
    };
    const trackSharedValueBinding = (declarator: EsTreeNode): void => {
      if (sharedValueBindingsByComponent.length === 0) return;
      if (!isNodeOfType(declarator, "VariableDeclarator")) return;
      if (!isNodeOfType(declarator.id, "Identifier")) return;
      if (!isNodeOfType(declarator.init, "CallExpression")) return;
      const callee = declarator.init.callee;
      if (!isNodeOfType(callee, "Identifier")) return;
      if (callee.name !== "useSharedValue") return;
      sharedValueBindingsByComponent[sharedValueBindingsByComponent.length - 1].add(
        declarator.id.name,
      );
    };

    return {
      FunctionDeclaration: enterScope,
      "FunctionDeclaration:exit": exitScope,
      FunctionExpression: enterScope,
      "FunctionExpression:exit": exitScope,
      ArrowFunctionExpression: enterScope,
      "ArrowFunctionExpression:exit": exitScope,
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        trackSharedValueBinding(node);
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const name = resolveJsxElementName(node);
        if (name !== "Pressable") return;
        if (sharedValueBindingsByComponent.length === 0) return;
        const activeBindings = new Set<string>();
        for (const frame of sharedValueBindingsByComponent) {
          for (const binding of frame) activeBindings.add(binding);
        }
        if (activeBindings.size === 0) return;

        for (const attr of node.attributes ?? []) {
          if (!isNodeOfType(attr, "JSXAttribute")) continue;
          if (!isNodeOfType(attr.name, "JSXIdentifier")) continue;
          if (!PRESS_HANDLER_PROP_NAMES.has(attr.name.name)) continue;
          if (!isNodeOfType(attr.value, "JSXExpressionContainer")) continue;
          const handler = attr.value.expression;
          if (!handler) continue;
          if (!handlerMutatesIdentifier(handler, activeBindings)) continue;

          context.report({
            node: attr,
            message: `<Pressable> ${attr.name.name} mutates a Reanimated shared value — use a Gesture.Tap() inside <GestureDetector> for press animations that stay on the UI thread`,
          });
        }
      },
    };
  },
});
