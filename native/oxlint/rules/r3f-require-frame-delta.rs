use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const R3F_FRAME_DELTA_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const R3F_FRAME_DELTA_TRANSFORM_PROPERTIES: [&str; 4] =
    ["position", "rotation", "scale", "quaternion"];
const R3F_FRAME_DELTA_INTERPOLATION_PROPERTIES: [&str; 5] =
    ["position", "rotation", "scale", "quaternion", "color"];
const R3F_FRAME_DELTA_STATE_PROPERTIES: [&str; 2] = ["camera", "scene"];
const UPDATE_MESSAGE: &str = "This transform changes by a fixed amount per frame, so animation speed depends on refresh rate. Use the useFrame delta argument instead of an update operator";
const ASSIGNMENT_MESSAGE: &str = "This transform changes by a fixed amount per frame, so animation speed depends on refresh rate. Multiply the increment by the useFrame delta argument";
const INTERPOLATION_MESSAGE: &str = "This fixed interpolation factor converges once per frame, so its speed changes with refresh rate. Derive the factor from useFrame delta or use a delta-aware damping function";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireFrameDelta;

struct R3fFrameDeltaIdentifierReferenceIndex {
    node_ids_by_start: Vec<oxc_semantic::NodeId>,
}

impl R3fFrameDeltaIdentifierReferenceIndex {
    fn new(ctx: &LintContext<'_>) -> Self {
        let mut node_ids_by_start = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                matches!(node.kind(), AstKind::IdentifierReference(_)).then_some(node.id())
            })
            .collect::<Vec<_>>();
        node_ids_by_start
            .sort_unstable_by_key(|node_id| ctx.nodes().get_node(*node_id).span().start);
        Self { node_ids_by_start }
    }
}

impl RuleMeta for R3FRequireFrameDelta {
    const NAME: &'static str = "r3f-require-frame-delta";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require frame-rate-independent R3F animation updates.",
    };
}

impl Rule for R3FRequireFrameDelta {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let managed_ref_symbol_ids = collect_r3f_host_ref_symbol_ids(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let mut identifier_reference_index = None;

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_FRAME_DELTA_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) && !type_import_module_api_reference_matches(
                &call_expression.callee,
                "useFrame",
                &R3F_FRAME_DELTA_PUBLIC_MODULES,
                &analysis,
                ctx,
            ) {
                continue;
            }
            let Some(callback_expression) = call_expression
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                callback_expression,
                &analysis,
                ctx,
                &mut resolution_cache,
            ) else {
                continue;
            };
            if matches!(
                ctx.nodes().get_node(callback_id).kind(),
                AstKind::Function(function) if function.generator
            ) {
                continue;
            }
            let identifier_reference_index: &R3fFrameDeltaIdentifierReferenceIndex =
                &*identifier_reference_index
                    .get_or_insert_with(|| R3fFrameDeltaIdentifierReferenceIndex::new(ctx));

            for_each_analyzed_synchronous_execution_node(
                callback_id,
                &analysis,
                &node_index,
                ctx,
                &mut resolution_cache,
                |candidate,
                 root_callback_id,
                 is_conditionally_executed,
                 execution_resolution_cache| {
                    let is_behind_ref_availability_guard = is_conditionally_executed
                        && r3f_frame_delta_is_conditionally_executed_only_by_ref_availability(
                            candidate,
                            root_callback_id,
                            ctx,
                        );
                    match candidate.kind() {
                        AstKind::UpdateExpression(update_expression) => {
                            let Some(member_expression) =
                                update_expression.argument.as_member_expression()
                            else {
                                return;
                            };
                            if r3f_frame_delta_is_transform_member(
                                member_expression,
                                root_callback_id,
                                &managed_ref_symbol_ids,
                                &analysis,
                                &node_index,
                                execution_resolution_cache,
                                &mut assigned_expression_cache,
                                ctx,
                            ) && (!is_conditionally_executed || is_behind_ref_availability_guard)
                            {
                                ctx.diagnostic(
                                    OxcDiagnostic::warn(UPDATE_MESSAGE)
                                        .with_label(candidate.span()),
                                );
                            }
                        }
                        AstKind::AssignmentExpression(assignment_expression) => {
                            if !matches!(
                                assignment_expression.operator,
                                oxc_syntax::operator::AssignmentOperator::Addition
                                    | oxc_syntax::operator::AssignmentOperator::Subtraction
                            ) {
                                return;
                            }
                            let Some(member_expression) =
                                assignment_expression.left.as_member_expression()
                            else {
                                return;
                            };
                            if !r3f_frame_delta_is_transform_member(
                                member_expression,
                                root_callback_id,
                                &managed_ref_symbol_ids,
                                &analysis,
                                &node_index,
                                execution_resolution_cache,
                                &mut assigned_expression_cache,
                                ctx,
                            ) || r3f_frame_delta_expression_references_delta(
                                &assignment_expression.right,
                                root_callback_id,
                                identifier_reference_index,
                                ctx,
                                &mut Vec::new(),
                            ) || r3f_frame_delta_is_rotation_correction_after_look_at(
                                candidate,
                                assignment_expression,
                                ctx,
                            ) || (is_conditionally_executed && !is_behind_ref_availability_guard)
                            {
                                return;
                            }
                            ctx.diagnostic(
                                OxcDiagnostic::warn(ASSIGNMENT_MESSAGE)
                                    .with_label(candidate.span()),
                            );
                        }
                        AstKind::CallExpression(interpolation_call) => {
                            let Some(factor) = r3f_frame_delta_fixed_interpolation_factor(
                                interpolation_call,
                                root_callback_id,
                                &managed_ref_symbol_ids,
                                &analysis,
                                &node_index,
                                execution_resolution_cache,
                                &mut assigned_expression_cache,
                                ctx,
                            ) else {
                                return;
                            };
                            if r3f_frame_delta_expression_references_delta(
                                factor,
                                root_callback_id,
                                identifier_reference_index,
                                ctx,
                                &mut Vec::new(),
                            ) || (is_conditionally_executed && !is_behind_ref_availability_guard)
                            {
                                return;
                            }
                            ctx.diagnostic(
                                OxcDiagnostic::warn(INTERPOLATION_MESSAGE)
                                    .with_label(factor.span()),
                            );
                        }
                        _ => {}
                    }
                },
            );
        }
    }
}

