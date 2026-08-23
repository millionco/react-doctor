use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

const MESSAGE: &str = "This autoplaying video has no poster frame, so users can see an empty or unstable media region before playback. Add a representative poster image.";

#[derive(Debug, Default, Clone)]
pub struct RequireAutoplayVideoPoster;

declare_oxc_lint!(
    /// Require a poster frame for autoplaying videos with declarative sources.
    RequireAutoplayVideoPoster,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Require autoplay video poster frames.",
);

impl Rule for RequireAutoplayVideoPoster {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "video"
        ) || opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
        {
            return;
        }
        let Some(JSXAttributeItem::Attribute(autoplay_attribute)) =
            has_jsx_prop_ignore_case(opening_element, "autoplay")
        else {
            return;
        };
        if !is_statically_enabled(autoplay_attribute)
            || !has_declarative_video_source(node, opening_element, ctx)
            || has_usable_poster(opening_element)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
    }
}

fn is_statically_enabled(attribute: &JSXAttribute) -> bool {
    let Some(value) = attribute.value.as_ref() else {
        return true;
    };
    match value {
        JSXAttributeValue::StringLiteral(string_literal) => string_literal.value == "true",
        JSXAttributeValue::ExpressionContainer(container) => {
            matches!(
                container.expression.as_expression().map(Expression::get_inner_expression),
                Some(Expression::BooleanLiteral(boolean_literal)) if boolean_literal.value
            ) || matches!(
                container.expression.as_expression().map(Expression::get_inner_expression),
                Some(Expression::StringLiteral(string_literal)) if string_literal.value == "true"
            )
        }
        _ => false,
    }
}

fn has_usable_poster(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    let Some(JSXAttributeItem::Attribute(poster_attribute)) =
        has_jsx_prop_ignore_case(opening_element, "poster")
    else {
        return false;
    };
    get_string_literal_attribute_value(poster_attribute).map_or(true, |poster| {
        !poster
            .trim_matches(|character| is_js_whitespace(character))
            .is_empty()
    })
}

fn has_declarative_video_source(
    node: &AstNode,
    opening_element: &oxc_ast::ast::JSXOpeningElement,
    ctx: &LintContext,
) -> bool {
    if has_jsx_prop_ignore_case(opening_element, "src").is_some() {
        return true;
    }
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXElement(element) = parent.kind() else {
        return false;
    };
    element.children.iter().any(|child| {
        matches!(
            child,
            oxc_ast::ast::JSXChild::Element(child_element)
                if matches!(
                    &child_element.opening_element.name,
                    JSXElementName::Identifier(identifier) if identifier.name == "source"
                )
        )
    })
}
