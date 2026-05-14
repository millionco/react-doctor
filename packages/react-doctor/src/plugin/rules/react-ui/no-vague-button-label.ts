import { VAGUE_BUTTON_LABELS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getOpeningElementTagName } from "./utils/get-opening-element-tag-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isButtonLikeTagName = (tagName: string): boolean => {
  if (tagName === "button") return true;
  if (tagName === "Button") return true;
  return false;
};

const collectJsxLabelText = (jsxElementNode: EsTreeNode): string | null => {
  if (!isNodeOfType(jsxElementNode, "JSXElement") && !isNodeOfType(jsxElementNode, "JSXFragment"))
    return null;
  const childList = jsxElementNode.children ?? [];
  if (childList.length === 0) return null;
  const collectedFragments: string[] = [];
  for (const childNode of childList) {
    if (isNodeOfType(childNode, "JSXText")) {
      collectedFragments.push(typeof childNode.value === "string" ? childNode.value : "");
      continue;
    }
    if (isNodeOfType(childNode, "JSXExpressionContainer")) {
      const expression = childNode.expression;
      if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
        collectedFragments.push(expression.value);
        continue;
      }
      if (isNodeOfType(expression, "TemplateLiteral") && expression.quasis?.length === 1) {
        const rawTemplate = expression.quasis[0].value?.raw;
        if (typeof rawTemplate === "string" && expression.expressions.length === 0) {
          collectedFragments.push(rawTemplate);
          continue;
        }
      }
      // Bail on dynamic content (interpolation, identifiers).
      return null;
    }
    if (isNodeOfType(childNode, "JSXFragment")) {
      // Recurse into <>…</> fragments — they're transparent for label purposes.
      const fragmentLabel = collectJsxLabelText(childNode);
      if (fragmentLabel === null) return null;
      collectedFragments.push(fragmentLabel);
      continue;
    }
    if (isNodeOfType(childNode, "JSXElement")) {
      // Bail on nested elements (icons, spans) — the leading/trailing text alone isn't the full label.
      return null;
    }
  }
  return collectedFragments.join("").trim();
};

export const noVagueButtonLabel = defineRule<Rule>({
  id: "design-no-vague-button-label",
  tags: ["design", "test-noise"],
  framework: "global",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    'Name the action: "Save changes" instead of "Continue", "Send invite" instead of "Submit", "Delete account" instead of "OK". The label IS the button\'s accessible name',
  examples: [
    {
      before: "<button>Submit</button>",
      after: "<button>Send invite</button>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXElement(jsxElementNode: EsTreeNodeOfType<"JSXElement">) {
      const tagName = getOpeningElementTagName(jsxElementNode.openingElement);
      if (!tagName || !isButtonLikeTagName(tagName)) return;
      const labelText = collectJsxLabelText(jsxElementNode);
      if (!labelText) return;
      const normalizedLabel = labelText
        .toLowerCase()
        .replace(/[.!?…]+$/, "")
        .trim();
      if (!VAGUE_BUTTON_LABELS.has(normalizedLabel)) return;
      context.report({
        node: jsxElementNode.openingElement ?? jsxElementNode,
        message: `Vague button label "${labelText}" — name the action ("Save changes", "Send invite", "Delete account") so screen readers and hesitant users know what happens`,
      });
    },
  }),
});
