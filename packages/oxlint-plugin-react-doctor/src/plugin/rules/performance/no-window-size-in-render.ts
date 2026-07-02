import {
  componentOrHookDisplayNameForFunction,
  nearestEnclosingFunction,
} from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripGroupingParens } from "../../utils/strip-grouping-parens.js";

// Viewport-size reads only — grounded in a real production SSR viewport-hook
// incident. matchMedia / navigator were cut from v1 as high-FP
// feature-detection idioms.
const WINDOW_SIZE_PROPS = new Set([
  "innerWidth",
  "innerHeight",
  "outerWidth",
  "outerHeight",
  "devicePixelRatio",
  "scrollX",
  "scrollY",
  "pageXOffset",
  "pageYOffset",
]);
const SCREEN_SIZE_PROPS = new Set(["width", "height", "availWidth", "availHeight"]);

// Array-iteration callbacks whose bodies run on the render path (they
// build the JSX), so a viewport read inside them is just as unsafe as
// one in the component body. Effect/handler/useMemo/useState-initializer
// callbacks are NOT here — those are deferred and stay quiet.
const RENDER_ITERATION_METHODS = new Set([
  "map",
  "flatMap",
  "filter",
  "forEach",
  "reduce",
  "reduceRight",
]);

const isWindowGlobalIdentifier = (node: EsTreeNode): node is EsTreeNodeOfType<"Identifier"> =>
  isNodeOfType(node, "Identifier") && (node.name === "window" || node.name === "globalThis");

// The `window` / `globalThis` identifier that roots a viewport read, or
// null when `node` isn't one of the in-scope size reads. Requires the
// explicit `window.`/`globalThis.` member form (bare-global reads were
// dropped from v1 for precision).
const windowSizeReadRoot = (node: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return null;
  if (!isNodeOfType(node.property, "Identifier")) return null;

  if (WINDOW_SIZE_PROPS.has(node.property.name) && isWindowGlobalIdentifier(node.object)) {
    return node.object;
  }
  if (
    SCREEN_SIZE_PROPS.has(node.property.name) &&
    isNodeOfType(node.object, "MemberExpression") &&
    !node.object.computed &&
    isNodeOfType(node.object.property, "Identifier") &&
    node.object.property.name === "screen" &&
    isWindowGlobalIdentifier(node.object.object)
  ) {
    return node.object.object;
  }
  return null;
};

const isRenderIterationCallback = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (!parent.arguments?.some((argument) => argument === functionNode)) return false;
  const callee = parent.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return RENDER_ITERATION_METHODS.has(callee.property.name);
};

// oxc-parser can surface `(...)` as ParenthesizedExpression, which sits
// outside the TSESTree union — matched by string, same as
// strip-grouping-parens.
const PARENTHESIZED_EXPRESSION_TYPE: string = "ParenthesizedExpression";

// A plain synchronous IIFE runs its body immediately during render, so
// it is render-path, not a deferred boundary. Async and generator
// function expressions stay deferred — their bodies do not (fully) run
// at the call site.
const isImmediatelyInvokedRenderFunction = (functionNode: EsTreeNode): boolean => {
  if (
    !isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode, "FunctionExpression")
  ) {
    return false;
  }
  if (functionNode.async || functionNode.generator) return false;
  let callCandidate = functionNode.parent;
  while (callCandidate && callCandidate.type === PARENTHESIZED_EXPRESSION_TYPE) {
    callCandidate = callCandidate.parent;
  }
  if (!callCandidate || !isNodeOfType(callCandidate, "CallExpression")) return false;
  return stripGroupingParens(callCandidate.callee) === functionNode;
};

// True when `node` sits on the render path of a component/hook: the
// nearest enclosing function is the component/hook itself, or a chain of
// render-path iteration callbacks / synchronous IIFEs leading up to it.
// Crossing any deferred boundary (effect/handler/useMemo/useState-
// initializer) returns false.
const isInComponentRenderPath = (node: EsTreeNode): boolean => {
  let current = nearestEnclosingFunction(node);
  while (current) {
    if (componentOrHookDisplayNameForFunction(current)) return true;
    if (!isRenderIterationCallback(current) && !isImmediatelyInvokedRenderFunction(current)) {
      return false;
    }
    current = nearestEnclosingFunction(current);
  }
  return false;
};

const RENDER_READ_MESSAGE =
  "Reading window size during render breaks server-side rendering (hydration mismatch) and never updates on resize — read it in a useState lazy initializer with a resize subscription, or inside an effect/handler.";

// Reading window.innerWidth/innerHeight/screen size during render is a
// footgun: on the server these globals are absent (hydration mismatch +
// a viewport-jump re-render), and even client-only the value is captured
// once and never updates on resize. The fix is a useState lazy
// initializer + resize subscription (an SSR-safe useViewport/
// useMediaQuery hook), or reading inside an effect/handler.
export const noWindowSizeInRender = defineRule({
  id: "no-window-size-in-render",
  title: "Window size read during render",
  tags: ["react-jsx-only"],
  requires: ["ssr"],
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Read viewport size in a useState lazy initializer paired with a resize subscription (or an SSR-safe useViewport hook), not directly during render where it breaks hydration and never updates on resize.",
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const root = windowSizeReadRoot(node);
      if (!root) return;
      // A local binding named `window`/`globalThis` shadows the global —
      // resolve conservatively and stay quiet when it isn't the global.
      if (findVariableInitializer(root, root.name) !== null) return;
      if (!isInComponentRenderPath(node)) return;

      context.report({ node, message: RENDER_READ_MESSAGE });
    },
    // `const { innerWidth } = window;` — the destructured form of the
    // same render-path viewport read.
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init || !isNodeOfType(node.id, "ObjectPattern")) return;
      const source = stripGroupingParens(node.init);
      if (!isWindowGlobalIdentifier(source)) return;
      if (findVariableInitializer(source, source.name) !== null) return;
      if (!isInComponentRenderPath(node)) return;

      for (const property of node.id.properties) {
        if (!isNodeOfType(property, "Property") || property.computed) continue;
        if (!isNodeOfType(property.key, "Identifier")) continue;
        if (!WINDOW_SIZE_PROPS.has(property.key.name)) continue;
        context.report({ node: property, message: RENDER_READ_MESSAGE });
      }
    },
  }),
});
