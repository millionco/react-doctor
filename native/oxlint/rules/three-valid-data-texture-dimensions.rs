use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const DATA_TEXTURE_CONSTRUCTOR_NAMES: [&str; 3] =
    ["DataTexture", "Data3DTexture", "DataArrayTexture"];
const WIDTH_ARGUMENT_INDEX: usize = 1;
const HEIGHT_ARGUMENT_INDEX: usize = 2;
const DEPTH_ARGUMENT_INDEX: usize = 3;
const MINIMUM_DIMENSION_PX: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidDataTextureDimensions;

declare_oxc_lint!(
    /// Require positive integer Three.js data texture dimensions.
    ThreeValidDataTextureDimensions,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js data texture dimensions.",
);

impl Rule for ThreeValidDataTextureDimensions {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        let Some(constructor_name) =
            DATA_TEXTURE_CONSTRUCTOR_NAMES
                .iter()
                .copied()
                .find(|constructor_name| {
                    three_module_api_path_matches(&new_expression.callee, &[*constructor_name], ctx)
                })
        else {
            return;
        };
        report_invalid_data_texture_dimension(
            "width",
            new_expression.arguments.get(WIDTH_ARGUMENT_INDEX),
            ctx,
        );
        report_invalid_data_texture_dimension(
            "height",
            new_expression.arguments.get(HEIGHT_ARGUMENT_INDEX),
            ctx,
        );
        if constructor_name != "DataTexture" {
            report_invalid_data_texture_dimension(
                "depth",
                new_expression.arguments.get(DEPTH_ARGUMENT_INDEX),
                ctx,
            );
        }
    }
}

fn report_invalid_data_texture_dimension<'a>(
    dimension_name: &str,
    argument: Option<&'a oxc_ast::ast::Argument<'a>>,
    ctx: &LintContext<'a>,
) {
    let Some((expression, value)) = resolve_static_number_argument(argument, ctx) else {
        return;
    };
    if value.fract() == 0.0 && value >= MINIMUM_DIMENSION_PX {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Data texture {dimension_name} must be a positive integer, but this value is {value}"
        ))
        .with_label(expression.span()),
    );
}
