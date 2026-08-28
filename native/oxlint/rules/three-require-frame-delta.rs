use oxc_ast::{
    AstKind,
    ast::{CallExpression, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const UPDATE_MESSAGE: &str = "This transform changes by a fixed amount per frame, so animation speed depends on refresh rate. Use a Three.js Clock delta instead of an update operator";
const ASSIGNMENT_MESSAGE: &str = "This transform changes by a fixed amount per frame, so animation speed depends on refresh rate. Multiply the increment by Clock.getDelta()";
const INTERPOLATION_MESSAGE: &str = "This fixed interpolation factor converges once per frame, so its speed changes with refresh rate. Derive the factor from Clock.getDelta() or use delta-aware damping";
const THREE_MODULES: [&str; 3] = ["three", "three-stdlib", "three/"];
const THREE_MATH_UTILS_MODULES: [&str; 1] = ["three"];
const THREE_RENDERER_NAMES: [&str; 2] = ["WebGLRenderer", "WebGPURenderer"];
const THREE_RENDER_METHOD_NAMES: [&str; 2] = ["render", "renderAsync"];
const THREE_TRANSFORM_PROPERTY_NAMES: [&str; 4] = ["position", "quaternion", "rotation", "scale"];

#[derive(Debug, Default, Clone)]
pub struct ThreeRequireFrameDelta;

struct ThreeFrameDeltaExpressionCandidateIndex {
    node_ids_by_start: Vec<NodeId>,
}

impl ThreeFrameDeltaExpressionCandidateIndex {
    fn new(ctx: &LintContext<'_>) -> Self {
        let mut node_ids_by_start = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(
                    node.kind(),
                    AstKind::CallExpression(_) | AstKind::IdentifierReference(_)
                )
                .then_some(node.id())
            })
            .collect::<Vec<_>>();
        node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        Self { node_ids_by_start }
    }
}

impl RuleMeta for ThreeRequireFrameDelta {
    const NAME: &'static str = "three-require-frame-delta";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require frame-rate-independent Three.js animation updates.",
    };
}

