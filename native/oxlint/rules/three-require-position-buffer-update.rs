use oxc_ast::{
    AstKind,
    ast::{Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::AssignmentOperator;

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const MESSAGE: &str = "This animation loop changes position-buffer data without setting the BufferAttribute needsUpdate flag, so Three.js may keep rendering the previous GPU data";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];
const POSITION_BUFFER_MUTATION_METHOD_NAMES: [&str; 6] =
    ["setX", "setXY", "setXYZ", "setXYZW", "setY", "setZ"];
const POSITION_BUFFER_ARRAY_MUTATION_METHOD_NAMES: [&str; 3] = ["copyWithin", "fill", "set"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequirePositionBufferUpdate;

impl RuleMeta for ThreeRequirePositionBufferUpdate {
    const NAME: &'static str = "three-require-position-buffer-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require Three.js position-buffer uploads after CPU mutations.",
    };
}

impl Rule for ThreeRequirePositionBufferUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let animation_call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call) = node.kind() else {
                    return None;
                };
                let callee = call.callee.get_inner_expression();
                (callee.as_member_expression().is_some_and(|member| {
                    static_member_expression_property_name(member) == Some("setAnimationLoop")
                }) || is_global_request_animation_frame_call(call, ctx))
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        if animation_call_ids.is_empty() {
            return;
        }

        let managed_position_buffer_ref_symbol_ids = rustc_hash::FxHashSet::default();
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();

        for animation_call_id in animation_call_ids {
            let AstKind::CallExpression(call_expression) =
                ctx.nodes().get_node(animation_call_id).kind()
            else {
                continue;
            };
            let Some(callback_id) = three_position_buffer_update_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            ) else {
                continue;
            };
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) || !analyzed_callback_ids.insert(callback_id)
            {
                continue;
            }

            let mut mutation_ids = Vec::new();
            let mut seen_mutation_ids = rustc_hash::FxHashSet::default();
            let mut marks_position_buffer_for_update = false;
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, _, _| {
                    if three_position_buffer_update_is_mutation(
                        candidate,
                        &managed_position_buffer_ref_symbol_ids,
                        ctx,
                    ) && seen_mutation_ids.insert(candidate.id())
                    {
                        mutation_ids.push(candidate.id());
                    }
                    if !marks_position_buffer_for_update
                        && three_position_buffer_update_marks_for_upload(
                            candidate,
                            &managed_position_buffer_ref_symbol_ids,
                            ctx,
                        )
                    {
                        marks_position_buffer_for_update = true;
                    }
                },
            );
            if marks_position_buffer_for_update {
                continue;
            }
            for mutation_id in mutation_ids {
                ctx.diagnostic(
                    OxcDiagnostic::error(MESSAGE)
                        .with_label(ctx.nodes().get_node(mutation_id).span()),
                );
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_position_buffer_update_animation_callback_id<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    callback_renders_with_three_cache: &mut rustc_hash::FxHashMap<NodeId, bool>,
) -> Option<NodeId> {
    let callee = call_expression.callee.get_inner_expression();
    if let Some(member) = callee.as_member_expression()
        && static_member_expression_property_name(member) == Some("setAnimationLoop")
        && three_position_buffer_update_resolves_to_renderer(
            member.object(),
            analysis,
            ctx,
            &mut Vec::new(),
        )
    {
        return resolve_r3f_analyzed_callback_function_id(
            call_expression.arguments.first()?.as_expression()?,
            analysis,
            ctx,
            resolution_cache,
        );
    }

    let callback_id = resolve_analyzed_recursive_animation_frame_callback_id(
        call_expression,
        false,
        node_index,
        ctx,
        resolution_cache,
    )?;
    if let Some(&does_render) = callback_renders_with_three_cache.get(&callback_id) {
        return does_render.then_some(callback_id);
    }
    let does_render = three_position_buffer_update_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_position_buffer_update_callback_renders_with_three<'a>(
    callback_id: NodeId,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if matches!(
        ctx.nodes().get_node(callback_id).kind(),
        AstKind::Function(function) if function.generator
    ) {
        return false;
    }
    let mut does_render = false;
    for_each_analyzed_synchronous_execution_node(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
        |candidate, _, _, _| {
            if does_render {
                return;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return;
            };
            if static_member_expression_property_name(member)
                .is_some_and(|method_name| THREE_RENDER_METHOD_NAMES.contains(&method_name))
                && three_position_buffer_update_resolves_to_renderer(
                    member.object(),
                    analysis,
                    ctx,
                    &mut Vec::new(),
                )
            {
                does_render = true;
            }
        },
    );
    does_render
}

