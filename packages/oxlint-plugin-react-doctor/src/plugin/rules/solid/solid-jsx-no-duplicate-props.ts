import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { readSolidRuleSettings } from "../../utils/read-solid-rule-settings.js";

interface SolidJsxNoDuplicatePropsSettings {
  ignoreCase?: boolean;
}

const normalizeName = (name: string, ignoreCase: boolean): string => {
  if (!(ignoreCase || name.startsWith("on"))) return name;
  return name
    .toLowerCase()
    .replace(/^on(?:capture)?:/, "on")
    .replace(/^(?:attr|prop):/, "");
};

interface PropEntry {
  normalizedName: string;
  reportNode: EsTreeNode;
}

const collectProps = (
  attributes: ReadonlyArray<EsTreeNode>,
  ignoreCase: boolean,
): ReadonlyArray<PropEntry> => {
  const collected: PropEntry[] = [];
  for (const attribute of attributes) {
    if (isNodeOfType(attribute, "JSXAttribute")) {
      const propertyName = getJsxAttributeName(attribute.name);
      if (!propertyName) continue;
      collected.push({
        normalizedName: normalizeName(propertyName, ignoreCase),
        reportNode: attribute,
      });
    } else if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      const expression = attribute.argument;
      if (expression && isNodeOfType(expression, "ObjectExpression")) {
        for (const property of expression.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          let keyName: string | null = null;
          if (isNodeOfType(property.key, "Identifier")) keyName = property.key.name;
          else if (isNodeOfType(property.key, "Literal")) keyName = String(property.key.value);
          if (!keyName) continue;
          collected.push({
            normalizedName: normalizeName(keyName, ignoreCase),
            reportNode: property.key,
          });
        }
      }
    }
  }
  return collected;
};

// Port of `solid/jsx-no-duplicate-props` — adapted from
// `eslint-plugin-react`'s rule of the same name. Also flags
// simultaneous use of `children` / JSX children / `innerHTML` /
// `textContent`.
export const solidJsxNoDuplicateProps = defineRule<Rule>({
  id: "solid-jsx-no-duplicate-props",
  severity: "error",
  requires: ["solid"],
  recommendation: "Remove duplicate props from JSX — only the last value wins in Solid.",
  create: (context: RuleContext) => {
    const settings = readSolidRuleSettings<SolidJsxNoDuplicatePropsSettings>(
      context.settings,
      "solidJsxNoDuplicateProps",
    );
    const ignoreCase = Boolean(settings.ignoreCase);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const seenNames = new Set<string>();
        for (const entry of collectProps(node.attributes, ignoreCase)) {
          if (seenNames.has(entry.normalizedName)) {
            const message =
              entry.normalizedName === "class"
                ? "Duplicate `class` props are not allowed; use `classList` instead in Solid."
                : "Duplicate props are not allowed.";
            context.report({ node: entry.reportNode, message });
          }
          seenNames.add(entry.normalizedName);
        }
        const hasChildrenProp = seenNames.has("children");
        const parent = node.parent;
        const hasJsxChildren = Boolean(
          parent &&
          (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
          parent.children &&
          parent.children.length > 0,
        );
        const hasInnerHtml = seenNames.has("innerHTML") || seenNames.has("innerhtml");
        const hasTextContent = seenNames.has("textContent") || seenNames.has("textcontent");
        const conflictingChildSources = [
          hasChildrenProp && "`props.children`",
          hasJsxChildren && "JSX children",
          hasInnerHtml && "`props.innerHTML`",
          hasTextContent && "`props.textContent`",
        ].filter(Boolean);
        if (conflictingChildSources.length > 1) {
          context.report({
            node,
            message: `Using ${conflictingChildSources.join(", ")} at the same time is not allowed.`,
          });
        }
      },
    };
  },
});
