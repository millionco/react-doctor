use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, Expression, Statement, TSSignature,
        TSType,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CHAIN_EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const CHAIN_DEFERRED_CALL_NAMES: [&str; 17] = [
    "addEventListener",
    "addListener",
    "catch",
    "finally",
    "observe",
    "on",
    "once",
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setImmediate",
    "setInterval",
    "setTimeout",
    "subscribe",
    "then",
    "watch",
    "watchPosition",
];
const CHAIN_POST_MOUNT_METHOD_NAMES: [&str; 8] = [
    "getBoundingClientRect",
    "getComputedStyle",
    "getElementById",
    "getElementsByClassName",
    "getElementsByTagName",
    "matchMedia",
    "querySelector",
    "querySelectorAll",
];
const CHAIN_LAYOUT_MEASUREMENT_PROPERTY_NAMES: [&str; 16] = [
    "clientHeight",
    "clientWidth",
    "className",
    "current",
    "innerHeight",
    "innerText",
    "innerWidth",
    "offsetHeight",
    "offsetLeft",
    "offsetTop",
    "offsetWidth",
    "scrollHeight",
    "scrollLeft",
    "scrollTop",
    "scrollWidth",
    "textContent",
];
const CHAIN_POST_MOUNT_GLOBAL_NAMES: [&str; 5] = [
    "document",
    "localStorage",
    "navigator",
    "sessionStorage",
    "window",
];
const CHAIN_BUILTIN_NAMESPACE_NAMES: [&str; 12] = [
    "Array", "BigInt", "Boolean", "Date", "JSON", "Math", "Number", "Object", "Reflect", "RegExp",
    "String", "Symbol",
];
const MESSAGE: &str = "Chaining state updates triggers an extra render each step.";

#[derive(Debug, Default, Clone)]
pub struct NoChainStateUpdates;

struct ChainSetterCandidate {
    report_call_id: NodeId,
    source_setter_call_ids: Vec<NodeId>,
    direct_state_pair: Option<(SymbolId, SymbolId)>,
}

struct ChainStateSetterCall {
    call_id: NodeId,
    owner_function_id: NodeId,
    state_symbol_id: SymbolId,
    setter_symbol_id: SymbolId,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ChainSnapshotShape {
    scalar_key: Option<String>,
    element_keys: Option<Vec<String>>,
}

#[derive(Default)]
struct ChainSnapshotEnvironment {
    ref_shapes: FxHashMap<SymbolId, ChainSnapshotShape>,
    previous_value_keys: FxHashMap<SymbolId, String>,
}

#[derive(Clone, Default)]
struct ChainBooleanSubstitution {
    boolean_value: Option<bool>,
    current_key: Option<String>,
    is_reflexive: bool,
    snapshot_key: Option<String>,
}

struct ChainBooleanEnvironment<'environment, 'ast> {
    allow_helper_call: bool,
    component_function_id: NodeId,
    effect_function_id: NodeId,
    snapshot_environment: &'environment ChainSnapshotEnvironment,
    substitutions: FxHashMap<SymbolId, ChainBooleanSubstitution>,
    visited_symbol_ids: FxHashSet<SymbolId>,
    ctx: &'environment LintContext<'ast>,
}

declare_oxc_lint!(
    /// Warns when an effect chains one state update from another state update.
    NoChainStateUpdates,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when an effect chains state updates.",
);

impl Rule for NoChainStateUpdates {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_capability(ctx, "react:18") {
            return;
        }
        let effect_call_ids = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call) = node.kind() else {
                    return None;
                };
                is_react_hook_call(call, &CHAIN_EFFECT_HOOK_NAMES, ctx).then(|| node.id())
            })
            .collect::<Vec<_>>();
        if effect_call_ids.is_empty() {
            return;
        }
        let local_call_edges = chain_local_call_edges(ctx);
        let state_setter_calls = chain_state_setter_calls(ctx);
        for effect_call_id in effect_call_ids {
            chain_check_effect(
                ctx.nodes().get_node(effect_call_id),
                ctx,
                &local_call_edges,
                &state_setter_calls,
            );
        }
    }
}

fn chain_check_effect<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    local_call_edges: &FxHashMap<NodeId, Vec<(NodeId, NodeId)>>,
    state_setter_calls: &[ChainStateSetterCall],
) {
    let AstKind::CallExpression(effect_call) = node.kind() else {
        return;
    };
    if !is_react_hook_call(effect_call, &CHAIN_EFFECT_HOOK_NAMES, ctx) {
        return;
    }
    let Some(callback_expression) = effect_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return;
    };
    let Some(callback_node_id) = chain_callback_function_id(callback_expression, ctx) else {
        return;
    };
    if chain_function_is_async(callback_node_id, ctx) {
        return;
    }
    if chain_effect_has_cleanup(callback_node_id, ctx) {
        return;
    }
    let Some(Expression::ArrayExpression(dependencies)) = effect_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return;
    };
    let mut state_dependency_symbol_ids = FxHashSet::default();
    for dependency in dependencies
        .elements
        .iter()
        .filter_map(chain_array_element_expression)
    {
        chain_collect_dependency_state_symbols(
            dependency,
            true,
            ctx,
            &mut FxHashSet::default(),
            &mut state_dependency_symbol_ids,
        );
    }
    if state_dependency_symbol_ids.is_empty() {
        return;
    }
    let Some(component_node_id) = chain_nearest_function_node_id(node.id(), ctx) else {
        return;
    };
    let snapshot_environment =
        chain_collect_snapshot_environment(callback_node_id, component_node_id, ctx);
    if state_dependency_symbol_ids.iter().all(|state_symbol_id| {
        chain_state_setter_symbol_id(*state_symbol_id, ctx).is_some_and(|setter_symbol_id| {
            chain_state_is_externally_driven(setter_symbol_id, component_node_id, ctx)
        })
    }) {
        return;
    }

    let synchronous_function_ids =
        chain_synchronous_execution_function_ids(callback_node_id, local_call_edges, ctx);
    let mut raw_setter_calls = Vec::new();
    for state_setter_call in state_setter_calls {
        if !synchronous_function_ids.contains(&state_setter_call.owner_function_id) {
            continue;
        }
        raw_setter_calls.push((
            state_setter_call.call_id,
            state_setter_call.state_symbol_id,
            state_setter_call.setter_symbol_id,
        ));
    }

    let mut setter_candidates = Vec::new();
    for (setter_call_id, state_symbol_id, setter_symbol_id) in &raw_setter_calls {
        let Some(owner_function_id) = chain_nearest_function_node_id(*setter_call_id, ctx) else {
            continue;
        };
        if owner_function_id == callback_node_id {
            chain_add_setter_candidate(
                &mut setter_candidates,
                *setter_call_id,
                *setter_call_id,
                Some((*state_symbol_id, *setter_symbol_id)),
            );
            continue;
        }
        for &(call_id, called_function_id) in local_call_edges
            .get(&callback_node_id)
            .into_iter()
            .flatten()
        {
            if called_function_id == owner_function_id
                || chain_function_reaches_function(
                    called_function_id,
                    owner_function_id,
                    local_call_edges,
                    &mut FxHashSet::default(),
                )
            {
                chain_add_setter_candidate(&mut setter_candidates, call_id, *setter_call_id, None);
            }
        }
    }
    setter_candidates.sort_unstable_by_key(|candidate| {
        ctx.nodes().get_node(candidate.report_call_id).span().start
    });

    let mut dom_synced_setter_symbol_ids = FxHashSet::default();
    for (setter_call_id, _, setter_symbol_id) in &raw_setter_calls {
        if chain_nearest_function_node_id(*setter_call_id, ctx) != Some(callback_node_id) {
            continue;
        }
        let setter_call_node = ctx.nodes().get_node(*setter_call_id);
        if !chain_is_reachable_under_snapshot_environment(
            setter_call_node,
            callback_node_id,
            component_node_id,
            &snapshot_environment,
            ctx,
        ) {
            continue;
        }
        let AstKind::CallExpression(setter_call) = setter_call_node.kind() else {
            continue;
        };
        if setter_call
            .arguments
            .iter()
            .filter_map(chain_argument_expression)
            .any(|argument| {
                chain_expression_reads_post_mount_value(
                    argument,
                    callback_node_id,
                    ctx,
                    &mut FxHashSet::default(),
                )
            })
        {
            dom_synced_setter_symbol_ids.insert(*setter_symbol_id);
        }
    }

    for setter_candidate in setter_candidates {
        let report_call_node = ctx.nodes().get_node(setter_candidate.report_call_id);
        if !chain_is_reachable_under_snapshot_environment(
            report_call_node,
            callback_node_id,
            component_node_id,
            &snapshot_environment,
            ctx,
        ) {
            continue;
        }
        let AstKind::CallExpression(report_call) = report_call_node.kind() else {
            continue;
        };
        if setter_candidate
            .direct_state_pair
            .is_some_and(|(_, setter_symbol_id)| {
                dom_synced_setter_symbol_ids.contains(&setter_symbol_id)
            })
        {
            continue;
        }
        let report_has_state_source = report_call
            .arguments
            .iter()
            .filter_map(chain_argument_expression)
            .any(|argument| {
                chain_expression_has_state_source(argument, ctx, &mut FxHashSet::default())
            });
        let source_has_state_source =
            setter_candidate
                .source_setter_call_ids
                .iter()
                .any(|source_setter_call_id| {
                    let AstKind::CallExpression(source_setter_call) =
                        ctx.nodes().get_node(*source_setter_call_id).kind()
                    else {
                        return false;
                    };
                    source_setter_call
                        .arguments
                        .iter()
                        .filter_map(chain_argument_expression)
                        .any(|argument| {
                            chain_expression_has_state_source(
                                argument,
                                ctx,
                                &mut FxHashSet::default(),
                            )
                        })
                });
        let helper_call_has_state_source = local_call_edges
            .get(&callback_node_id)
            .into_iter()
            .flatten()
            .find_map(|(call_id, function_id)| {
                (*call_id == setter_candidate.report_call_id).then_some(*function_id)
            })
            .is_some_and(|function_id| {
                chain_function_call_arguments_have_state_source(function_id, ctx)
            });
        if report_has_state_source || source_has_state_source || helper_call_has_state_source {
            continue;
        }
        if let Some((state_symbol_id, _)) = setter_candidate.direct_state_pair
            && state_dependency_symbol_ids.contains(&state_symbol_id)
            && report_call
                .arguments
                .iter()
                .filter_map(chain_argument_expression)
                .all(|argument| {
                    chain_expression_is_simple(
                        argument,
                        callback_node_id,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                })
        {
            continue;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(report_call.span));
    }
}