fn r3f_frame_delta_is_transform_member<'a>(
    member_expression: &'a oxc_ast::ast::MemberExpression<'a>,
    callback_id: oxc_semantic::NodeId,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut has_transform_property = member_expression
        .static_property_name()
        .is_some_and(|property_name| R3F_FRAME_DELTA_TRANSFORM_PROPERTIES.contains(&property_name));
    let mut current = member_expression.object().get_inner_expression();
    while let Some(current_member) = current.as_member_expression() {
        if current_member
            .static_property_name()
            .is_some_and(|property_name| {
                R3F_FRAME_DELTA_TRANSFORM_PROPERTIES.contains(&property_name)
            })
        {
            has_transform_property = true;
        }
        current = current_member.object().get_inner_expression();
    }
    has_transform_property
        && r3f_frame_delta_has_transform_provenance(
            member_expression.object(),
            callback_id,
            managed_ref_symbol_ids,
            analysis,
            node_index,
            resolution_cache,
            assigned_expression_cache,
            ctx,
        )
}

fn r3f_frame_delta_has_transform_provenance<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = expression.get_inner_expression();
    while let Some(member_expression) = current.as_member_expression() {
        if R3F_FRAME_DELTA_STATE_PROPERTIES
            .iter()
            .any(|property_name| {
                r3f_analyzed_callback_state_property_matches(
                    current,
                    callback_id,
                    property_name,
                    ctx,
                    &mut Vec::new(),
                ) || r3f_analyzed_use_three_state_property_matches(
                    current,
                    property_name,
                    analysis,
                    node_index,
                    ctx,
                    resolution_cache,
                    assigned_expression_cache,
                )
            })
            || r3f_frame_delta_managed_ref_symbol(member_expression, true, ctx)
                .is_some_and(|symbol_id| managed_ref_symbol_ids.contains(&symbol_id))
        {
            return true;
        }
        current = member_expression.object().get_inner_expression();
    }
    R3F_FRAME_DELTA_STATE_PROPERTIES
        .iter()
        .any(|property_name| {
            r3f_analyzed_callback_state_property_matches(
                current,
                callback_id,
                property_name,
                ctx,
                &mut Vec::new(),
            ) || r3f_analyzed_use_three_state_property_matches(
                current,
                property_name,
                analysis,
                node_index,
                ctx,
                resolution_cache,
                assigned_expression_cache,
            )
        })
}

