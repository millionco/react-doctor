use oxc_ast::{ast::JSXElementName, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const ROOT_LAYOUT_CLASS_NAMES: [&str; 4] = ["h-dvh", "h-screen", "min-h-dvh", "min-h-screen"];
const WARM_NEUTRAL_SURFACE_CLASSES: [&str; 4] =
    ["bg-amber-50", "bg-orange-50", "bg-stone-50", "bg-yellow-50"];

#[derive(Debug, Default, Clone)]
pub struct NoDefaultWarmPageSurface;

declare_oxc_lint!(
    /// Disallow default warm neutral page surfaces.
    NoDefaultWarmPageSurface,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow default warm neutral page surfaces.",
);

impl Rule for NoDefaultWarmPageSurface {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let unvariant_utilities = tokens
            .iter()
            .filter(|token| token.variants.is_empty())
            .map(|token| token.utility)
            .collect::<Vec<_>>();
        let is_main_element = matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "main"
        );
        if !is_main_element
            && !ROOT_LAYOUT_CLASS_NAMES
                .iter()
                .any(|class_name| unvariant_utilities.contains(class_name))
        {
            return;
        }
        let Some(warm_surface) = WARM_NEUTRAL_SURFACE_CLASSES
            .iter()
            .find(|class_name| unvariant_utilities.contains(class_name))
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "The page-wide {warm_surface} surface reads as a default warm neutral. Use a palette choice tied to the product's visual identity."
            ))
            .with_label(opening_element.span),
        );
    }
}
