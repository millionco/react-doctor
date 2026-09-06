use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

#[derive(Debug, Default, Clone)]
pub struct HtmlXmlLangMismatch;

declare_oxc_lint!(
    /// Require matching base languages on html lang and xml:lang.
    HtmlXmlLangMismatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require matching base languages on html lang and xml:lang.",
);

impl Rule for HtmlXmlLangMismatch {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name) != Some("html") {
            return;
        }
        let Some(language_attribute) =
            get_authoritative_jsx_attribute(opening_element, "lang", false)
        else {
            return;
        };
        let Some(xml_language_attribute) =
            get_authoritative_jsx_attribute(opening_element, "xml:lang", false)
        else {
            return;
        };
        let Some(language) = get_string_literal_attribute_value(language_attribute) else {
            return;
        };
        let Some(xml_language) = get_string_literal_attribute_value(xml_language_attribute) else {
            return;
        };
        let base_language_name = get_base_language(language);
        let base_xml_language_name = get_base_language(xml_language);
        if base_language_name.is_empty()
            || base_xml_language_name.is_empty()
            || base_language_name == base_xml_language_name
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "lang declares {base_language_name}, but xml:lang declares {base_xml_language_name}. Use the same base language so assistive technology chooses one pronunciation model."
            ))
            .with_label(xml_language_attribute.span),
        );
    }
}

fn get_base_language(language: &str) -> String {
    language
        .trim()
        .to_lowercase()
        .split('-')
        .next()
        .unwrap_or_default()
        .to_string()
}