fn r3f_frame_delta_has_interpolation_receiver_provenance<'a>(
    expression: &'a oxc_ast::ast::Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = expression.get_inner_expression();
    let mut has_interpolation_property = false;
    while let Some(member_expression) = current.as_member_expression() {
        if member_expression
            .static_property_name()
            .is_some_and(|property_name| {
                R3F_FRAME_DELTA_INTERPOLATION_PROPERTIES.contains(&property_name)
            })
        {
            has_interpolation_property = true;
        }
        if r3f_frame_delta_managed_ref_symbol(member_expression, true, ctx)
            .is_some_and(|symbol_id| managed_ref_symbol_ids.contains(&symbol_id))
        {
            return true;
        }
        current = member_expression.object().get_inner_expression();
    }
    has_interpolation_property
        && r3f_frame_delta_has_transform_provenance(
            expression,
            callback_id,
            managed_ref_symbol_ids,
            analysis,
            node_index,
            resolution_cache,
            assigned_expression_cache,
            ctx,
        )
}

fn r3f_frame_delta_expression_references_delta<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    callback_id: oxc_semantic::NodeId,
    identifier_reference_index: &R3fFrameDeltaIdentifierReferenceIndex,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let Some(delta_symbol_id) = r3f_frame_delta_callback_delta_symbol(callback_id, ctx) else {
        return false;
    };
    let expression_span = expression.span();
    let first_candidate_index = identifier_reference_index
        .node_ids_by_start
        .partition_point(|node_id| {
            ctx.nodes().get_node(*node_id).span().start < expression_span.start
        });
    for candidate_id in &identifier_reference_index.node_ids_by_start[first_candidate_index..] {
        let candidate = ctx.nodes().get_node(*candidate_id);
        if candidate.span().start > expression_span.end {
            break;
        }
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
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
        if symbol_id == delta_symbol_id {
            return true;
        }
        if visited_symbol_ids.contains(&symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
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
        if r3f_frame_delta_expression_references_delta(
            initializer,
            callback_id,
            identifier_reference_index,
            ctx,
            visited_symbol_ids,
        ) {
            return true;
        }
    }
    false
}

fn r3f_frame_delta_callback_delta_symbol(
    callback_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let parameter = match ctx.nodes().get_node(callback_id).kind() {
        AstKind::Function(function) => function.params.items.get(1),
        AstKind::ArrowFunctionExpression(function) => function.params.items.get(1),
        _ => None,
    }?;
    let pattern = match &parameter.pattern {
        oxc_ast::ast::BindingPattern::AssignmentPattern(assignment) => &assignment.left,
        pattern => pattern,
    };
    pattern
        .get_binding_identifier()
        .map(|binding| binding.symbol_id())
}

fn r3f_frame_delta_fixed_interpolation_factor<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    callback_id: oxc_semantic::NodeId,
    managed_ref_symbol_ids: &rustc_hash::FxHashSet<oxc_semantic::SymbolId>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    resolution_cache: &mut LocalFunctionResolutionCache,
    assigned_expression_cache: &mut R3fAnalyzedAssignedExpressionCache<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let member_expression = call_expression.callee.as_member_expression()?;
    let method_name = member_expression.static_property_name()?;
    let factor_argument_index = if method_name == "lerp"
        && (module_api_reference_matches(
            member_expression.object(),
            "MathUtils",
            &["three"],
            analysis,
            ctx,
        ) || type_import_module_api_reference_matches(
            member_expression.object(),
            "MathUtils",
            &["three"],
            analysis,
            ctx,
        )) {
        2
    } else if r3f_frame_delta_has_interpolation_receiver_provenance(
        member_expression.object(),
        callback_id,
        managed_ref_symbol_ids,
        analysis,
        node_index,
        resolution_cache,
        assigned_expression_cache,
        ctx,
    ) {
        match method_name {
            "lerp" | "lerpHSL" | "slerp" => 1,
            "lerpColors" | "lerpVectors" | "slerpQuaternions" => 2,
            _ => return None,
        }
    } else {
        return None;
    };
    let factor = call_expression
        .arguments
        .get(factor_argument_index)?
        .as_expression()?;
    resolve_static_number(factor, ctx)
        .is_some_and(|value| value > 0.0 && value < 1.0)
        .then_some(factor)
}

