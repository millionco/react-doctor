import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (value: string): string =>
  `Users who rely on autofill can't fill this field because \`${value}\` isn't a known token, so use a valid \`autoComplete\` token.`;

// Subset of HTML autofill tokens (full WHATWG list is much larger).
// See https://html.spec.whatwg.org/multipage/forms.html#autofill
const AUTOFILL_TOKENS: ReadonlySet<string> = new Set([
  "off",
  "on",
  "name",
  "honorific-prefix",
  "given-name",
  "additional-name",
  "family-name",
  "honorific-suffix",
  "nickname",
  "email",
  "username",
  "new-password",
  "current-password",
  "one-time-code",
  "organization-title",
  "organization",
  "street-address",
  "address-line1",
  "address-line2",
  "address-line3",
  "address-level4",
  "address-level3",
  "address-level2",
  "address-level1",
  "country",
  "country-name",
  "postal-code",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-number",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
  "cc-type",
  "transaction-currency",
  "transaction-amount",
  "language",
  "bday",
  "bday-day",
  "bday-month",
  "bday-year",
  "sex",
  "tel",
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-extension",
  "impp",
  "url",
  "photo",
]);

const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select", "form"]);

interface AutocompleteValidSettings {
  inputComponents?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { inputComponents: ReadonlyArray<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { autocompleteValid?: AutocompleteValidSettings }).autocompleteValid ?? {})
      : {};
  return { inputComponents: ruleSettings.inputComponents ?? [] };
};

// Port of `oxc_linter::rules::jsx_a11y::autocomplete_valid`. Validates
// `autoComplete` against the known HTML autofill token list.
export const autocompleteValid = defineRule<Rule>({
  id: "autocomplete-valid",
  title: "Invalid autocomplete value",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation: "Use a valid autofill token in `autoComplete`.",
  category: "Accessibility",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement: (node: EsTreeNodeOfType<"JSXOpeningElement">) => {
        const tag = getElementType(node, context.settings);
        if (!FORM_CONTROL_TAGS.has(tag) && !settings.inputComponents.includes(tag)) return;
        const attribute = hasJsxPropIgnoreCase(node.attributes, "autoComplete");
        if (!attribute) return;
        const value = getJsxPropStringValue(attribute);
        if (!value) return;
        // Multiple tokens separated by spaces.
        const tokens = value
          .toLowerCase()
          .split(/\s+/)
          .filter((token) => token.length > 0);
        for (const token of tokens) {
          // Strip section-name prefix `section-foo`.
          const normalized = token.startsWith("section-") ? "section-" : token;
          if (normalized === "section-") continue;
          if (!AUTOFILL_TOKENS.has(token)) {
            context.report({ node: attribute, message: buildMessage(value) });
            return;
          }
        }
      },
    };
  },
});