impl Rule for ThreeRequireFrameDelta {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut has_candidate = false;
        let mut animation_call_ids = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::UpdateExpression(_) => has_candidate = true,
                AstKind::AssignmentExpression(assignment) => {
                    has_candidate |= matches!(
                        assignment.operator,
                        oxc_syntax::operator::AssignmentOperator::Addition
                            | oxc_syntax::operator::AssignmentOperator::Subtraction
                    );
                }
                AstKind::CallExpression(call) => {
                    let is_set_animation_loop = call
                        .callee
                        .get_inner_expression()
                        .as_member_expression()
                        .is_some_and(|member| {
                            static_member_expression_property_name(member)
                                == Some("setAnimationLoop")
                        });
                    if is_set_animation_loop || is_global_request_animation_frame_call(call, ctx) {
                        animation_call_ids.push(node.id());
                    }
                    has_candidate |= call
                        .callee
                        .as_member_expression()
                        .and_then(static_member_expression_property_name)
                        .is_some_and(|method_name| {
                            three_frame_delta_interpolation_factor_index(method_name).is_some()
                        });
                }
                _ => {}
            }
        }
        if !has_candidate || animation_call_ids.is_empty() {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut expression_candidate_index = None;
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut analyzed_callback_ids = rustc_hash::FxHashSet::default();
        let mut callback_renders_with_three_cache = rustc_hash::FxHashMap::default();

        for animation_call_id in animation_call_ids {
            let AstKind::CallExpression(call_expression) =
                ctx.nodes().get_node(animation_call_id).kind()
            else {
                continue;
            };
            let Some(callback_id) = three_frame_delta_animation_callback_id(
                call_expression,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                &mut callback_renders_with_three_cache,
            ) else {
                continue;
            };
            if !analyzed_callback_ids.insert(callback_id)
                || matches!(
                    ctx.nodes().get_node(callback_id).kind(),
                    AstKind::Function(function) if function.generator
                )
            {
                continue;
            }
            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate, _, is_conditionally_executed, _| {
                    if is_conditionally_executed {
                        return;
                    }
                    match candidate.kind() {
                        AstKind::UpdateExpression(update) => {
                            let Some(member) =
                                update.argument.as_member_expression().or_else(|| {
                                    update
                                        .argument
                                        .get_expression()?
                                        .get_inner_expression()
                                        .as_member_expression()
                                })
                            else {
                                return;
                            };
                            if three_frame_delta_is_transform_member(member, &analysis, ctx) {
                                ctx.diagnostic(
                                    OxcDiagnostic::warn(UPDATE_MESSAGE)
                                        .with_label(candidate.span()),
                                );
                            }
                        }
                        AstKind::AssignmentExpression(assignment) => {
                            if !matches!(
                                assignment.operator,
                                oxc_syntax::operator::AssignmentOperator::Addition
                                    | oxc_syntax::operator::AssignmentOperator::Subtraction
                            ) {
                                return;
                            }
                            let Some(member) =
                                assignment.left.as_member_expression().or_else(|| {
                                    assignment
                                        .left
                                        .get_expression()?
                                        .get_inner_expression()
                                        .as_member_expression()
                                })
                            else {
                                return;
                            };
                            if three_frame_delta_is_transform_member(member, &analysis, ctx)
                                && !three_frame_delta_expression_uses_clock_delta(
                                    &assignment.right,
                                    &analysis,
                                    &*expression_candidate_index.get_or_insert_with(|| {
                                        ThreeFrameDeltaExpressionCandidateIndex::new(ctx)
                                    }),
                                    ctx,
                                    &mut Vec::new(),
                                )
                            {
                                ctx.diagnostic(
                                    OxcDiagnostic::warn(ASSIGNMENT_MESSAGE)
                                        .with_label(candidate.span()),
                                );
                            }
                        }
                        AstKind::CallExpression(call) => {
                            let Some(factor) =
                                three_frame_delta_fixed_interpolation_factor(call, &analysis, ctx)
                            else {
                                return;
                            };
                            if !three_frame_delta_expression_uses_clock_delta(
                                factor,
                                &analysis,
                                &*expression_candidate_index.get_or_insert_with(|| {
                                    ThreeFrameDeltaExpressionCandidateIndex::new(ctx)
                                }),
                                ctx,
                                &mut Vec::new(),
                            ) {
                                ctx.diagnostic(
                                    OxcDiagnostic::warn(INTERPOLATION_MESSAGE)
                                        .with_label(factor.span()),
                                );
                            }
                        }
                        _ => {}
                    }
                },
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn three_frame_delta_animation_callback_id<'a>(
    call_expression: &CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
    callback_renders_with_three_cache: &mut rustc_hash::FxHashMap<NodeId, bool>,
) -> Option<NodeId> {
    let callee = call_expression.callee.get_inner_expression();
    if let Some(member) = callee.as_member_expression()
        && static_member_expression_property_name(member) == Some("setAnimationLoop")
        && three_frame_delta_expression_resolves_to_constructor(
            member.object(),
            &THREE_RENDERER_NAMES,
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
    let does_render = three_frame_delta_callback_renders_with_three(
        callback_id,
        analysis,
        node_index,
        ctx,
        resolution_cache,
    );
    callback_renders_with_three_cache.insert(callback_id, does_render);
    does_render.then_some(callback_id)
}

fn three_frame_delta_callback_renders_with_three<'a>(
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
                && three_frame_delta_expression_resolves_to_constructor(
                    member.object(),
                    &THREE_RENDERER_NAMES,
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

fn three_frame_delta_is_transform_member<'a>(
    member: &MemberExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let mut has_transform_property = static_member_expression_property_name(member)
        .is_some_and(|property_name| THREE_TRANSFORM_PROPERTY_NAMES.contains(&property_name));
    let mut root = member.object().get_inner_expression();
    while let Some(current_member) = root.as_member_expression() {
        if static_member_expression_property_name(current_member)
            .is_some_and(|property_name| THREE_TRANSFORM_PROPERTY_NAMES.contains(&property_name))
        {
            has_transform_property = true;
        }
        root = current_member.object().get_inner_expression();
    }
    has_transform_property
        && three_frame_delta_expression_resolves_to_constructor(
            root,
            &[],
            analysis,
            ctx,
            &mut Vec::new(),
        )
}

fn three_frame_delta_fixed_interpolation_factor<'a>(
    call: &'a CallExpression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let member = call.callee.as_member_expression()?;
    let method_name = static_member_expression_property_name(member)?;
    let factor_index = if method_name == "lerp"
        && (module_api_reference_matches(
            member.object(),
            "MathUtils",
            &THREE_MATH_UTILS_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            member.object(),
            "MathUtils",
            &THREE_MATH_UTILS_MODULES,
            analysis,
            ctx,
        )) {
        2
    } else if three_frame_delta_has_three_object_provenance(member.object(), analysis, ctx) {
        three_frame_delta_interpolation_factor_index(method_name)?
    } else {
        return None;
    };
    let factor = call.arguments.get(factor_index)?.as_expression()?;
    resolve_static_number(factor, ctx)
        .is_some_and(|value| value > 0.0 && value < 1.0)
        .then_some(factor)
}

fn three_frame_delta_interpolation_factor_index(method_name: &str) -> Option<usize> {
    match method_name {
        "lerp" | "lerpHSL" | "slerp" => Some(1),
        "lerpColors" | "lerpVectors" | "slerpQuaternions" => Some(2),
        _ => None,
    }
}

fn three_frame_delta_has_three_object_provenance<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    let mut root = expression.get_inner_expression();
    while let Some(member) = root.as_member_expression() {
        root = member.object().get_inner_expression();
    }
    three_frame_delta_expression_resolves_to_constructor(root, &[], analysis, ctx, &mut Vec::new())
}