fn chain_state_setter_calls(ctx: &LintContext<'_>) -> Vec<ChainStateSetterCall> {
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::CallExpression(setter_call) = candidate.kind() else {
                return None;
            };
            let owner_function_id = chain_nearest_function_node_id(candidate.id(), ctx)?;
            let Expression::Identifier(setter_identifier) =
                setter_call.callee.get_inner_expression()
            else {
                return None;
            };
            let (state_symbol_id, setter_symbol_id) =
                chain_resolve_use_state_pair(setter_identifier, ctx)?;
            Some(ChainStateSetterCall {
                call_id: candidate.id(),
                owner_function_id,
                state_symbol_id,
                setter_symbol_id,
            })
        })
        .collect()
}

fn chain_array_element_expression<'a, 'b>(
    element: &'b ArrayExpressionElement<'a>,
) -> Option<&'b Expression<'a>> {
    match element {
        ArrayExpressionElement::SpreadElement(spread) => Some(&spread.argument),
        element => element.as_expression(),
    }
}

fn chain_add_setter_candidate(
    candidates: &mut Vec<ChainSetterCandidate>,
    report_call_id: NodeId,
    source_setter_call_id: NodeId,
    direct_state_pair: Option<(SymbolId, SymbolId)>,
) {
    if let Some(candidate) = candidates
        .iter_mut()
        .find(|candidate| candidate.report_call_id == report_call_id)
    {
        if !candidate
            .source_setter_call_ids
            .contains(&source_setter_call_id)
        {
            candidate.source_setter_call_ids.push(source_setter_call_id);
        }
        if let Some(direct_state_pair) = direct_state_pair
            && candidate.direct_state_pair != Some(direct_state_pair)
        {
            candidate.direct_state_pair = None;
        }
        return;
    }
    candidates.push(ChainSetterCandidate {
        report_call_id,
        source_setter_call_ids: vec![source_setter_call_id],
        direct_state_pair,
    });
}

fn chain_ref_current_symbol_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let member = expression.get_inner_expression().as_member_expression()?;
    if member.static_property_name().as_deref() != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn chain_assignment_ref_current_symbol_id<'a>(
    assignment: &oxc_ast::ast::AssignmentExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let member = assignment.left.as_member_expression()?;
    if member.static_property_name().as_deref() != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn chain_symbol_has_non_initializer_write(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
}

fn chain_is_stable_parameter_default(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_)
    ) || matches!(expression.get_inner_expression(), Expression::TemplateLiteral(template)
        if template.expressions.is_empty())
}

fn chain_name_starts_uppercase(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}

fn chain_function_is_component(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    match function_node.kind() {
        AstKind::Function(function) => {
            if function
                .id
                .as_ref()
                .is_some_and(|identifier| chain_name_starts_uppercase(identifier.name.as_str()))
            {
                return true;
            }
        }
        AstKind::ArrowFunctionExpression(_) => {}
        _ => return false,
    }
    let mut current = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::CallExpression(call)
                if call.arguments.iter().any(|argument| {
                    argument
                        .as_expression()
                        .is_some_and(|expression| expression.span() == current.span())
                }) =>
            {
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::VariableDeclarator(declarator) => {
                return declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|identifier| {
                        chain_name_starts_uppercase(identifier.name.as_str())
                    });
            }
            AstKind::ExportDefaultDeclaration(_) => return true,
            _ => return false,
        }
    }
}

fn chain_pattern_is_direct_parameter_binding(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            assignment
                .left
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                && chain_is_stable_parameter_default(&assignment.right)
        }
        BindingPattern::ObjectPattern(object_pattern) => {
            object_pattern
                .properties
                .iter()
                .any(|property| match &property.value {
                    BindingPattern::BindingIdentifier(identifier) => {
                        identifier.symbol_id() == symbol_id
                    }
                    BindingPattern::AssignmentPattern(assignment) => {
                        assignment
                            .left
                            .get_binding_identifier()
                            .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                            && chain_is_stable_parameter_default(&assignment.right)
                    }
                    _ => false,
                })
        }
        _ => false,
    }
}

fn chain_symbol_is_direct_component_prop(
    symbol_id: SymbolId,
    component_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if !chain_function_is_component(component_function_id, ctx) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::FormalParameter(parameter) = declaration.kind() else {
        return false;
    };
    chain_nearest_function_node_id(declaration.id(), ctx) == Some(component_function_id)
        && chain_pattern_is_direct_parameter_binding(&parameter.pattern, symbol_id)
}

fn chain_symbol_type_annotation<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a TSType<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .filter(|identifier| identifier.symbol_id() == symbol_id)
            .and(declarator.type_annotation.as_ref())
            .map(|annotation| &annotation.type_annotation),
        AstKind::FormalParameter(parameter) => {
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
            {
                return parameter
                    .type_annotation
                    .as_ref()
                    .map(|annotation| &annotation.type_annotation);
            }
            let BindingPattern::ObjectPattern(object_pattern) = &parameter.pattern else {
                return None;
            };
            let property_name = object_pattern.properties.iter().find_map(|property| {
                property
                    .value
                    .get_binding_identifier()
                    .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                    .then(|| property.key.static_name())
                    .flatten()
            })?;
            let TSType::TSTypeLiteral(type_literal) =
                &parameter.type_annotation.as_ref()?.type_annotation
            else {
                return None;
            };
            type_literal.members.iter().find_map(|member| {
                let oxc_ast::ast::TSSignature::TSPropertySignature(property) = member else {
                    return None;
                };
                (property.key.static_name().as_deref() == Some(property_name.as_ref())).then(
                    || {
                        property
                            .type_annotation
                            .as_ref()
                            .map(|annotation| &annotation.type_annotation)
                    },
                )?
            })
        }
        _ => None,
    }
}

fn chain_type_is_definitely_primitive(type_annotation: &TSType<'_>) -> bool {
    match type_annotation {
        TSType::TSBigIntKeyword(_)
        | TSType::TSBooleanKeyword(_)
        | TSType::TSNeverKeyword(_)
        | TSType::TSNullKeyword(_)
        | TSType::TSNumberKeyword(_)
        | TSType::TSStringKeyword(_)
        | TSType::TSSymbolKeyword(_)
        | TSType::TSUndefinedKeyword(_)
        | TSType::TSLiteralType(_) => true,
        TSType::TSUnionType(union) => union.types.iter().all(chain_type_is_definitely_primitive),
        _ => false,
    }
}

fn chain_type_is_definitely_reflexive(type_annotation: &TSType<'_>) -> bool {
    match type_annotation {
        TSType::TSBigIntKeyword(_)
        | TSType::TSBooleanKeyword(_)
        | TSType::TSNeverKeyword(_)
        | TSType::TSNullKeyword(_)
        | TSType::TSObjectKeyword(_)
        | TSType::TSStringKeyword(_)
        | TSType::TSSymbolKeyword(_)
        | TSType::TSUndefinedKeyword(_)
        | TSType::TSLiteralType(_) => true,
        TSType::TSUnionType(union) => union.types.iter().all(chain_type_is_definitely_reflexive),
        _ => false,
    }
}

fn chain_expression_is_definitely_primitive<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if matches!(
        expression.get_inner_expression(),
        Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_)
    ) {
        return true;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    chain_symbol_type_annotation(symbol_id, ctx).is_some_and(chain_type_is_definitely_primitive)
}

