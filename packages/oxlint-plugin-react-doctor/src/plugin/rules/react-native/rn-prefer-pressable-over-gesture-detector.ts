import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { resolveJsxElementName } from "./utils/resolve-jsx-element-name.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: every `<GestureDetector>` registers a native gesture handler
// on mount. On a screen that mounts many tap-only pressables (a list of
// chart indicators, a settings sheet, a chip cloud), 100 registrations
// land in the same commit and add ~325 ms of mount latency on Android
// (measured: 760 ms → 453 ms after switching to plain `Pressable`).
// For tap-only feedback the native pressable surface is faster AND
// equivalent — Reanimated 4's `createCSSAnimatedComponent(Pressable)`
// keeps the press-scale/opacity animation. Composed gestures
// (`Gesture.Race`, `Gesture.Simultaneous`, multi-tap, pan) still need
// the handler, so this rule only fires for the lone `Gesture.Tap()` case.

// Existing valid-case tests cover the other gesture factories
// (`Gesture.Pan/Pinch/Race/...`) — they all fail the `factoryName === "Tap"`
// gate above. No need to enumerate them here.

const COMPOSING_CHAIN_METHOD_NAMES = new Set([
  "simultaneousWithExternalGesture",
  "requireExternalGestureToFail",
  "blocksExternalGesture",
]);

// Walks a chain of MemberExpression-call links rooted in the initial
// gesture factory. For `Gesture.Tap().numberOfTaps(2).maxDuration(250)`
// the chain produces ["numberOfTaps", "maxDuration"] and the initial
// factory name "Tap". Returns null when the chain bottoms out at
// anything other than `Gesture.<factory>()`.
interface GestureChainInfo {
  factoryName: string;
  chainMethodNames: string[];
  numberOfTapsArgument: EsTreeNode | null;
}

const analyzeGestureChain = (expression: EsTreeNode): GestureChainInfo | null => {
  if (!isNodeOfType(expression, "CallExpression")) return null;
  const chainMethodNames: string[] = [];
  let numberOfTapsArgument: EsTreeNode | null = null;
  let cursor: EsTreeNode | null = expression;
  while (cursor && isNodeOfType(cursor, "CallExpression")) {
    const callExpression: EsTreeNodeOfType<"CallExpression"> = cursor;
    const callee = callExpression.callee;
    if (!isNodeOfType(callee, "MemberExpression")) return null;
    if (!isNodeOfType(callee.property, "Identifier")) return null;
    const methodName = callee.property.name;
    // The outermost call is the most-recent .method() in the chain;
    // we walk inward through the receivers until the chain root.
    if (isNodeOfType(callee.object, "Identifier") && callee.object.name === "Gesture") {
      return {
        factoryName: methodName,
        chainMethodNames,
        numberOfTapsArgument,
      };
    }
    // The walker visits OUTERMOST → INNERMOST. In a fluent chain,
    // `.numberOfTaps(2)` outermost is the semantically effective call
    // (last assignment wins in a fluent builder). Earlier inner
    // `.numberOfTaps(1)` calls are overridden and shouldn't reset our
    // captured value — so only record the FIRST occurrence we see.
    if (
      methodName === "numberOfTaps" &&
      numberOfTapsArgument === null &&
      callExpression.arguments?.length === 1
    ) {
      numberOfTapsArgument = callExpression.arguments[0] ?? null;
    }
    chainMethodNames.push(methodName);
    cursor = callee.object as EsTreeNode | null;
  }
  return null;
};

const isTapChainEligibleForPressable = (chain: GestureChainInfo): boolean => {
  if (chain.factoryName !== "Tap") return false;
  for (const methodName of chain.chainMethodNames) {
    if (COMPOSING_CHAIN_METHOD_NAMES.has(methodName)) return false;
  }
  const tapsArg = chain.numberOfTapsArgument;
  if (tapsArg !== null) {
    // The chain called `.numberOfTaps(...)`. Only a static numeric `1`
    // is Pressable-equivalent — anything else (`numberOfTaps(2)`,
    // `numberOfTaps(config.taps)`, `numberOfTaps(double ? 2 : 1)`)
    // signals potentially multi-tap behavior that Pressable can't
    // model. Bail conservatively.
    if (!isNodeOfType(tapsArg, "Literal")) return false;
    if (typeof tapsArg.value !== "number") return false;
    if (tapsArg.value !== 1) return false;
  }
  return true;
};

export const rnPreferPressableOverGestureDetector = defineRule<Rule>({
  id: "rn-prefer-pressable-over-gesture-detector",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Replace `<GestureDetector gesture={Gesture.Tap()...}>` with `<Pressable>` (or `createCSSAnimatedComponent(Pressable)` from react-native-reanimated/css for animated press feedback) — every GestureDetector registers a native handler on mount",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const elementName = resolveJsxElementName(node);
      if (elementName !== "GestureDetector") return;
      // Only react-native-gesture-handler's GestureDetector — never a
      // homegrown component of the same name in the same file.
      if (!isImportedFromModule(node, "GestureDetector", "react-native-gesture-handler")) return;

      let gestureExpression: EsTreeNode | null = null;
      for (const attribute of node.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
        if (attribute.name.name !== "gesture") continue;
        if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) continue;
        gestureExpression = attribute.value.expression;
        break;
      }
      if (!gestureExpression) return;

      const resolvedExpression = stripParenExpression(gestureExpression);
      // `<GD gesture={tap}>` — follow ONE level of binding to find the
      // CallExpression chain. v1 doesn't follow chains of intermediate
      // identifiers, since each extra hop dilutes the signal.
      let chainExpression: EsTreeNode = resolvedExpression;
      if (isNodeOfType(resolvedExpression, "Identifier")) {
        const binding = findVariableInitializer(node, resolvedExpression.name);
        if (!binding || !binding.initializer) return;
        chainExpression = stripParenExpression(binding.initializer);
      }

      const chain = analyzeGestureChain(chainExpression);
      if (!chain) return;
      if (!isTapChainEligibleForPressable(chain)) return;

      context.report({
        node,
        message:
          "<GestureDetector gesture={Gesture.Tap()...}> registers a native handler per mount — for tap-only feedback use <Pressable> (with createCSSAnimatedComponent(Pressable) from react-native-reanimated/css for animation)",
      });
    },
  }),
});
