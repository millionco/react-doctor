use oxc_ast::{
    AstKind,
    ast::{Expression, JSXElementName, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator};

use crate::{
    AstNode,
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const CAMERA_HOST_NAMES: [&str; 2] = ["orthographicCamera", "perspectiveCamera"];
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
const R3F_PROJECTION_PUBLIC_MODULES: [&str; 5] = [
    "@react-three/fiber",
    "@react-three/fiber/legacy",
    "@react-three/fiber/native",
    "@react-three/fiber/webgpu",
    "react-three-fiber",
];
const MESSAGE: &str = "This camera projection property changes without a later updateProjectionMatrix() call on every path, so Three.js can keep rendering the stale projection matrix";

#[derive(Debug, Default, Clone)]
pub struct R3FRequireProjectionMatrixUpdate;

impl RuleMeta for R3FRequireProjectionMatrixUpdate {
    const NAME: &'static str = "r3f-require-projection-matrix-update";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Require camera projection-matrix refreshes after projection changes.",
    };
}

struct R3fProjectionMutation {
    node_id: NodeId,
    property_key: String,
    receiver_key: String,
}

struct R3fProjectionReceiverCall {
    node_id: NodeId,
    receiver_key: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum R3fProjectionExpressionRestriction {
    Alternate,
    Consequent,
    Right,
}

impl Rule for R3FRequireProjectionMatrixUpdate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_r3f_runtime_import(ctx) {
            return;
        }

        let analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let managed_camera_ref_symbol_ids = r3f_projection_managed_camera_ref_symbol_ids(ctx);
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut assigned_expression_cache = R3fAnalyzedAssignedExpressionCache::default();
        let mut frame_callback_ids = rustc_hash::FxHashSet::default();
        let mut mutations = Vec::new();
        let mut update_calls = Vec::new();
        let mut opaque_calls = Vec::new();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call_expression) => {
                    if (module_api_reference_matches(
                        &call_expression.callee,
                        "useFrame",
                        &R3F_PROJECTION_PUBLIC_MODULES,
                        &analysis,
                        ctx,
                    ) || type_import_module_api_reference_matches(
                        &call_expression.callee,
                        "useFrame",
                        &R3F_PROJECTION_PUBLIC_MODULES,
                        &analysis,
                        ctx,
                    )) && let Some(callback_expression) = call_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                        && let Some(callback_id) = resolve_r3f_analyzed_callback_function_id(
                            callback_expression,
                            &analysis,
                            ctx,
                            &mut resolution_cache,
                        )
                    {
                        frame_callback_ids.insert(callback_id);
                    }

                    let update_receiver =
                        r3f_projection_update_receiver(call_expression).or_else(|| {
                            r3f_projection_direct_local_update_receiver(
                                call_expression,
                                ctx,
                                &mut resolution_cache,
                            )
                        });
                    if let Some(update_receiver) = update_receiver
                        && let Some(receiver_key) =
                            resolve_expression_key(update_receiver, ctx, &mut Vec::new())
                    {
                        update_calls.push(R3fProjectionReceiverCall {
                            node_id: node.id(),
                            receiver_key,
                        });
                        continue;
                    }

                    if !is_imported_or_stable_parameter_call(
                        call_expression,
                        ctx,
                        &mut resolution_cache,
                    ) {
                        continue;
                    }
                    for argument in &call_expression.arguments {
                        let Some(argument_expression) = argument.as_expression() else {
                            continue;
                        };
                        if let Some(receiver_key) =
                            resolve_expression_key(argument_expression, ctx, &mut Vec::new())
                        {
                            opaque_calls.push(R3fProjectionReceiverCall {
                                node_id: node.id(),
                                receiver_key,
                            });
                        }
                    }
                }
                AstKind::AssignmentExpression(assignment) => {
                    let Some((receiver, property_name)) =
                        r3f_projection_assignment_receiver(&assignment.left)
                    else {
                        continue;
                    };
                    if let Some(mutation) =
                        r3f_projection_mutation(node.id(), receiver, property_name, ctx)
                    {
                        mutations.push(mutation);
                    }
                }
                AstKind::UpdateExpression(update) => {
                    let Some((receiver, property_name)) =
                        r3f_projection_update_argument_receiver(&update.argument)
                    else {
                        continue;
                    };
                    if let Some(mutation) =
                        r3f_projection_mutation(node.id(), receiver, property_name, ctx)
                    {
                        mutations.push(mutation);
                    }
                }
                _ => {}
            }
        }

        update_calls.extend(opaque_calls);
        for mutation in mutations {
            let mutation_node = ctx.nodes().get_node(mutation.node_id);
            let Some(receiver) = r3f_projection_mutation_node_receiver(mutation_node) else {
                continue;
            };
            if !r3f_projection_has_stable_root_binding(receiver, ctx)
                || !(r3f_analyzed_use_three_state_property_matches(
                    receiver,
                    "camera",
                    &analysis,
                    &node_index,
                    ctx,
                    &mut resolution_cache,
                    &mut assigned_expression_cache,
                ) || frame_callback_ids.iter().any(|&callback_id| {
                    r3f_callback_state_property_matches(receiver, callback_id, "camera", ctx)
                }) || r3f_projection_react_ref_symbol(receiver, ctx)
                    .is_some_and(|symbol_id| managed_camera_ref_symbol_ids.contains(&symbol_id)))
                || r3f_projection_updates_cover_every_path_after_mutation(
                    &mutation,
                    &update_calls,
                    ctx,
                ) != Some(false)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(mutation_node.span()));
        }
    }
}