fn r3f_frame_delta_is_conditionally_executed_only_by_ref_availability(
    node: &crate::AstNode<'_>,
    callback_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut did_find_ref_availability_condition = false;
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == callback_id {
            return did_find_ref_availability_condition;
        }
        match ancestor.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            AstKind::IfStatement(statement) if statement.test.span() != child_span => {
                let did_condition_pass = statement.consequent.span() == child_span;
                if (!did_condition_pass
                    && statement
                        .alternate
                        .as_ref()
                        .is_none_or(|alternate| alternate.span() != child_span))
                    || !r3f_frame_delta_is_ref_availability_condition(
                        &statement.test,
                        did_condition_pass,
                        ctx,
                    )
                {
                    return false;
                }
                did_find_ref_availability_condition = true;
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.span() == child_span
                    || expression.alternate.span() == child_span =>
            {
                let did_condition_pass = expression.consequent.span() == child_span;
                if !r3f_frame_delta_is_ref_availability_condition(
                    &expression.test,
                    did_condition_pass,
                    ctx,
                ) {
                    return false;
                }
                did_find_ref_availability_condition = true;
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == child_span => {
                if expression.operator == oxc_syntax::operator::LogicalOperator::Coalesce
                    || !r3f_frame_delta_is_ref_availability_condition(
                        &expression.left,
                        expression.operator == oxc_syntax::operator::LogicalOperator::And,
                        ctx,
                    )
                {
                    return false;
                }
                did_find_ref_availability_condition = true;
            }
            AstKind::AssignmentPattern(pattern) if pattern.right.span() == child_span => {
                return false;
            }
            AstKind::SwitchCase(_) => return false,
            _ => {}
        }
        child_span = ancestor.span();
    }
    false
}

fn r3f_frame_delta_is_ref_availability_condition<'a>(
    expression: &oxc_ast::ast::Expression<'a>,
    did_condition_pass: bool,
    ctx: &LintContext<'a>,
) -> bool {
    let candidate = expression.get_inner_expression();
    if candidate
        .as_member_expression()
        .is_some_and(|member| r3f_frame_delta_managed_ref_symbol(member, false, ctx).is_some())
    {
        return did_condition_pass;
    }
    if let oxc_ast::ast::Expression::UnaryExpression(unary_expression) = candidate
        && unary_expression.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
    {
        return r3f_frame_delta_is_ref_availability_condition(
            &unary_expression.argument,
            !did_condition_pass,
            ctx,
        );
    }
    let oxc_ast::ast::Expression::BinaryExpression(binary_expression) = candidate else {
        return false;
    };
    if !matches!(
        binary_expression.operator,
        oxc_syntax::operator::BinaryOperator::Equality
            | oxc_syntax::operator::BinaryOperator::StrictEquality
            | oxc_syntax::operator::BinaryOperator::Inequality
            | oxc_syntax::operator::BinaryOperator::StrictInequality
    ) {
        return false;
    }
    let ref_expression = if is_nullish_expression(&binary_expression.left) {
        &binary_expression.right
    } else if is_nullish_expression(&binary_expression.right) {
        &binary_expression.left
    } else {
        return false;
    };
    if ref_expression
        .get_inner_expression()
        .as_member_expression()
        .is_none_or(|member| r3f_frame_delta_managed_ref_symbol(member, false, ctx).is_none())
    {
        return false;
    }
    let is_inequality = matches!(
        binary_expression.operator,
        oxc_syntax::operator::BinaryOperator::Inequality
            | oxc_syntax::operator::BinaryOperator::StrictInequality
    );
    did_condition_pass == is_inequality
}

fn r3f_frame_delta_managed_ref_symbol<'a>(
    member_expression: &oxc_ast::ast::MemberExpression<'a>,
    include_create_ref: bool,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::SymbolId> {
    if member_expression.static_property_name() != Some("current") {
        return None;
    }
    let oxc_ast::ast::Expression::Identifier(identifier) =
        member_expression.object().get_inner_expression()
    else {
        return None;
    };
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let Some(oxc_ast::ast::Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(oxc_ast::ast::Expression::get_inner_expression)
    else {
        return None;
    };
    let is_matching_ref = if include_create_ref {
        is_react_api_call(call_expression, "useRef", ctx)
            || is_react_api_call(call_expression, "createRef", ctx)
    } else {
        r3f_frame_delta_is_direct_use_ref_call(call_expression, ctx)
    };
    is_matching_ref.then_some(symbol_id)
}

fn r3f_frame_delta_is_direct_use_ref_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callee = call_expression.callee.get_inner_expression();
    if let oxc_ast::ast::Expression::Identifier(identifier) = callee {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        return ctx.module_record().import_entries.iter().any(|entry| {
            [
                "react",
                "react-dom",
                "preact/compat",
                "preact/hooks",
                "@wordpress/element",
            ]
            .contains(&entry.module_request.name())
                && ctx
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
                && matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if imported_name.name() == "useRef"
                )
        });
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    member_expression.static_property_name() == Some("useRef")
        && is_react_api_call(call_expression, "useRef", ctx)
}

