import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const NAVIGATING_TARGETS = new Set(["_self", "_top", "_parent"]);

// Matches `window.open` and `globalThis.window.open` — a non-computed
// `.open` member off the `window` global. Bare `open(...)` (an
// `Identifier` callee) and `foo.postMessage`/`webview.open` are not the
// window global and never match.
const isWindowOpenCallee = (callee: EsTreeNode): boolean => {
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed)
    return false;
  if (
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "open"
  )
    return false;
  const object = callee.object;
  if (isNodeOfType(object, "Identifier")) return object.name === "window";
  if (isNodeOfType(object, "MemberExpression") && !object.computed) {
    return (
      isNodeOfType(object.object, "Identifier") &&
      object.object.name === "globalThis" &&
      isNodeOfType(object.property, "Identifier") &&
      object.property.name === "window"
    );
  }
  return false;
};

const isStringLiteral = (
  node: EsTreeNode | null | undefined
): node is EsTreeNodeOfType<"Literal"> & { value: string } =>
  node != null &&
  isNodeOfType(node, "Literal") &&
  typeof node.value === "string";

// `mailto:`/`tel:`/`sms:` hand the URL to an OS protocol handler and never
// open a navigable browsing context, so no `window.opener` is exposed and
// there is nothing to reverse-tabnab — flagging them is a false positive.
const NON_BROWSING_URL_SCHEMES = ["mailto:", "tel:", "sms:"];

const getStaticUrlText = (
  node: EsTreeNode | null | undefined
): string | null => {
  if (isStringLiteral(node)) return node.value;
  if (node != null && isNodeOfType(node, "TemplateLiteral")) {
    return node.quasis?.[0]?.value?.raw ?? null;
  }
  return null;
};

const opensProtocolHandlerOnly = (
  urlArgument: EsTreeNode | null | undefined
): boolean => {
  const urlText = getStaticUrlText(urlArgument)?.trimStart().toLowerCase();
  if (urlText == null) return false;
  return NON_BROWSING_URL_SCHEMES.some((scheme) => urlText.startsWith(scheme));
};

// The opened handle is captured/used when the arrow that returns it is
// stored or returned (its eventual return value may be consumed via
// `getPopup().focus()`), so a concise `() => window.open(...)` is only
// fire-and-forget when the arrow itself is an event handler, a callback
// argument (forEach/map/addEventListener), or a bare statement.
const isArrowReturnDiscarded = (arrow: EsTreeNode): boolean => {
  const parent = arrow.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "JSXExpressionContainer")) return true;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "CallExpression")) {
    return parent.arguments?.some((argument) => argument === arrow) ?? false;
  }
  return false;
};

// The window handle is discarded (so `noopener`'s null return breaks
// nothing) when the call is a bare statement or the concise body of a
// discarded arrow. Any capturing parent — VariableDeclarator init,
// AssignmentExpression right, ReturnStatement arg, a member access on the
// result, or being passed as a call argument — means the caller wants the
// handle, so we stay quiet.
const isDiscardedWindowHandle = (callNode: EsTreeNode): boolean => {
  const parent = callNode.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (
    isNodeOfType(parent, "ArrowFunctionExpression") &&
    parent.body === callNode
  ) {
    return isArrowReturnDiscarded(parent);
  }
  return false;
};

export const windowOpenWithoutNoopener = defineRule({
  id: "window-open-without-noopener",
  title: "window.open without noopener",
  severity: "warn",
  recommendation:
    "Pass `'noopener'` in the third features argument of `window.open` so the opened page can't control your tab through `window.opener` or leak the referrer.",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isWindowOpenCallee(node.callee)) return;
      if (!isDiscardedWindowHandle(node)) return;
      if (opensProtocolHandlerOnly(node.arguments?.[0])) return;

      const targetArgument = node.arguments?.[1];
      if (
        isStringLiteral(targetArgument) &&
        NAVIGATING_TARGETS.has(targetArgument.value)
      )
        return;

      const featuresArgument = node.arguments?.[2];
      if (isStringLiteral(featuresArgument)) {
        const features = featuresArgument.value.toLowerCase();
        if (features.includes("noopener") || features.includes("noreferrer"))
          return;
      }

      context.report({
        node,
        message:
          "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.",
      });
    },
  }),
});