fn chain_is_supported_prop_projection<'a>(
    expression: &Expression<'a>,
    component_function_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if chain_symbol_is_direct_component_prop(symbol_id, component_function_id, ctx) {
                return true;
            }
            if !visited_symbol_ids.insert(symbol_id)
                || chain_symbol_has_non_initializer_write(symbol_id, ctx)
            {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                visited_symbol_ids.remove(&symbol_id);
                return false;
            };
            if !matches!(
                ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                visited_symbol_ids.remove(&symbol_id);
                return false;
            }
            let is_supported = declarator.init.as_ref().is_some_and(|initializer| {
                chain_is_supported_prop_projection(
                    initializer,
                    component_function_id,
                    ctx,
                    visited_symbol_ids,
                )
            });
            visited_symbol_ids.remove(&symbol_id);
            is_supported
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::BitwiseNot => {
            chain_expression_is_definitely_primitive(&unary.argument, ctx)
                && chain_is_supported_prop_projection(
                    &unary.argument,
                    component_function_id,
                    ctx,
                    visited_symbol_ids,
                )
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::BitwiseOR
                    | BinaryOperator::BitwiseAnd
                    | BinaryOperator::BitwiseXOR
                    | BinaryOperator::ShiftLeft
                    | BinaryOperator::ShiftRight
                    | BinaryOperator::ShiftRightZeroFill
            ) =>
        {
            [&binary.left, &binary.right].iter().all(|operand| {
                matches!(
                    operand.get_inner_expression(),
                    Expression::BooleanLiteral(_)
                        | Expression::NullLiteral(_)
                        | Expression::NumericLiteral(_)
                        | Expression::BigIntLiteral(_)
                        | Expression::StringLiteral(_)
                ) || (chain_expression_is_definitely_primitive(operand, ctx)
                    && chain_is_supported_prop_projection(
                        operand,
                        component_function_id,
                        ctx,
                        visited_symbol_ids,
                    ))
            })
        }
        Expression::CallExpression(call) if call.arguments.len() == 1 => {
            let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                return false;
            };
            if !matches!(callee.name.as_str(), "Boolean" | "String")
                || ctx
                    .scoping()
                    .get_reference(callee.reference_id())
                    .symbol_id()
                    .is_some()
            {
                return false;
            }
            call.arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| {
                    chain_expression_is_definitely_primitive(argument, ctx)
                        && chain_is_supported_prop_projection(
                            argument,
                            component_function_id,
                            ctx,
                            visited_symbol_ids,
                        )
                })
        }
        _ => false,
    }
}

fn chain_stable_current_value_key<'a>(
    expression: &Expression<'a>,
    component_function_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if chain_expression_has_state_source(expression, ctx, &mut FxHashSet::default())
        || !chain_is_supported_prop_projection(
            expression,
            component_function_id,
            ctx,
            &mut FxHashSet::default(),
        )
    {
        return None;
    }
    resolve_expression_key(expression, ctx, &mut Vec::new())
}

fn chain_snapshot_shape<'a>(
    expression: &Expression<'a>,
    component_function_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<ChainSnapshotShape> {
    if let Expression::ArrayExpression(array) = expression.get_inner_expression() {
        let mut element_keys = Vec::new();
        for element in &array.elements {
            let element = match element {
                ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_) => {
                    return None;
                }
                element => element.as_expression()?,
            };
            element_keys.push(chain_stable_current_value_key(
                element,
                component_function_id,
                ctx,
            )?);
        }
        return Some(ChainSnapshotShape {
            scalar_key: None,
            element_keys: Some(element_keys),
        });
    }
    Some(ChainSnapshotShape {
        scalar_key: Some(chain_stable_current_value_key(
            expression,
            component_function_id,
            ctx,
        )?),
        element_keys: None,
    })
}

fn chain_node_is_unconditional_in_effect<'a>(
    node: &AstNode<'a>,
    effect_function_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    if chain_nearest_function_node_id(node.id(), ctx) != Some(effect_function_id) {
        return false;
    }
    let entry_block = ctx.nodes().cfg_id(effect_function_id);
    let target_block = ctx.nodes().cfg_id(node.id());
    let reachable_blocks = chain_reachable_effect_cfg_blocks(entry_block, None, ctx);
    if !reachable_blocks.contains(&target_block) {
        return true;
    }
    !chain_reachable_effect_cfg_blocks(entry_block, Some(target_block), ctx)
        .into_iter()
        .any(|block_id| {
            ctx.cfg()
                .basic_block(block_id)
                .instructions()
                .iter()
                .any(|instruction| {
                    matches!(
                        instruction.kind,
                        oxc_cfg::InstructionKind::ImplicitReturn
                            | oxc_cfg::InstructionKind::Return(_)
                    )
                })
        })
}

fn chain_reachable_effect_cfg_blocks(
    entry_block: oxc_cfg::BlockNodeId,
    excluded_block: Option<oxc_cfg::BlockNodeId>,
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_cfg::BlockNodeId> {
    let mut visited_blocks = FxHashSet::default();
    let mut pending_blocks = Vec::new();
    if Some(entry_block) != excluded_block {
        pending_blocks.push(entry_block);
    }
    while let Some(block_id) = pending_blocks.pop() {
        if !visited_blocks.insert(block_id) {
            continue;
        }
        for edge in ctx
            .cfg()
            .graph()
            .edges_directed(block_id, oxc_cfg::graph::Direction::Outgoing)
        {
            if matches!(
                edge.weight(),
                oxc_cfg::EdgeType::NewFunction
                    | oxc_cfg::EdgeType::Unreachable
                    | oxc_cfg::EdgeType::Error(_)
            ) {
                continue;
            }
            let target = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if Some(target) != excluded_block {
                pending_blocks.push(target);
            }
        }
    }
    visited_blocks
}

fn chain_ref_symbol_is_genuine_use_ref(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    declarator
        .id
        .get_binding_identifier()
        .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
        && matches!(declarator.init.as_ref().map(Expression::get_inner_expression),
            Some(Expression::CallExpression(call)) if is_react_hook_call(call, &["useRef"], ctx))
}

fn chain_ref_symbol_has_only_supported_current_references(
    symbol_id: SymbolId,
    tracked_assignment_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .all(|reference| {
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            let member_node = ctx.nodes().parent_node(identifier_node.id());
            let member_matches = match member_node.kind() {
                AstKind::StaticMemberExpression(member) => {
                    member.object.span() == identifier_node.span()
                        && member.property.name == "current"
                }
                AstKind::ComputedMemberExpression(member) => {
                    member.object.span() == identifier_node.span()
                        && matches!(member.expression.get_inner_expression(), Expression::StringLiteral(literal) if literal.value == "current")
                }
                _ => false,
            };
            if !member_matches {
                return false;
            }
            let member_root = transparent_expression_root(member_node, ctx);
            let parent = ctx.nodes().parent_node(member_root.id());
            match parent.kind() {
                AstKind::UpdateExpression(_) => false,
                AstKind::AssignmentExpression(assignment)
                    if assignment.left.span() == member_root.span() =>
                {
                    parent.id() == tracked_assignment_id
                }
                _ => true,
            }
        })
}

fn chain_collect_snapshot_environment(
    effect_function_id: NodeId,
    component_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> ChainSnapshotEnvironment {
    let mut assignments_by_ref_symbol_id = FxHashMap::<SymbolId, Vec<NodeId>>::default();
    for candidate in ctx.nodes().iter() {
        if chain_nearest_function_node_id(candidate.id(), ctx) != Some(effect_function_id) {
            continue;
        }
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            continue;
        };
        if assignment.operator != AssignmentOperator::Assign {
            continue;
        }
        let Some(ref_symbol_id) = chain_assignment_ref_current_symbol_id(assignment, ctx) else {
            continue;
        };
        assignments_by_ref_symbol_id
            .entry(ref_symbol_id)
            .or_default()
            .push(candidate.id());
    }

    let mut environment = ChainSnapshotEnvironment::default();
    for (ref_symbol_id, assignment_ids) in assignments_by_ref_symbol_id {
        let [assignment_id] = assignment_ids.as_slice() else {
            continue;
        };
        let assignment_node = ctx.nodes().get_node(*assignment_id);
        let AstKind::AssignmentExpression(assignment) = assignment_node.kind() else {
            continue;
        };
        if !chain_node_is_unconditional_in_effect(assignment_node, effect_function_id, ctx)
            || !chain_ref_symbol_is_genuine_use_ref(ref_symbol_id, ctx)
            || !chain_ref_symbol_has_only_supported_current_references(
                ref_symbol_id,
                *assignment_id,
                ctx,
            )
        {
            continue;
        }
        let declaration = ctx.symbol_declaration(ref_symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            continue;
        };
        let Some(Expression::CallExpression(use_ref_call)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            continue;
        };
        let Some(initializer) = use_ref_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        let Some(initial_shape) = chain_snapshot_shape(initializer, component_function_id, ctx)
        else {
            continue;
        };
        let Some(assigned_shape) =
            chain_snapshot_shape(&assignment.right, component_function_id, ctx)
        else {
            continue;
        };
        if initial_shape == assigned_shape {
            environment.ref_shapes.insert(ref_symbol_id, assigned_shape);
        }
    }

    for candidate in ctx.nodes().iter() {
        if chain_nearest_function_node_id(candidate.id(), ctx) != Some(effect_function_id) {
            continue;
        }
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            continue;
        };
        let Some(initializer) = &declarator.init else {
            continue;
        };
        let Some(ref_symbol_id) = chain_ref_current_symbol_id(initializer, ctx) else {
            continue;
        };
        let Some(snapshot_shape) = environment.ref_shapes.get(&ref_symbol_id) else {
            continue;
        };
        if let BindingPattern::BindingIdentifier(identifier) = &declarator.id
            && matches!(
                ctx.nodes().parent_node(candidate.id()).kind(),
                AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            )
            && let Some(scalar_key) = &snapshot_shape.scalar_key
        {
            environment
                .previous_value_keys
                .insert(identifier.symbol_id(), scalar_key.clone());
            continue;
        }
        let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
            continue;
        };
        let Some(element_keys) = &snapshot_shape.element_keys else {
            continue;
        };
        for (element, element_key) in pattern.elements.iter().zip(element_keys) {
            let Some(BindingPattern::BindingIdentifier(identifier)) = element else {
                continue;
            };
            environment
                .previous_value_keys
                .insert(identifier.symbol_id(), element_key.clone());
        }
    }
    environment
}

