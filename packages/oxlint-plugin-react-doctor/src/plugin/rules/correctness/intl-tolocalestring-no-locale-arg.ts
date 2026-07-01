import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Only the Date/Number locale-formatting methods. String's
// `toLocaleLowerCase`/`toLocaleUpperCase` are deliberately excluded — they
// take a locale but don't format numbers or dates.
const LOCALE_FORMAT_METHODS: ReadonlySet<string> = new Set([
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
]);

const messageFor = (method: string): string =>
  `Calling \`.${method}()\` with no arguments formats using the host's default locale and timezone, so the server and the browser render different strings and cause a hydration mismatch; pass an explicit locale (and \`timeZone\` for dates), e.g. \`.${method}('en-US', { timeZone: 'UTC' })\`.`;

export const intlTolocalestringNoLocaleArg = defineRule({
  id: "intl-tolocalestring-no-locale-arg",
  title: "toLocale*String called without a locale",
  severity: "warn",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    "Pass an explicit locale (and `timeZone` for dates) to `.toLocaleString()` / `.toLocaleDateString()` / `.toLocaleTimeString()` so the server and browser format identically instead of reading the host default.",
  create: (context: RuleContext) => {
    const skipTestlikeFile = isTestlikeFilename(context.filename);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (skipTestlikeFile) return;
        if ((node.arguments?.length ?? 0) !== 0) return;
        const callee = node.callee as EsTreeNode;
        if (!isNodeOfType(callee, "MemberExpression") || callee.computed)
          return;
        if (!isNodeOfType(callee.property, "Identifier")) return;
        if (!LOCALE_FORMAT_METHODS.has(callee.property.name)) return;
        context.report({ node, message: messageFor(callee.property.name) });
      },
    };
  },
});
