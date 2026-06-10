import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "A `javascript:` URL is an XSS hole that runs injected input as code.";

// Matches `javascript:` allowing whitespace between letters and any
// casing — exactly the regex `oxc_linter::rules::react::jsx_no_script_url`
// uses to defeat the "j a v a s c r i p t :" obfuscation.
const JAVASCRIPT_URL_PATTERN =
  /j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;

interface JsxNoScriptUrlSettings {
  components?: Record<string, ReadonlyArray<string>>;
  includeFromSettings?: boolean;
  linkComponents?: Record<string, ReadonlyArray<string>>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): JsxNoScriptUrlSettings => {
  const reactDoctor = settings?.["react-doctor"];
  if (typeof reactDoctor !== "object" || reactDoctor === null) return {};
  const ruleSettings = (reactDoctor as { jsxNoScriptUrl?: JsxNoScriptUrlSettings }).jsxNoScriptUrl;
  return ruleSettings ?? {};
};

const getElementName = (node: EsTreeNodeOfType<"JSXOpeningElement">): string | null => {
  if (isNodeOfType(node.name, "JSXIdentifier")) return node.name.name;
  return null;
};

const isLinkPropForElement = (
  elementName: string,
  attributeName: string,
  options: JsxNoScriptUrlSettings,
): boolean => {
  if (elementName === "a" && attributeName === "href") return true;
  const explicit = options.components?.[elementName];
  if (explicit && explicit.includes(attributeName)) return true;
  if (options.includeFromSettings && options.linkComponents) {
    const settingsAttrs = options.linkComponents[elementName];
    if (settingsAttrs && settingsAttrs.includes(attributeName)) return true;
  }
  return false;
};

// Port of `oxc_linter::rules::react::jsx_no_script_url`. Reports any JSX
// link attribute whose string value matches the obfuscation-resistant
// `javascript:` regex. By default only `<a href="...">` is checked; the
// `components` map lets callers extend to custom Link components, and
// `includeFromSettings` opts in to the `linkComponents` settings hash.
export const jsxNoScriptUrl = defineRule<Rule>({
  id: "jsx-no-script-url",
  title: "javascript: URL in JSX",
  severity: "error",
  recommendation:
    "Use real event handlers instead of `javascript:` URLs so injected URL text cannot execute as code.",
  category: "Security",
  create: (context) => {
    const options = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementName = getElementName(node);
        if (!elementName) return;
        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXAttribute")) continue;
          if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
          const attributeName = attribute.name.name;
          if (!isLinkPropForElement(elementName, attributeName, options)) continue;
          const value = attribute.value;
          if (!value || !isNodeOfType(value, "Literal") || typeof value.value !== "string")
            continue;
          if (JAVASCRIPT_URL_PATTERN.test(value.value)) {
            context.report({ node: attribute, message: MESSAGE });
          }
        }
      },
    };
  },
});
