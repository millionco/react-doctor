use oxc_ast::{
    AstKind,
    ast::{AssignmentExpression, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This texture wrapping changes after the texture has rendered without setting texture.needsUpdate to true on every path, so the GPU sampler can remain stale";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_TEXTURE_NAMES: [&str; 9] = [
    "CanvasTexture",
    "CompressedTexture",
    "Data3DTexture",
    "DataArrayTexture",
    "DataTexture",
    "DepthTexture",
    "FramebufferTexture",
    "Texture",
    "VideoTexture",
];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireTextureUpdateAfterWrappingChange;

impl RuleMeta for ThreeRequireTextureUpdateAfterWrappingChange {
    const NAME: &'static str = "three-require-texture-update-after-wrapping-change";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require texture uploads after post-render wrapping changes.",
    };
}

struct ThreeTextureWrappingMutation {
    node_id: NodeId,
    owner_id: NodeId,
    texture_key: String,
}

struct ThreeTextureUpload {
    node_id: NodeId,
    owner_id: NodeId,
    texture_key: String,
}

struct ThreeRendererRenderCall {
    node_id: NodeId,
    owner_id: NodeId,
}

impl Rule for ThreeRequireTextureUpdateAfterWrappingChange {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let Some(program_id) = ctx
            .nodes()
            .iter()
            .find_map(|node| matches!(node.kind(), AstKind::Program(_)).then_some(node.id()))
        else {
            return;
        };
        let mut assignment_candidate_ids = Vec::new();
        let mut render_call_candidate_ids = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(assignment)
                    if assignment.operator == AssignmentOperator::Assign
                        && three_texture_update_assignment_target(assignment).is_some_and(
                            |target| {
                                matches!(
                                    static_member_expression_property_name(target),
                                    Some("wrapS" | "wrapT" | "needsUpdate")
                                )
                            },
                        ) =>
                {
                    assignment_candidate_ids.push(node.id());
                }
                AstKind::CallExpression(call_expression)
                    if call_expression
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                        .is_some_and(|callee| {
                            static_member_expression_property_name(callee) == Some("render")
                        }) =>
                {
                    render_call_candidate_ids.push(node.id());
                }
                _ => {}
            }
        }
        if assignment_candidate_ids.is_empty() || render_call_candidate_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut mutations = Vec::new();
        let mut uploads = Vec::new();
        for candidate_id in assignment_candidate_ids {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                continue;
            };
            let Some(target) = three_texture_update_assignment_target(assignment) else {
                continue;
            };
            if !three_texture_update_constructor_matches(
                target.object(),
                &THREE_TEXTURE_NAMES,
                &analysis,
                ctx,
                &mut Vec::new(),
            ) {
                continue;
            }
            let Some(texture_key) = resolve_expression_key(target.object(), ctx, &mut Vec::new())
            else {
                continue;
            };
            let owner_id = crate::ast_util::get_enclosing_function(candidate, ctx)
                .map_or(program_id, crate::AstNode::id);
            match static_member_expression_property_name(target) {
                Some("wrapS" | "wrapT") => mutations.push(ThreeTextureWrappingMutation {
                    node_id: candidate.id(),
                    owner_id,
                    texture_key,
                }),
                Some("needsUpdate")
                    if matches!(
                        assignment.right.get_inner_expression(),
                        Expression::BooleanLiteral(literal) if literal.value
                    ) =>
                {
                    uploads.push(ThreeTextureUpload {
                        node_id: candidate.id(),
                        owner_id,
                        texture_key,
                    });
                }
                _ => {}
            }
        }

        let render_calls = render_call_candidate_ids
            .into_iter()
            .filter_map(|candidate_id| {
                let candidate = ctx.nodes().get_node(candidate_id);
                let AstKind::CallExpression(call_expression) = candidate.kind() else {
                    return None;
                };
                let callee = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()?;
                three_texture_update_constructor_matches(
                    callee.object(),
                    &THREE_RENDERER_NAMES,
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                )
                .then(|| ThreeRendererRenderCall {
                    node_id: candidate.id(),
                    owner_id: crate::ast_util::get_enclosing_function(candidate, ctx)
                        .map_or(program_id, crate::AstNode::id),
                })
            })
            .collect::<Vec<_>>();
        if render_calls.is_empty() {
            return;
        }

        for mutation in mutations {
            let mutation_node = ctx.nodes().get_node(mutation.node_id);
            let mutation_start = mutation_node.span().start;
            let has_prior_render = render_calls.iter().any(|render_call| {
                render_call.owner_id == mutation.owner_id
                    && ctx.nodes().get_node(render_call.node_id).span().start < mutation_start
            });
            if !has_prior_render {
                continue;
            }
            let matching_upload_nodes = uploads
                .iter()
                .filter(|upload| {
                    upload.texture_key == mutation.texture_key
                        && upload.owner_id == mutation.owner_id
                })
                .map(|upload| ctx.nodes().get_node(upload.node_id))
                .collect::<Vec<_>>();
            let upload_covers_mutation = if mutation.owner_id == program_id {
                three_texture_update_program_has_unconditional_later_upload(
                    mutation_node,
                    &matching_upload_nodes,
                    program_id,
                    ctx,
                )
            } else {
                do_nodes_cover_every_path_after_node(
                    mutation_node,
                    &matching_upload_nodes,
                    ctx.nodes().get_node(mutation.owner_id),
                    ctx,
                )
            };
            if !upload_covers_mutation {
                ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(mutation_node.span()));
            }
        }
    }
}

fn three_texture_update_program_has_unconditional_later_upload<'a>(
    mutation_node: &crate::AstNode<'a>,
    matching_upload_nodes: &[&crate::AstNode<'a>],
    program_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let mutation_start = mutation_node.span().start;
    matching_upload_nodes.iter().any(|upload_node| {
        upload_node.span().start > mutation_start
            && !is_node_conditionally_executed(upload_node, program_id, ctx)
    })
}

fn three_texture_update_assignment_target<'a, 'b>(
    assignment: &'b AssignmentExpression<'a>,
) -> Option<&'b MemberExpression<'a>> {
    assignment.left.as_member_expression().or_else(|| {
        assignment
            .left
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })
}

fn three_texture_update_constructor_matches<'a>(
    expression: &Expression<'a>,
    expected_names: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return expected_names.iter().any(|constructor_name| {
            module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_MODULES,
                analysis,
                ctx,
            ) || type_import_module_api_reference_matches(
                &allocation.callee,
                constructor_name,
                &THREE_MODULES,
                analysis,
                ctx,
            )
        });
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) && declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            three_texture_update_constructor_matches(
                initializer,
                expected_names,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}
