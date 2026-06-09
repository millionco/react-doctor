import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "This tag has no children, so the closing tag adds noise without changing output.";

interface SelfClosingCompSettings {
  component?: boolean;
  html?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<SelfClosingCompSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { selfClosingComp?: SelfClosingCompSettings }).selfClosingComp ?? {})
      : {};
  return {
    component: ruleSettings.component ?? true,
    html: ruleSettings.html ?? true,
  };
};

const isLowercaseIdentifier = (name: EsTreeNode): boolean => {
  if (!isNodeOfType(name, "JSXIdentifier")) return false;
  const firstCharacter = name.name.charCodeAt(0);
  return firstCharacter >= 97 && firstCharacter <= 122;
};

// Port of `oxc_linter::rules::react::self_closing_comp`. Reports
// `<X></X>` and `<X> </X>` (multi-line whitespace) where `<X />` would
// suffice. Settings let callers disable for HTML tags or for custom
// components independently.
export const selfClosingComp = defineRule<Rule>({
  id: "self-closing-comp",
  title: "Element not self-closing",
  severity: "warn",
  // Pure stylistic rule — `<X></X>` vs `<X/>` is a formatter concern,
  // not a bug class. Default off.
  defaultEnabled: false,
  recommendation: "Use `<X />` for childless elements so empty closing tags do not add noise.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (!node.closingElement) return;
        if (node.children.length > 1) return;

        if (node.children.length === 1) {
          const onlyChild = node.children[0];
          if (!isNodeOfType(onlyChild, "JSXText")) return;
          const textValue = onlyChild.value;
          // `<X> </X>` (whitespace, no newline) is allowed; only flag
          // multi-line whitespace-only children.
          const isMultilineWhitespaceOnly = textValue.includes("\n") && /^\s*$/.test(textValue);
          if (!isMultilineWhitespaceOnly) return;
        }

        const elementName = node.openingElement.name;
        const isCustomComponent =
          isNodeOfType(elementName, "JSXMemberExpression") ||
          isNodeOfType(elementName, "JSXNamespacedName") ||
          (isNodeOfType(elementName, "JSXIdentifier") && !isLowercaseIdentifier(elementName));
        const isHtmlTag =
          isNodeOfType(elementName, "JSXIdentifier") && isLowercaseIdentifier(elementName);

        if (isCustomComponent && !settings.component) return;
        if (isHtmlTag && !settings.html) return;
        context.report({ node: node.openingElement, message: MESSAGE });
      },
    };
  },
});