fn three_frame_delta_expression_uses_clock_delta<'a>(
    expression: &Expression<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    expression_candidate_index: &ThreeFrameDeltaExpressionCandidateIndex,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression_id = expression.node_id();
    let expression_span = expression.span();
    let first_candidate_index = expression_candidate_index
        .node_ids_by_start
        .partition_point(|node_id| {
            ctx.nodes().get_node(*node_id).span().start < expression_span.start
        });
    for candidate_id in &expression_candidate_index.node_ids_by_start[first_candidate_index..] {
        let candidate = ctx.nodes().get_node(*candidate_id);
        let candidate_span = candidate.span();
        if candidate_span.start > expression_span.end {
            break;
        }
        if !expression_span.contains_inclusive(candidate_span)
            || !three_frame_delta_node_is_descendant_or_same(candidate.id(), expression_id, ctx)
        {
            continue;
        }
        if let AstKind::CallExpression(call) = candidate.kind()
            && let Some(member) = call.callee.as_member_expression()
            && static_member_expression_property_name(member) == Some("getDelta")
            && three_frame_delta_expression_resolves_to_constructor(
                member.object(),
                &["Clock"],
                analysis,
                ctx,
                &mut Vec::new(),
            )
        {
            return true;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        if visited_symbol_ids.contains(&symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| !reference.is_read() || reference.is_write())
        {
            continue;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            continue;
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            continue;
        }
        let Some(initializer) = binding_pattern_initializer_for_symbol(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        ) else {
            continue;
        };
        visited_symbol_ids.push(symbol_id);
        if three_frame_delta_expression_uses_clock_delta(
            initializer,
            analysis,
            expression_candidate_index,
            ctx,
            visited_symbol_ids,
        ) {
            return true;
        }
    }
    false
}

fn three_frame_delta_node_is_descendant_or_same(
    inner_id: NodeId,
    outer_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    inner_id == outer_id
        || ctx
            .nodes()
            .ancestors(inner_id)
            .any(|node| node.id() == outer_id)
}

fn three_frame_delta_expression_resolves_to_constructor<'a>(
    expression: &Expression<'a>,
    expected_names: &[&str],
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::NewExpression(allocation) = expression {
        let Some(constructor_name) =
            three_frame_delta_candidate_api_name(&allocation.callee, ctx, &mut Vec::new())
        else {
            return false;
        };
        if !expected_names.is_empty() && !expected_names.contains(&constructor_name.as_str()) {
            return false;
        }
        return module_api_reference_matches(
            &allocation.callee,
            &constructor_name,
            &THREE_MODULES,
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            &allocation.callee,
            &constructor_name,
            &THREE_MODULES,
            analysis,
            ctx,
        );
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
            three_frame_delta_expression_resolves_to_constructor(
                initializer,
                expected_names,
                analysis,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn three_frame_delta_candidate_api_name<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<String> {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return static_member_expression_property_name(member).map(str::to_string);
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = identifier_symbol_id_with_lexical_fallback(identifier, ctx)?;
    if visited_symbol_ids.contains(&symbol_id) {
        return None;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::TSImportEqualsDeclaration(import_equals) = declaration.kind() {
        let oxc_ast::ast::TSModuleReference::QualifiedName(qualified_name) =
            &import_equals.module_reference
        else {
            return None;
        };
        return Some(qualified_name.right.name.to_string());
    }
    if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const()
        ) {
            return None;
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            return three_frame_delta_candidate_api_name(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            );
        }
        return destructured_binding_provenance(
            &declarator.id,
            symbol_id,
            declarator.init.as_ref(),
        )
        .map(|(property_name, _)| property_name);
    }
    ctx.module_record().import_entries.iter().find_map(|entry| {
        if ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
            != Some(symbol_id)
        {
            return None;
        }
        let crate::module_record::ImportImportName::Name(imported_name) = &entry.import_name else {
            return None;
        };
        Some(imported_name.name().to_string())
    })
}
