import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getElementType } from "../../utils/get-element-type.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";

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

// Contact-info fields that may carry a `home`/`work`/… qualifier
// (WHATWG "autofill field name" → "contact" category).
const AUTOFILL_CONTACT_TOKENS: ReadonlySet<string> = new Set([
  "tel",
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-extension",
  "email",
  "impp",
]);

const AUTOFILL_ADDRESS_TYPES: ReadonlySet<string> = new Set(["shipping", "billing"]);

const AUTOFILL_CONTACT_QUALIFIERS: ReadonlySet<string> = new Set([
  "home",
  "work",
  "mobile",
  "fax",
  "pager",
]);

const SECTION_TOKEN_PREFIX = "section-";
const WEBAUTHN_TOKEN = "webauthn";

// Validate a value against the WHATWG autofill grammar:
//   [section-*] [shipping|billing] [home|work|mobile|fax|pager] field [webauthn]
// A contact qualifier restricts the field to the contact category, so
// `home url` stays invalid while `home tel` and `shipping postal-code` pass.
const isValidAutofillValue = (value: string): boolean => {
  const tokens = value
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return true;

  let index = 0;
  if (tokens[index]?.startsWith(SECTION_TOKEN_PREFIX)) index += 1;
  if (index < tokens.length && AUTOFILL_ADDRESS_TYPES.has(tokens[index])) index += 1;

  const isContactQualified =
    index < tokens.length && AUTOFILL_CONTACT_QUALIFIERS.has(tokens[index]);
  if (isContactQualified) index += 1;

  const fieldToken = tokens[index];
  if (!fieldToken) return false;
  const fieldIsValid = isContactQualified
    ? AUTOFILL_CONTACT_TOKENS.has(fieldToken)
    : AUTOFILL_TOKENS.has(fieldToken);
  if (!fieldIsValid) return false;
  index += 1;

  if (index < tokens.length && tokens[index] === WEBAUTHN_TOKEN) index += 1;
  return index === tokens.length;
};

const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set(["input", "textarea", "select", "form"]);

interface AutocompleteValidSettings {
  inputComponents?: ReadonlyArray<string>;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): { inputComponents: ReadonlySet<string> } => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { autocompleteValid?: AutocompleteValidSettings }).autocompleteValid ?? {})
      : {};
  return { inputComponents: new Set(ruleSettings.inputComponents ?? []) };
};

// Port of `oxc_linter::rules::jsx_a11y::autocomplete_valid`. Validates
// `autoComplete` against the known HTML autofill token list.
export const autocompleteValid = defineRule({
  id: "autocomplete-valid",
  title: "Invalid autocomplete value",
  tags: ["react-jsx-only"],
  severity: "warn",
  recommendation:
    "Use a valid autofill token in `autoComplete` so browsers can fill the right field reliably.",
  category: "Accessibility",
  // Docs-validation FP cluster: test fixtures deliberately pass arbitrary
  // autoComplete values through to assert rendering behaviour; markup in
  // test-only files never reaches a browser's autofill, so the finding is
  // unactionable there.
  create: skipNonProductionFiles((context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXOpeningElement: (node: EsTreeNodeOfType<"JSXOpeningElement">) => {
        const tag = getElementType(node, context.settings);
        if (!FORM_CONTROL_TAGS.has(tag) && !settings.inputComponents.has(tag)) return;
        const attribute = hasJsxPropIgnoreCase(node.attributes, "autoComplete");
        if (!attribute) return;
        const value = getJsxPropStringValue(attribute);
        if (!value) return;
        if (!isValidAutofillValue(value)) {
          context.report({ node: attribute, message: buildMessage(value) });
        }
      },
    };
  }),
});
