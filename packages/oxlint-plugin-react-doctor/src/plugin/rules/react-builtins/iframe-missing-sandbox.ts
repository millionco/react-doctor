import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

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
      context.report({ node: reportNode, message: INVALID_VALUE_MESSAGE(token) });
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
export const iframeMissingSandbox = defineRule<Rule>({
  id: "iframe-missing-sandbox",
  title: "iframe missing sandbox attribute",
  severity: "warn",
  recommendation: 'Add `sandbox=""` (or a curated value) to your iframe.',
  category: "Security",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "iframe") return;
      const sandboxAttr = hasJsxPropIgnoreCase(node.attributes, "sandbox");
      if (!sandboxAttr) {
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
      if (!propsArgument || !isNodeOfType(propsArgument, "ObjectExpression")) {
        context.report({ node, message: MISSING_MESSAGE });
        return;
      }
      let sandboxValueNode: EsTreeNode | null = null;
      for (const property of propsArgument.properties) {
        if (!isNodeOfType(property, "Property")) continue;
        const propertyKey = property.key;
        const matches =
          (isNodeOfType(propertyKey, "Identifier") && propertyKey.name === "sandbox") ||
          (isNodeOfType(propertyKey, "Literal") && propertyKey.value === "sandbox");
        if (matches) {
          sandboxValueNode = property.value;
          break;
        }
      }
      if (!sandboxValueNode) {
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
  }),
});
