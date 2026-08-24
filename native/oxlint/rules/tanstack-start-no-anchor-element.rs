use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Plain <a> reloads the whole page for internal navigation, so TanStack Router loses client state and preloading.";

#[derive(Debug, Default, Clone)]
pub struct TanstackStartNoAnchorElement;

declare_oxc_lint!(
    /// Require TanStack Router links for internal route navigation.
    TanstackStartNoAnchorElement,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require TanStack Router links for internal routes.",
);

impl Rule for TanstackStartNoAnchorElement {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !is_in_project_directory(ctx, "routes")
            || resolve_jsx_element_type(opening_element, ctx)
                .is_none_or(|(element_type, _)| element_type != "a")
        {
            return;
        }
        let Some(href) =
            find_jsx_attribute(opening_element, "href").and_then(get_literal_attribute_string)
        else {
            return;
        };
        if !href.starts_with('/') || href.starts_with("//") {
            return;
        }
        let pathname_end = href.find(['?', '#']).unwrap_or(href.len());
        let pathname = &href[..pathname_end];
        if pathname.starts_with("/api/") || has_static_asset_extension(pathname) {
            return;
        }
        if find_jsx_attribute(opening_element, "download").is_some()
            || find_jsx_attribute(opening_element, "target").and_then(get_literal_attribute_string)
                == Some("_blank")
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn get_literal_attribute_string<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => {
            let Some(Expression::StringLiteral(literal)) = container.expression.as_expression()
            else {
                return None;
            };
            Some(literal.value.as_str())
        }
        _ => None,
    }
}

fn has_static_asset_extension(pathname: &str) -> bool {
    let Some((_stem, extension)) = pathname
        .rsplit('/')
        .next()
        .and_then(|segment| segment.rsplit_once('.'))
    else {
        return false;
    };
    (1..=8).contains(&extension.len())
        && extension
            .bytes()
            .all(|character| character.is_ascii_alphanumeric())
}
