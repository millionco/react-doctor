import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNullishExpression } from "../../utils/is-nullish-expression.js";
import type { Rule } from "../../utils/rule.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";

const ALLOWED_SANDBOX_VALUES = new Set([
  "downloads-without-user-activation",
  "downloads",
  "forms",
  "modals",
  "orientation-lock",
  "pointer-lock",
  "popups",
  "popups-to-escape-sandbox",
  "presentation",
  "same-origin",
  "scripts",
  "storage-access-by-user-activation",
  "top-navigation",
  "top-navigation-by-user-activation",
]);

const MISSING_MESSAGE =
  "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.";
const INVALID_VALUE_MESSAGE = (value: string): string =>
  `\`${value}\` isn't a valid \`sandbox\` token, so the browser ignores it & leaves your iframe exposed.`;
const INVALID_COMBINATION_MESSAGE =
  "Combining `allow-scripts` & `allow-same-origin` lets the iframe remove its own sandbox, defeating the protection.";

const isAllowedSandboxToken = (token: string): boolean => {
  if (token === "") return true;
  if (!token.startsWith("allow-")) return false;
  return ALLOWED_SANDBOX_VALUES.has(token.slice("allow-".length));
};

const validateSandboxValue = (
  context: Parameters<Rule["create"]>[0],
  value: string,
  reportNode: EsTreeNode,
): void => {
  let hasAllowScripts = false;
  let hasAllowSameOrigin = false;
  for (const rawToken of value.split(" ")) {
    const token = rawToken.trim();
    if (!isAllowedSandboxToken(token)) {
      context.report({
        node: reportNode,
        message: INVALID_VALUE_MESSAGE(token),
      });
    }
    if (token === "allow-scripts") hasAllowScripts = true;
    if (token === "allow-same-origin") hasAllowSameOrigin = true;
  }
  if (hasAllowScripts && hasAllowSameOrigin) {
    context.report({ node: reportNode, message: INVALID_COMBINATION_MESSAGE });
  }
};

// Port of `oxc_linter::rules::react::iframe_missing_sandbox`. Reports
//  - `<iframe>` without a `sandbox` attribute,
//  - `<iframe sandbox="…">` whose value contains an invalid token,
//  - `sandbox="allow-scripts allow-same-origin"` combination,
//  - `React.createElement("iframe", …)` equivalents of all three.
// `document.createElement("iframe", …)` is intentionally NOT flagged
// (DOM API, sandbox can't be set there).
export const iframeMissingSandbox = defineRule({
  id: "iframe-missing-sandbox",
  title: "iframe missing sandbox attribute",
  severity: "warn",
  recommendation:
    'Add `sandbox=""` or a curated value so embedded pages cannot get full access to your site by default.',
  category: "Security",
  create: skipNonProductionFiles((context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "iframe") return;
      const sandboxAttr = hasJsxPropIgnoreCase(node.attributes, "sandbox");
      if (!sandboxAttr) {
        // A fully-opaque spread (`<iframe {...props} />`) can forward
        // `sandbox` at runtime, so its absence here isn't proof of a missing
        // attribute — but an explicit `src` marks this element as the real
        // embed site, where a missing `sandbox` is the author's omission.
        const hasExplicitSrc = Boolean(hasJsxPropIgnoreCase(node.attributes, "src"));
        if (!hasExplicitSrc && hasJsxSpreadAttribute(node.attributes)) return;
        context.report({ node: node.name, message: MISSING_MESSAGE });
        return;
      }
      const stringValue = getJsxPropStringValue(sandboxAttr);
      if (stringValue === null) return;
      validateSandboxValue(context, stringValue, sandboxAttr);
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isCreateElementCall(node)) return;
      const firstArgument = node.arguments[0];
      if (!firstArgument) return;
      if (!isNodeOfType(firstArgument, "Literal") || firstArgument.value !== "iframe") return;
      const propsArgument = node.arguments[1];
      // No props or explicitly nullish props (`null`/`undefined`/`void 0`)
      // carry no `sandbox` → missing.
      if (!propsArgument || isNullishExpression(propsArgument)) {
        context.report({ node, message: MISSING_MESSAGE });
        return;
      }
      // An opaque props bag (`createElement("iframe", props)`) may forward
      // `sandbox` at runtime — mirror the JSX spread bailout above.
      if (!isNodeOfType(propsArgument, "ObjectExpression")) return;
      let sandboxValueNode: EsTreeNode | null = null;
      let hasSpread = false;
      let hasExplicitSrcProperty = false;
      for (const property of propsArgument.properties) {
        if (isNodeOfType(property, "SpreadElement")) {
          hasSpread = true;
          continue;
        }
        if (!isNodeOfType(property, "Property")) continue;
        const propertyKey = property.key;
        const keyName = isNodeOfType(propertyKey, "Identifier")
          ? propertyKey.name
          : isNodeOfType(propertyKey, "Literal")
            ? propertyKey.value
            : null;
        if (keyName === "src") hasExplicitSrcProperty = true;
        if (keyName === "sandbox") {
          sandboxValueNode = property.value;
          break;
        }
      }
      if (!sandboxValueNode) {
        // `{ ...props }` may supply `sandbox` at runtime, like a JSX spread —
        // unless an explicit `src` marks this call as the real embed site.
        if (hasSpread && !hasExplicitSrcProperty) return;
        context.report({ node: propsArgument, message: MISSING_MESSAGE });
        return;
      }
      if (
        !isNodeOfType(sandboxValueNode, "Literal") ||
        typeof sandboxValueNode.value !== "string"
      ) {
        return;
      }
      validateSandboxValue(context, sandboxValueNode.value, sandboxValueNode);
    },
  })),
});
