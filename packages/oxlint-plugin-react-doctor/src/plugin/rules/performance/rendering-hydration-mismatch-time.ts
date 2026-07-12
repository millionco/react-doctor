import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { executesDuringRender } from "../../utils/executes-during-render.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { hasSuppressHydrationWarningAttribute } from "../../utils/has-suppress-hydration-warning-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGatedByFalsyInitialState } from "../../utils/is-gated-by-falsy-initial-state.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isGlobalMethodCall } from "../../utils/is-global-method-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const NONDETERMINISTIC_RENDER_PATTERNS: Array<{
  matches: (node: EsTreeNode) => boolean;
  display: string;
}> = [
  {
    display: "new Date()",
    matches: (node) =>
      isNodeOfType(node, "NewExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "Date" &&
      // `new Date(timestamp)` / `new Date(year, month, …)` are
      // deterministic conversions; only the no-arg form reads the
      // current wall clock and so differs server-vs-client.
      (node.arguments?.length ?? 0) === 0,
  },
  {
    display: "Date.now()",
    matches: (node) => isGlobalMethodCall(node, "Date", "now"),
  },
  {
    display: "Math.random()",
    matches: (node) => isGlobalMethodCall(node, "Math", "random"),
  },
  {
    display: "performance.now()",
    matches: (node) => isGlobalMethodCall(node, "performance", "now"),
  },
  {
    display: "crypto.randomUUID()",
    matches: (node) => isGlobalMethodCall(node, "crypto", "randomUUID"),
  },
];

const findOpeningElementOfChild = (jsxNode: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null = jsxNode.parent ?? null;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXElement")) return cursor.openingElement;
    if (isNodeOfType(cursor, "JSXFragment")) return null;
    cursor = cursor.parent ?? null;
  }
  return null;
};

// `© {new Date().getFullYear()}` is the universal copyright idiom — the value
// only diverges across a New Year boundary between the server render and
// hydration, which no maintainer wraps in useEffect.
const isYearOnlyDateRead = (dateNode: EsTreeNode): boolean => {
  const member = dateNode.parent;
  if (!isNodeOfType(member, "MemberExpression") || member.object !== dateNode) return false;
  if (!isNodeOfType(member.property, "Identifier") || member.property.name !== "getFullYear") {
    return false;
  }
  const call = member.parent;
  return isNodeOfType(call, "CallExpression") && call.callee === member;
};

// framer-motion's `transition` prop is timing config consumed by the client
// animation loop; it is never serialized into server HTML, so random values
// there cannot mismatch.
const MOTION_ELEMENT_OBJECT_NAMES = new Set(["motion", "m"]);

const isInsideMotionTransitionAttribute = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXAttribute")) {
      if (!isNodeOfType(cursor.name, "JSXIdentifier") || cursor.name.name !== "transition") {
        return false;
      }
      const openingElement = cursor.parent;
      if (!isNodeOfType(openingElement, "JSXOpeningElement")) return false;
      const elementName = openingElement.name;
      return (
        isNodeOfType(elementName, "JSXMemberExpression") &&
        isNodeOfType(elementName.object, "JSXIdentifier") &&
        MOTION_ELEMENT_OBJECT_NAMES.has(elementName.object.name)
      );
    }
    if (isNodeOfType(cursor, "JSXElement") || isNodeOfType(cursor, "JSXFragment")) return false;
    cursor = cursor.parent ?? null;
  }
  return false;
};

// HACK: rendering `new Date()`, `Date.now()`, `Math.random()`, etc.
// directly inside JSX produces a different value on the server vs the
// client, causing React's hydration mismatch warning. The fix is either
// to wrap in `useEffect` + `useState` (so the dynamic value renders
// only client-side) or to add `suppressHydrationWarning` to the parent
// element when the mismatch is intentional.
export const renderingHydrationMismatchTime = defineRule({
  id: "rendering-hydration-mismatch-time",
  title: "Time or random value in JSX",
  severity: "warn",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Move time or random values into useEffect+useState so they only run in the browser, or add suppressHydrationWarning to the parent if it's intentional",
  create: (context: RuleContext): RuleVisitors => {
    // Hydration only happens in the shipped app — a time/random value in
    // a test / story / fixture file can't mismatch a server render.
    const isTestlikeFile = isTestlikeFilename(context.filename);
    // React Native has no server-rendered HTML to hydrate; skip files in
    // RN/Expo packages of mixed monorepos (the project-level capability
    // gate alone can't reach those).
    if (classifyReactNativeFileTarget(context) === "react-native") return {};
    return {
      JSXExpressionContainer(node: EsTreeNodeOfType<"JSXExpressionContainer">) {
        if (isTestlikeFile) return;
        if (!node.expression) return;
        // JSX rasterized by `ImageResponse` / satori (og images) renders
        // once on the server into a static image — it never hydrates, so
        // a time/random value there cannot mismatch.
        if (isGeneratedImageRenderContext(context, findOpeningElementOfChild(node) ?? node)) return;
        const programRoot = findProgramRoot(node);
        if (programRoot && hasEmailTemplateImport(programRoot)) return;
        const matched = NONDETERMINISTIC_RENDER_PATTERNS.find((pattern) =>
          pattern.matches(node.expression),
        );
        // Direct call as the JSX child expression.
        if (matched) {
          const openingElement = findOpeningElementOfChild(node);
          if (hasSuppressHydrationWarningAttribute(openingElement)) return;
          if (isGatedByFalsyInitialState(node, context.scopes)) return;
          if (isInsideMotionTransitionAttribute(node)) return;
          context.report({
            node,
            message: `This can cause a hydration mismatch because ${matched.display} in JSX gives a different value on the server than in the browser. Move it into useEffect+useState to run only in the browser, or add suppressHydrationWarning to the parent if it's on purpose.`,
          });
          return;
        }

        // Method-chained on a Date / Math / etc. — e.g. new Date().toLocaleString().
        walkAst(node.expression, (child: EsTreeNode): boolean | void => {
          // Don't descend into nested function bodies — an arrow / function
          // passed as an event-handler or render-prop value (`onClose={(x) =>
          // { … Date.now() … }}`) runs on the user event, not during the
          // server/client render pass, so a time/random call inside it is
          // not a hydration mismatch. IIFEs and useMemo factories DO run
          // during render, so keep walking those.
          if (isFunctionLike(child) && !executesDuringRender(child, context.scopes)) return false;
          for (const pattern of NONDETERMINISTIC_RENDER_PATTERNS) {
            if (pattern.matches(child)) {
              const openingElement = findOpeningElementOfChild(node);
              if (hasSuppressHydrationWarningAttribute(openingElement)) return;
              if (isGatedByFalsyInitialState(child, context.scopes)) return;
              if (isInsideMotionTransitionAttribute(child)) return;
              if (pattern.display === "new Date()" && isYearOnlyDateRead(child)) return;
              context.report({
                node: child,
                message: `This can cause a hydration mismatch because ${pattern.display} reached from JSX gives a different value on the server than in the browser. Move it into useEffect+useState to run only in the browser, or add suppressHydrationWarning to the parent if it's on purpose.`,
              });
              return;
            }
          }
        });
      },
    };
  },
});
