use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const CAMERA_CONSTRUCTOR_NAMES: [&str; 2] = ["OrthographicCamera", "PerspectiveCamera"];
const MESSAGE: &str = "This camera projection property changes without a later updateProjectionMatrix() call on every path, so Three.js can keep rendering a stale projection matrix";
const PROJECTION_PROPERTY_NAMES: [&str; 11] = [
    "aspect",
    "bottom",
    "far",
    "filmGauge",
    "filmOffset",
    "fov",
    "left",
    "near",
    "right",
    "top",
    "zoom",
];
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireProjectionMatrixUpdate;

impl RuleMeta for ThreeRequireProjectionMatrixUpdate {
    const NAME: &'static str = "three-require-projection-matrix-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require projection-matrix updates after Three.js camera mutations.",
    };
}

struct ThreeProjectionMutation {
    node_id: NodeId,
    receiver_key: String,
}

struct ThreeProjectionUpdate {
    node_id: NodeId,
    receiver_key: String,
}

impl Rule for ThreeRequireProjectionMatrixUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !ctx.nodes().iter().any(|node| {
            three_projection_mutation_receiver(node).is_some_and(|(_, property_name)| {
                PROJECTION_PROPERTY_NAMES.contains(&property_name)
            })
        }) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut mutations = Vec::new();
        let mut updates = Vec::new();
        for node in ctx.nodes().iter() {
            if let Some((receiver, property_name)) = three_projection_mutation_receiver(node)
                && PROJECTION_PROPERTY_NAMES.contains(&property_name)
                && three_projection_expression_resolves_to_camera(
                    receiver,
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                )
                && let Some(receiver_key) = resolve_expression_key(receiver, ctx, &mut Vec::new())
            {
                mutations.push(ThreeProjectionMutation {
                    node_id: node.id(),
                    receiver_key,
                });
                continue;
            }

            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if let Some(receiver) = three_projection_direct_update_receiver(call_expression)
                && three_projection_expression_resolves_to_camera(
                    receiver,
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                )
                && let Some(receiver_key) = resolve_expression_key(receiver, ctx, &mut Vec::new())
            {
                updates.push(ThreeProjectionUpdate {
                    node_id: node.id(),
                    receiver_key,
                });
                continue;
            }
            if !is_imported_or_stable_parameter_call(call_expression, ctx, &mut resolution_cache) {
                continue;
            }
            for argument in &call_expression.arguments {
                let Some(argument) = argument.as_expression() else {
                    continue;
                };
                if three_projection_expression_resolves_to_camera(
                    argument,
                    &analysis,
                    ctx,
                    &mut Vec::new(),
                ) && let Some(receiver_key) =
                    resolve_expression_key(argument, ctx, &mut Vec::new())
                {
                    updates.push(ThreeProjectionUpdate {
                        node_id: node.id(),
                        receiver_key,
                    });
                }
            }
        }
        if mutations.is_empty() {
            return;
        }

        let Some(program_id) = ctx
            .nodes()
            .iter()
            .find_map(|node| matches!(node.kind(), AstKind::Program(_)).then_some(node.id()))
        else {
            return;
        };
        for mutation in mutations {
            if three_projection_update_covers_mutation(&mutation, &updates, program_id, ctx) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(MESSAGE)
                    .with_label(ctx.nodes().get_node(mutation.node_id).span()),
            );
        }
    }
}

fn three_projection_mutation_receiver<'a, 'node>(
    node: &'node crate::AstNode<'a>,
) -> Option<(&'node Expression<'a>, &'node str)> {
    let member_expression = match node.kind() {
        AstKind::AssignmentExpression(assignment) => {
            assignment.left.as_member_expression().or_else(|| {
                assignment
                    .left
                    .get_expression()?
                    .get_inner_expression()
                    .as_member_expression()
            })?
        }
        AstKind::UpdateExpression(update) => {
            update.argument.as_member_expression().or_else(|| {
                update
                    .argument
                    .get_expression()?
                    .get_inner_expression()
                    .as_member_expression()
            })?
        }
        _ => return None,
    };
    Some((
        member_expression.object(),
        static_member_expression_property_name(member_expression)?,
    ))
}

fn three_projection_direct_update_receiver<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a Expression<'a>> {
    let member_expression = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    (static_member_expression_property_name(member_expression) == Some("updateProjectionMatrix"))
        .then(|| member_expression.object())
}

fn three_projection_expression_resolves_to_camera<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return CAMERA_CONSTRUCTOR_NAMES.iter().any(|constructor_name| {
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
    let Some(symbol_id) = identifier_symbol_id_with_lexical_fallback(identifier, ctx) else {
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
            three_projection_expression_resolves_to_camera(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_projection_update_covers_mutation<'a>(
    mutation: &ThreeProjectionMutation,
    updates: &[ThreeProjectionUpdate],
    program_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let mutation_node = ctx.nodes().get_node(mutation.node_id);
    let owner_id =
        crate::ast_util::get_enclosing_function(mutation_node, ctx).map(crate::AstNode::id);
    let matching_update_nodes = updates
        .iter()
        .filter(|update| update.receiver_key == mutation.receiver_key)
        .filter_map(|update| {
            let update_node = ctx.nodes().get_node(update.node_id);
            (crate::ast_util::get_enclosing_function(update_node, ctx).map(crate::AstNode::id)
                == owner_id)
                .then_some(update_node)
        })
        .collect::<Vec<_>>();
    if let Some(owner_id) = owner_id {
        return do_nodes_cover_every_path_after_node(
            mutation_node,
            &matching_update_nodes,
            ctx.nodes().get_node(owner_id),
            ctx,
        );
    }
    matching_update_nodes.into_iter().any(|update_node| {
        three_projection_module_update_covers_mutation(mutation_node, update_node, program_id, ctx)
    })
}

fn three_projection_module_update_covers_mutation(
    mutation: &crate::AstNode<'_>,
    update: &crate::AstNode<'_>,
    program_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if update.span().start <= mutation.span().start {
        return false;
    }
    if !is_node_conditionally_executed(update, program_id, ctx) {
        return true;
    }
    let mutation_regions =
        three_projection_conditional_execution_regions(mutation, program_id, ctx);
    three_projection_conditional_execution_regions(update, program_id, ctx)
        .iter()
        .all(|region_id| mutation_regions.contains(region_id))
}

fn three_projection_conditional_execution_regions(
    node: &crate::AstNode<'_>,
    boundary_id: NodeId,
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<NodeId> {
    let mut regions = rustc_hash::FxHashSet::default();
    let mut child_span = node.span();
    let mut child_id = node.id();
    for parent in ctx.nodes().ancestors(node.id()) {
        if parent.id() == boundary_id {
            break;
        }
        let region_id = match parent.kind() {
            AstKind::IfStatement(statement) if statement.test.span() != child_span => {
                Some(child_id)
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.span() == child_span
                    || expression.alternate.span() == child_span =>
            {
                Some(child_id)
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == child_span => {
                Some(child_id)
            }
            AstKind::AssignmentPattern(pattern) if pattern.right.span() == child_span => {
                Some(child_id)
            }
            AstKind::SwitchCase(_) => Some(parent.id()),
            _ => None,
        };
        if let Some(region_id) = region_id {
            regions.insert(region_id);
        }
        child_span = parent.span();
        child_id = parent.id();
    }
    regions
}