fn chain_current_value_key<'a>(
    expression: &Expression<'a>,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> Option<String> {
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(symbol_id) = environment
            .ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        && let Some(substitution) = environment.substitutions.get(&symbol_id)
    {
        return substitution.current_key.clone();
    }
    chain_stable_current_value_key(
        expression,
        environment.component_function_id,
        environment.ctx,
    )
}

fn chain_snapshot_value_key<'a>(
    expression: &Expression<'a>,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> Option<String> {
    if let Some(ref_symbol_id) = chain_ref_current_symbol_id(expression, environment.ctx) {
        return environment
            .snapshot_environment
            .ref_shapes
            .get(&ref_symbol_id)
            .and_then(|shape| shape.scalar_key.clone());
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = environment
        .ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if let Some(substitution) = environment.substitutions.get(&symbol_id) {
        return substitution.snapshot_key.clone();
    }
    if let Some(key) = environment
        .snapshot_environment
        .previous_value_keys
        .get(&symbol_id)
    {
        return Some(key.clone());
    }
    if environment.visited_symbol_ids.contains(&symbol_id)
        || chain_symbol_has_non_initializer_write(symbol_id, environment.ctx)
    {
        return None;
    }
    let declaration = environment.ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !matches!(
        environment.ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable) if variable.kind.is_const()
    ) {
        return None;
    }
    let mut next_environment = ChainBooleanEnvironment {
        allow_helper_call: environment.allow_helper_call,
        component_function_id: environment.component_function_id,
        effect_function_id: environment.effect_function_id,
        snapshot_environment: environment.snapshot_environment,
        substitutions: environment.substitutions.clone(),
        visited_symbol_ids: environment.visited_symbol_ids.clone(),
        ctx: environment.ctx,
    };
    next_environment.visited_symbol_ids.insert(symbol_id);
    chain_snapshot_value_key(declarator.init.as_ref()?, &next_environment)
}

fn chain_expression_is_definitely_reflexive<'a>(
    expression: &Expression<'a>,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_) => true,
        Expression::NumericLiteral(_) => true,
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::LogicalNot
                    | UnaryOperator::Typeof
                    | UnaryOperator::Void
                    | UnaryOperator::BitwiseNot
            ) =>
        {
            true
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::BitwiseOR
                    | BinaryOperator::BitwiseAnd
                    | BinaryOperator::BitwiseXOR
                    | BinaryOperator::ShiftLeft
                    | BinaryOperator::ShiftRight
                    | BinaryOperator::ShiftRightZeroFill
            ) =>
        {
            true
        }
        Expression::CallExpression(call) => {
            let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                return false;
            };
            matches!(callee.name.as_str(), "Boolean" | "String")
                && environment
                    .ctx
                    .scoping()
                    .get_reference(callee.reference_id())
                    .symbol_id()
                    .is_none()
        }
        Expression::Identifier(identifier) => {
            if identifier.name == "undefined"
                && environment
                    .ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
            {
                return true;
            }
            let Some(symbol_id) = environment
                .ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if let Some(substitution) = environment.substitutions.get(&symbol_id) {
                return substitution.is_reflexive;
            }
            if chain_symbol_type_annotation(symbol_id, environment.ctx)
                .is_some_and(chain_type_is_definitely_reflexive)
            {
                return true;
            }
            if environment.visited_symbol_ids.contains(&symbol_id)
                || chain_symbol_has_non_initializer_write(symbol_id, environment.ctx)
            {
                return false;
            }
            let declaration = environment.ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            if !matches!(
                environment.ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            ) {
                return false;
            }
            let Some(initializer) = &declarator.init else {
                return false;
            };
            let mut next_environment = ChainBooleanEnvironment {
                allow_helper_call: environment.allow_helper_call,
                component_function_id: environment.component_function_id,
                effect_function_id: environment.effect_function_id,
                snapshot_environment: environment.snapshot_environment,
                substitutions: environment.substitutions.clone(),
                visited_symbol_ids: environment.visited_symbol_ids.clone(),
                ctx: environment.ctx,
            };
            next_environment.visited_symbol_ids.insert(symbol_id);
            chain_expression_is_definitely_reflexive(initializer, &next_environment)
        }
        _ => false,
    }
}

fn chain_evaluate_comparison<'a>(
    binary: &oxc_ast::ast::BinaryExpression<'a>,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> Option<bool> {
    if !matches!(
        binary.operator,
        BinaryOperator::Equality
            | BinaryOperator::StrictEquality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictInequality
    ) {
        return None;
    }
    let left_snapshot_key = chain_snapshot_value_key(&binary.left, environment);
    let right_snapshot_key = chain_snapshot_value_key(&binary.right, environment);
    let left_current_key = chain_current_value_key(&binary.left, environment);
    let right_current_key = chain_current_value_key(&binary.right, environment);
    let current_expression =
        if left_snapshot_key.is_some() && left_snapshot_key == right_current_key {
            Some(&binary.right)
        } else if right_snapshot_key.is_some() && right_snapshot_key == left_current_key {
            Some(&binary.left)
        } else {
            None
        }?;
    if !chain_expression_is_definitely_reflexive(current_expression, environment) {
        return None;
    }
    Some(matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    ))
}

fn chain_program_has_global_object_is_write(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let target_member = match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                if let oxc_ast::ast::AssignmentTarget::AssignmentTargetIdentifier(identifier) =
                    &assignment.left
                {
                    return identifier.name == "Object"
                        && ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_none();
                }
                assignment.left.as_member_expression()
            }
            AstKind::UpdateExpression(update) => update.argument.as_member_expression(),
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Delete => {
                unary.argument.get_inner_expression().as_member_expression()
            }
            _ => None,
        };
        let Some(member) = target_member else {
            return false;
        };
        let Expression::Identifier(object) = member.object().get_inner_expression() else {
            return false;
        };
        object.name == "Object"
            && ctx
                .scoping()
                .get_reference(object.reference_id())
                .symbol_id()
                .is_none()
            && member
                .static_property_name()
                .as_deref()
                .is_none_or(|name| name == "is")
    })
}

fn chain_evaluate_object_is<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> Option<bool> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    if member.static_property_name().as_deref() != Some("is") {
        return None;
    }
    let Expression::Identifier(object) = member.object().get_inner_expression() else {
        return None;
    };
    if object.name != "Object"
        || environment
            .ctx
            .scoping()
            .get_reference(object.reference_id())
            .symbol_id()
            .is_some()
        || chain_program_has_global_object_is_write(environment.ctx)
        || call.arguments.len() != 2
    {
        return None;
    }
    let left = call.arguments.first()?.as_expression()?;
    let right = call.arguments.get(1)?.as_expression()?;
    let left_snapshot_key = chain_snapshot_value_key(left, environment);
    let right_snapshot_key = chain_snapshot_value_key(right, environment);
    let left_current_key = chain_current_value_key(left, environment);
    let right_current_key = chain_current_value_key(right, environment);
    (left_snapshot_key.is_some() && left_snapshot_key == right_current_key
        || right_snapshot_key.is_some() && right_snapshot_key == left_current_key)
        .then_some(true)
}

fn chain_evaluate_boolean<'a>(
    expression: &Expression<'a>,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::Identifier(identifier) => {
            let symbol_id = environment
                .ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if let Some(substitution) = environment.substitutions.get(&symbol_id) {
                return substitution.boolean_value;
            }
            if environment.visited_symbol_ids.contains(&symbol_id)
                || chain_symbol_has_non_initializer_write(symbol_id, environment.ctx)
            {
                return None;
            }
            let declaration = environment.ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            if !matches!(
                environment.ctx.nodes().parent_node(declaration.id()).kind(),
                AstKind::VariableDeclaration(variable) if variable.kind.is_const()
            ) {
                return None;
            }
            let mut next_environment = ChainBooleanEnvironment {
                allow_helper_call: environment.allow_helper_call,
                component_function_id: environment.component_function_id,
                effect_function_id: environment.effect_function_id,
                snapshot_environment: environment.snapshot_environment,
                substitutions: environment.substitutions.clone(),
                visited_symbol_ids: environment.visited_symbol_ids.clone(),
                ctx: environment.ctx,
            };
            next_environment.visited_symbol_ids.insert(symbol_id);
            chain_evaluate_boolean(declarator.init.as_ref()?, &next_environment)
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            chain_evaluate_boolean(&unary.argument, environment).map(|value| !value)
        }
        Expression::LogicalExpression(logical) => {
            let left = chain_evaluate_boolean(&logical.left, environment);
            match logical.operator {
                LogicalOperator::And if left == Some(false) => Some(false),
                LogicalOperator::And if left == Some(true) => {
                    chain_evaluate_boolean(&logical.right, environment)
                }
                LogicalOperator::And => (chain_evaluate_boolean(&logical.right, environment)
                    == Some(false))
                .then_some(false),
                LogicalOperator::Or if left == Some(true) => Some(true),
                LogicalOperator::Or if left == Some(false) => {
                    chain_evaluate_boolean(&logical.right, environment)
                }
                LogicalOperator::Or => (chain_evaluate_boolean(&logical.right, environment)
                    == Some(true))
                .then_some(true),
                LogicalOperator::Coalesce => None,
            }
        }
        Expression::BinaryExpression(binary) => chain_evaluate_comparison(binary, environment),
        Expression::CallExpression(call) => {
            if let Some(value) = chain_evaluate_object_is(call, environment) {
                return Some(value);
            }
            if !environment.allow_helper_call {
                return None;
            }
            let Expression::Identifier(_) = call.callee.get_inner_expression() else {
                return None;
            };
            let helper_function_id =
                exact_local_callback_function_id(&call.callee, environment.ctx, &mut Vec::new())?;
            let helper_node = environment.ctx.nodes().get_node(helper_function_id);
            let (parameters, return_expression) = match helper_node.kind() {
                AstKind::Function(function) if !function.r#async && !function.generator => {
                    let body = function.body.as_ref()?;
                    let [Statement::ReturnStatement(return_statement)] = body.statements.as_slice()
                    else {
                        return None;
                    };
                    (&function.params, return_statement.argument.as_ref()?)
                }
                AstKind::ArrowFunctionExpression(function) if !function.r#async => {
                    let expression = function.get_expression()?;
                    (&function.params, expression)
                }
                _ => return None,
            };
            if parameters.items.len() != call.arguments.len() {
                return None;
            }
            let mut substitutions = environment.substitutions.clone();
            for (parameter, argument) in parameters.items.iter().zip(&call.arguments) {
                let BindingPattern::BindingIdentifier(parameter_identifier) = &parameter.pattern
                else {
                    return None;
                };
                let argument = argument.as_expression()?;
                substitutions.insert(
                    parameter_identifier.symbol_id(),
                    ChainBooleanSubstitution {
                        boolean_value: chain_evaluate_boolean(argument, environment),
                        current_key: chain_current_value_key(argument, environment),
                        is_reflexive: chain_expression_is_definitely_reflexive(
                            argument,
                            environment,
                        ),
                        snapshot_key: chain_snapshot_value_key(argument, environment),
                    },
                );
            }
            let helper_environment = ChainBooleanEnvironment {
                allow_helper_call: false,
                component_function_id: environment.component_function_id,
                effect_function_id: environment.effect_function_id,
                snapshot_environment: environment.snapshot_environment,
                substitutions,
                visited_symbol_ids: FxHashSet::default(),
                ctx: environment.ctx,
            };
            chain_evaluate_boolean(return_expression, &helper_environment)
        }
        _ => None,
    }
}