fn r3f_projection_managed_camera_ref_symbol_ids(
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<SymbolId> {
    let mut symbol_ids = rustc_hash::FxHashSet::default();
    for node in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        let JSXElementName::Identifier(element_name) = &opening_element.name else {
            continue;
        };
        if !CAMERA_HOST_NAMES.contains(&element_name.name.as_str())
            || !is_r3f_host_intrinsic(opening_element, ctx)
        {
            continue;
        }
        let Some(Expression::Identifier(identifier)) =
            get_authoritative_jsx_attribute(opening_element, "ref", true)
                .and_then(jsx_attribute_expression)
                .map(Expression::get_inner_expression)
        else {
            continue;
        };
        if let Some(symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) {
            symbol_ids.insert(symbol_id);
        }
    }
    symbol_ids
}

fn r3f_projection_assignment_receiver<'a>(
    target: &'a oxc_ast::ast::AssignmentTarget<'a>,
) -> Option<(&'a Expression<'a>, &'a str)> {
    let member_expression = target.as_member_expression().or_else(|| {
        target
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })?;
    let property_name = static_member_expression_property_name(member_expression)?;
    PROJECTION_PROPERTY_NAMES
        .contains(&property_name)
        .then(|| (member_expression.object(), property_name))
}

fn r3f_projection_update_argument_receiver<'a>(
    target: &'a oxc_ast::ast::SimpleAssignmentTarget<'a>,
) -> Option<(&'a Expression<'a>, &'a str)> {
    let member_expression = target.as_member_expression().or_else(|| {
        target
            .get_expression()?
            .get_inner_expression()
            .as_member_expression()
    })?;
    let property_name = static_member_expression_property_name(member_expression)?;
    PROJECTION_PROPERTY_NAMES
        .contains(&property_name)
        .then(|| (member_expression.object(), property_name))
}

fn r3f_projection_mutation(
    node_id: NodeId,
    receiver: &Expression<'_>,
    property_name: &str,
    ctx: &LintContext<'_>,
) -> Option<R3fProjectionMutation> {
    let receiver_key = resolve_expression_key(receiver, ctx, &mut Vec::new())?;
    let property_key = format!("{receiver_key}.{property_name}");
    Some(R3fProjectionMutation {
        node_id,
        property_key,
        receiver_key,
    })
}

fn r3f_projection_mutation_node_receiver<'a, 'node>(
    node: &'node AstNode<'a>,
) -> Option<&'node Expression<'a>> {
    match node.kind() {
        AstKind::AssignmentExpression(assignment) => {
            r3f_projection_assignment_receiver(&assignment.left).map(|(receiver, _)| receiver)
        }
        AstKind::UpdateExpression(update) => {
            r3f_projection_update_argument_receiver(&update.argument).map(|(receiver, _)| receiver)
        }
        _ => None,
    }
}

fn r3f_projection_update_receiver<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a Expression<'a>> {
    let member_expression = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    (static_member_expression_property_name(member_expression) == Some("updateProjectionMatrix"))
        .then(|| member_expression.object())
}

fn r3f_projection_direct_local_update_receiver<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<&'a Expression<'a>> {
    let function_id = exact_local_function_id_including_generators(
        &call_expression.callee,
        ctx,
        &mut Vec::new(),
        resolution_cache,
    )?;
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::ArrowFunctionExpression(function) => {
            if let Some(Expression::CallExpression(inner_call)) = function
                .get_expression()
                .map(Expression::get_inner_expression)
            {
                return r3f_projection_update_receiver(inner_call);
            }
            r3f_projection_single_statement_update_receiver(
                function.body.as_function_body()?.statements.as_slice(),
            )
        }
        AstKind::Function(function) => r3f_projection_single_statement_update_receiver(
            function.body.as_ref()?.statements.as_slice(),
        ),
        _ => None,
    }
}

