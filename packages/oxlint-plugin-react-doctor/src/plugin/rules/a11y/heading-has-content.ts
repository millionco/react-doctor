import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { objectHasAccessibleChild } from "../../utils/object-has-accessible-child.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Blind users can't use this heading to navigate because screen readers skip it empty, so add text, `aria-label`, or `aria-labelledby`.";

const DEFAULT_HEADING_TAGS: ReadonlyArray<string> = ["h1", "h2", "h3", "h4", "h5", "h6"];

interface HeadingHasContentSettings {
  components?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { headingTags: ReadonlyArray<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { headingHasContent?: HeadingHasContentSettings }).headingHasContent ?? {})
      : {};
  return {
    headingTags: [...DEFAULT_HEADING_TAGS, ...(ruleSettings.components ?? [])],
  };
};

// Port of `oxc_linter::rules::jsx_a11y::heading_has_content`. Reports
// heading elements (h1-h6 + configured aliases) without accessible
// content (visible text / aria-label / dangerouslySetInnerHTML).
export const headingHasContent = defineRule<Rule>({
  id: "heading-has-content",
  title: "Heading has no content",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Put readable text in every heading.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementType = getElementType(node, context.settings);
        if (!settings.headingTags.includes(elementType)) return;
        const parent = (node as EsTreeNode).parent;
        if (parent && isNodeOfType(parent, "JSXElement")) {
          if (objectHasAccessibleChild(parent, context.settings)) return;
        }
        if (isHiddenFromScreenReader(node, context.settings)) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
