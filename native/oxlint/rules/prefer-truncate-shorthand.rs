use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "`overflow-hidden text-ellipsis whitespace-nowrap` is exactly what the `truncate` utility does — collapse the three classes into `truncate`.";
const REQUIRED_CLASS_NAMES: [&str; 3] = ["overflow-hidden", "text-ellipsis", "whitespace-nowrap"];

#[derive(Debug, Default, Clone)]
pub struct PreferTruncateShorthand;

declare_oxc_lint!(
    /// Prefer Tailwind's truncate utility over its three component classes.
    PreferTruncateShorthand,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Prefer Tailwind's truncate shorthand.",
);

impl Rule for PreferTruncateShorthand {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        if !REQUIRED_CLASS_NAMES
            .iter()
            .all(|required_class| has_class_name(class_name, required_class))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn has_class_name(class_name: &str, required_class: &str) -> bool {
    class_name
        .split(is_ecmascript_whitespace)
        .any(|class_token| class_token == required_class)
}

fn is_ecmascript_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}
