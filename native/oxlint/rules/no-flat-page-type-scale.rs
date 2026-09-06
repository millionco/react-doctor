use oxc_ast::{ast::JSXElementName, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MIN_PAGE_TYPE_SCALE_RATIO: f64 = 2.0;
const PAGE_TYPE_SCALE_MIN_STEPS: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct NoFlatPageTypeScale;

declare_oxc_lint!(
    /// Disallow a compressed explicit type scale across one page.
    NoFlatPageTypeScale,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow a compressed page type scale.",
);

impl Rule for NoFlatPageTypeScale {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if identifier.name != "main" {
            return;
        }
        let has_tailwind = has_capability_or_unspecified(ctx, "tailwind");
        let mut opening_elements = vec![element.opening_element.as_ref()];
        collect_static_jsx_opening_elements(&element.children, &mut opening_elements);
        let mut font_sizes = Vec::new();
        for opening_element in opening_elements {
            let Some(font_size) = get_static_effective_font_size(opening_element, has_tailwind)
            else {
                continue;
            };
            if !font_sizes.contains(&font_size) {
                font_sizes.push(font_size);
            }
        }
        if font_sizes.len() < PAGE_TYPE_SCALE_MIN_STEPS {
            return;
        }
        font_sizes.sort_by(f64::total_cmp);
        let smallest_size = font_sizes[0];
        let largest_size = font_sizes[font_sizes.len() - 1];
        if smallest_size == 0.0
            || largest_size == 0.0
            || largest_size / smallest_size >= MIN_PAGE_TYPE_SCALE_RATIO
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "This page declares {} text sizes within less than a 2× range. Increase the hierarchy between supporting and display text.",
                font_sizes.len()
            ))
            .with_label(element.opening_element.span),
        );
    }
}
