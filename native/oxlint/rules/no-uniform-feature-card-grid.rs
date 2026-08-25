use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const UNIFORM_FEATURE_CARD_MIN_COUNT: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct NoUniformFeatureCardGrid;

declare_oxc_lint!(
    /// Disallow feature grids whose direct children all repeat one card recipe.
    NoUniformFeatureCardGrid,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow uniform feature card grids.",
);

impl Rule for NoUniformFeatureCardGrid {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if !matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(identifier)
                if matches!(identifier.name.as_str(), "div" | "section")
        ) {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        if !tailwind_class_name_tokens(class_name)
            .iter()
            .any(|token| token.variants.is_empty() && token.utility == "grid")
        {
            return;
        }
        let direct_elements = get_static_direct_jsx_elements(element);
        if direct_elements.len() < UNIFORM_FEATURE_CARD_MIN_COUNT
            || !direct_elements.iter().all(|direct_element| {
                is_tailwind_card_surface(&direct_element.opening_element)
                    && has_feature_copy(direct_element)
            })
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "All {} items in this grid use the same rounded card-and-heading recipe. Introduce hierarchy or a composition specific to the content.",
                direct_elements.len()
            ))
            .with_label(element.opening_element.span),
        );
    }
}

fn has_feature_copy(element: &oxc_ast::ast::JSXElement<'_>) -> bool {
    let mut descendants = Vec::new();
    collect_static_jsx_opening_elements(&element.children, &mut descendants);
    let has_heading = descendants.iter().any(|opening_element| {
        matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier)
                if matches!(identifier.name.as_str(), "h2" | "h3" | "h4")
        )
    });
    let has_paragraph = descendants.iter().any(|opening_element| {
        matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "p"
        )
    });
    has_heading && has_paragraph
}
