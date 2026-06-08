import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

// Port of `oxc_linter::rules::react::jsx_no_duplicate_props`. Walks each
// JSXOpeningElement's attribute list and reports any `JSXAttribute` whose
// identifier name has already been seen in the same opening tag. Spread
// attributes (`{...props}`) are skipped — they don't carry a static name.
// OXC's port intentionally skips `ignoreCase` (cases differ → distinct).
export const jsxNoDuplicateProps = defineRule<Rule>({
  id: "jsx-no-duplicate-props",
  title: "Duplicate props on element",
  severity: "error",
  recommendation:
    "Remove or rename one of the duplicate props so the later value does not silently override the earlier one.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const seenPropNames = new Set<string>();
      for (const attribute of node.attributes) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        if (!isNodeOfType(attribute.name, "JSXIdentifier")) continue;
        const propName = attribute.name.name;
        if (seenPropNames.has(propName)) {
          context.report({
            node: attribute,
            message: `Your users can get the wrong value because React keeps only the last "${propName}" & drops the first.`,
          });
        }
        seenPropNames.add(propName);
      }
    },
  }),
});
