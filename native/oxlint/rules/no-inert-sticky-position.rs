use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const INSET_PROPERTY_NAMES: [&str; 11] = [
    "inset",
    "insetBlock",
    "insetBlockEnd",
    "insetBlockStart",
    "insetInline",
    "insetInlineEnd",
    "insetInlineStart",
    "top",
    "right",
    "bottom",
    "left",
];
const MESSAGE: &str = "This element is sticky but has no non-auto inset, so it behaves like relative positioning instead of sticking. Set an inset on the sticky axis.";

#[derive(Debug, Default, Clone)]
pub struct NoInertStickyPosition;

declare_oxc_lint!(
    /// Require a non-auto inset for sticky positioning.
    NoInertStickyPosition,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require an inset for sticky positioning.",
);

impl Rule for NoInertStickyPosition {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if opening_element.attributes.iter().any(|attribute| {
            matches!(
                attribute,
                oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
            )
        }) {
            return;
        }
        let class_name = get_static_class_name(opening_element);
        let style = find_jsx_attribute(opening_element, "style")
            .and_then(|attribute| get_inline_style_object_expression(attribute));
        let position_property =
            style.and_then(|style| get_effective_static_style_property(style, "position"));
        let has_static_sticky_class = class_name.is_some_and(|class_name| {
            tailwind_class_name_tokens(class_name)
                .iter()
                .any(|token| token.variants.is_empty() && token.utility == "sticky")
        });
        let has_inline_sticky = position_property.is_some_and(|property| {
            matches!(
                &property.value,
                oxc_ast::ast::Expression::StringLiteral(string_literal)
                    if string_literal.value == "sticky"
            )
        });
        if !has_static_sticky_class && !has_inline_sticky {
            return;
        }
        if class_name.is_some_and(has_non_auto_inset_class)
            || style.is_some_and(has_non_auto_inline_inset)
        {
            return;
        }
        let span = position_property.map_or(opening_element.span, |property| property.span);
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(span));
    }
}

fn has_non_auto_inset_class(class_name: &str) -> bool {
    tailwind_class_name_tokens(class_name).iter().any(|token| {
        token.variants.is_empty()
            && is_inset_utility(token.utility)
            && !token.utility.ends_with("-auto")
    })
}

fn is_inset_utility(utility: &str) -> bool {
    let utility = utility.strip_prefix('-').unwrap_or(utility);
    [
        "inset-", "inset-x-", "inset-y-", "top-", "right-", "bottom-", "left-", "start-", "end-",
    ]
    .iter()
    .any(|prefix| utility.starts_with(prefix))
}

fn has_non_auto_inline_inset(style: &oxc_ast::ast::ObjectExpression) -> bool {
    INSET_PROPERTY_NAMES.iter().any(|property_name| {
        let Some(property) = get_effective_static_style_property(style, property_name) else {
            return false;
        };
        !matches!(
            &property.value,
            oxc_ast::ast::Expression::StringLiteral(string_literal) if string_literal.value == "auto"
        )
    })
}
