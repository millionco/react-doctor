use oxc_ast::{ast::JSXElementName, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "This page-wide purple-spectrum gradient is a common default treatment. Choose a palette relationship specific to the product.";
const ROOT_LAYOUT_CLASS_NAMES: [&str; 4] = ["h-dvh", "h-screen", "min-h-dvh", "min-h-screen"];
const PURPLE_STOP_PREFIXES: [&str; 3] = ["from-indigo-", "from-purple-", "from-violet-"];
const PURPLE_VIA_PREFIXES: [&str; 3] = ["via-indigo-", "via-purple-", "via-violet-"];
const PURPLE_TO_PREFIXES: [&str; 3] = ["to-indigo-", "to-purple-", "to-violet-"];
const BRIGHT_STOP_PREFIXES: [&str; 4] = ["from-blue-", "from-cyan-", "from-fuchsia-", "from-pink-"];
const BRIGHT_VIA_PREFIXES: [&str; 4] = ["via-blue-", "via-cyan-", "via-fuchsia-", "via-pink-"];
const BRIGHT_TO_PREFIXES: [&str; 4] = ["to-blue-", "to-cyan-", "to-fuchsia-", "to-pink-"];

#[derive(Debug, Default, Clone)]
pub struct NoDefaultPurplePageGradient;

declare_oxc_lint!(
    /// Disallow default purple-spectrum page gradients.
    NoDefaultPurplePageGradient,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow default purple-spectrum page gradients.",
);

impl Rule for NoDefaultPurplePageGradient {
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
            .filter(|token| !token.has_variants)
            .map(|token| token.utility)
            .collect::<Vec<_>>();
        let is_main_element = matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "main"
        );
        let is_page_root = is_main_element
            || ROOT_LAYOUT_CLASS_NAMES
                .iter()
                .any(|class_name| unvariant_utilities.contains(class_name));
        let has_gradient = unvariant_utilities.iter().any(|utility| {
            utility.starts_with("bg-gradient-to-") || utility.starts_with("bg-linear-to-")
        });
        if !is_page_root || !has_gradient {
            return;
        }
        let has_purple_stop = unvariant_utilities.iter().any(|utility| {
            starts_with_any(utility, &PURPLE_STOP_PREFIXES)
                || starts_with_any(utility, &PURPLE_VIA_PREFIXES)
                || starts_with_any(utility, &PURPLE_TO_PREFIXES)
        });
        let has_bright_stop = unvariant_utilities.iter().any(|utility| {
            starts_with_any(utility, &BRIGHT_STOP_PREFIXES)
                || starts_with_any(utility, &BRIGHT_VIA_PREFIXES)
                || starts_with_any(utility, &BRIGHT_TO_PREFIXES)
        });
        if has_purple_stop && has_bright_stop {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
        }
    }
}

fn starts_with_any(value: &str, prefixes: &[&str]) -> bool {
    prefixes.iter().any(|prefix| value.starts_with(prefix))
}