fn three_position_buffer_update_resolves_to_renderer<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        return THREE_RENDERER_NAMES.iter().any(|constructor_name| {
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
            three_position_buffer_update_resolves_to_renderer(
                initializer,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_position_buffer_update_is_mutation<'a>(
    candidate: &AstNode<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    match candidate.kind() {
        AstKind::CallExpression(call_expression) => {
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                return false;
            };
            let Some(method_name) = static_member_expression_property_name(member_expression)
            else {
                return false;
            };
            (POSITION_BUFFER_MUTATION_METHOD_NAMES.contains(&method_name)
                && three_position_buffer_update_resolves_to_attribute(
                    member_expression.object(),
                    managed_ref_symbol_ids,
                    ctx,
                    &mut Vec::new(),
                )
                && node_is_inside_repeated_execution(candidate, ctx))
                || (POSITION_BUFFER_ARRAY_MUTATION_METHOD_NAMES.contains(&method_name)
                    && three_position_buffer_update_resolves_to_array(
                        member_expression.object(),
                        managed_ref_symbol_ids,
                        ctx,
                        &mut Vec::new(),
                    ))
        }
        AstKind::AssignmentExpression(assignment_expression) => assignment_expression
            .left
            .as_member_expression()
            .or_else(|| {
                assignment_expression
                    .left
                    .get_expression()
                    .map(Expression::get_inner_expression)
                    .and_then(Expression::as_member_expression)
            })
            .is_some_and(|member_expression| {
                three_position_buffer_update_is_array_element(
                    member_expression,
                    managed_ref_symbol_ids,
                    ctx,
                ) && node_is_inside_repeated_execution(candidate, ctx)
            }),
        AstKind::UpdateExpression(update_expression) => update_expression
            .argument
            .as_member_expression()
            .or_else(|| {
                update_expression
                    .argument
                    .get_expression()
                    .map(Expression::get_inner_expression)
                    .and_then(Expression::as_member_expression)
            })
            .is_some_and(|member_expression| {
                three_position_buffer_update_is_array_element(
                    member_expression,
                    managed_ref_symbol_ids,
                    ctx,
                ) && node_is_inside_repeated_execution(candidate, ctx)
            }),
        _ => false,
    }
}

fn three_position_buffer_update_is_array_element<'a>(
    member_expression: &MemberExpression<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    matches!(
        member_expression,
        MemberExpression::ComputedMemberExpression(_)
    ) && three_position_buffer_update_resolves_to_array(
        member_expression.object(),
        managed_ref_symbol_ids,
        ctx,
        &mut Vec::new(),
    )
}

fn three_position_buffer_update_marks_for_upload<'a>(
    candidate: &AstNode<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let AstKind::AssignmentExpression(assignment_expression) = candidate.kind() else {
        return false;
    };
    if assignment_expression.operator != AssignmentOperator::Assign
        || !matches!(
            assignment_expression.right.get_inner_expression(),
            Expression::BooleanLiteral(boolean_literal) if boolean_literal.value
        )
    {
        return false;
    }
    let Some(target) = assignment_expression
        .left
        .as_member_expression()
        .or_else(|| {
            assignment_expression
                .left
                .get_expression()
                .map(Expression::get_inner_expression)
                .and_then(Expression::as_member_expression)
        })
    else {
        return false;
    };
    static_member_expression_property_name(target) == Some("needsUpdate")
        && three_position_buffer_update_resolves_to_attribute(
            target.object(),
            managed_ref_symbol_ids,
            ctx,
            &mut Vec::new(),
        )
}

fn three_position_buffer_update_resolves_to_attribute<'a>(
    expression: &Expression<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if !managed_ref_symbol_ids.is_empty()
        && three_position_buffer_update_react_ref_symbol(expression, ctx)
            .is_some_and(|symbol_id| managed_ref_symbol_ids.contains(&symbol_id))
    {
        return true;
    }
    if let Expression::CallExpression(call_expression) = expression
        && call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member_expression| {
                static_member_expression_property_name(member_expression) == Some("getAttribute")
            })
        && matches!(
            call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
                .map(Expression::get_inner_expression),
            Some(Expression::StringLiteral(literal)) if literal.value == "position"
        )
    {
        return true;
    }
    if let Some(position_member) = expression.as_member_expression()
        && static_member_expression_property_name(position_member) == Some("position")
        && position_member
            .object()
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|attributes_member| {
                static_member_expression_property_name(attributes_member) == Some("attributes")
            })
    {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some((symbol_id, initializer)) =
        three_position_buffer_update_const_identifier_initializer(identifier, ctx)
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    three_position_buffer_update_resolves_to_attribute(
        initializer,
        managed_ref_symbol_ids,
        ctx,
        visited_symbol_ids,
    )
}

fn three_position_buffer_update_resolves_to_array<'a>(
    expression: &Expression<'a>,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression()
        && static_member_expression_property_name(member_expression) == Some("array")
    {
        return three_position_buffer_update_resolves_to_attribute(
            member_expression.object(),
            managed_ref_symbol_ids,
            ctx,
            &mut Vec::new(),
        );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some((symbol_id, initializer)) =
        three_position_buffer_update_const_identifier_initializer(identifier, ctx)
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    three_position_buffer_update_resolves_to_array(
        initializer,
        managed_ref_symbol_ids,
        ctx,
        visited_symbol_ids,
    )
}

fn three_position_buffer_update_const_identifier_initializer<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, &'a Expression<'a>)> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
    {
        return None;
    }
    Some((symbol_id, declarator.init.as_ref()?))
}

fn three_position_buffer_update_react_ref_symbol<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let member_expression = expression.as_member_expression()?;
    if static_member_expression_property_name(member_expression) != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = member_expression.object().get_inner_expression()
    else {
        return None;
    };
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    three_position_buffer_update_symbol_is_react_ref(symbol_id, ctx).then_some(symbol_id)
}

fn three_position_buffer_update_symbol_is_react_ref(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    is_react_api_call(call_expression, "useRef", ctx)
        || is_react_api_call(call_expression, "createRef", ctx)
}
