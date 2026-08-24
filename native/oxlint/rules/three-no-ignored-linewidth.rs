use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const GPU_LINE_MATERIAL_NAMES: [&str; 2] = ["LineBasicMaterial", "LineDashedMaterial"];
const GPU_LINE_WIDTH_PX: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeNoIgnoredLinewidth;

declare_oxc_lint!(
    /// Disallow line widths ignored by Three.js GPU renderers.
    ThreeNoIgnoredLinewidth,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow ignored Three.js line widths.",
);

impl Rule for ThreeNoIgnoredLinewidth {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::NewExpression(new_expression)
                if GPU_LINE_MATERIAL_NAMES.iter().any(|constructor_name| {
                    three_module_api_path_matches(&new_expression.callee, &[*constructor_name], ctx)
                }) =>
            {
                let Some(parameters) = new_expression
                    .arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                else {
                    return;
                };
                if let Some(line_width) = get_static_object_property_value(parameters, "linewidth")
                {
                    report_ignored_line_width(line_width, ctx);
                }
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.operator == AssignmentOperator::Assign =>
            {
                let Some(member_expression) = assignment.left.as_member_expression() else {
                    return;
                };
                if member_expression.static_property_name() != Some("linewidth")
                    || three_constructor_name(
                        member_expression.object(),
                        &GPU_LINE_MATERIAL_NAMES,
                        ctx,
                    )
                    .is_none()
                {
                    return;
                }
                report_ignored_line_width(&assignment.right, ctx);
            }
            _ => {}
        }
    }
}

fn report_ignored_line_width<'a>(expression: &oxc_ast::ast::Expression<'a>, ctx: &LintContext<'a>) {
    let Some(line_width) = resolve_static_number(expression, ctx) else {
        return;
    };
    if line_width == GPU_LINE_WIDTH_PX {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "linewidth {line_width} is ignored by Three.js WebGL and WebGPU renderers, which render line primitives one pixel wide"
        ))
        .with_label(expression.span()),
    );
}
