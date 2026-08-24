use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const INCOMPATIBLE_OBJECT_NAMES: [&str; 2] = ["InstancedMesh", "SkinnedMesh"];
const MESSAGE: &str = "WebGPURenderer highPrecision uses CPU 64-bit matrices that Three.js does not support with InstancedMesh or SkinnedMesh objects rendered by this renderer";

#[derive(Debug, Default, Clone)]
pub struct ThreeWebgpuNoHighPrecisionInstancing;

declare_oxc_lint!(
    /// Disallow WebGPU high precision with instanced or skinned meshes.
    ThreeWebgpuNoHighPrecisionInstancing,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow incompatible WebGPU high-precision rendering.",
);

impl Rule for ThreeWebgpuNoHighPrecisionInstancing {
    fn run_once(&self, ctx: &LintContext<'_>) {
        if !has_capability_or_unspecified(ctx, "three:181") {
            return;
        }
        let mut assignments = Vec::new();
        let mut incompatible_root_symbol_ids = FxHashSet::default();
        let mut renders = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(assignment)
                    if assignment.operator == AssignmentOperator::Assign =>
                {
                    let Some(member_expression) = assignment.left.as_member_expression() else {
                        continue;
                    };
                    if member_expression.static_property_name() != Some("highPrecision")
                        || !matches!(
                            assignment.right.get_inner_expression(),
                            oxc_ast::ast::Expression::BooleanLiteral(value) if value.value
                        )
                        || three_constructor_api_name(member_expression.object(), ctx).as_deref()
                            != Some("WebGPURenderer")
                    {
                        continue;
                    }
                    let Some(renderer_symbol_id) =
                        resolve_stable_identifier_symbol(member_expression.object(), ctx)
                    else {
                        continue;
                    };
                    assignments.push((renderer_symbol_id, node.span()));
                }
                AstKind::CallExpression(call_expression) => {
                    let Some(member_expression) = call_expression.callee.as_member_expression()
                    else {
                        continue;
                    };
                    match member_expression.static_property_name() {
                        Some("add")
                            if three_constructor_api_name(member_expression.object(), ctx)
                                .as_deref()
                                == Some("Scene") =>
                        {
                            let Some(root_symbol_id) =
                                resolve_stable_identifier_symbol(member_expression.object(), ctx)
                            else {
                                continue;
                            };
                            if call_expression.arguments.iter().any(|argument| {
                                argument.as_expression().is_some_and(|expression| {
                                    three_constructor_api_name(expression, ctx).is_some_and(
                                        |constructor_name| {
                                            INCOMPATIBLE_OBJECT_NAMES
                                                .contains(&constructor_name.as_str())
                                        },
                                    )
                                })
                            }) {
                                incompatible_root_symbol_ids.insert(root_symbol_id);
                            }
                        }
                        Some("render")
                            if three_constructor_api_name(member_expression.object(), ctx)
                                .as_deref()
                                == Some("WebGPURenderer") =>
                        {
                            let Some(renderer_symbol_id) =
                                resolve_stable_identifier_symbol(member_expression.object(), ctx)
                            else {
                                continue;
                            };
                            let Some(rendered_root) = call_expression
                                .arguments
                                .first()
                                .and_then(oxc_ast::ast::Argument::as_expression)
                            else {
                                continue;
                            };
                            let Some(root_symbol_id) =
                                resolve_stable_identifier_symbol(rendered_root, ctx)
                            else {
                                continue;
                            };
                            if three_constructor_api_name(rendered_root, ctx).is_some_and(
                                |constructor_name| {
                                    INCOMPATIBLE_OBJECT_NAMES.contains(&constructor_name.as_str())
                                },
                            ) {
                                incompatible_root_symbol_ids.insert(root_symbol_id);
                            }
                            renders.push((renderer_symbol_id, root_symbol_id, node.span().start));
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        for (renderer_symbol_id, assignment_span) in assignments {
            let has_incompatible_render = renders.iter().any(
                |(render_renderer_symbol_id, root_symbol_id, render_start)| {
                    *render_renderer_symbol_id == renderer_symbol_id
                        && assignment_span.start < *render_start
                        && incompatible_root_symbol_ids.contains(root_symbol_id)
                },
            );
            if has_incompatible_render {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(assignment_span));
            }
        }
    }
}