fn r3f_projection_single_statement_update_receiver<'a>(
    statements: &'a [Statement<'a>],
) -> Option<&'a Expression<'a>> {
    let expression = match statements {
        [Statement::ExpressionStatement(statement)] => Some(&statement.expression),
        [Statement::ReturnStatement(statement)] => statement.argument.as_ref(),
        _ => None,
    }?;
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return None;
    };
    r3f_projection_update_receiver(call_expression)
}

fn r3f_projection_has_stable_root_binding(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut expression = expression.get_inner_expression();
    while let Some(member_expression) = expression.as_member_expression() {
        expression = member_expression.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = expression else {
        return true;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none_or(|symbol_id| {
            ctx.scoping()
                .get_resolved_references(symbol_id)
                .all(|reference| !reference.is_write())
        })
}

fn r3f_projection_react_ref_symbol<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let current_member = expression.get_inner_expression().as_member_expression()?;
    if static_member_expression_property_name(current_member) != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = current_member.object().get_inner_expression() else {
        return None;
    };
    let symbol_id = resolve_const_identifier_root_symbol(identifier, ctx)?;
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    let Some(Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return None;
    };
    (is_react_api_call(call_expression, "useRef", ctx)
        || is_react_api_call(call_expression, "createRef", ctx))
    .then_some(symbol_id)
}

fn r3f_projection_updates_cover_every_path_after_mutation<'a>(
    mutation: &R3fProjectionMutation,
    update_calls: &[R3fProjectionReceiverCall],
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let mutation_node = ctx.nodes().get_node(mutation.node_id);
    let owner = crate::ast_util::get_enclosing_function(mutation_node, ctx)?;
    let matching_update_ids = update_calls
        .iter()
        .filter(|update| {
            update.receiver_key == mutation.receiver_key
                && crate::ast_util::get_enclosing_function(
                    ctx.nodes().get_node(update.node_id),
                    ctx,
                )
                .is_some_and(|update_owner| update_owner.id() == owner.id())
        })
        .map(|update| update.node_id)
        .collect::<Vec<_>>();
    let mut expression_coverage_ids =
        r3f_projection_expression_path_coverage_ids(owner.id(), &matching_update_ids, ctx);
    for &update_id in &matching_update_ids {
        if r3f_projection_update_shares_mutation_expression_restrictions(
            mutation.node_id,
            update_id,
            owner.id(),
            ctx,
        ) {
            expression_coverage_ids.insert(update_id);
        }
    }
    if r3f_projection_is_guarded_refresh_for_changed_value(
        mutation,
        &matching_update_ids.iter().copied().collect(),
        ctx,
    ) {
        return Some(true);
    }

    let mutation_block = ctx.nodes().cfg_id(mutation.node_id);
    let mutation_start = mutation_node.span().start;
    let matching_blocks = expression_coverage_ids
        .into_iter()
        .filter_map(|update_id| {
            let update_node = ctx.nodes().get_node(update_id);
            let update_block = ctx.nodes().cfg_id(update_id);
            (update_block != mutation_block || update_node.span().start >= mutation_start)
                .then_some(update_block)
        })
        .collect::<rustc_hash::FxHashSet<_>>();
    if matching_blocks.contains(&mutation_block) {
        return Some(true);
    }

    let graph = ctx.cfg().graph();
    let mut visited_blocks = rustc_hash::FxHashSet::default();
    let mut pending_blocks = vec![mutation_block];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) {
            continue;
        }
        for edge in graph.edges_directed(current_block, oxc_cfg::graph::Direction::Outgoing) {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(_)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if !matching_blocks.contains(&target) {
                pending_blocks.push(target);
            }
        }
        if ctx
            .cfg()
            .basic_block(current_block)
            .instructions()
            .iter()
            .any(|instruction| {
                matches!(
                    instruction.kind,
                    oxc_cfg::InstructionKind::ImplicitReturn | oxc_cfg::InstructionKind::Return(_)
                )
            })
        {
            return Some(false);
        }
    }
    Some(!matching_blocks.is_empty())
}