fn chain_statement_can_complete_normally<'a>(
    statement: &Statement<'a>,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> bool {
    match statement {
        Statement::ReturnStatement(_)
        | Statement::ThrowStatement(_)
        | Statement::BreakStatement(_)
        | Statement::ContinueStatement(_) => false,
        Statement::BlockStatement(block) => block
            .body
            .iter()
            .all(|statement| chain_statement_can_complete_normally(statement, environment)),
        Statement::IfStatement(statement) => {
            let test_value = chain_evaluate_boolean(&statement.test, environment);
            if test_value == Some(true) {
                return chain_statement_can_complete_normally(&statement.consequent, environment);
            }
            if test_value == Some(false) {
                return statement.alternate.as_ref().is_none_or(|alternate| {
                    chain_statement_can_complete_normally(alternate, environment)
                });
            }
            chain_statement_can_complete_normally(&statement.consequent, environment)
                || statement.alternate.as_ref().is_none_or(|alternate| {
                    chain_statement_can_complete_normally(alternate, environment)
                })
        }
        Statement::LabeledStatement(statement) => {
            if chain_statement_can_complete_with_break_to_label(
                &statement.body,
                statement.label.name.as_str(),
                environment,
            ) {
                return true;
            }
            chain_statement_can_complete_normally_for_label(&statement.body, environment)
        }
        _ => true,
    }
}

fn chain_statement_can_complete_normally_for_label<'a>(
    statement: &Statement<'a>,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> bool {
    match statement {
        Statement::ReturnStatement(_)
        | Statement::ThrowStatement(_)
        | Statement::BreakStatement(_)
        | Statement::ContinueStatement(_) => false,
        Statement::BlockStatement(block) => block.body.iter().all(|statement| {
            chain_statement_can_complete_normally_for_label(statement, environment)
        }),
        Statement::IfStatement(statement) => {
            let test_value = chain_evaluate_boolean(&statement.test, environment);
            if test_value == Some(true) {
                return chain_statement_can_complete_normally_for_label(
                    &statement.consequent,
                    environment,
                );
            }
            if test_value == Some(false) {
                return statement.alternate.as_ref().is_none_or(|alternate| {
                    chain_statement_can_complete_normally_for_label(alternate, environment)
                });
            }
            chain_statement_can_complete_normally_for_label(&statement.consequent, environment)
                || statement.alternate.as_ref().is_none_or(|alternate| {
                    chain_statement_can_complete_normally_for_label(alternate, environment)
                })
        }
        Statement::LabeledStatement(_) => {
            chain_statement_can_complete_normally(statement, environment)
        }
        Statement::ExpressionStatement(_)
        | Statement::VariableDeclaration(_)
        | Statement::EmptyStatement(_)
        | Statement::DebuggerStatement(_) => true,
        _ => false,
    }
}

fn chain_statement_can_complete_with_break_to_label<'a>(
    statement: &Statement<'a>,
    label_name: &str,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> bool {
    match statement {
        Statement::BreakStatement(statement) => statement
            .label
            .as_ref()
            .is_some_and(|label| label.name == label_name),
        Statement::ReturnStatement(_)
        | Statement::ThrowStatement(_)
        | Statement::ContinueStatement(_) => false,
        Statement::BlockStatement(block) => {
            for statement in &block.body {
                if chain_statement_can_complete_with_break_to_label(
                    statement,
                    label_name,
                    environment,
                ) {
                    return true;
                }
                if !chain_statement_can_complete_normally_for_label(statement, environment) {
                    return false;
                }
            }
            false
        }
        Statement::IfStatement(statement) => {
            let test_value = chain_evaluate_boolean(&statement.test, environment);
            if test_value == Some(true) {
                return chain_statement_can_complete_with_break_to_label(
                    &statement.consequent,
                    label_name,
                    environment,
                );
            }
            if test_value == Some(false) {
                return statement.alternate.as_ref().is_some_and(|alternate| {
                    chain_statement_can_complete_with_break_to_label(
                        alternate,
                        label_name,
                        environment,
                    )
                });
            }
            chain_statement_can_complete_with_break_to_label(
                &statement.consequent,
                label_name,
                environment,
            ) || statement.alternate.as_ref().is_some_and(|alternate| {
                chain_statement_can_complete_with_break_to_label(alternate, label_name, environment)
            })
        }
        Statement::LabeledStatement(statement) => chain_statement_can_complete_with_break_to_label(
            &statement.body,
            label_name,
            environment,
        ),
        _ => false,
    }
}

fn chain_preceding_statements_can_complete<'a>(
    statements: &[Statement<'a>],
    target_span: oxc_span::Span,
    environment: &ChainBooleanEnvironment<'_, 'a>,
) -> bool {
    for statement in statements {
        if statement.span().contains_inclusive(target_span) {
            return true;
        }
        if statement.span().start >= target_span.start {
            return true;
        }
        if !chain_statement_can_complete_normally(statement, environment) {
            return false;
        }
    }
    true
}

fn chain_is_reachable_under_snapshot_environment<'a>(
    target: &AstNode<'a>,
    effect_function_id: NodeId,
    component_function_id: NodeId,
    snapshot_environment: &ChainSnapshotEnvironment,
    ctx: &LintContext<'a>,
) -> bool {
    if snapshot_environment.ref_shapes.is_empty()
        || chain_nearest_function_node_id(target.id(), ctx) != Some(effect_function_id)
    {
        return true;
    }
    let environment = ChainBooleanEnvironment {
        allow_helper_call: true,
        component_function_id,
        effect_function_id,
        snapshot_environment,
        substitutions: FxHashMap::default(),
        visited_symbol_ids: FxHashSet::default(),
        ctx,
    };
    let target_span = target.span();
    let mut current = target;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if parent.id() == effect_function_id {
            return true;
        }
        if matches!(
            parent.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return true;
        }
        match parent.kind() {
            AstKind::IfStatement(statement) => {
                let test_value = chain_evaluate_boolean(&statement.test, &environment);
                if statement
                    .consequent
                    .span()
                    .contains_inclusive(current.span())
                    && test_value == Some(false)
                {
                    return false;
                }
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(current.span()))
                    && test_value == Some(true)
                {
                    return false;
                }
            }
            AstKind::LogicalExpression(logical)
                if logical.right.span().contains_inclusive(current.span()) =>
            {
                let left_value = chain_evaluate_boolean(&logical.left, &environment);
                if (logical.operator == LogicalOperator::And && left_value == Some(false))
                    || (logical.operator == LogicalOperator::Or && left_value == Some(true))
                {
                    return false;
                }
            }
            AstKind::ConditionalExpression(conditional) => {
                let test_value = chain_evaluate_boolean(&conditional.test, &environment);
                if conditional
                    .consequent
                    .span()
                    .contains_inclusive(current.span())
                    && test_value == Some(false)
                {
                    return false;
                }
                if conditional
                    .alternate
                    .span()
                    .contains_inclusive(current.span())
                    && test_value == Some(true)
                {
                    return false;
                }
            }
            AstKind::BlockStatement(block) => {
                if !chain_preceding_statements_can_complete(&block.body, target_span, &environment)
                {
                    return false;
                }
            }
            AstKind::FunctionBody(body) => {
                if !chain_preceding_statements_can_complete(
                    &body.statements,
                    target_span,
                    &environment,
                ) {
                    return false;
                }
            }
            AstKind::Program(_) => return true,
            _ => {}
        }
        current = parent;
    }
}

fn chain_argument_expression<'a, 'b>(argument: &'b Argument<'a>) -> Option<&'b Expression<'a>> {
    match argument {
        Argument::SpreadElement(spread) => Some(&spread.argument),
        argument => argument.as_expression(),
    }
}

