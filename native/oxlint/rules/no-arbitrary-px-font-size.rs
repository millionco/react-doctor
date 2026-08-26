use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ROOT_FONT_SIZE_PX: f64 = 16.0;

#[derive(Debug, Default, Clone)]
pub struct NoArbitraryPxFontSize;

declare_oxc_lint!(
    /// Disallow pixel-based arbitrary Tailwind font sizes.
    NoArbitraryPxFontSize,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow pixel-based arbitrary font sizes.",
);

impl Rule for NoArbitraryPxFontSize {
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
        for token in tailwind_class_name_tokens(class_name) {
            let Some(pixels) = parse_arbitrary_px_font_size(token.utility) else {
                continue;
            };
            if pixels == 0.0 {
                continue;
            }
            let rem = pixels / ROOT_FONT_SIZE_PX;
            let rem_text = format_javascript_number(rem);
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "`{}` doesn't scale with the user's font-size preference — use rem, e.g. `text-[{}rem]{}`.",
                    token.utility,
                    rem_text,
                    arbitrary_font_size_line_height_suffix(token.utility)
                ))
                .with_label(opening_element.span),
            );
        }
    }
}

fn parse_arbitrary_px_font_size(utility: &str) -> Option<f64> {
    let prefix = utility.get(..6)?;
    if !prefix.eq_ignore_ascii_case("text-[") {
        return None;
    }
    let remainder = &utility[6..];
    let closing_bracket_index = remainder.find(']')?;
    let content = &remainder[..closing_bracket_index];
    let suffix = &remainder[closing_bracket_index + 1..];
    if !suffix.is_empty() && (!suffix.starts_with('/') || suffix.len() == 1) {
        return None;
    }
    let numeric_value_with_unit = content
        .get(..7)
        .filter(|prefix| prefix.eq_ignore_ascii_case("length:"))
        .map_or(content, |_| &content[7..]);
    let unit_start = numeric_value_with_unit.len().checked_sub(2)?;
    if !numeric_value_with_unit
        .get(unit_start..)?
        .eq_ignore_ascii_case("px")
    {
        return None;
    }
    let numeric_value = numeric_value_with_unit.get(..unit_start)?;
    if !is_unsigned_decimal(numeric_value) {
        return None;
    }
    numeric_value.parse().ok()
}

fn arbitrary_font_size_line_height_suffix(utility: &str) -> &str {
    utility.find(']').map_or("", |closing_bracket_index| {
        &utility[closing_bracket_index + 1..]
    })
}

fn is_unsigned_decimal(value: &str) -> bool {
    let Some((integer, fraction)) = value.split_once('.') else {
        return !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    };
    if fraction.contains('.') || (integer.is_empty() && fraction.is_empty()) {
        return false;
    }
    (integer.is_empty() || integer.bytes().all(|byte| byte.is_ascii_digit()))
        && (fraction.is_empty() || fraction.bytes().all(|byte| byte.is_ascii_digit()))
        && (!integer.is_empty() || !fraction.is_empty())
}
