import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isDomElementName } from "../../utils/is-dom-element-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const SOLID_CONTROL_FLOW_COMPONENTS: ReadonlySet<string> = new Set([
  "For",
  "Show",
  "Index",
  "Switch",
  "Match",
  "Dynamic",
  "Portal",
  "Suspense",
  "ErrorBoundary",
]);

const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "blockquote",
  "pre",
  "form",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "nav",
  "main",
  "details",
  "fieldset",
  "figure",
  "address",
  "dl",
  "dd",
  "dt",
  "figcaption",
  "hr",
]);

const CANNOT_CONTAIN_BLOCK: ReadonlySet<string> = new Set([
  "p",
  "span",
  "a",
  "b",
  "i",
  "em",
  "strong",
  "small",
  "s",
  "cite",
  "q",
  "dfn",
  "abbr",
  "code",
  "var",
  "samp",
  "kbd",
  "sub",
  "sup",
  "mark",
  "bdi",
  "bdo",
  "label",
  "output",
  "time",
  "data",
]);

const INTERACTIVE_ELEMENTS: ReadonlySet<string> = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
]);

const CANNOT_CONTAIN_INTERACTIVE: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["button", new Set(["button", "a", "input", "select", "textarea"])],
  ["a", new Set(["a"])],
  ["label", new Set(["label"])],
]);

const CANNOT_SELF_NEST: ReadonlySet<string> = new Set([
  "a",
  "button",
  "label",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const HEADING_ELEMENTS: ReadonlySet<string> = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

const REQUIRED_PARENT_CHILDREN: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["ul", new Set(["li"])],
  ["ol", new Set(["li"])],
  ["table", new Set(["thead", "tbody", "tfoot", "tr", "caption", "colgroup", "col"])],
  ["thead", new Set(["tr"])],
  ["tbody", new Set(["tr"])],
  ["tfoot", new Set(["tr"])],
  ["tr", new Set(["td", "th"])],
  ["dl", new Set(["dt", "dd", "div"])],
  ["select", new Set(["option", "optgroup"])],
]);

const getJsxElementName = (node: EsTreeNodeOfType<"JSXElement">): string | null => {
  const openingElement = node.openingElement;
  if (isNodeOfType(openingElement.name, "JSXIdentifier")) {
    return openingElement.name.name;
  }
  return null;
};

const isSolidControlFlowComponent = (elementName: string): boolean =>
  SOLID_CONTROL_FLOW_COMPONENTS.has(elementName);

export const solidValidateJsxNesting = defineRule<Rule>({
  id: "solid-validate-jsx-nesting",
  severity: "error",
  requires: ["solid"],
  recommendation:
    "Invalid HTML element nesting causes hydration mismatches — browsers auto-correct the DOM tree, breaking Solid's assumptions.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const parentName = getJsxElementName(node);
      if (!parentName || !isDomElementName(parentName)) return;

      for (const child of node.children) {
        if (!isNodeOfType(child as EsTreeNode, "JSXElement")) continue;
        const childElement = child as EsTreeNodeOfType<"JSXElement">;
        const childName = getJsxElementName(childElement);
        if (!childName) continue;

        if (isSolidControlFlowComponent(childName)) continue;
        if (!isDomElementName(childName)) continue;

        if (CANNOT_CONTAIN_BLOCK.has(parentName) && BLOCK_ELEMENTS.has(childName)) {
          context.report({
            node: childElement,
            message: `\`<${childName}>\` is a block element and cannot be nested inside \`<${parentName}>\` — the browser will auto-correct the DOM, causing a hydration mismatch.`,
          });
          continue;
        }

        if (HEADING_ELEMENTS.has(parentName) && HEADING_ELEMENTS.has(childName)) {
          context.report({
            node: childElement,
            message: `\`<${childName}>\` cannot be nested inside \`<${parentName}>\` — headings cannot contain other headings.`,
          });
          continue;
        }

        if (CANNOT_SELF_NEST.has(parentName) && childName === parentName) {
          context.report({
            node: childElement,
            message: `\`<${childName}>\` cannot be nested inside itself — this produces invalid HTML and causes hydration mismatches.`,
          });
          continue;
        }

        const disallowedInteractive = CANNOT_CONTAIN_INTERACTIVE.get(parentName);
        if (disallowedInteractive?.has(childName)) {
          context.report({
            node: childElement,
            message: `\`<${childName}>\` cannot be nested inside \`<${parentName}>\` — interactive elements must not contain other interactive elements.`,
          });
          continue;
        }

        const allowedChildren = REQUIRED_PARENT_CHILDREN.get(parentName);
        if (allowedChildren && !allowedChildren.has(childName)) {
          context.report({
            node: childElement,
            message: `\`<${childName}>\` is not a valid direct child of \`<${parentName}>\` — expected ${[...allowedChildren].map((allowed) => `\`<${allowed}>\``).join(", ")}.`,
          });
        }
      }
    },
  }),
});
