import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isJsxFragmentElement } from "../../utils/is-jsx-fragment-element.js";
import type { Rule } from "../../utils/rule.js";

const SYNTAX_MESSAGE =
  "`<React.Fragment>` is used where shorthand fragments are configured, so similar wrappers look different across the codebase.";
const ELEMENT_MESSAGE =
  "Fragment shorthand is used where explicit fragments are configured, so similar wrappers look different across the codebase.";

interface JsxFragmentsSettings {
  mode?: "syntax" | "element";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxFragmentsSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxFragments?: JsxFragmentsSettings }).jsxFragments ?? {})
      : {};
  return { mode: ruleSettings.mode ?? "syntax" };
};

// Port of `oxc_linter::rules::react::jsx_fragments`. Two modes:
//   - "syntax" (default): prefer `<></>`. Flags `<React.Fragment>...</>`
//     and `<Fragment>...</>` with NO attributes.
//   - "element": prefer `<React.Fragment>`. Flags `<></>` shorthand.
export const jsxFragments = defineRule<Rule>({
  id: "jsx-fragments",
  title: "Inconsistent fragment syntax",
  severity: "warn",
  // Pure stylistic — `<>` vs `<Fragment>` is a formatter concern,
  // not a bug class. Default off.
  defaultEnabled: false,
  recommendation:
    "Use one fragment style so identical wrappers do not look different across files.",
  category: "Architecture",
  create: (context) => {
    const { mode } = resolveSettings(context.settings);
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        if (mode !== "syntax") return;
        // Self-closing `<Fragment />` is fine — there's nothing to swap
        // for the shorthand. Match OXC's `let Some(closing_element)`
        // guard.
        if (!node.closingElement) return;
        const openingElement = node.openingElement;
        if (!isJsxFragmentElement(openingElement as EsTreeNode)) return;
        if (openingElement.attributes.length > 0) return;
        context.report({ node: openingElement, message: SYNTAX_MESSAGE });
      },
      JSXFragment(node: EsTreeNodeOfType<"JSXFragment">) {
        if (mode !== "element") return;
        context.report({ node: node.openingFragment, message: ELEMENT_MESSAGE });
      },
    };
  },
});
