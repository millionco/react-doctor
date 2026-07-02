import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";

const NAVIGATING_TARGETS = new Set(["_self", "_top", "_parent"]);

// Matches `window.open` and `globalThis.window.open` — a non-computed
// `.open` member off the `window` global. Bare `open(...)` (an
// `Identifier` callee) and `foo.postMessage`/`webview.open` are not the
// window global and never match.
const isWindowOpenCallee = (callee: EsTreeNode): boolean => {
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "open") return false;
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
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"Literal"> & { value: string } =>
  node != null && isNodeOfType(node, "Literal") && typeof node.value === "string";

// `mailto:`/`tel:`/`sms:` hand the URL to an OS protocol handler and never
// open a navigable browsing context, so no `window.opener` is exposed and
// there is nothing to reverse-tabnab — flagging them is a false positive.
const NON_BROWSING_URL_SCHEMES = ["mailto:", "tel:", "sms:"];

// A fixed `https://host/` prefix pins the origin: the `[/?#]` terminator
// after the host guarantees any interpolation lands in the path/query,
// not the host (`` `https://github.com${x}` `` without it could become
// `https://github.com.evil.com`).
const COMPLETE_ORIGIN_PATTERN = /^https?:\/\/[^/?#]+[/?#]/i;

const SAME_ORIGIN_URL_PREFIXES = ["./", "../", "?", "#"];

const startsSameOriginPath = (urlText: string): boolean => {
  if (urlText.startsWith("/")) return !urlText.startsWith("//");
  return SAME_ORIGIN_URL_PREFIXES.some((prefix) => urlText.startsWith(prefix));
};

// Reverse tabnabbing needs an attacker-controlled opened page. A
// developer-hardcoded string literal, a template whose origin is fixed
// (interpolations confined to the path/query), or a statically
// same-origin URL is a trusted-by-construction destination — the
// dominant real-world idiom ("Star on GitHub" buttons, `/preview?…`
// export routes) and not worth a warning. Dynamic URLs (identifiers,
// call results, member accesses, templates interpolating the
// scheme/host) keep firing.
const isTrustedStaticDestination = (urlArgument: EsTreeNode | null | undefined): boolean => {
  if (isStringLiteral(urlArgument)) return true;
  if (urlArgument == null || !isNodeOfType(urlArgument, "TemplateLiteral")) return false;
  if ((urlArgument.expressions?.length ?? 0) === 0) return true;
  const firstQuasiText = (urlArgument.quasis?.[0]?.value?.raw ?? "").trimStart();
  if (firstQuasiText.length === 0) return false;
  const loweredQuasiText = firstQuasiText.toLowerCase();
  if (NON_BROWSING_URL_SCHEMES.some((scheme) => loweredQuasiText.startsWith(scheme))) return true;
  if (COMPLETE_ORIGIN_PATTERN.test(firstQuasiText)) return true;
  return startsSameOriginPath(firstQuasiText);
};

const MAX_BINDING_RESOLUTION_DEPTH = 4;

// A nullish URL (`window.open(null)`, `cond ? url : null`) is harmless:
// it opens about:blank, which the opener fully controls.
const isNullishExpression = (node: EsTreeNode | null | undefined): boolean => {
  if (node == null) return true;
  if (isNodeOfType(node, "Literal")) return node.value === null;
  if (isNodeOfType(node, "UnaryExpression")) return node.operator === "void";
  return isNodeOfType(node, "Identifier") && node.name === "undefined";
};

// Only a direct `const name = <init>` declarator is safe to resolve —
// `let`/`var` can be reassigned to attacker-controlled input after the
// trusted initializer, and destructured/parameter bindings carry a
// default expression here, not the actual runtime value.
const resolveConstInitializer = (identifier: EsTreeNodeOfType<"Identifier">): EsTreeNode | null => {
  const binding = findVariableInitializer(identifier, identifier.name);
  if (binding?.initializer == null) return null;
  const declarator = binding.bindingIdentifier.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (declarator.init !== binding.initializer) return null;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
  if (declaration.kind !== "const") return null;
  return binding.initializer;
};

// The trusted-by-construction check, extended one binding hop: a local
// const holding a ternary over origin-pinned templates
// (releaseUrl = version ? `https://github.com/…/tag/v${version}` : null)
// is the same trusted destination as an inline one, just behind a name
// ("open release page" dialogs). Every non-nullish branch of the
// initializer must itself be trusted; opaque initializers (call results,
// awaited API responses, hook-destructured values) resolve to nothing
// and keep firing.
const isTrustedDestination = (
  urlArgument: EsTreeNode | null | undefined,
  depth: number,
): boolean => {
  if (isTrustedStaticDestination(urlArgument)) return true;
  if (urlArgument == null || depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
  if (isNodeOfType(urlArgument, "ConditionalExpression")) {
    return (
      isTrustedOrNullishDestination(urlArgument.consequent, depth + 1) &&
      isTrustedOrNullishDestination(urlArgument.alternate, depth + 1)
    );
  }
  if (isNodeOfType(urlArgument, "LogicalExpression")) {
    if (urlArgument.operator === "&&") {
      return (
        isNullishExpression(urlArgument.left) ||
        isTrustedOrNullishDestination(urlArgument.right, depth + 1)
      );
    }
    if (isStaticallyTruthyTrustedDestination(urlArgument.left, depth + 1)) return true;
    return (
      isTrustedOrNullishDestination(urlArgument.left, depth + 1) &&
      isTrustedOrNullishDestination(urlArgument.right, depth + 1)
    );
  }
  if (isNodeOfType(urlArgument, "Identifier")) {
    const constInitializer = resolveConstInitializer(urlArgument);
    if (constInitializer == null) return false;
    return isTrustedOrNullishDestination(constInitializer, depth + 1);
  }
  return false;
};

const isTrustedOrNullishDestination = (
  urlExpression: EsTreeNode | null | undefined,
  depth: number,
): boolean => isNullishExpression(urlExpression) || isTrustedDestination(urlExpression, depth);

// A statically truthy trusted left operand of `||`/`??` short-circuits, so
// `trustedUrl || dynamicFallback` always opens the trusted destination and
// the right side never evaluates. Only trusted destinations with nonempty
// static text qualify — `''` is falsy under `||` and a nullish binding
// falls through to the right operand under both operators.
const isStaticallyTruthyTrustedDestination = (
  urlExpression: EsTreeNode | null | undefined,
  depth: number,
): boolean => {
  if (urlExpression == null || depth > MAX_BINDING_RESOLUTION_DEPTH) return false;
  if (isStringLiteral(urlExpression)) return urlExpression.value.length > 0;
  if (isNodeOfType(urlExpression, "TemplateLiteral")) {
    const hasStaticText =
      urlExpression.quasis?.some((quasi) => (quasi.value?.raw ?? "").length > 0) ?? false;
    return hasStaticText && isTrustedStaticDestination(urlExpression);
  }
  if (isNodeOfType(urlExpression, "Identifier")) {
    const constInitializer = resolveConstInitializer(urlExpression);
    return (
      constInitializer != null && isStaticallyTruthyTrustedDestination(constInitializer, depth + 1)
    );
  }
  return false;
};

// Best-effort static text of the features argument: string literals,
// template literals (interpolations resolved when they are local const
// strings, empty otherwise so `noopener,width=${w}` still resolves), and
// identifiers bound to a local const initializer (`let`/`var` can be
// reassigned after the initializer, so they stay opaque). Returns
// null when the value is opaque (imported constant, call result), in
// which case the caller must not assume noopener is absent.
const resolveStaticStringText = (
  node: EsTreeNode | null | undefined,
  depth: number,
): string | null => {
  if (node == null || depth > MAX_BINDING_RESOLUTION_DEPTH) return null;
  if (isStringLiteral(node)) return node.value;
  if (isNodeOfType(node, "TemplateLiteral")) {
    const quasiTexts = node.quasis?.map((quasi) => quasi.value?.raw ?? "") ?? [];
    const expressionTexts =
      node.expressions?.map((expression) => resolveStaticStringText(expression, depth + 1) ?? "") ??
      [];
    return quasiTexts
      .map((quasiText, quasiIndex) => quasiText + (expressionTexts[quasiIndex] ?? ""))
      .join("");
  }
  if (isNodeOfType(node, "Identifier")) {
    const constInitializer = resolveConstInitializer(node);
    if (constInitializer == null) return null;
    return resolveStaticStringText(constInitializer, depth + 1);
  }
  return null;
};

// The opened handle is captured/used when the arrow that returns it is
// stored or returned (its eventual return value may be consumed via
// `getPopup().focus()`), so a concise `() => window.open(...)` is only
// fire-and-forget when the arrow itself is an event handler (JSX prop or
// an `onX` property in a props object, whose return React/DOM ignores),
// a callback argument (forEach/map/addEventListener), or a bare
// statement.
const EVENT_HANDLER_KEY_PATTERN = /^on[A-Z]/;

const isArrowReturnDiscarded = (arrow: EsTreeNode): boolean => {
  const parent = arrow.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "JSXExpressionContainer")) return true;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "CallExpression")) {
    return parent.arguments?.some((argument) => argument === arrow) ?? false;
  }
  if (isNodeOfType(parent, "Property") && parent.value === arrow && !parent.computed) {
    const handlerKeyName = isNodeOfType(parent.key, "Identifier")
      ? parent.key.name
      : isStringLiteral(parent.key)
        ? parent.key.value
        : null;
    return handlerKeyName != null && EVENT_HANDLER_KEY_PATTERN.test(handlerKeyName);
  }
  return false;
};

