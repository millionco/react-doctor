use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const AUTOFILL_TOKENS: &[&str] = &[
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
];
const AUTOFILL_CONTACT_TOKENS: &[&str] = &[
    "tel",
    "tel-country-code",
    "tel-national",
    "tel-area-code",
    "tel-local",
    "tel-extension",
    "email",
    "impp",
];
const AUTOFILL_ADDRESS_TYPES: &[&str] = &["shipping", "billing"];
const AUTOFILL_CONTACT_QUALIFIERS: &[&str] = &["home", "work", "mobile", "fax", "pager"];
const FORM_CONTROL_TAGS: &[&str] = &["input", "textarea", "select", "form"];

#[derive(Debug, Default, Clone)]
pub struct AutocompleteValid;

declare_oxc_lint!(
    /// Require valid HTML autocomplete tokens on form controls.
    AutocompleteValid,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require valid autocomplete values.",
);

impl Rule for AutocompleteValid {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some((raw_element_type, _)) = resolve_jsx_element_type(opening_element, ctx) else {
            return;
        };
        let element_type = ctx
            .settings()
            .jsx_a11y
            .components
            .get(raw_element_type)
            .map_or(raw_element_type, |configured| configured.as_str());
        if !FORM_CONTROL_TAGS.contains(&element_type)
            && !is_configured_input_component(element_type, ctx)
        {
            return;
        }
        let Some(attribute) = opening_element.attributes.iter().find_map(|attribute| {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
            matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name.eq_ignore_ascii_case("autocomplete"))
                .then_some(attribute.as_ref())
        }) else {
            return;
        };
        let Some(JSXAttributeValue::StringLiteral(value)) = attribute.value.as_ref() else {
            return;
        };
        if autocomplete_value_is_valid(value.value.as_str()) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Users who rely on autofill can't fill this field because `{}` isn't a known token, so use a valid `autoComplete` token.",
                value.value
            ))
            .with_label(attribute.span),
        );
    }
}

fn is_configured_input_component(element_type: &str, ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("autocompleteValid"))
        .and_then(|settings| settings.get("inputComponents"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|components| {
            components
                .iter()
                .any(|component| component.as_str() == Some(element_type))
        })
}

fn autocomplete_value_is_valid(value: &str) -> bool {
    let tokens = value
        .split_whitespace()
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return true;
    }
    let mut index = 0;
    if tokens[index].starts_with("section-") {
        index += 1;
    }
    if index < tokens.len() && AUTOFILL_ADDRESS_TYPES.contains(&tokens[index].as_str()) {
        index += 1;
    }
    let is_contact_qualified =
        index < tokens.len() && AUTOFILL_CONTACT_QUALIFIERS.contains(&tokens[index].as_str());
    if is_contact_qualified {
        index += 1;
    }
    let Some(field_token) = tokens.get(index) else {
        return false;
    };
    let valid_field_tokens = if is_contact_qualified {
        AUTOFILL_CONTACT_TOKENS
    } else {
        AUTOFILL_TOKENS
    };
    if !valid_field_tokens.contains(&field_token.as_str()) {
        return false;
    }
    index += 1;
    if index < tokens.len() && tokens[index] == "webauthn" {
        index += 1;
    }
    index == tokens.len()
}