fn chain_function_reaches_function(
    source_function_id: NodeId,
    target_function_id: NodeId,
    local_call_edges: &FxHashMap<NodeId, Vec<(NodeId, NodeId)>>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited_function_ids.insert(source_function_id) {
        return false;
    }
    let reaches_target = local_call_edges
        .get(&source_function_id)
        .into_iter()
        .flatten()
        .any(|(_, called_function_id)| {
            *called_function_id == target_function_id
                || chain_function_reaches_function(
                    *called_function_id,
                    target_function_id,
                    local_call_edges,
                    visited_function_ids,
                )
        });
    visited_function_ids.remove(&source_function_id);
    reaches_target
}

fn chain_local_call_edges(ctx: &LintContext<'_>) -> FxHashMap<NodeId, Vec<(NodeId, NodeId)>> {
    let mut edges = FxHashMap::default();
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        let Some(owner_function_id) = chain_nearest_function_node_id(candidate.id(), ctx) else {
            continue;
        };
        let Some(called_function_id) =
            chain_local_callback_function_id(&call_expression.callee, ctx, &mut Vec::new())
        else {
            continue;
        };
        edges
            .entry(owner_function_id)
            .or_insert_with(Vec::new)
            .push((candidate.id(), called_function_id));
    }
    edges
}

fn chain_local_callback_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    if let Expression::CallExpression(call_expression) = expression.get_inner_expression()
        && matches!(call_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "useCallback")
    {
        return chain_local_callback_function_id(
            call_expression.arguments.first()?.as_expression()?,
            ctx,
            visited_symbol_ids,
        );
    }
    if let Expression::Identifier(identifier) = expression.get_inner_expression() {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        if visited_symbol_ids.contains(&symbol_id)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
        {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        return match declaration.kind() {
            AstKind::Function(function) if !function.generator => Some(function.node_id.get()),
            AstKind::VariableDeclarator(declarator)
                if matches!(&declarator.id, BindingPattern::ObjectPattern(_)) =>
            {
                let property_name =
                    chain_binding_property_name_for_symbol(&declarator.id, symbol_id)?;
                let Expression::CallExpression(initializer_call) =
                    declarator.init.as_ref()?.get_inner_expression()
                else {
                    return None;
                };
                let returned_function_id = chain_local_callback_function_id(
                    &initializer_call.callee,
                    ctx,
                    visited_symbol_ids,
                )?;
                chain_returned_property_function_id(
                    returned_function_id,
                    &property_name,
                    ctx,
                    visited_symbol_ids,
                )
            }
            AstKind::VariableDeclarator(declarator)
                if matches!(
                    ctx.nodes().parent_node(declaration.id()).kind(),
                    AstKind::VariableDeclaration(variable_declaration)
                        if variable_declaration.kind.is_const()
                ) && declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id) =>
            {
                chain_local_callback_function_id(declarator.init.as_ref()?, ctx, visited_symbol_ids)
            }
            _ => None,
        };
    }
    exact_local_callback_function_id(expression, ctx, visited_symbol_ids)
}

fn chain_binding_property_name_for_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> Option<String> {
    match pattern {
        BindingPattern::BindingIdentifier(_) => None,
        BindingPattern::AssignmentPattern(assignment) => {
            chain_binding_property_name_for_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(object_pattern) => {
            object_pattern.properties.iter().find_map(|property| {
                chain_binding_pattern_has_symbol(&property.value, symbol_id)
                    .then(|| property.key.static_name().map(|name| name.to_string()))
                    .flatten()
            })
        }
        BindingPattern::ArrayPattern(array_pattern) => array_pattern
            .elements
            .iter()
            .flatten()
            .find_map(|element| chain_binding_property_name_for_symbol(element, symbol_id)),
    }
}

fn chain_binding_pattern_has_symbol(pattern: &BindingPattern<'_>, symbol_id: SymbolId) -> bool {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => identifier.symbol_id() == symbol_id,
        BindingPattern::AssignmentPattern(assignment) => {
            chain_binding_pattern_has_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ObjectPattern(object_pattern) => object_pattern
            .properties
            .iter()
            .any(|property| chain_binding_pattern_has_symbol(&property.value, symbol_id)),
        BindingPattern::ArrayPattern(array_pattern) => array_pattern
            .elements
            .iter()
            .flatten()
            .any(|element| chain_binding_pattern_has_symbol(element, symbol_id)),
    }
}

fn chain_returned_property_function_id<'a>(
    function_id: NodeId,
    property_name: &str,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<NodeId> {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
        && let Some(property_value) = chain_static_object_property_value(expression, property_name)
    {
        return chain_local_callback_function_id(property_value, ctx, visited_symbol_ids);
    }
    ctx.nodes().iter().find_map(|candidate| {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return None;
        };
        if chain_nearest_function_node_id(candidate.id(), ctx) != Some(function_id) {
            return None;
        }
        let property_value =
            chain_static_object_property_value(return_statement.argument.as_ref()?, property_name)?;
        chain_local_callback_function_id(property_value, ctx, visited_symbol_ids)
    })
}

fn chain_static_object_property_value<'a, 'b>(
    expression: &'b Expression<'a>,
    property_name: &str,
) -> Option<&'b Expression<'a>> {
    let Expression::ObjectExpression(object_expression) = expression.get_inner_expression() else {
        return None;
    };
    object_expression
        .properties
        .iter()
        .rev()
        .find_map(|property| {
            let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            (property.kind == oxc_ast::ast::PropertyKind::Init
                && property.key.static_name().as_deref() == Some(property_name))
            .then_some(&property.value)
        })
}

fn chain_function_call_arguments_have_state_source(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let function_span = ctx.nodes().get_node(function_id).span();
    if ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        function_span.contains_inclusive(candidate.span())
            && call_expression
                .arguments
                .iter()
                .filter_map(chain_argument_expression)
                .any(|argument| {
                    chain_expression_has_state_source(argument, ctx, &mut FxHashSet::default())
                })
    }) {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !function_span.contains_inclusive(identifier.span) {
            return false;
        }
        let reference = ctx.scoping().get_reference(identifier.reference_id());
        let Some(symbol_id) = reference.symbol_id() else {
            return false;
        };
        chain_symbol_initializer_call_arguments_have_state_source(
            symbol_id,
            ctx,
            &mut FxHashSet::default(),
        )
    })
}

fn chain_symbol_initializer_call_arguments_have_state_source(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return false;
    };
    let initializer_span = initializer.span();
    if ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        initializer_span.contains_inclusive(candidate.span())
            && call_expression
                .arguments
                .iter()
                .filter_map(chain_argument_expression)
                .any(|argument| {
                    chain_expression_has_state_source(argument, ctx, &mut FxHashSet::default())
                })
    }) {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !initializer_span.contains_inclusive(identifier.span) {
            return false;
        }
        let reference = ctx.scoping().get_reference(identifier.reference_id());
        let Some(inner_symbol_id) = reference.symbol_id() else {
            return false;
        };
        chain_symbol_initializer_call_arguments_have_state_source(
            inner_symbol_id,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn chain_synchronous_execution_function_ids(
    callback_function_id: NodeId,
    local_call_edges: &FxHashMap<NodeId, Vec<(NodeId, NodeId)>>,
    ctx: &LintContext<'_>,
) -> FxHashSet<NodeId> {
    let mut function_ids = FxHashSet::default();
    let mut pending_function_ids = vec![callback_function_id];
    while let Some(function_id) = pending_function_ids.pop() {
        if !function_ids.insert(function_id) {
            continue;
        }
        for &(_, called_function_id) in local_call_edges.get(&function_id).into_iter().flatten() {
            if !chain_function_is_async(called_function_id, ctx)
                && !function_ids.contains(&called_function_id)
            {
                pending_function_ids.push(called_function_id);
            }
        }
    }
    function_ids
}

fn chain_effect_has_cleanup(callback_node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let callback_node = ctx.nodes().get_node(callback_node_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return chain_expression_is_cleanup_value(expression, ctx);
    }
    ctx.nodes().iter().any(|candidate| {
        matches!(candidate.kind(), AstKind::ReturnStatement(statement)
        if statement.argument.as_ref().is_some_and(|argument| {
            chain_expression_is_cleanup_value(argument, ctx)
        })) && callback_node.span().contains_inclusive(candidate.span())
            && chain_nearest_function_node_id(candidate.id(), ctx) == Some(callback_node_id)
    })
}

fn chain_expression_is_cleanup_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        expression if expression.as_member_expression().is_some() => true,
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            matches!(
                declaration.kind(),
                AstKind::FormalParameter(_) | AstKind::Function(_)
            ) || matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
            if declarator.init.as_ref().is_some_and(|initializer| {
                chain_effect_callback_initializer_function_id(initializer).is_some()
            }))
        }
        Expression::ConditionalExpression(conditional) => {
            chain_expression_is_cleanup_value(&conditional.consequent, ctx)
                || chain_expression_is_cleanup_value(&conditional.alternate, ctx)
        }
        _ => false,
    }
}

fn chain_callback_function_id<'a>(
    callback_expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    match callback_expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator) => declarator
                    .init
                    .as_ref()
                    .and_then(chain_effect_callback_initializer_function_id),
                _ => None,
            }
        }
        _ => None,
    }
}