fn r3f_frame_delta_is_rotation_correction_after_look_at<'a>(
    node: &crate::AstNode<'a>,
    assignment_expression: &oxc_ast::ast::AssignmentExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(rotation_owner) = r3f_frame_delta_rotation_owner(&assignment_expression.left) else {
        return false;
    };
    let assignment_root = transparent_expression_root(node, ctx);
    let assignment_statement = ctx.nodes().parent_node(assignment_root.id());
    let AstKind::ExpressionStatement(statement) = assignment_statement.kind() else {
        return false;
    };
    if statement.expression.span() != assignment_root.span() {
        return false;
    }
    let block_node = ctx.nodes().parent_node(assignment_statement.id());
    let previous_statement = match block_node.kind() {
        AstKind::BlockStatement(block) => block
            .body
            .iter()
            .position(|candidate| candidate.span().start == assignment_statement.span().start)
            .and_then(|index| index.checked_sub(1))
            .and_then(|index| block.body.get(index)),
        AstKind::FunctionBody(body) => body
            .statements
            .iter()
            .position(|candidate| candidate.span().start == assignment_statement.span().start)
            .and_then(|index| index.checked_sub(1))
            .and_then(|index| body.statements.get(index)),
        _ => None,
    };
    let Some(oxc_ast::ast::Statement::ExpressionStatement(previous_statement)) = previous_statement
    else {
        return false;
    };
    let oxc_ast::ast::Expression::CallExpression(previous_call) =
        previous_statement.expression.get_inner_expression()
    else {
        return false;
    };
    let Some(previous_member) = previous_call.callee.as_member_expression() else {
        return false;
    };
    previous_member.static_property_name() == Some("lookAt")
        && r3f_frame_delta_are_same_resolved_receivers(
            rotation_owner,
            previous_member.object(),
            ctx,
        )
}

fn r3f_frame_delta_rotation_owner<'a>(
    assignment_target: &'a oxc_ast::ast::AssignmentTarget<'a>,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let axis_member = assignment_target.as_member_expression()?;
    if !matches!(axis_member.static_property_name(), Some("x" | "y" | "z")) {
        return None;
    }
    let rotation_member = axis_member
        .object()
        .get_inner_expression()
        .as_member_expression()?;
    (rotation_member.static_property_name() == Some("rotation"))
        .then(|| rotation_member.object().get_inner_expression())
}

fn r3f_frame_delta_are_same_resolved_receivers(
    left: &oxc_ast::ast::Expression<'_>,
    right: &oxc_ast::ast::Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let left = left.get_inner_expression();
    let right = right.get_inner_expression();
    if matches!(left, oxc_ast::ast::Expression::ThisExpression(_)) {
        return matches!(right, oxc_ast::ast::Expression::ThisExpression(_));
    }
    if let oxc_ast::ast::Expression::Identifier(left_identifier) = left {
        let oxc_ast::ast::Expression::Identifier(right_identifier) = right else {
            return false;
        };
        let left_symbol_id = identifier_symbol_id_with_lexical_fallback(left_identifier, ctx);
        let right_symbol_id = identifier_symbol_id_with_lexical_fallback(right_identifier, ctx);
        return left_symbol_id.is_some() && left_symbol_id == right_symbol_id;
    }
    let Some(left_member) = left.as_member_expression() else {
        return false;
    };
    let Some(right_member) = right.as_member_expression() else {
        return false;
    };
    left_member
        .static_property_name()
        .is_some_and(|property_name| {
            right_member.static_property_name() == Some(property_name)
                && r3f_frame_delta_are_same_resolved_receivers(
                    left_member.object(),
                    right_member.object(),
                    ctx,
                )
        })
}
