use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EXCESSIVE_CARD_SURFACE_MIN_COUNT: usize = 6;

#[derive(Debug, Default, Clone)]
pub struct NoExcessiveCardSurfaces;

declare_oxc_lint!(
    /// Disallow pages that box too many groups into rounded cards.
    NoExcessiveCardSurfaces,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow excessive card surfaces.",
);

impl Rule for NoExcessiveCardSurfaces {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !is_top_level_page_copy_root(element, node, ctx) {
            return;
        }
        let mut opening_elements = vec![element.opening_element.as_ref()];
        collect_static_jsx_opening_elements(&element.children, &mut opening_elements);
        let card_count = opening_elements
            .into_iter()
            .filter(|opening_element| is_tailwind_card_surface(opening_element))
            .count();
        if card_count < EXCESSIVE_CARD_SURFACE_MIN_COUNT {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page gives {card_count} groups a complete rounded card treatment. Flatten secondary groups so the important surfaces keep their visual weight."
            ))
            .with_label(element.opening_element.span),
        );
    }
}