fn chain_effect_callback_initializer_function_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::CallExpression(call_expression)
            if chain_callee_is_syntactic_use_callback(&call_expression.callee) =>
        {
            match call_expression.arguments.first()?.as_expression()? {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn chain_callee_is_syntactic_use_callback(callee: &Expression<'_>) -> bool {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == "useCallback",
        expression => {
            expression
                .as_member_expression()
                .and_then(chain_member_identifier_property_name)
                == Some("useCallback")
        }
    }
}

fn chain_nearest_function_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn chain_function_is_async(function_node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_node_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn chain_collect_dependency_state_symbols<'a>(
    expression: &Expression<'a>,
    is_direct_effect_dependency: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    state_symbol_ids: &mut FxHashSet<SymbolId>,
) {
    let expression_span = expression.span();
    let identifier_symbol_ids: Vec<_> = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                return None;
            };
            if !expression_span.contains_inclusive(identifier.span) {
                return None;
            }
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            if reference.is_type() {
                None
            } else {
                reference.symbol_id()
            }
        })
        .collect();
    for symbol_id in identifier_symbol_ids {
        chain_collect_state_symbol_from_symbol(
            symbol_id,
            is_direct_effect_dependency,
            ctx,
            visited_symbol_ids,
            state_symbol_ids,
        );
    }
}

fn chain_collect_state_symbol_from_symbol<'a>(
    symbol_id: SymbolId,
    is_direct_effect_dependency: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    state_symbol_ids: &mut FxHashSet<SymbolId>,
) {
    if !visited_symbol_ids.insert(symbol_id) {
        return;
    }
    if chain_is_state_symbol(symbol_id, ctx) {
        state_symbol_ids.insert(symbol_id);
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return;
    };
    let Some(initializer) = &declarator.init else {
        return;
    };
    if is_direct_effect_dependency
        && let Expression::CallExpression(call_expression) = initializer.get_inner_expression()
        && is_react_hook_call(call_expression, &["useCallback"], ctx)
        && let Some(Expression::ArrayExpression(callback_dependencies)) = call_expression
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
    {
        for dependency in callback_dependencies
            .elements
            .iter()
            .filter_map(chain_array_element_expression)
        {
            let dependency_span = dependency.span();
            let dependency_symbol_ids: Vec<_> = ctx
                .nodes()
                .iter()
                .filter_map(|candidate| {
                    let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                        return None;
                    };
                    if !dependency_span.contains_inclusive(identifier.span) {
                        return None;
                    }
                    let reference = ctx.scoping().get_reference(identifier.reference_id());
                    if reference.is_type() {
                        None
                    } else {
                        reference.symbol_id()
                    }
                })
                .collect();
            for dependency_symbol_id in dependency_symbol_ids {
                chain_collect_state_symbol_from_symbol(
                    dependency_symbol_id,
                    false,
                    ctx,
                    visited_symbol_ids,
                    state_symbol_ids,
                );
            }
        }
        return;
    }
    let preserve_direct_dependency = is_direct_effect_dependency
        && matches!(
            initializer.get_inner_expression(),
            Expression::Identifier(_)
        )
        && chain_symbol_is_const_binding(symbol_id, ctx);
    chain_collect_dependency_state_symbols(
        initializer,
        preserve_direct_dependency,
        ctx,
        visited_symbol_ids,
        state_symbol_ids,
    );
}

fn chain_symbol_is_const_binding(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && matches!(ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable_declaration)
                if variable_declaration.kind.is_const())
}

fn chain_state_setter_symbol_id(
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let declaration = ctx.symbol_declaration(state_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(state_binding) =
        pattern.elements.first().and_then(Option::as_ref)?
    else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter_binding) =
        pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    (state_binding.symbol_id() == state_symbol_id
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| chain_expression_is_use_state_tuple(initializer, ctx)))
    .then_some(setter_binding.symbol_id())
}

fn chain_is_state_symbol(state_symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(state_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    matches!(pattern.elements.first().and_then(Option::as_ref),
        Some(BindingPattern::BindingIdentifier(state_binding))
            if state_binding.symbol_id() == state_symbol_id)
        && declarator
            .init
            .as_ref()
            .is_some_and(|initializer| chain_expression_is_use_state_tuple(initializer, ctx))
}

fn chain_expression_is_use_state_tuple<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => is_react_hook_call(call, &["useState"], ctx),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            if declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
                || !matches!(
                    ctx.nodes().parent_node(declaration.id()).kind(),
                    AstKind::VariableDeclaration(variable_declaration)
                        if variable_declaration.kind.is_const()
                )
            {
                return false;
            }
            matches!(declarator.init.as_ref().map(Expression::get_inner_expression),
                Some(Expression::CallExpression(call)) if is_react_hook_call(call, &["useState"], ctx))
        }
        _ => false,
    }
}

fn chain_resolve_use_state_pair<'a>(
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<(SymbolId, SymbolId)> {
    let setter_symbol_id = resolve_const_identifier_root_symbol(setter_identifier, ctx)?;
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(state_binding) =
        pattern.elements.first().and_then(Option::as_ref)?
    else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter_binding) =
        pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    if setter_binding.symbol_id() != setter_symbol_id
        || !declarator
            .init
            .as_ref()
            .is_some_and(|initializer| chain_expression_is_use_state_tuple(initializer, ctx))
    {
        return None;
    }
    Some((state_binding.symbol_id(), setter_symbol_id))
}

fn chain_expression_has_state_source<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    chain_expression_has_state_source_excluding_spans(expression, &[], ctx, visited_symbol_ids)
}

fn chain_initializer_has_state_source<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let excluded_callback_spans: Vec<_> = match expression {
        Expression::CallExpression(call_expression)
            if !chain_callee_is_bare_hook(&call_expression.callee) =>
        {
            call_expression
                .arguments
                .iter()
                .filter_map(chain_argument_expression)
                .filter(|argument| {
                    matches!(
                        argument.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    )
                })
                .map(GetSpan::span)
                .collect()
        }
        Expression::NewExpression(new_expression) => new_expression
            .arguments
            .iter()
            .filter_map(chain_argument_expression)
            .filter(|argument| {
                matches!(
                    argument.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
            })
            .map(GetSpan::span)
            .collect(),
        _ => Vec::new(),
    };
    chain_expression_has_state_source_excluding_spans(
        expression,
        &excluded_callback_spans,
        ctx,
        visited_symbol_ids,
    )
}

fn chain_callee_is_bare_hook(callee: &Expression<'_>) -> bool {
    let Expression::Identifier(identifier) = callee else {
        return false;
    };
    let name = identifier.name.as_str().as_bytes();
    name.starts_with(b"use")
        && name
            .get(3)
            .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
}

fn chain_expression_has_state_source_excluding_spans<'a>(
    expression: &Expression<'a>,
    excluded_spans: &[oxc_span::Span],
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !expression_span.contains_inclusive(identifier.span)
            || excluded_spans
                .iter()
                .any(|excluded_span| excluded_span.contains_inclusive(identifier.span))
        {
            return false;
        }
        let reference = ctx.scoping().get_reference(identifier.reference_id());
        if reference.is_type() {
            return false;
        }
        let Some(symbol_id) = reference.symbol_id() else {
            return false;
        };
        chain_symbol_has_state_source(symbol_id, ctx, visited_symbol_ids)
    })
}

fn chain_symbol_has_state_source<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    if chain_is_state_symbol(symbol_id, ctx) {
        return true;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let has_state_source = matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
    if declarator.init.as_ref().is_some_and(|initializer| {
        chain_asserted_type_literal_has_state_name(initializer, declaration.id(), ctx)
            || chain_initializer_has_state_source(initializer, ctx, visited_symbol_ids)
    }));
    visited_symbol_ids.remove(&symbol_id);
    has_state_source
}

fn chain_asserted_type_literal_has_state_name<'a>(
    expression: &Expression<'a>,
    declaration_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let asserted_type = match expression {
        Expression::TSAsExpression(assertion) => Some(&assertion.type_annotation),
        Expression::TSTypeAssertion(assertion) => Some(&assertion.type_annotation),
        Expression::TSSatisfiesExpression(assertion) => Some(&assertion.type_annotation),
        _ => None,
    };
    let Some(TSType::TSTypeLiteral(type_literal)) = asserted_type else {
        return false;
    };
    let property_names: FxHashSet<_> = type_literal
        .members
        .iter()
        .filter_map(|member| {
            let TSSignature::TSPropertySignature(property) = member else {
                return None;
            };
            property.key.static_name().map(|name| name.to_string())
        })
        .collect();
    if property_names.is_empty() {
        return false;
    }
    let declaration_owner = chain_nearest_function_node_id(declaration_id, ctx);
    ctx.scoping().symbol_ids().any(|candidate_symbol_id| {
        chain_is_state_symbol(candidate_symbol_id, ctx)
            && chain_nearest_function_node_id(ctx.symbol_declaration(candidate_symbol_id).id(), ctx)
                == declaration_owner
            && property_names.contains(ctx.scoping().symbol_name(candidate_symbol_id))
    })
}

fn chain_state_is_externally_driven<'a>(
    setter_symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let mut has_deferred_writer = false;
    for reference in ctx.scoping().get_resolved_references(setter_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let root = transparent_expression_root(reference_node, ctx);
        let parent = ctx.nodes().parent_node(root.id());
        if chain_node_is_deferred_callback_position(root, ctx) {
            has_deferred_writer = true;
            continue;
        }
        let AstKind::CallExpression(call) = parent.kind() else {
            continue;
        };
        if call.callee.span() != root.span() {
            continue;
        }
        if !chain_writer_is_deferred(reference_node.id(), component_node_id, ctx) {
            return false;
        }
        has_deferred_writer = true;
    }
    has_deferred_writer
}

fn chain_writer_is_deferred<'a>(
    node_id: NodeId,
    component_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == component_node_id {
            break;
        }
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        if chain_function_is_deferred_callback(ancestor, ctx) {
            return true;
        }
    }
    false
}

