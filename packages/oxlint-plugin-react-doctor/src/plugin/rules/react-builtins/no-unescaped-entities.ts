import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const ESCAPED_VERSIONS: Record<string, string> = {
  '"': "`&quot;` / `&ldquo;` / `&#34;` / `&rdquo;`",
  "'": "`&apos;` / `&lsquo;` / `&#39;` / `&rsquo;`",
  ">": "`&gt;` / `&#62;`",
  "}": "`&#125;` (or wrap the literal in `{'}'}`)",
};

const buildMessage = (character: string): string =>
  `\`${character}\` in JSX text can read as markup & confuse readers.`;

// Port of `oxc_linter::rules::react::no_unescaped_entities`. Walks JSX
// text nodes and reports each `'`, `"`, `>`, and `}` character as an
// unescaped entity. Matches `eslint-plugin-react`'s default surface
// (OXC's narrower port covered only quotes).
export const noUnescapedEntities = defineRule<Rule>({
  id: "no-unescaped-entities",
  title: "Unescaped entities in JSX",
  severity: "warn",
  // Pure stylistic rule — replacing `'` with `&apos;` etc. is a
  // cosmetic preference that doesn't catch bugs (modern JSX
  // compilers + browsers handle bare entities fine). Default off.
  defaultEnabled: false,
  recommendation:
    "Replace bare `'` / `\"` / `>` / `}` characters with HTML entities so literal UI text is encoded consistently.",
  create: (context) => ({
    JSXText(node: EsTreeNodeOfType<"JSXText">) {
      const value = node.value;
      for (const character of value) {
        if (character in ESCAPED_VERSIONS) {
          context.report({ node, message: buildMessage(character) });
          return;
        }
      }
    },
  }),
});
