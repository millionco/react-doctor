use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, JSXAttributeItem, JSXAttributeValue, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

const ALLOWED_SANDBOX_VALUES: [&str; 14] = [
    "downloads-without-user-activation",
    "downloads",
    "forms",
    "modals",
    "orientation-lock",
    "pointer-lock",
    "popups",
    "popups-to-escape-sandbox",
    "presentation",
    "same-origin",
    "scripts",
    "storage-access-by-user-activation",
    "top-navigation",
    "top-navigation-by-user-activation",
];

const MISSING_MESSAGE: &str =
    "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.";
const INVALID_COMBINATION_MESSAGE: &str = "Combining `allow-scripts` & `allow-same-origin` lets the iframe remove its own sandbox, defeating the protection.";

#[derive(Debug, Default, Clone)]
pub struct IframeMissingSandbox;

declare_oxc_lint!(
    /// Require iframe elements to use a valid, effective sandbox.
    IframeMissingSandbox,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require iframe elements to use a valid sandbox.",
);

impl Rule for IframeMissingSandbox {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => {
                check_iframe_jsx(opening_element, ctx)
            }
            AstKind::CallExpression(call_expression) => {
                check_iframe_create_element(call_expression, ctx)
            }
            _ => {}
        }
    }
}

fn check_iframe_jsx<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) {
    if resolve_jsx_element_type(opening_element, ctx).map(|(element_type, _)| element_type)
        != Some("iframe")
    {
        return;
    }
    let sandbox_attribute = has_jsx_prop_ignore_case(opening_element, "sandbox")
        .and_then(JSXAttributeItem::as_attribute);
    let Some(sandbox_attribute) = sandbox_attribute else {
        let has_explicit_src = has_jsx_prop_ignore_case(opening_element, "src").is_some();
        let has_spread = opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)));
        if !has_explicit_src && has_spread {
            return;
        }
        let has_src_doc = has_jsx_prop_ignore_case(opening_element, "srcDoc").is_some();
        if !has_explicit_src
            && !has_src_doc
            && has_jsx_prop_ignore_case(opening_element, "ref").is_some()
        {
            return;
        }
        if has_media_embed_allow_value(opening_element) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(opening_element.name.span()));
        return;
    };
    let Some(sandbox_value) = direct_jsx_string_value(sandbox_attribute) else {
        return;
    };
    validate_sandbox_value(sandbox_value, sandbox_attribute.span, ctx);
}

fn has_media_embed_allow_value(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(allow_attribute) = has_jsx_prop_ignore_case(opening_element, "allow")
        .and_then(JSXAttributeItem::as_attribute)
    else {
        return false;
    };
    direct_jsx_string_value(allow_attribute).is_some_and(|allow_value| {
        let lowercase_allow_value = allow_value.to_ascii_lowercase();
        lowercase_allow_value.contains("encrypted-media")
            || lowercase_allow_value.contains("picture-in-picture")
    })
}

fn direct_jsx_string_value<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a str> {
    let JSXAttributeValue::StringLiteral(string_literal) = attribute.value.as_ref()? else {
        return None;
    };
    Some(string_literal.value.as_str())
}

fn check_iframe_create_element<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) {
    if !is_create_element_call(call_expression)
        || !matches!(
            call_expression.arguments.first().and_then(Argument::as_expression),
            Some(Expression::StringLiteral(string_literal)) if string_literal.value == "iframe"
        )
    {
        return;
    }
    let Some(props_argument) = call_expression.arguments.get(1).and_then(Argument::as_expression)
    else {
        ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(call_expression.span));
        return;
    };
    if is_nullish_expression(props_argument) {
        ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(call_expression.span));
        return;
    }
    let Expression::ObjectExpression(props_object) = props_argument else {
        return;
    };
    let mut sandbox_value = None;
    let mut has_spread = false;
    let mut has_explicit_src = false;
    for property in &props_object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            has_spread = true;
            continue;
        };
        if property_key_matches_name(&property.key, "src") {
            has_explicit_src = true;
        }
        if property_key_matches_name(&property.key, "sandbox") {
            sandbox_value = Some(&property.value);
            break;
        }
    }
    let Some(sandbox_value) = sandbox_value else {
        if has_spread && !has_explicit_src {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(props_object.span));
        return;
    };
    let Expression::StringLiteral(string_literal) = sandbox_value else {
        return;
    };
    validate_sandbox_value(string_literal.value.as_str(), sandbox_value.span(), ctx);
}

fn validate_sandbox_value(value: &str, span: Span, ctx: &LintContext<'_>) {
    let mut has_allow_scripts = false;
    let mut has_allow_same_origin = false;
    for raw_token in value.split(' ') {
        let token = raw_token.trim_matches(|character| is_js_whitespace(character));
        if !is_allowed_sandbox_token(token) {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "`{token}` isn't a valid `sandbox` token, so the browser ignores it & leaves your iframe exposed."
                ))
                .with_label(span),
            );
        }
        has_allow_scripts |= token == "allow-scripts";
        has_allow_same_origin |= token == "allow-same-origin";
    }
    if has_allow_scripts && has_allow_same_origin {
        ctx.diagnostic(OxcDiagnostic::warn(INVALID_COMBINATION_MESSAGE).with_label(span));
    }
}

fn is_allowed_sandbox_token(token: &str) -> bool {
    token.is_empty()
        || token
            .strip_prefix("allow-")
            .is_some_and(|value| ALLOWED_SANDBOX_VALUES.contains(&value))
}
