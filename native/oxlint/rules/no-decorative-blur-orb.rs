use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const DECORATIVE_BLUR_ORB_MIN_BLUR_PX: f64 = 24.0;
const MESSAGE: &str = "This empty, positioned, heavily blurred color circle is generic decorative scaffolding. Replace it with a visual tied to the product or simplify the background.";

#[derive(Debug, Default, Clone)]
pub struct NoDecorativeBlurOrb;

declare_oxc_lint!(
    /// Disallow empty, positioned, heavily blurred color circles.
    NoDecorativeBlurOrb,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow decorative blurred color orbs.",
);

impl Rule for NoDecorativeBlurOrb {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let element_name = match &element.opening_element.name {
            oxc_ast::ast::JSXElementName::Identifier(identifier) => identifier.name.as_str(),
            _ => return,
        };
        if !matches!(element_name, "div" | "span")
            || !element.children.iter().all(|child| {
                matches!(
                    child,
                    oxc_ast::ast::JSXChild::Text(text)
                        if text.value.chars().all(is_js_whitespace)
                )
            })
        {
            return;
        }
        let Some(class_name) = get_static_class_name(&element.opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        let utilities = tokens
            .iter()
            .filter(|token| token.variants.is_empty())
            .map(|token| token.utility)
            .collect::<Vec<_>>();
        if !utilities
            .iter()
            .any(|utility| matches!(*utility, "absolute" | "fixed"))
            || !utilities.contains(&"rounded-full")
            || !utilities.iter().any(|utility| has_strong_blur(utility))
            || !has_visible_tailwind_background(&utilities)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn has_strong_blur(utility: &str) -> bool {
    if matches!(utility, "blur-2xl" | "blur-3xl") {
        return true;
    }
    let Some(value) = utility
        .strip_prefix("blur-[")
        .and_then(|value| value.strip_suffix("px]"))
    else {
        return false;
    };
    !value.is_empty()
        && value
            .chars()
            .all(|character| character.is_ascii_digit() || character == '.')
        && parse_javascript_unsigned_decimal_prefix(value)
            .is_some_and(|value| value >= DECORATIVE_BLUR_ORB_MIN_BLUR_PX)
}

fn parse_javascript_unsigned_decimal_prefix(value: &str) -> Option<f64> {
    let mut parsed_value = 0.0;
    let mut decimal_divisor = 1.0;
    let mut has_decimal_point = false;
    let mut has_digit = false;
    for character in value.chars() {
        if character == '.' {
            if has_decimal_point {
                break;
            }
            has_decimal_point = true;
            continue;
        }
        let digit = character.to_digit(10)?;
        has_digit = true;
        if has_decimal_point {
            decimal_divisor *= 10.0;
            parsed_value += f64::from(digit) / decimal_divisor;
        } else {
            parsed_value = parsed_value * 10.0 + f64::from(digit);
        }
    }
    has_digit.then_some(parsed_value)
}