// The window handle is discarded (so `noopener`'s null return breaks
// nothing) when the call is a bare statement, a `void` operand, the
// branch of a guard-shaped logical/ternary that is itself discarded, a
// non-final position in a comma sequence, an `await` whose own result
// is discarded, or the concise
// body of a discarded arrow. Any capturing parent — VariableDeclarator
// init, AssignmentExpression right, ReturnStatement arg, a member access
// on the result, or being passed as a call argument — means the caller
// wants the handle, so we stay quiet.
const isDiscardedWindowHandle = (callNode: EsTreeNode): boolean => {
  const parent = callNode.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "void") return true;
  if (isNodeOfType(parent, "AwaitExpression")) return isDiscardedWindowHandle(parent);
  if (isNodeOfType(parent, "LogicalExpression") && parent.right === callNode) {
    return isDiscardedWindowHandle(parent);
  }
  if (
    isNodeOfType(parent, "ConditionalExpression") &&
    (parent.consequent === callNode || parent.alternate === callNode)
  ) {
    return isDiscardedWindowHandle(parent);
  }
  if (isNodeOfType(parent, "SequenceExpression")) {
    const finalExpression = parent.expressions?.[parent.expressions.length - 1];
    return finalExpression !== callNode || isDiscardedWindowHandle(parent);
  }
  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === callNode) {
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

      const urlArgument = node.arguments?.[0];
      if (isTrustedOrNullishDestination(urlArgument, 0)) return;

      const targetArgument = node.arguments?.[1];
      if (isStringLiteral(targetArgument) && NAVIGATING_TARGETS.has(targetArgument.value)) return;

      const featuresArgument = node.arguments?.[2];
      if (featuresArgument != null && !isNullishExpression(featuresArgument)) {
        const featuresText = resolveStaticStringText(featuresArgument, 0);
        if (featuresText == null) return;
        const featureNames = featuresText
          .toLowerCase()
          .split(/[\s,]+/)
          .map((featureEntry) => featureEntry.split("=")[0]);
        if (featureNames.some((name) => name === "noopener" || name === "noreferrer")) return;
      }

      context.report({
        node,
        message:
          "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.",
      });
    },
  }),
});
