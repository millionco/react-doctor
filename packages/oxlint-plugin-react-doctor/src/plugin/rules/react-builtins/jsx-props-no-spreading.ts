import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "You can't tell what props reach this element when you spread them.";

interface JsxPropsNoSpreadingSettings {
  html?: "enforce" | "ignore";
  custom?: "enforce" | "ignore";
  explicitSpread?: "enforce" | "ignore";
  exceptions?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxPropsNoSpreadingSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxPropsNoSpreading?: JsxPropsNoSpreadingSettings })
          .jsxPropsNoSpreading ?? {})
      : {};
  return {
    html: ruleSettings.html ?? "enforce",
    custom: ruleSettings.custom ?? "enforce",
    explicitSpread: ruleSettings.explicitSpread ?? "enforce",
    exceptions: ruleSettings.exceptions ?? [],
  };
};

// Port of `oxc_linter::rules::react::jsx_props_no_spreading`. Reports
// `<C {...props} />` (and equivalent on intrinsic / member-expression
// JSX names). Settings let either tag class be disabled, plus an
// exception list and an `explicitSpread: "ignore"` mode that allows
// spreads of object literals (`<C {...{ foo: 1 }} />`).
export const jsxPropsNoSpreading = defineRule<Rule>({
  id: "jsx-props-no-spreading",
  title: "Props spread onto element",
  severity: "warn",
  // Default off because `{...props}` is the canonical composition
  // pattern: forwardRef wrappers, shadcn-ui components, Radix /
  // Headless UI consumers, polymorphic components, etc. all spread.
  // Opt in via config when a project wants to enforce explicit prop
  // lists on its component boundaries.
  defaultEnabled: false,
  recommendation:
    "List each prop explicitly so consumers can see the component API instead of receiving hidden spread props.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const tagName = flattenJsxName(node.name);
        if (!tagName) return;
        const isCustom = isReactComponentName(tagName) || tagName.includes(".");
        const isHtml = !isCustom;
        const isException = settings.exceptions.includes(tagName);

        const ignoreHtml = settings.html === "ignore";
        const ignoreCustom = settings.custom === "ignore";

        for (const attribute of node.attributes) {
          if (!isNodeOfType(attribute, "JSXSpreadAttribute")) continue;
          const argument = stripParenExpression(attribute.argument);
          if (settings.explicitSpread === "ignore" && isNodeOfType(argument, "ObjectExpression")) {
            // When the inner object literal contains any nested
            // SpreadElement (`{ ...rest }` / `{ prop1, ...rest }`),
            // OXC treats it as opaque — same as a non-explicit
            // spread — and continues to flag the outer spread.
            const hasInnerSpread = argument.properties.some((property) =>
              isNodeOfType(property as EsTreeNode, "SpreadElement"),
            );
            if (!hasInnerSpread) continue;
          }
          // Apply the html/custom toggle modulo the per-tag exceptions
          // (exceptions FLIP the active mode for that single tag).
          if (isHtml) {
            const shouldEnforce = ignoreHtml ? isException : !isException;
            if (!shouldEnforce) continue;
          } else if (isCustom) {
            const shouldEnforce = ignoreCustom ? isException : !isException;
            if (!shouldEnforce) continue;
          }
          context.report({ node: attribute, message: MESSAGE });
        }
      },
    };
  },
});
