use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const GPU_COMPUTATION_WIDTH_ARGUMENT_INDEX: usize = 0;
const GPU_COMPUTATION_HEIGHT_ARGUMENT_INDEX: usize = 1;
const MINIMUM_GPU_COMPUTATION_DIMENSION_PX: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidGpuComputationDimensions;

declare_oxc_lint!(
    /// Require positive integer GPU computation texture dimensions.
    ThreeValidGpuComputationDimensions,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate GPU computation texture dimensions.",
);

impl Rule for ThreeValidGpuComputationDimensions {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        if !three_module_api_path_matches(&new_expression.callee, &["GPUComputationRenderer"], ctx)
        {
            return;
        }
        report_invalid_gpu_computation_dimension(
            "width",
            new_expression
                .arguments
                .get(GPU_COMPUTATION_WIDTH_ARGUMENT_INDEX),
            ctx,
        );
        report_invalid_gpu_computation_dimension(
            "height",
            new_expression
                .arguments
                .get(GPU_COMPUTATION_HEIGHT_ARGUMENT_INDEX),
            ctx,
        );
    }
}

fn report_invalid_gpu_computation_dimension<'a>(
    dimension_name: &str,
    argument: Option<&'a oxc_ast::ast::Argument<'a>>,
    ctx: &LintContext<'a>,
) {
    let Some((expression, dimension)) = resolve_static_number_argument(argument, ctx) else {
        return;
    };
    if dimension.fract() == 0.0 && dimension >= MINIMUM_GPU_COMPUTATION_DIMENSION_PX {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "GPUComputationRenderer {dimension_name} must be a positive integer, but this value is {dimension}"
        ))
        .with_label(expression.span()),
    );
}
