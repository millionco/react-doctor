use oxc_ast::{
    AstKind,
    ast::{JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MIN_OVERPRECISE_SVG_TOKEN_OCCURRENCES: usize = 2;
const SVG_PATH_ATTRIBUTES: [&str; 3] = ["d", "points", "transform"];
const AUTO_GENERATED_PATH_SEGMENTS: [&str; 5] = [
    "/__generated__/",
    "/generated/",
    "/codegen/",
    "/figma-export/",
    "/sketch-export/",
];

#[derive(Debug, Default, Clone)]
pub struct RenderingSvgPrecision;

declare_oxc_lint!(
    /// Warns when static SVG attributes contain invisible numeric precision.
    RenderingSvgPrecision,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when static SVG attributes contain invisible numeric precision.",
);

impl Rule for RenderingSvgPrecision {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        if is_test_noise_file(ctx) {
            return false;
        }
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        !AUTO_GENERATED_PATH_SEGMENTS
            .iter()
            .any(|segment| filename.contains(segment))
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        for node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = node.kind() else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if !SVG_PATH_ATTRIBUTES.contains(&attribute_name.name.as_str()) {
                continue;
            }
            let Some(JSXAttributeValue::StringLiteral(value)) = &attribute.value else {
                continue;
            };
            if count_high_precision_tokens(value.value.as_str())
                < MIN_OVERPRECISE_SVG_TOKEN_OCCURRENCES
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users download extra bytes for SVG {} precision they can't see, so round it to 1 or 2 decimals.",
                    attribute_name.name
                ))
                .with_label(attribute.span),
            );
            return;
        }
    }
}

fn count_high_precision_tokens(value: &str) -> usize {
    let bytes = value.as_bytes();
    let mut index = 0;
    let mut count = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if index >= bytes.len() || bytes[index] != b'.' {
            continue;
        }
        index += 1;
        let decimal_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        let decimals = &bytes[decimal_start..index];
        if decimals.len() >= 4
            && decimals[2..]
                .iter()
                .any(|digit| matches!(digit, b'1'..=b'9'))
        {
            count += 1;
        }
    }
    count
}