fn r3f_projection_expression_path_coverage_ids(
    owner_id: NodeId,
    matching_node_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashSet<NodeId> {
    let mut pending_ids = matching_node_ids
        .iter()
        .copied()
        .filter(|&node_id| r3f_projection_node_is_within(node_id, owner_id, ctx))
        .collect::<Vec<_>>();
    let mut visited_ids = pending_ids
        .iter()
        .copied()
        .collect::<rustc_hash::FxHashSet<_>>();
    let mut coverage_ids = rustc_hash::FxHashSet::default();
    let mut covered_branches_by_conditional = rustc_hash::FxHashMap::<NodeId, u8>::default();
    while let Some(coverage_candidate_id) = pending_ids.pop() {
        if coverage_candidate_id == owner_id {
            coverage_ids.insert(coverage_candidate_id);
            continue;
        }
        let mut current_child_id = coverage_candidate_id;
        let mut current_parent = ctx.nodes().parent_node(current_child_id);
        let mut conditional_branch = None;
        let mut is_blocked = false;
        while current_parent.id() != owner_id {
            match current_parent.kind() {
                AstKind::ConditionalExpression(conditional) => {
                    let is_consequent = conditional.consequent.node_id() == current_child_id;
                    let is_alternate = conditional.alternate.node_id() == current_child_id;
                    if is_consequent || is_alternate {
                        if let Some(test_value) = r3f_projection_static_boolean(&conditional.test) {
                            if test_value != is_consequent {
                                is_blocked = true;
                                break;
                            }
                            current_child_id = current_parent.id();
                            current_parent = ctx.nodes().parent_node(current_child_id);
                            continue;
                        }
                        conditional_branch =
                            Some((current_parent.id(), if is_consequent { 1_u8 } else { 2_u8 }));
                        break;
                    }
                }
                AstKind::LogicalExpression(logical)
                    if logical.right.node_id() == current_child_id =>
                {
                    let static_left = r3f_projection_static_boolean(&logical.left);
                    let is_right_guaranteed = logical.operator == LogicalOperator::And
                        && static_left == Some(true)
                        || logical.operator == LogicalOperator::Or && static_left == Some(false);
                    if !is_right_guaranteed {
                        is_blocked = true;
                        break;
                    }
                }
                AstKind::AssignmentPattern(assignment)
                    if assignment.right.node_id() == current_child_id =>
                {
                    is_blocked = true;
                    break;
                }
                _ => {}
            }
            current_child_id = current_parent.id();
            current_parent = ctx.nodes().parent_node(current_child_id);
        }
        if is_blocked {
            continue;
        }
        let Some((conditional_id, branch_bit)) = conditional_branch else {
            coverage_ids.insert(coverage_candidate_id);
            continue;
        };
        let covered_branches = covered_branches_by_conditional
            .entry(conditional_id)
            .or_default();
        *covered_branches |= branch_bit;
        if *covered_branches == 3 && visited_ids.insert(conditional_id) {
            pending_ids.push(conditional_id);
        }
    }
    coverage_ids
}

fn r3f_projection_static_boolean(expression: &Expression<'_>) -> Option<bool> {
    let mut expression = expression.get_inner_expression();
    while let Expression::SequenceExpression(sequence) = expression {
        expression = sequence.expressions.last()?.get_inner_expression();
    }
    let Expression::BooleanLiteral(literal) = expression else {
        return None;
    };
    Some(literal.value)
}

fn r3f_projection_update_shares_mutation_expression_restrictions(
    mutation_id: NodeId,
    update_id: NodeId,
    owner_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mutation_restrictions = r3f_projection_expression_restrictions(mutation_id, owner_id, ctx);
    r3f_projection_expression_restrictions(update_id, owner_id, ctx)
        .into_iter()
        .all(|(expression_id, restriction)| {
            mutation_restrictions.get(&expression_id) == Some(&restriction)
        })
}

fn r3f_projection_expression_restrictions(
    node_id: NodeId,
    owner_id: NodeId,
    ctx: &LintContext<'_>,
) -> rustc_hash::FxHashMap<NodeId, R3fProjectionExpressionRestriction> {
    let mut restrictions = rustc_hash::FxHashMap::default();
    let mut current_child_id = node_id;
    let mut current_parent = ctx.nodes().parent_node(current_child_id);
    while current_parent.id() != owner_id {
        let restriction = match current_parent.kind() {
            AstKind::ConditionalExpression(conditional)
                if conditional.consequent.node_id() == current_child_id =>
            {
                Some(R3fProjectionExpressionRestriction::Consequent)
            }
            AstKind::ConditionalExpression(conditional)
                if conditional.alternate.node_id() == current_child_id =>
            {
                Some(R3fProjectionExpressionRestriction::Alternate)
            }
            AstKind::LogicalExpression(logical) if logical.right.node_id() == current_child_id => {
                Some(R3fProjectionExpressionRestriction::Right)
            }
            AstKind::AssignmentPattern(assignment)
                if assignment.right.node_id() == current_child_id =>
            {
                Some(R3fProjectionExpressionRestriction::Right)
            }
            _ => None,
        };
        if let Some(restriction) = restriction {
            restrictions.insert(current_parent.id(), restriction);
        }
        current_child_id = current_parent.id();
        current_parent = ctx.nodes().parent_node(current_child_id);
    }
    restrictions
}

fn r3f_projection_is_guarded_refresh_for_changed_value(
    mutation: &R3fProjectionMutation,
    matching_update_ids: &rustc_hash::FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    let mutation_node = ctx.nodes().get_node(mutation.node_id);
    let mutation_statement = ctx.nodes().parent_node(mutation.node_id);
    let AstKind::ExpressionStatement(expression_statement) = mutation_statement.kind() else {
        return false;
    };
    if expression_statement.expression.span() != mutation_node.span() {
        return false;
    }
    let block = ctx.nodes().parent_node(mutation_statement.id());
    let statements = match block.kind() {
        AstKind::BlockStatement(block) => block.body.as_slice(),
        AstKind::FunctionBody(body) => body.statements.as_slice(),
        _ => return false,
    };
    let Some(mutation_index) = statements
        .iter()
        .position(|statement| statement.span() == mutation_statement.span())
    else {
        return false;
    };
    let Some(snapshot_statement) = mutation_index
        .checked_sub(1)
        .and_then(|index| statements.get(index))
    else {
        return false;
    };
    let Some(Statement::IfStatement(refresh_statement)) = statements.get(mutation_index + 1) else {
        return false;
    };
    let Statement::VariableDeclaration(snapshot_declaration) = snapshot_statement else {
        return false;
    };
    if !snapshot_declaration.kind.is_const()
        || snapshot_declaration.declarations.len() != 1
        || refresh_statement.alternate.is_some()
    {
        return false;
    }
    let declaration = &snapshot_declaration.declarations[0];
    let oxc_ast::ast::BindingPattern::BindingIdentifier(snapshot_binding) = &declaration.id else {
        return false;
    };
    if declaration.init.as_ref().is_none_or(|initializer| {
        resolve_expression_key(initializer, ctx, &mut Vec::new()).as_deref()
            != Some(mutation.property_key.as_str())
    }) {
        return false;
    }
    let Some(refresh_call_id) =
        r3f_projection_only_call_expression_id(&refresh_statement.consequent)
    else {
        return false;
    };
    if !matching_update_ids.contains(&refresh_call_id) {
        return false;
    }
    let Expression::BinaryExpression(comparison) = refresh_statement.test.get_inner_expression()
    else {
        return false;
    };
    if !matches!(
        comparison.operator,
        BinaryOperator::Inequality | BinaryOperator::StrictInequality
    ) {
        return false;
    }
    r3f_projection_comparison_matches_snapshot(
        &comparison.left,
        &comparison.right,
        snapshot_binding.symbol_id(),
        &mutation.property_key,
        ctx,
    ) || r3f_projection_comparison_matches_snapshot(
        &comparison.right,
        &comparison.left,
        snapshot_binding.symbol_id(),
        &mutation.property_key,
        ctx,
    )
}

fn r3f_projection_only_call_expression_id(statement: &Statement<'_>) -> Option<NodeId> {
    let expression = match statement {
        Statement::BlockStatement(block) if block.body.len() == 1 => {
            return r3f_projection_only_call_expression_id(&block.body[0]);
        }
        Statement::ExpressionStatement(statement) => &statement.expression,
        _ => return None,
    };
    let Expression::CallExpression(call_expression) = expression.get_inner_expression() else {
        return None;
    };
    Some(call_expression.node_id.get())
}

fn r3f_projection_comparison_matches_snapshot(
    snapshot: &Expression<'_>,
    current: &Expression<'_>,
    snapshot_symbol_id: SymbolId,
    property_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(snapshot_identifier) = snapshot.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(snapshot_identifier.reference_id())
        .symbol_id()
        == Some(snapshot_symbol_id)
        && resolve_expression_key(current, ctx, &mut Vec::new()).as_deref() == Some(property_key)
}

fn r3f_projection_node_is_within(
    node_id: NodeId,
    boundary_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    node_id == boundary_id
        || ctx
            .nodes()
            .ancestors(node_id)
            .any(|ancestor| ancestor.id() == boundary_id)
}
