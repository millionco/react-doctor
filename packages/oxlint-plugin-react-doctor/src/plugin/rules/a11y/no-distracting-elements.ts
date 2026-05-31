import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (tag: string): string =>
  `Users with attention or motion sensitivity struggle because \`<${tag}>\` animates on its own, so use normal, accessible markup instead.`;

interface NoDistractingElementsSettings {
  // Subset of distracting tags to enforce; defaults to all known.
  elements?: ReadonlyArray<string>;
}

const DEFAULT_DISTRACTING: ReadonlyArray<string> = ["marquee", "blink"];

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { distractingTags: ReadonlySet<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noDistractingElements?: NoDistractingElementsSettings })
          .noDistractingElements ?? {})
      : {};
  const elements = ruleSettings.elements ?? DEFAULT_DISTRACTING;
  return { distractingTags: new Set(elements) };
};

// Port of `oxc_linter::rules::jsx_a11y::no_distracting_elements`. Flags
// `<marquee>` and `<blink>` (or any tag in `elements`).
export const noDistractingElements = defineRule<Rule>({
  id: "no-distracting-elements",
  title: "Distracting marquee or blink element",
  tags: ["react-jsx-only"],
  severity: "error",
  recommendation: "Replace `<marquee>` and `<blink>` with normal, accessible markup.",
  category: "Accessibility",
  create: (context) => {
    const { distractingTags } = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (distractingTags.size === 0) return;
        const tag = getElementType(node, context.settings);
        if (distractingTags.has(tag)) {
          context.report({ node: node.name, message: buildMessage(tag) });
        }
      },
    };
  },
});