fn chain_function_is_deferred_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if chain_node_is_deferred_callback_position(function_node, ctx) {
        return true;
    }
    let Some(symbol_id) = chain_function_handler_binding_symbol(function_node, ctx) else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            chain_node_is_deferred_callback_position(ctx.nodes().get_node(reference.node_id()), ctx)
        })
}

fn chain_function_handler_binding_symbol<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut current = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            break;
        };
        if !call_expression.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == current.span())
        }) {
            break;
        }
        current = transparent_expression_root(parent, ctx);
    }
    let AstKind::VariableDeclarator(declarator) = ctx.nodes().parent_node(current.id()).kind()
    else {
        return None;
    };
    declarator
        .init
        .as_ref()
        .filter(|initializer| initializer.span() == current.span())
        .and_then(|_| declarator.id.get_binding_identifier())
        .map(|identifier| identifier.symbol_id())
}

fn chain_call_name(call_expression: &oxc_ast::ast::CallExpression<'_>) -> Option<String> {
    chain_callee_name(&call_expression.callee)
}

fn chain_callee_name(callee: &Expression<'_>) -> Option<String> {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        expression => expression
            .as_member_expression()
            .and_then(chain_member_identifier_property_name)
            .map(str::to_string),
    }
}

fn chain_node_is_deferred_callback_position<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::CallExpression(call_expression) => {
            call_expression.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|expression| expression.span() == root.span())
            }) && chain_call_name(call_expression)
                .is_some_and(|name| CHAIN_DEFERRED_CALL_NAMES.contains(&name.as_str()))
        }
        AstKind::NewExpression(new_expression) => {
            new_expression.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|expression| expression.span() == root.span())
            }) && chain_callee_name(&new_expression.callee)
                .is_some_and(|name| name == "Promise" || name.ends_with("Observer"))
        }
        AstKind::AssignmentExpression(assignment) if assignment.right.span() == root.span() => {
            assignment
                .left
                .as_member_expression()
                .and_then(|member| match member {
                    oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
                        Some(member.property.name.as_str())
                    }
                    oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
                        match member.expression.get_inner_expression() {
                            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                            _ => None,
                        }
                    }
                    oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
                })
                .is_some_and(|property_name| property_name.starts_with("on"))
        }
        _ => false,
    }
}

fn chain_expression_reads_post_mount_value<'a>(
    expression: &Expression<'a>,
    effect_function_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    chain_expression_reads_post_mount_value_internal(
        expression,
        effect_function_id,
        ctx,
        visited_symbol_ids,
        &mut FxHashSet::default(),
    )
}

fn chain_expression_reads_post_mount_value_internal<'a>(
    expression: &Expression<'a>,
    local_function_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    let expression_span = expression.span();
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        match candidate.kind() {
            AstKind::CallExpression(call_expression) => {
                if let Some(function_id) =
                    exact_local_callback_function_id(&call_expression.callee, ctx, &mut Vec::new())
                    && visited_function_ids.insert(function_id)
                    && chain_local_function_returns_post_mount_value(
                        function_id,
                        ctx,
                        visited_symbol_ids,
                        visited_function_ids,
                    )
                {
                    return true;
                }
            }
            AstKind::StaticMemberExpression(member_expression)
                if chain_member_property_is_post_mount_read(
                    &member_expression.object,
                    member_expression.property.name.as_str(),
                    ctx,
                ) =>
            {
                return true;
            }
            AstKind::ComputedMemberExpression(member_expression)
                if matches!(member_expression.expression.get_inner_expression(), Expression::Identifier(property)
                if chain_member_property_is_post_mount_read(
                    &member_expression.object,
                    property.name.as_str(),
                    ctx,
                )) =>
            {
                return true;
            }
            AstKind::IdentifierReference(identifier) => {
                if CHAIN_POST_MOUNT_GLOBAL_NAMES.contains(&identifier.name.as_str()) {
                    return true;
                }
                let reference = ctx.scoping().get_reference(identifier.reference_id());
                if reference.is_type() {
                    continue;
                }
                let Some(symbol_id) = reference.symbol_id() else {
                    continue;
                };
                if !visited_symbol_ids.insert(symbol_id) {
                    continue;
                }
                let declaration = ctx.symbol_declaration(symbol_id);
                if chain_nearest_function_node_id(declaration.id(), ctx) == Some(local_function_id)
                    && matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
                    if declarator.init.as_ref().is_some_and(|initializer| {
                        chain_expression_reads_post_mount_value_internal(
                            initializer,
                            local_function_id,
                            ctx,
                            visited_symbol_ids,
                            visited_function_ids,
                        )
                    }))
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn chain_local_function_returns_post_mount_value(
    function_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
        && chain_expression_reads_post_mount_value_internal(
            expression,
            function_id,
            ctx,
            visited_symbol_ids,
            visited_function_ids,
        )
    {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return false;
        };
        chain_nearest_function_node_id(candidate.id(), ctx) == Some(function_id)
            && return_statement.argument.as_ref().is_some_and(|argument| {
                chain_expression_reads_post_mount_value_internal(
                    argument,
                    function_id,
                    ctx,
                    visited_symbol_ids,
                    visited_function_ids,
                )
            })
    })
}

fn chain_member_property_is_post_mount_read<'a>(
    object: &Expression<'a>,
    property_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    if CHAIN_POST_MOUNT_METHOD_NAMES.contains(&property_name) {
        return true;
    }
    if !CHAIN_LAYOUT_MEASUREMENT_PROPERTY_NAMES.contains(&property_name)
        || property_name == "current"
    {
        return false;
    }
    if property_name == "className" {
        return match object.get_inner_expression() {
            Expression::Identifier(identifier) => {
                matches!(identifier.name.as_str(), "element" | "node")
                    || chain_identifier_resolves_ref_current_alias(
                        identifier,
                        ctx,
                        &mut FxHashSet::default(),
                    )
            }
            _ => chain_expression_is_ref_like(object, ctx, &mut FxHashSet::default()),
        };
    }
    chain_expression_is_ref_like(object, ctx, &mut FxHashSet::default())
}

fn chain_expression_is_ref_like<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            chain_has_ref_like_name(identifier.name.as_str())
                || chain_identifier_resolves_ref_factory(identifier, ctx)
                || chain_identifier_resolves_ref_current_alias(identifier, ctx, visited_symbol_ids)
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Some(property_name) = chain_member_identifier_property_name(member) else {
                return false;
            };
            chain_has_ref_like_name(property_name)
                || (property_name == "current"
                    && chain_expression_is_ref_like(member.object(), ctx, visited_symbol_ids))
        }
    }
}

fn chain_identifier_resolves_ref_factory<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
    if declarator.init.as_ref().is_some_and(|initializer| {
        matches!(initializer.get_inner_expression(), Expression::CallExpression(call)
            if chain_call_name(call).is_some_and(|name| matches!(name.as_str(), "useRef" | "createRef")))
    }))
}

fn chain_identifier_resolves_ref_current_alias<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return false;
    };
    let Some(member) = initializer.get_inner_expression().as_member_expression() else {
        return false;
    };
    chain_member_identifier_property_name(member) == Some("current")
        && chain_expression_is_ref_like(member.object(), ctx, visited_symbol_ids)
}

fn chain_member_identifier_property_name<'a, 'b>(
    member: &'b oxc_ast::ast::MemberExpression<'a>,
) -> Option<&'b str> {
    match member {
        oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
            Some(member.property.name.as_str())
        }
        oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
            match member.expression.get_inner_expression() {
                Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                _ => None,
            }
        }
        oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn chain_has_ref_like_name(name: &str) -> bool {
    name == "ref"
        || name.ends_with("Ref")
        || name.ends_with("ref")
        || name.ends_with("Node")
        || name.ends_with("node")
        || name.ends_with("Element")
        || name.ends_with("element")
}

fn chain_expression_is_simple<'a>(
    expression: &Expression<'a>,
    effect_function_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        match candidate.kind() {
            AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_)
            | AstKind::AwaitExpression(_)
            | AstKind::NewExpression(_) => return false,
            AstKind::CallExpression(call_expression)
                if !chain_call_is_builtin_namespace_call(call_expression) =>
            {
                return false;
            }
            AstKind::IdentifierReference(identifier) => {
                let reference = ctx.scoping().get_reference(identifier.reference_id());
                if reference.is_type() {
                    continue;
                }
                let Some(symbol_id) = reference.symbol_id() else {
                    continue;
                };
                if !visited_symbol_ids.insert(symbol_id) {
                    continue;
                }
                let declaration = ctx.symbol_declaration(symbol_id);
                if chain_nearest_function_node_id(declaration.id(), ctx) == Some(effect_function_id)
                    && let AstKind::VariableDeclarator(declarator) = declaration.kind()
                    && let Some(initializer) = &declarator.init
                    && !chain_expression_is_simple(
                        initializer,
                        effect_function_id,
                        ctx,
                        visited_symbol_ids,
                    )
                {
                    return false;
                }
            }
            _ => {}
        }
    }
    true
}

fn chain_call_is_builtin_namespace_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
) -> bool {
    let root_name = match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        expression => expression
            .as_member_expression()
            .and_then(|member_expression| chain_root_identifier_name(member_expression.object())),
    };
    root_name.is_some_and(|name| CHAIN_BUILTIN_NAMESPACE_NAMES.contains(&name.as_str()))
}

fn chain_root_identifier_name(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        expression => chain_root_identifier_name(expression.as_member_expression()?.object()),
    }
}
