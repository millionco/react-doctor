import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findDeclaratorForBinding } from "../../utils/find-declarator-for-binding.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { flattenLogicalAndChain } from "../../utils/flatten-logical-and-chain.js";
import { hasEmailTemplateImport } from "../../utils/has-email-template-import.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
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
    matches: (node) =>
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "Date" &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "now",
  },
  {
    display: "Math.random()",
    matches: (node) =>
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "Math" &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "random",
  },
  {
    display: "performance.now()",
    matches: (node) =>
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "performance" &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "now",
  },
  {
    display: "crypto.randomUUID()",
    matches: (node) =>
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === "crypto" &&
      isNodeOfType(node.callee.property, "Identifier") &&
      node.callee.property.name === "randomUUID",
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

// A nested function usually runs on a user event, not during the render
// pass — but two shapes DO execute while rendering: an immediately
// invoked function (`{(() => new Date().toLocaleString())()}`) and a
// useMemo factory (`{useMemo(() => Date.now(), [])}`).
const executesDuringRender = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (parent.callee === functionNode) return true;
  return isHookCall(parent, "useMemo") && parent.arguments?.[0] === functionNode;
};

// Mounted-flag hooks (`const isClient = useClient()`, `useIsMounted()`,
// `useHydrated()`, …) are false on the server AND on the client's first
// (hydration) render, flipping true only in an effect — so JSX gated by
// such a flag renders identically on both sides and cannot mismatch.
const CLIENT_ONLY_FLAG_NAME_PATTERN =
  /^(?:is|has|did)?_?(?:client|mounted|hydrated|browser)(?:_?(?:side|ready|only))?$/i;

const referencesClientOnlyFlag = (expression: EsTreeNode): boolean => {
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "Identifier")) {
    return CLIENT_ONLY_FLAG_NAME_PATTERN.test(unwrapped.name);
  }
  if (isNodeOfType(unwrapped, "MemberExpression")) {
    const property = unwrapped.property;
    return (
      isNodeOfType(property, "Identifier") && CLIENT_ONLY_FLAG_NAME_PATTERN.test(property.name)
    );
  }
  if (isNodeOfType(unwrapped, "UnaryExpression") && unwrapped.operator === "!") {
    return referencesClientOnlyFlag(unwrapped.argument);
  }
  if (isNodeOfType(unwrapped, "LogicalExpression")) {
    return referencesClientOnlyFlag(unwrapped.left) || referencesClientOnlyFlag(unwrapped.right);
  }
  return false;
};

// State from `useState(falsyLiteral)` is identical on the server and on the
// client's first (hydration) render — it only flips after a post-hydration
// state update. JSX gated behind such a flag (interaction-opened editors,
// transient toasts) is absent from both sides of the hydration comparison.
const isFalsyLiteral = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return true;
  if (isNodeOfType(node, "Literal")) return !node.value;
  return isNodeOfType(node, "Identifier") && node.name === "undefined";
};

const isFalsyInitialStateBinding = (identifier: EsTreeNode): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding) return false;
  const declarator = findDeclaratorForBinding(binding.bindingIdentifier);
  if (!declarator?.init) return false;
  const init = stripParenExpression(declarator.init);
  if (!isHookCall(init, "useState") || !isNodeOfType(init, "CallExpression")) return false;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return false;
  if (declarator.id.elements?.[0] !== binding.bindingIdentifier) return false;
  return isFalsyLiteral(init.arguments?.[0]);
};

const referencesFalsyInitialState = (expression: EsTreeNode): boolean =>
  flattenLogicalAndChain(stripParenExpression(expression)).some((operand) =>
    isFalsyInitialStateBinding(stripParenExpression(operand)),
  );

const isGatedByFalsyInitialState = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent) {
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === cursor &&
      referencesFalsyInitialState(parent.left)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      parent.consequent === cursor &&
      referencesFalsyInitialState(parent.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "IfStatement") &&
      parent.consequent === cursor &&
      referencesFalsyInitialState(parent.test)
    ) {
      return true;
    }
    cursor = parent;
    parent = parent.parent ?? null;
  }
  return false;
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

const isInsideClientOnlyGuard = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode = node;
  let parent: EsTreeNode | null | undefined = node.parent;
  while (parent) {
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      parent.operator === "&&" &&
      parent.right === cursor &&
      referencesClientOnlyFlag(parent.left)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === cursor || parent.alternate === cursor) &&
      referencesClientOnlyFlag(parent.test)
    ) {
      return true;
    }
    if (
      isNodeOfType(parent, "IfStatement") &&
      parent.consequent === cursor &&
      referencesClientOnlyFlag(parent.test)
    ) {
      return true;
    }
    cursor = parent;
    parent = parent.parent ?? null;
  }
  return false;
};

const hasSuppressHydrationWarningAttribute = (openingElement: EsTreeNode | null): boolean => {
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  for (const attr of openingElement.attributes ?? []) {
    if (
      isNodeOfType(attr, "JSXAttribute") &&
      isNodeOfType(attr.name, "JSXIdentifier") &&
      attr.name.name === "suppressHydrationWarning"
    ) {
      return true;
    }
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
  // Client-only build tools have no server render, so hydration can never
  // happen and a wall-clock/random value in JSX is harmless there.
  disabledWhen: ["vite", "cra"],
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
          if (isInsideClientOnlyGuard(node)) return;
          if (isGatedByFalsyInitialState(node)) return;
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
          if (isFunctionLike(child) && !executesDuringRender(child)) return false;
          for (const pattern of NONDETERMINISTIC_RENDER_PATTERNS) {
            if (pattern.matches(child)) {
              const openingElement = findOpeningElementOfChild(node);
              if (hasSuppressHydrationWarningAttribute(openingElement)) return;
              if (isInsideClientOnlyGuard(child)) return;
              if (isGatedByFalsyInitialState(child)) return;
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
