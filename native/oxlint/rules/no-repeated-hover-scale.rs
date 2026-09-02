use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REPEATED_HOVER_SCALE_MIN_COUNT: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct NoRepeatedHoverScale;

declare_oxc_lint!(
    /// Disallow the same hover scale treatment across a page.
    NoRepeatedHoverScale,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeated hover scaling.",
);

impl Rule for NoRepeatedHoverScale {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
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
        let mut candidates_by_utility = Vec::<(&str, Vec<&oxc_ast::ast::JSXOpeningElement>)>::new();
        for opening_element in opening_elements {
            let Some(class_name) = get_static_class_name(opening_element) else {
                continue;
            };
            let tokens = tailwind_class_name_tokens(class_name);
            let Some(hover_scale) = tokens.iter().find(|token| {
                token.variants.contains(&"hover") && is_nondefault_scale_utility(token.utility)
            }) else {
                continue;
            };
            if let Some((_, candidates)) = candidates_by_utility
                .iter_mut()
                .find(|(utility, _)| *utility == hover_scale.utility)
            {
                candidates.push(opening_element);
            } else {
                candidates_by_utility.push((hover_scale.utility, vec![opening_element]));
            }
        }
        for (utility, candidates) in candidates_by_utility {
            if candidates.len() < REPEATED_HOVER_SCALE_MIN_COUNT {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "The {utility} hover treatment repeats on {} elements. Use stable surfaces or vary feedback by interaction purpose.",
                    candidates.len()
                ))
                .with_label(candidates[0].span),
            );
        }
    }
}

fn is_nondefault_scale_utility(utility: &str) -> bool {
    let Some(scale) = utility.strip_prefix("scale-") else {
        return false;
    };
    !scale.starts_with("100")
        || scale
            .as_bytes()
            .get(3)
            .is_some_and(|byte| byte.is_ascii_digit())
}
