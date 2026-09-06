use std::{
    cell::OnceCell,
    path::{Path, PathBuf},
};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{
        AssignmentTarget, BindingPattern, Expression, ImportDeclarationSpecifier,
        ObjectPropertyKind, SimpleAssignmentTarget, Statement, TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_resolver::{
    ResolveOptions, Resolver, TsconfigDiscovery, TsconfigOptions, TsconfigReferences,
};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, Span, VALID_EXTENSIONS};
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::LintContext,
    module_record::{ExportExportName, ExportImportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const MESSAGE: &str = "This side-effecting call runs inside a state updater, which React may invoke more than once. Move it outside the setter after computing the next state.";
const SYNCHRONOUS_CALLBACK_METHOD_NAMES: [&str; 13] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
    "sort",
    "toSorted",
];
const SIDE_EFFECT_METHOD_NAMES: [&str; 10] = [
    "appendChild",
    "click",
    "dispatchEvent",
    "focus",
    "insertBefore",
    "remove",
    "removeChild",
    "removeItem",
    "replaceChild",
    "setItem",
];
const GLOBAL_SCHEDULER_NAMES: [&str; 6] = [
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setImmediate",
    "setInterval",
    "setTimeout",
];
const FRESH_CONTAINER_CONSTRUCTORS: [&str; 13] = [
    "Array",
    "DataView",
    "Date",
    "FormData",
    "Headers",
    "Map",
    "NextResponse",
    "Object",
    "Response",
    "Set",
    "URLSearchParams",
    "WeakMap",
    "WeakSet",
];
const MUTATING_COLLECTION_METHODS: [&str; 4] = ["add", "clear", "delete", "set"];
const DAYJS_BAD_MUTABLE_MODULE_NAMES: [&str; 2] =
    ["dayjs/plugin/badMutable", "dayjs/plugin/badMutable.js"];
const DAYJS_FACTORY_EXPORT_DEPTH: usize = 4;
const DAYJS_RUNTIME_DEPENDENCY_DEPTH: usize = 4;
const DAYJS_CROSS_FILE_PARSE_MAX_BYTES: u64 = 2_000_000;
const DAYJS_TSCONFIG_DIRECTORY_DEPTH: usize = 30;

#[derive(Debug, Default, Clone)]
pub struct NoSideEffectInStateUpdaterFunction;

declare_oxc_lint!(
    /// Warns about observable side effects inside React state updater functions.
    NoSideEffectInStateUpdaterFunction,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Side effect inside a state updater function.",
);

#[derive(Clone, Copy)]
struct StateUpdaterFunction {
    node_id: NodeId,
    span: Span,
    parameters_span: Span,
}

struct ExecutedFunctionAnalysis {
    array_parameter_symbol_ids: FxHashSet<SymbolId>,
    function_ids: FxHashSet<NodeId>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DayjsMutability {
    Active,
    Inactive,
    Unknown,
}

impl Rule for NoSideEffectInStateUpdaterFunction {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut state_setter_symbol_ids = FxHashSet::default();
        let mut call_node_ids = Vec::new();
        let mut call_node_ids_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();
        let mut executable_node_ids_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();
        let mut suspension_node_ids_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();

        for node in ctx.nodes().iter() {
            if let AstKind::VariableDeclarator(declarator) = node.kind()
                && let BindingPattern::ArrayPattern(pattern) = &declarator.id
                && let Some(BindingPattern::BindingIdentifier(setter)) =
                    pattern.elements.get(1).and_then(Option::as_ref)
                && let Some(Expression::CallExpression(call)) = &declarator.init
                && is_react_hook_call(call, &["useState"], ctx)
            {
                state_setter_symbol_ids.insert(setter.symbol_id());
            }
            if let AstKind::CallExpression(call) = node.kind() {
                call_node_ids.push(node.id());
                if let Some(function) = updater_resolve_called_function(call, ctx) {
                    call_node_ids_by_function
                        .entry(function.node_id)
                        .or_default()
                        .push(node.id());
                }
            }
            if matches!(
                node.kind(),
                AstKind::CallExpression(_)
                    | AstKind::NewExpression(_)
                    | AstKind::AssignmentExpression(_)
                    | AstKind::UpdateExpression(_)
                    | AstKind::UnaryExpression(_)
            ) && let Some(function_id) = updater_nearest_function_id(node, ctx)
            {
                executable_node_ids_by_function
                    .entry(function_id)
                    .or_default()
                    .push(node.id());
            }
            if (matches!(
                node.kind(),
                AstKind::AwaitExpression(_) | AstKind::YieldExpression(_)
            ) || matches!(node.kind(), AstKind::ForOfStatement(statement) if statement.r#await))
                && let Some(function_id) = updater_nearest_function_id(node, ctx)
            {
                suspension_node_ids_by_function
                    .entry(function_id)
                    .or_default()
                    .push(node.id());
            }
        }
        let dayjs_mutability = OnceCell::new();

        let mut reported_spans = FxHashSet::default();
        for call_node_id in call_node_ids {
            let call_node = ctx.nodes().get_node(call_node_id);
            let AstKind::CallExpression(setter_call) = call_node.kind() else {
                continue;
            };
            let Expression::Identifier(setter_identifier) =
                setter_call.callee.get_inner_expression()
            else {
                continue;
            };
            if !updater_identifier_resolves_to_setter(
                setter_identifier,
                &state_setter_symbol_ids,
                ctx,
                &mut FxHashSet::default(),
            ) {
                continue;
            }
            let Some(updater_argument) = setter_call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                continue;
            };
            let Some(updater_function) =
                updater_resolve_function(updater_argument, ctx, &mut FxHashSet::default())
            else {
                continue;
            };
            let updater_state_is_array =
                updater_state_value_is_array(setter_identifier, &state_setter_symbol_ids, ctx);
            let executed_function_analysis = updater_collect_executed_functions(
                updater_function,
                updater_state_is_array,
                &state_setter_symbol_ids,
                &executable_node_ids_by_function,
                &suspension_node_ids_by_function,
                ctx,
            );
            for function_id in &executed_function_analysis.function_ids {
                for candidate_id in executable_node_ids_by_function
                    .get(function_id)
                    .into_iter()
                    .flatten()
                {
                    let candidate = ctx.nodes().get_node(*candidate_id);
                    if updater_is_statically_unreachable(candidate, *function_id, ctx)
                        || !is_node_reachable_within_function(
                            candidate,
                            ctx.nodes().get_node(*function_id),
                            ctx,
                        )
                        || !updater_can_execute_before_suspension(
                            candidate,
                            *function_id,
                            &suspension_node_ids_by_function,
                            ctx,
                        )
                    {
                        continue;
                    }
                    let diagnostic_span = match candidate.kind() {
                        AstKind::AssignmentExpression(assignment) => {
                            updater_assignment_receiver(&assignment.left)
                                .filter(|receiver| {
                                    updater_write_receiver_is_external(
                                        receiver,
                                        updater_function,
                                        &executed_function_analysis.function_ids,
                                        &call_node_ids_by_function,
                                        ctx,
                                    )
                                })
                                .map(|_| assignment.span)
                        }
                        AstKind::UpdateExpression(update) => {
                            updater_simple_assignment_receiver(&update.argument)
                                .filter(|receiver| {
                                    updater_write_receiver_is_external(
                                        receiver,
                                        updater_function,
                                        &executed_function_analysis.function_ids,
                                        &call_node_ids_by_function,
                                        ctx,
                                    )
                                })
                                .map(|_| update.span)
                        }
                        AstKind::UnaryExpression(unary)
                            if unary.operator == UnaryOperator::Delete =>
                        {
                            updater_member_receiver(&unary.argument)
                                .filter(|receiver| {
                                    updater_write_receiver_is_external(
                                        receiver,
                                        updater_function,
                                        &executed_function_analysis.function_ids,
                                        &call_node_ids_by_function,
                                        ctx,
                                    )
                                })
                                .map(|_| unary.span)
                        }
                        AstKind::CallExpression(call) => updater_call_is_side_effect(
                            candidate,
                            call,
                            setter_identifier,
                            updater_function,
                            updater_state_is_array,
                            &state_setter_symbol_ids,
                            &executed_function_analysis.array_parameter_symbol_ids,
                            &executed_function_analysis.function_ids,
                            &call_node_ids_by_function,
                            &dayjs_mutability,
                            ctx,
                        )
                        .then_some(call.span),
                        _ => None,
                    };
                    let Some(diagnostic_span) = diagnostic_span else {
                        continue;
                    };
                    if reported_spans.insert((diagnostic_span.start, diagnostic_span.end)) {
                        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(diagnostic_span));
                    }
                }
            }
        }
    }
}

fn updater_nearest_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn updater_identifier_resolves_to_setter(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    state_setter_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if state_setter_symbol_ids.contains(&symbol_id) {
        return true;
    }
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let Some(Expression::Identifier(aliased_identifier)) =
        resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            .map(Expression::get_inner_expression)
    else {
        return false;
    };
    updater_identifier_resolves_to_setter(
        aliased_identifier,
        state_setter_symbol_ids,
        ctx,
        visited_symbol_ids,
    )
}

fn updater_resolve_function<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<StateUpdaterFunction> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(StateUpdaterFunction {
            node_id: function.node_id.get(),
            span: function.span,
            parameters_span: function.params.span,
        }),
        Expression::FunctionExpression(function) => Some(StateUpdaterFunction {
            node_id: function.node_id.get(),
            span: function.span,
            parameters_span: function.params.span,
        }),
        Expression::CallExpression(call)
            if is_react_api_call(call, "useCallback", ctx)
                || is_react_api_call(call, "useMemo", ctx) =>
        {
            updater_resolve_function(
                call.arguments.first()?.as_expression()?,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) if !function.r#async && !function.generator => {
                    Some(StateUpdaterFunction {
                        node_id: function.node_id.get(),
                        span: function.span(),
                        parameters_span: function.params.span,
                    })
                }
                AstKind::VariableDeclarator(_) => updater_resolve_function(
                    resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?,
                    ctx,
                    visited_symbol_ids,
                ),
                _ => None,
            }
        }
        _ => None,
    }
}

fn updater_state_value_is_array(
    setter_identifier: &oxc_ast::ast::IdentifierReference<'_>,
    state_setter_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(setter_identifier.reference_id())
        .symbol_id();
    let mut visited = FxHashSet::default();
    while let Some(candidate_symbol_id) = symbol_id {
        if !visited.insert(candidate_symbol_id) {
            return false;
        }
        if state_setter_symbol_ids.contains(&candidate_symbol_id) {
            let declaration = ctx.symbol_declaration(candidate_symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let Some(Expression::CallExpression(use_state_call)) = &declarator.init else {
                return false;
            };
            if use_state_call
                .type_arguments
                .as_ref()
                .and_then(|arguments| arguments.params.first())
                .is_some_and(|state_type| match state_type {
                    TSType::TSArrayType(_) | TSType::TSTupleType(_) => true,
                    TSType::TSTypeReference(reference) => {
                        matches!(&reference.type_name, TSTypeName::IdentifierReference(identifier)
                            if matches!(identifier.name.as_str(), "Array" | "ReadonlyArray"))
                    }
                    _ => false,
                })
            {
                return true;
            }
            let Some(mut initializer) = use_state_call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)
            else {
                return false;
            };
            if let Some(function) =
                updater_resolve_function(initializer, ctx, &mut FxHashSet::default())
                && let AstKind::ArrowFunctionExpression(function) =
                    ctx.nodes().get_node(function.node_id).kind()
                && let Some(expression) = function.get_expression()
            {
                initializer = expression;
            }
            return match initializer.get_inner_expression() {
                Expression::ArrayExpression(_) => true,
                Expression::NewExpression(new_expression) => {
                    matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                        if identifier.name == "Array" && ctx.is_reference_to_global_variable(identifier))
                }
                _ => false,
            };
        }
        let Some(Expression::Identifier(alias)) =
            resolve_direct_unreassigned_symbol_initializer(candidate_symbol_id, ctx)
                .map(Expression::get_inner_expression)
        else {
            return false;
        };
        symbol_id = ctx
            .scoping()
            .get_reference(alias.reference_id())
            .symbol_id();
    }
    false
}

fn updater_collect_executed_functions(
    updater_function: StateUpdaterFunction,
    updater_state_is_array: bool,
    state_setter_symbol_ids: &FxHashSet<SymbolId>,
    executable_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    suspension_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> ExecutedFunctionAnalysis {
    let mut executed_function_ids = FxHashSet::default();
    let mut array_parameter_symbol_ids = FxHashSet::default();
    if updater_state_is_array
        && let Some(symbol_id) =
            updater_function_parameter_symbol_id(updater_function.node_id, 0, ctx)
    {
        array_parameter_symbol_ids.insert(symbol_id);
    }
    let mut pending_function_ids = vec![updater_function.node_id];
    while let Some(function_id) = pending_function_ids.pop() {
        if !executed_function_ids.insert(function_id) {
            continue;
        }
        let Some(current_function) = updater_function_from_node_id(function_id, ctx) else {
            continue;
        };
        for candidate_id in executable_node_ids_by_function
            .get(&function_id)
            .into_iter()
            .flatten()
        {
            let candidate = ctx.nodes().get_node(*candidate_id);
            if updater_is_statically_unreachable(candidate, function_id, ctx)
                || !is_node_reachable_within_function(
                    candidate,
                    ctx.nodes().get_node(function_id),
                    ctx,
                )
                || !updater_can_execute_before_suspension(
                    candidate,
                    function_id,
                    suspension_node_ids_by_function,
                    ctx,
                )
            {
                continue;
            }
            match candidate.kind() {
                AstKind::NewExpression(new_expression)
                    if matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                        if identifier.name == "Promise" && ctx.is_reference_to_global_variable(identifier)) =>
                {
                    if let Some(function) = new_expression
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                        .and_then(|expression| {
                            updater_resolve_function(expression, ctx, &mut FxHashSet::default())
                        })
                    {
                        pending_function_ids.push(function.node_id);
                    }
                }
                AstKind::CallExpression(call) => {
                    if let Some(function) = updater_resolve_called_function(call, ctx) {
                        updater_propagate_array_arguments(
                            call,
                            current_function,
                            function,
                            updater_function,
                            updater_state_is_array,
                            &mut array_parameter_symbol_ids,
                            ctx,
                        );
                        pending_function_ids.push(function.node_id);
                    }
                    let Expression::Identifier(callee_identifier) =
                        call.callee.get_inner_expression()
                    else {
                        updater_collect_synchronous_callback(
                            call,
                            current_function,
                            updater_function,
                            updater_state_is_array,
                            &array_parameter_symbol_ids,
                            &mut pending_function_ids,
                            ctx,
                        );
                        continue;
                    };
                    if updater_identifier_resolves_to_setter(
                        callee_identifier,
                        state_setter_symbol_ids,
                        ctx,
                        &mut FxHashSet::default(),
                    ) && let Some(function) = call
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                        .and_then(|expression| {
                            updater_resolve_function(expression, ctx, &mut FxHashSet::default())
                        })
                    {
                        pending_function_ids.push(function.node_id);
                    }
                    updater_collect_synchronous_callback(
                        call,
                        current_function,
                        updater_function,
                        updater_state_is_array,
                        &array_parameter_symbol_ids,
                        &mut pending_function_ids,
                        ctx,
                    );
                }
                _ => {}
            }
        }
    }
    ExecutedFunctionAnalysis {
        array_parameter_symbol_ids,
        function_ids: executed_function_ids,
    }
}

fn updater_function_from_node_id(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<StateUpdaterFunction> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => Some(StateUpdaterFunction {
            node_id: function_id,
            span: function.span,
            parameters_span: function.params.span,
        }),
        AstKind::ArrowFunctionExpression(function) => Some(StateUpdaterFunction {
            node_id: function_id,
            span: function.span,
            parameters_span: function.params.span,
        }),
        _ => None,
    }
}

fn updater_function_parameter_symbol_id(
    function_id: NodeId,
    parameter_index: usize,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let parameter = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.params.items.get(parameter_index),
        AstKind::ArrowFunctionExpression(function) => function.params.items.get(parameter_index),
        _ => None,
    }?;
    match &parameter.pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        BindingPattern::AssignmentPattern(assignment) => match &assignment.left {
            BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
            _ => None,
        },
        _ => None,
    }
}

fn updater_propagate_array_arguments<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    current_function: StateUpdaterFunction,
    called_function: StateUpdaterFunction,
    updater_function: StateUpdaterFunction,
    updater_state_is_array: bool,
    array_parameter_symbol_ids: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) {
    for (parameter_index, argument) in call.arguments.iter().enumerate() {
        let Some(argument) = argument.as_expression() else {
            continue;
        };
        if !updater_receiver_is_known_array(
            argument,
            current_function,
            updater_function,
            updater_state_is_array,
            array_parameter_symbol_ids,
            ctx,
        ) {
            continue;
        }
        if let Some(symbol_id) =
            updater_function_parameter_symbol_id(called_function.node_id, parameter_index, ctx)
        {
            array_parameter_symbol_ids.insert(symbol_id);
        }
    }
}

fn updater_collect_synchronous_callback<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    current_function: StateUpdaterFunction,
    updater_function: StateUpdaterFunction,
    updater_state_is_array: bool,
    array_parameter_symbol_ids: &FxHashSet<SymbolId>,
    pending_function_ids: &mut Vec<NodeId>,
    ctx: &LintContext<'a>,
) {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return;
    };
    let property_name = member.static_property_name();
    let callback_index = if property_name == Some("from")
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Array" && ctx.is_reference_to_global_variable(identifier))
    {
        1
    } else if property_name
        .is_some_and(|name| SYNCHRONOUS_CALLBACK_METHOD_NAMES.contains(&name.as_ref()))
        && updater_receiver_is_known_array(
            member.object(),
            current_function,
            updater_function,
            updater_state_is_array,
            array_parameter_symbol_ids,
            ctx,
        )
    {
        0
    } else {
        return;
    };
    if let Some(function) = call
        .arguments
        .get(callback_index)
        .and_then(oxc_ast::ast::Argument::as_expression)
        .and_then(|expression| updater_resolve_function(expression, ctx, &mut FxHashSet::default()))
    {
        pending_function_ids.push(function.node_id);
    }
}

fn updater_resolve_called_function<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<StateUpdaterFunction> {
    if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
        let method_name = member.static_property_name();
        if method_name.as_deref() == Some("apply")
            && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Reflect" && ctx.is_reference_to_global_variable(identifier))
        {
            return updater_resolve_function(
                call.arguments.first()?.as_expression()?,
                ctx,
                &mut FxHashSet::default(),
            );
        }
        if matches!(method_name.as_deref(), Some("call" | "apply")) {
            return updater_resolve_function(member.object(), ctx, &mut FxHashSet::default());
        }
    }
    updater_resolve_function(&call.callee, ctx, &mut FxHashSet::default())
}

fn updater_receiver_is_known_array<'a>(
    expression: &Expression<'a>,
    current_function: StateUpdaterFunction,
    updater_function: StateUpdaterFunction,
    updater_state_is_array: bool,
    array_parameter_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) => true,
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if symbol_id.is_some_and(|symbol_id| array_parameter_symbol_ids.contains(&symbol_id)) {
                return true;
            }
            if updater_state_is_array
                && symbol_id.is_some_and(|symbol_id| {
                    current_function.node_id == updater_function.node_id
                        && updater_function
                            .parameters_span
                            .contains_inclusive(ctx.symbol_declaration(symbol_id).span())
                })
            {
                return true;
            }
            if symbol_id.is_some_and(|symbol_id| updater_parameter_symbol_is_array(symbol_id, ctx))
            {
                return true;
            }
            resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
                match initializer.get_inner_expression() {
                    Expression::ArrayExpression(_) => true,
                    Expression::NewExpression(new_expression) => {
                        matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                            if identifier.name == "Array" && ctx.is_reference_to_global_variable(identifier))
                    }
                    _ => false,
                }
            })
        }
        _ => false,
    }
}

fn updater_parameter_symbol_is_array(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::FormalParameter(parameter) = declaration.kind() else {
        return false;
    };
    parameter
        .type_annotation
        .as_ref()
        .is_some_and(|annotation| match &annotation.type_annotation {
            TSType::TSArrayType(_) | TSType::TSTupleType(_) => true,
            TSType::TSTypeReference(reference) => {
                matches!(&reference.type_name, TSTypeName::IdentifierReference(identifier)
                    if matches!(identifier.name.as_str(), "Array" | "ReadonlyArray"))
            }
            _ => false,
        })
}

fn updater_call_is_side_effect<'a>(
    call_node: &AstNode<'a>,
    call: &'a oxc_ast::ast::CallExpression<'a>,
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    updater_function: StateUpdaterFunction,
    updater_state_is_array: bool,
    state_setter_symbol_ids: &FxHashSet<SymbolId>,
    array_parameter_symbol_ids: &FxHashSet<SymbolId>,
    executed_function_ids: &FxHashSet<NodeId>,
    call_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    dayjs_mutability: &OnceCell<DayjsMutability>,
    ctx: &LintContext<'a>,
) -> bool {
    if let Expression::Identifier(identifier) = call.callee.get_inner_expression() {
        if updater_identifier_resolves_to_setter(
            identifier,
            state_setter_symbol_ids,
            ctx,
            &mut FxHashSet::default(),
        ) {
            return true;
        }
        if updater_resolve_called_function(call, ctx)
            .is_some_and(|function| executed_function_ids.contains(&function.node_id))
        {
            return false;
        }
        if ctx.is_reference_to_global_variable(identifier) {
            return identifier.name == "fetch"
                || GLOBAL_SCHEDULER_NAMES.contains(&identifier.name.as_str())
                || updater_name_looks_side_effecting(identifier.name.as_str());
        }
        let looks_side_effecting = updater_name_looks_side_effecting(identifier.name.as_str());
        let is_async_update = updater_name_is_async_update(identifier.name.as_str())
            && updater_call_starts_promise_chain(call_node, ctx);
        let is_callback_prop = updater_identifier_callback_property_name(identifier, ctx)
            .is_some_and(|property_name| updater_name_is_callback_prop(&property_name));
        return (looks_side_effecting
            || is_async_update
            || is_callback_prop && is_result_discarded_call(call_node, true, ctx))
            && updater_identifier_is_external_callback(identifier, updater_function, ctx);
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    let receiver = member.object().get_inner_expression();
    if updater_is_global_object(receiver, ctx) {
        return method_name == "fetch"
            || GLOBAL_SCHEDULER_NAMES.contains(&method_name.as_ref())
            || matches!(method_name.as_ref(), "pushState" | "replaceState");
    }
    if method_name == "pushState" || method_name == "replaceState" {
        return updater_is_global_history(receiver, ctx);
    }
    if SYNCHRONOUS_CALLBACK_METHOD_NAMES.contains(&method_name.as_ref())
        && updater_receiver_is_known_array(
            receiver,
            updater_function,
            updater_function,
            updater_state_is_array,
            array_parameter_symbol_ids,
            ctx,
        )
    {
        return call.arguments.first().is_some_and(|argument| {
            argument.as_expression().is_some_and(|callback| {
                updater_expression_looks_external_callback(callback, updater_function, ctx)
            })
        });
    }
    if updater_call_is_proven_pure_library_method(
        receiver,
        method_name.as_ref(),
        setter_identifier,
        updater_function,
        ctx,
    ) {
        return false;
    }
    if matches!(method_name.as_ref(), "add" | "set")
        && (updater_expression_is_dayjs_value(receiver, ctx)
            || updater_state_member_initial_value(
                receiver,
                setter_identifier,
                updater_function,
                ctx,
            )
            .is_some_and(|value| updater_expression_is_dayjs_value(value, ctx)))
    {
        return *dayjs_mutability.get_or_init(|| updater_program_dayjs_mutability(ctx))
            != DayjsMutability::Inactive;
    }
    if updater_fresh_object_method_is_external_callback(receiver, method_name.as_ref(), ctx) {
        return true;
    }
    let Some(root_identifier) = updater_member_root_identifier(receiver) else {
        return false;
    };
    let is_platform_append =
        method_name == "append" && updater_receiver_is_platform_builder(receiver, ctx);
    let is_async_update = updater_name_is_async_update(method_name.as_ref())
        && updater_call_starts_promise_chain(call_node, ctx);
    let is_discarded_callback = updater_name_is_callback_prop(method_name.as_ref())
        && is_result_discarded_call(call_node, true, ctx);
    if is_discarded_callback
        && updater_receiver_resolves_to_updater_parameter(
            root_identifier,
            updater_function,
            ctx,
            &mut FxHashSet::default(),
        )
    {
        return true;
    }
    ((SIDE_EFFECT_METHOD_NAMES.contains(&method_name.as_ref()) && method_name != "append")
        || MUTATING_COLLECTION_METHODS.contains(&method_name.as_ref())
        || is_platform_append
        || is_async_update
        || updater_name_looks_side_effecting(method_name.as_ref())
        || updater_name_is_callback_prop(method_name.as_ref())
            && is_result_discarded_call(call_node, true, ctx))
        && updater_receiver_is_external(
            root_identifier,
            updater_function,
            executed_function_ids,
            call_node_ids_by_function,
            ctx,
        )
}

fn updater_fresh_object_method_is_external_callback<'a>(
    receiver: &Expression<'a>,
    method_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let resolved = updater_resolve_direct_expression(receiver, ctx, &mut FxHashSet::default());
    let Expression::ObjectExpression(object) = resolved.get_inner_expression() else {
        return false;
    };
    for property in object.properties.iter().rev() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        let Some(property_name) = property.key.static_name() else {
            return false;
        };
        if property_name != method_name {
            continue;
        }
        return updater_expression_is_external_callback_value(&property.value, ctx);
    }
    false
}

fn updater_expression_is_external_callback_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            (identifier.name == "fetch" && ctx.is_reference_to_global_variable(identifier))
                || updater_identifier_callback_property_name(identifier, ctx)
                    .is_some_and(|name| updater_name_is_callback_prop(&name))
                || updater_name_looks_side_effecting(identifier.name.as_str())
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|name| {
                updater_name_is_callback_prop(name.as_ref())
                    || updater_name_looks_side_effecting(name.as_ref())
            })
        }),
    }
}

fn updater_identifier_callback_property_name(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    if let AstKind::VariableDeclarator(declarator) = declaration.kind()
        && let Some(property_name) = binding_property_name_for_symbol(&declarator.id, symbol_id)
    {
        let Expression::Identifier(source_identifier) =
            declarator.init.as_ref()?.get_inner_expression()
        else {
            return None;
        };
        let source_symbol_id = ctx
            .scoping()
            .get_reference(source_identifier.reference_id())
            .symbol_id()?;
        return matches!(
            ctx.symbol_declaration(source_symbol_id).kind(),
            AstKind::FormalParameter(_)
        )
        .then_some(property_name);
    }
    let enclosing_function = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    })?;
    let parameters = match enclosing_function.kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return None,
    };
    parameters
        .iter()
        .find_map(|parameter| binding_property_name_for_symbol(&parameter.pattern, symbol_id))
}

fn updater_receiver_resolves_to_updater_parameter(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    updater_function: StateUpdaterFunction,
    ctx: &LintContext<'_>,
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
    if updater_function
        .parameters_span
        .contains_inclusive(ctx.symbol_declaration(symbol_id).span())
    {
        return true;
    }
    let Some(Expression::Identifier(alias)) =
        resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            .map(Expression::get_inner_expression)
    else {
        return false;
    };
    updater_receiver_resolves_to_updater_parameter(alias, updater_function, ctx, visited_symbol_ids)
}

fn updater_name_looks_side_effecting(name: &str) -> bool {
    [
        "analytics",
        "capture",
        "dispatch",
        "emit",
        "log",
        "notify",
        "persist",
        "record",
        "report",
        "save",
        "send",
        "submit",
        "track",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
}

fn updater_name_is_async_update(name: &str) -> bool {
    name.strip_prefix("update").is_some_and(|suffix| {
        suffix
            .as_bytes()
            .first()
            .is_some_and(|byte| byte.is_ascii_uppercase() || *byte == b'_')
    })
}

fn updater_call_starts_promise_chain<'a>(call_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let call_root = transparent_expression_root(call_node, ctx);
    let parent = ctx.nodes().parent_node(call_root.id());
    let Some(member) = parent.kind().as_member_expression_kind() else {
        return false;
    };
    if member.object().span() != call_root.span() {
        return false;
    }
    match member {
        oxc_ast::MemberExpressionKind::Static(member) => {
            matches!(member.property.name.as_str(), "then" | "catch" | "finally")
        }
        oxc_ast::MemberExpressionKind::Computed(member) => {
            matches!(&member.expression, Expression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "then" | "catch" | "finally"))
        }
        oxc_ast::MemberExpressionKind::PrivateField(_) => false,
    }
}

fn updater_name_is_callback_prop(name: &str) -> bool {
    (name.starts_with("on") || name.starts_with("set"))
        && name
            .as_bytes()
            .get(if name.starts_with("on") { 2 } else { 3 })
            .is_some_and(u8::is_ascii_uppercase)
}

fn updater_identifier_is_external_callback(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    updater_function: StateUpdaterFunction,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    !updater_function
        .span
        .contains_inclusive(ctx.symbol_declaration(symbol_id).span())
}

fn updater_expression_looks_external_callback(
    expression: &Expression<'_>,
    updater_function: StateUpdaterFunction,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            (updater_name_looks_side_effecting(identifier.name.as_str())
                || updater_name_is_callback_prop(identifier.name.as_str()))
                && updater_identifier_is_external_callback(identifier, updater_function, ctx)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            member.static_property_name().is_some_and(|name| {
                updater_name_looks_side_effecting(name.as_ref())
                    || updater_name_is_callback_prop(name.as_ref())
            })
        }),
    }
}

fn updater_receiver_is_external(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    updater_function: StateUpdaterFunction,
    executed_function_ids: &FxHashSet<NodeId>,
    call_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> bool {
    updater_receiver_is_external_inner(
        identifier,
        updater_function,
        executed_function_ids,
        call_node_ids_by_function,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn updater_receiver_is_external_inner(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    updater_function: StateUpdaterFunction,
    executed_function_ids: &FxHashSet<NodeId>,
    call_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return true;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if updater_function
        .parameters_span
        .contains_inclusive(declaration.span())
    {
        return false;
    }
    let declaring_function_id = updater_nearest_function_id(declaration, ctx)
        .filter(|function_id| executed_function_ids.contains(function_id));
    if let Some(declaring_function_id) = declaring_function_id {
        if let Some(parameter_index) =
            updater_function_parameter_index_for_symbol(declaring_function_id, symbol_id, ctx)
        {
            return !updater_parameter_arguments_stay_local(
                declaring_function_id,
                parameter_index,
                updater_function,
                executed_function_ids,
                call_node_ids_by_function,
                ctx,
                visited_symbol_ids,
            );
        }
        if let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx) {
            if updater_expression_is_fresh_container(initializer, ctx) {
                return false;
            }
            if let Expression::Identifier(alias) = initializer.get_inner_expression() {
                return updater_receiver_is_external_inner(
                    alias,
                    updater_function,
                    executed_function_ids,
                    call_node_ids_by_function,
                    ctx,
                    visited_symbol_ids,
                );
            }
            if initializer
                .get_inner_expression()
                .as_member_expression()
                .is_some()
            {
                return true;
            }
        }
        if let AstKind::VariableDeclarator(declarator) = declaration.kind()
            && let Some(initializer) = &declarator.init
        {
            match initializer.get_inner_expression() {
                Expression::Identifier(alias) => {
                    return updater_receiver_is_external_inner(
                        alias,
                        updater_function,
                        executed_function_ids,
                        call_node_ids_by_function,
                        ctx,
                        visited_symbol_ids,
                    );
                }
                Expression::CallExpression(call) => {
                    return !updater_call_returns_only_fresh_containers(
                        call,
                        ctx,
                        &mut FxHashSet::default(),
                    );
                }
                Expression::ChainExpression(chain) => {
                    return match &chain.expression {
                        oxc_ast::ast::ChainElement::CallExpression(call) => {
                            !updater_call_returns_only_fresh_containers(
                                call,
                                ctx,
                                &mut FxHashSet::default(),
                            )
                        }
                        _ => true,
                    };
                }
                expression if expression.as_member_expression().is_some() => return true,
                _ => {}
            }
        }
        return false;
    }
    if let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx) {
        if updater_expression_is_fresh_container(initializer, ctx)
            && updater_nearest_function_id(declaration, ctx).is_some()
        {
            return false;
        }
        if let Expression::Identifier(alias) = initializer.get_inner_expression() {
            return updater_receiver_is_external_inner(
                alias,
                updater_function,
                executed_function_ids,
                call_node_ids_by_function,
                ctx,
                visited_symbol_ids,
            );
        }
    }
    true
}

fn updater_call_returns_only_fresh_containers<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    let Some(function) = updater_resolve_called_function(call, ctx) else {
        return false;
    };
    if !visited_function_ids.insert(function.node_id) {
        return false;
    }
    let function_node = ctx.nodes().get_node(function.node_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        let result = updater_expression_is_fresh_container(expression, ctx)
            || if let Expression::CallExpression(call) = expression.get_inner_expression() {
                updater_call_returns_only_fresh_containers(call, ctx, visited_function_ids)
            } else {
                false
            };
        visited_function_ids.remove(&function_node.id());
        return result;
    }
    let mut has_return = false;
    let mut returns_only_fresh_containers = true;
    for candidate in ctx.nodes().iter() {
        if updater_nearest_function_id(candidate, ctx) != Some(function.node_id) {
            continue;
        }
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        let Some(expression) = &statement.argument else {
            returns_only_fresh_containers = false;
            break;
        };
        has_return = true;
        let returns_fresh_container = updater_expression_is_fresh_container(expression, ctx)
            || if let Expression::CallExpression(call) = expression.get_inner_expression() {
                updater_call_returns_only_fresh_containers(call, ctx, visited_function_ids)
            } else {
                false
            };
        if !returns_fresh_container {
            returns_only_fresh_containers = false;
            break;
        }
    }
    visited_function_ids.remove(&function.node_id);
    has_return && returns_only_fresh_containers
}

fn updater_function_parameter_index_for_symbol(
    function_id: NodeId,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<usize> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return None,
    };
    parameters
        .iter()
        .position(|parameter| binding_pattern_has_symbol(&parameter.pattern, symbol_id))
}

fn updater_parameter_arguments_stay_local(
    function_id: NodeId,
    parameter_index: usize,
    updater_function: StateUpdaterFunction,
    executed_function_ids: &FxHashSet<NodeId>,
    call_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(call_node_ids) = call_node_ids_by_function.get(&function_id) else {
        return false;
    };
    call_node_ids.iter().all(|call_node_id| {
        let AstKind::CallExpression(call) = ctx.nodes().get_node(*call_node_id).kind() else {
            return false;
        };
        let Some(argument) = call
            .arguments
            .get(parameter_index)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return false;
        };
        updater_expression_is_local(
            argument,
            updater_function,
            executed_function_ids,
            call_node_ids_by_function,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
    })
}

fn updater_expression_is_local<'a>(
    expression: &Expression<'a>,
    updater_function: StateUpdaterFunction,
    executed_function_ids: &FxHashSet<NodeId>,
    call_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if updater_expression_is_fresh_container(expression, ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    !updater_receiver_is_external_inner(
        identifier,
        updater_function,
        executed_function_ids,
        call_node_ids_by_function,
        ctx,
        visited_symbol_ids,
    )
}

fn updater_receiver_is_platform_builder<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let resolved = match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            resolve_direct_unreassigned_initializer(identifier, ctx)
                .unwrap_or(expression)
                .get_inner_expression()
        }
        expression => expression,
    };
    matches!(resolved, Expression::NewExpression(new_expression)
        if matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "FormData" | "Headers" | "URLSearchParams")
                && ctx.is_reference_to_global_variable(identifier)))
}

fn updater_expression_is_fresh_container<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_cpu_typed_array(expression, ctx) {
        return true;
    }
    match expression.get_inner_expression() {
        Expression::ArrayExpression(_) | Expression::ObjectExpression(_) => true,
        Expression::NewExpression(new_expression) => {
            matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                if FRESH_CONTAINER_CONSTRUCTORS.contains(&identifier.name.as_str())
                    && ctx.is_reference_to_global_variable(identifier))
        }
        _ => false,
    }
}

fn updater_call_is_proven_pure_library_method<'a>(
    receiver: &Expression<'a>,
    method_name: &str,
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    updater_function: StateUpdaterFunction,
    ctx: &LintContext<'a>,
) -> bool {
    if matches!(
        method_name,
        "map" | "filter" | "reduce" | "slice" | "concat" | "toSorted"
    ) {
        return true;
    }
    if matches!(method_name, "add" | "set") {
        let state_member_initial_value =
            updater_state_member_initial_value(receiver, setter_identifier, updater_function, ctx);
        return updater_expression_is_fresh_container(receiver, ctx)
            || updater_expression_is_internationalized_date(receiver, ctx)
            || state_member_initial_value
                .is_some_and(|value| updater_expression_is_internationalized_date(value, ctx));
    }
    matches!(receiver.get_inner_expression(), Expression::Identifier(identifier)
        if matches!(identifier.name.as_str(), "Math" | "JSON" | "Object" | "Array")
            && ctx.is_reference_to_global_variable(identifier))
}

fn updater_expression_is_internationalized_date<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let resolved = updater_resolve_direct_expression(expression, ctx, &mut FxHashSet::default());
    match resolved.get_inner_expression() {
        Expression::NewExpression(new_expression) => {
            let Expression::Identifier(identifier) = new_expression.callee.get_inner_expression()
            else {
                return false;
            };
            resolve_identifier_import(identifier, ctx).is_some_and(|entry| {
                entry.module_request.name() == "@internationalized/date"
                    && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(name)
                        if name.name() == "CalendarDateTime")
            })
        }
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            matches!(
                member.static_property_name().as_deref(),
                Some("add" | "set")
            ) && updater_expression_is_internationalized_date(member.object(), ctx)
        }
        _ => false,
    }
}

fn updater_state_member_initial_value<'a>(
    receiver: &Expression<'a>,
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    updater_function: StateUpdaterFunction,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let resolved_receiver =
        updater_resolve_direct_expression(receiver, ctx, &mut FxHashSet::default());
    let mut member = resolved_receiver
        .get_inner_expression()
        .as_member_expression()?;
    let mut property_names = Vec::new();
    loop {
        property_names.push(member.static_property_name()?.to_string());
        let object = member.object().get_inner_expression();
        if let Expression::Identifier(identifier) = object {
            if !updater_receiver_resolves_to_updater_parameter(
                identifier,
                updater_function,
                ctx,
                &mut FxHashSet::default(),
            ) {
                return None;
            }
            break;
        }
        member = object.as_member_expression()?;
    }
    let mut value = updater_state_initial_value(setter_identifier, ctx)?;
    for property_name in property_names.iter().rev() {
        value = updater_static_member_value(value, property_name)?;
    }
    Some(value)
}

fn updater_state_initial_value<'a>(
    setter_identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(setter_identifier.reference_id())
        .symbol_id()?;
    let mut visited_symbol_ids = FxHashSet::default();
    loop {
        if !visited_symbol_ids.insert(symbol_id) {
            return None;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        if let AstKind::VariableDeclarator(declarator) = declaration.kind()
            && let BindingPattern::ArrayPattern(pattern) = &declarator.id
            && pattern
                .elements
                .get(1)
                .and_then(Option::as_ref)
                .is_some_and(|binding| {
                    binding
                        .get_binding_identifier()
                        .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                })
            && let Some(Expression::CallExpression(use_state_call)) = &declarator.init
            && is_react_hook_call(use_state_call, &["useState"], ctx)
        {
            let initial_value = use_state_call
                .arguments
                .first()
                .and_then(oxc_ast::ast::Argument::as_expression)?;
            if let Expression::ArrowFunctionExpression(function) =
                initial_value.get_inner_expression()
                && let Some(expression) = function.get_expression()
            {
                return Some(expression);
            }
            return Some(initial_value);
        }
        let Expression::Identifier(alias) =
            resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?.get_inner_expression()
        else {
            return None;
        };
        symbol_id = ctx
            .scoping()
            .get_reference(alias.reference_id())
            .symbol_id()?;
    }
}

fn updater_static_member_value<'a>(
    expression: &'a Expression<'a>,
    property_name: &str,
) -> Option<&'a Expression<'a>> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => {
            for candidate in object.properties.iter().rev() {
                let ObjectPropertyKind::ObjectProperty(property) = candidate else {
                    return None;
                };
                let candidate_name = property.key.static_name()?;
                if candidate_name == property_name {
                    return Some(&property.value);
                }
            }
            None
        }
        Expression::ArrayExpression(array) => {
            let index = property_name.parse::<usize>().ok()?;
            array.elements.get(index)?.as_expression()
        }
        _ => None,
    }
}

fn updater_expression_is_dayjs_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let resolved = updater_resolve_direct_expression(expression, ctx, &mut FxHashSet::default());
    let Expression::CallExpression(call) = resolved.get_inner_expression() else {
        return false;
    };
    if updater_expression_is_dayjs_factory(&call.callee, ctx) {
        return true;
    }
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    matches!(
        member.static_property_name().as_deref(),
        Some("add" | "set")
    ) && updater_expression_is_dayjs_value(member.object(), ctx)
}

fn updater_expression_is_dayjs_factory<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let file_path = updater_dayjs_absolute_file_path(ctx.file_path());
    updater_dayjs_expression_resolves_to_factory(
        expression,
        ctx.semantic(),
        ctx.module_record(),
        &file_path,
        0,
        &mut FxHashSet::default(),
        &mut FxHashSet::default(),
    )
}

fn updater_program_dayjs_mutability(ctx: &LintContext<'_>) -> DayjsMutability {
    let file_path = updater_dayjs_absolute_file_path(ctx.file_path());
    updater_dayjs_analyze_runtime_graph(
        ctx.nodes().program(),
        ctx.semantic(),
        ctx.module_record(),
        &file_path,
        0,
        &mut FxHashMap::default(),
        &mut FxHashSet::default(),
    )
}

fn updater_dayjs_absolute_file_path(file_path: &Path) -> PathBuf {
    if file_path.is_absolute() {
        file_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|current_directory| current_directory.join(file_path))
            .unwrap_or_else(|_| file_path.to_path_buf())
    }
}

fn updater_dayjs_analyze_runtime_graph<'a>(
    program: &oxc_ast::ast::Program<'a>,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    file_path: &Path,
    depth: usize,
    minimum_depth_by_path: &mut FxHashMap<PathBuf, usize>,
    unresolved_frontier_paths: &mut FxHashSet<PathBuf>,
) -> DayjsMutability {
    let normalized_path =
        std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf());
    if minimum_depth_by_path
        .get(&normalized_path)
        .is_some_and(|previous_depth| *previous_depth <= depth)
    {
        return if unresolved_frontier_paths.is_empty() {
            DayjsMutability::Inactive
        } else {
            DayjsMutability::Unknown
        };
    }
    minimum_depth_by_path.insert(normalized_path.clone(), depth);
    unresolved_frontier_paths.remove(&normalized_path);
    if updater_dayjs_program_has_activation(semantic, module_record, file_path) {
        return DayjsMutability::Active;
    }
    for dependency_source in program
        .body
        .iter()
        .filter_map(updater_dayjs_runtime_dependency_source)
    {
        let Some(dependency_path) =
            updater_dayjs_resolve_first_party_module_path(file_path, dependency_source)
        else {
            continue;
        };
        let normalized_dependency_path =
            std::fs::canonicalize(&dependency_path).unwrap_or_else(|_| dependency_path.clone());
        let dependency_depth = depth + 1;
        if minimum_depth_by_path
            .get(&normalized_dependency_path)
            .is_some_and(|previous_depth| *previous_depth <= dependency_depth)
        {
            continue;
        }
        if depth >= DAYJS_RUNTIME_DEPENDENCY_DEPTH {
            unresolved_frontier_paths.insert(normalized_dependency_path);
            continue;
        }
        let Some(dependency_mutability) = updater_dayjs_with_foreign_program(
            &dependency_path,
            |dependency_program, dependency_semantic, dependency_module_record| {
                updater_dayjs_analyze_runtime_graph(
                    dependency_program,
                    dependency_semantic,
                    dependency_module_record,
                    &dependency_path,
                    dependency_depth,
                    minimum_depth_by_path,
                    unresolved_frontier_paths,
                )
            },
        ) else {
            continue;
        };
        if dependency_mutability == DayjsMutability::Active {
            return DayjsMutability::Active;
        }
    }
    if unresolved_frontier_paths.is_empty() {
        DayjsMutability::Inactive
    } else {
        DayjsMutability::Unknown
    }
}

fn updater_dayjs_runtime_dependency_source<'a>(statement: &'a Statement<'a>) -> Option<&'a str> {
    match statement {
        Statement::ImportDeclaration(declaration) => {
            if declaration.import_kind.is_type()
                || declaration.specifiers.as_ref().is_some_and(|specifiers| {
                    !specifiers.is_empty()
                        && specifiers.iter().all(|specifier| {
                            matches!(specifier,
                                ImportDeclarationSpecifier::ImportSpecifier(specifier)
                                    if specifier.import_kind.is_type())
                        })
                })
            {
                None
            } else {
                Some(declaration.source.value.as_str())
            }
        }
        Statement::ExportFromDeclaration(declaration) => {
            if declaration.export_kind.is_type()
                || !declaration.specifiers.is_empty()
                    && declaration
                        .specifiers
                        .iter()
                        .all(|specifier| specifier.export_kind.is_type())
            {
                None
            } else {
                Some(declaration.source.value.as_str())
            }
        }
        Statement::ExportAllDeclaration(declaration) => {
            (!declaration.export_kind.is_type()).then_some(declaration.source.value.as_str())
        }
        _ => None,
    }
}

fn updater_dayjs_program_has_activation<'a>(
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    file_path: &Path,
) -> bool {
    let mut pending_function_ids = Vec::new();
    let mut executed_function_ids = FxHashSet::default();
    let mut did_scan_module_scope = false;
    loop {
        let current_function_id = if !did_scan_module_scope {
            did_scan_module_scope = true;
            None
        } else {
            let Some(function_id) = pending_function_ids.pop() else {
                break;
            };
            if !executed_function_ids.insert(function_id) {
                continue;
            }
            Some(function_id)
        };
        for node in semantic.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if updater_dayjs_nearest_function_id(node, semantic) != current_function_id {
                continue;
            }
            if updater_dayjs_call_activates_bad_mutable(call, semantic, module_record, file_path) {
                return true;
            }
            if let Some(function_id) = updater_dayjs_resolve_called_function(call, semantic) {
                pending_function_ids.push(function_id);
            }
            updater_dayjs_collect_synchronous_callbacks(call, semantic, &mut pending_function_ids);
        }
    }
    false
}

fn updater_dayjs_call_activates_bad_mutable<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    file_path: &Path,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("extend")
        || !updater_dayjs_expression_resolves_to_default_module(
            member.object(),
            semantic,
            module_record,
            file_path,
            &["dayjs"],
            false,
            0,
            &mut FxHashSet::default(),
            &mut FxHashSet::default(),
        )
    {
        return false;
    }
    call.arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|plugin| {
            updater_dayjs_expression_resolves_to_default_module(
                plugin,
                semantic,
                module_record,
                file_path,
                &DAYJS_BAD_MUTABLE_MODULE_NAMES,
                false,
                0,
                &mut FxHashSet::default(),
                &mut FxHashSet::default(),
            )
        })
}

fn updater_dayjs_nearest_function_id(
    node: &AstNode<'_>,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
    semantic.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn updater_dayjs_resolve_called_function(
    call: &oxc_ast::ast::CallExpression<'_>,
    semantic: &Semantic<'_>,
) -> Option<NodeId> {
    updater_dayjs_resolve_function_expression(&call.callee, semantic, &mut FxHashSet::default())
}

fn updater_dayjs_resolve_function_expression(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) if !function.r#async => {
            Some(function.node_id.get())
        }
        Expression::FunctionExpression(function) if !function.r#async && !function.generator => {
            Some(function.node_id.get())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            match semantic.symbol_declaration(symbol_id).kind() {
                AstKind::Function(function) if !function.r#async && !function.generator => {
                    Some(function.node_id.get())
                }
                AstKind::VariableDeclarator(declarator) => {
                    let parent = semantic
                        .nodes()
                        .parent_node(semantic.symbol_declaration(symbol_id).id());
                    let AstKind::VariableDeclaration(declaration) = parent.kind() else {
                        return None;
                    };
                    if !declaration.kind.is_const()
                        && semantic
                            .scoping()
                            .get_resolved_references(symbol_id)
                            .any(oxc_semantic::Reference::is_write)
                    {
                        return None;
                    }
                    updater_dayjs_resolve_function_expression(
                        declarator.init.as_ref()?,
                        semantic,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn updater_dayjs_collect_synchronous_callbacks(
    call: &oxc_ast::ast::CallExpression<'_>,
    semantic: &Semantic<'_>,
    pending_function_ids: &mut Vec<NodeId>,
) {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return;
    };
    let Some(method_name) = member.static_property_name() else {
        return;
    };
    if !SYNCHRONOUS_CALLBACK_METHOD_NAMES.contains(&method_name.as_ref())
        || !updater_dayjs_receiver_is_definitely_nonempty(member.object(), semantic)
    {
        return;
    }
    for callback in call
        .arguments
        .iter()
        .filter_map(oxc_ast::ast::Argument::as_expression)
    {
        if let Some(function_id) =
            updater_dayjs_resolve_function_expression(callback, semantic, &mut FxHashSet::default())
        {
            pending_function_ids.push(function_id);
        }
    }
}

fn updater_dayjs_receiver_is_definitely_nonempty(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => !array.elements.is_empty(),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let AstKind::VariableDeclarator(declarator) =
                semantic.symbol_declaration(symbol_id).kind()
            else {
                return false;
            };
            declarator.init.as_ref().is_some_and(|initializer| {
                updater_dayjs_receiver_is_definitely_nonempty(initializer, semantic)
            })
        }
        _ => false,
    }
}

fn updater_dayjs_expression_resolves_to_factory<'a>(
    expression: &Expression<'a>,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    file_path: &Path,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if updater_dayjs_expression_resolves_to_default_module(
        expression,
        semantic,
        module_record,
        file_path,
        &["dayjs"],
        true,
        depth,
        visited_paths,
        visited_symbol_ids,
    ) {
        return true;
    }
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    matches!(
        member.static_property_name().as_deref(),
        Some("unix" | "utc")
    ) && updater_dayjs_expression_resolves_to_factory(
        member.object(),
        semantic,
        module_record,
        file_path,
        depth,
        visited_paths,
        visited_symbol_ids,
    )
}

#[allow(clippy::too_many_arguments)]
fn updater_dayjs_expression_resolves_to_default_module<'a>(
    expression: &Expression<'a>,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    file_path: &Path,
    module_names: &[&str],
    allow_static_dayjs_factory: bool,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if depth > DAYJS_FACTORY_EXPORT_DEPTH {
        return false;
    }
    if allow_static_dayjs_factory
        && let Some(member) = expression.get_inner_expression().as_member_expression()
        && matches!(
            member.static_property_name().as_deref(),
            Some("unix" | "utc")
        )
    {
        return updater_dayjs_expression_resolves_to_default_module(
            member.object(),
            semantic,
            module_record,
            file_path,
            module_names,
            allow_static_dayjs_factory,
            depth,
            visited_paths,
            visited_symbol_ids,
        );
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    if let Some(import_entry) = module_record.import_entries.iter().find(|entry| {
        !entry.is_type
            && semantic
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    }) {
        let imported_name = match &import_entry.import_name {
            ImportImportName::Default(_) => "default",
            ImportImportName::Name(name) => name.name(),
            ImportImportName::NamespaceObject => return false,
        };
        if module_names.contains(&import_entry.module_request.name())
            && (imported_name == "default"
                || allow_static_dayjs_factory && matches!(imported_name, "unix" | "utc"))
        {
            return true;
        }
        let Some(imported_path) = updater_dayjs_resolve_first_party_module_path(
            file_path,
            import_entry.module_request.name(),
        ) else {
            return false;
        };
        return updater_dayjs_foreign_export_resolves_to_default_module(
            &imported_path,
            imported_name,
            module_names,
            allow_static_dayjs_factory,
            depth + 1,
            visited_paths,
        );
    }
    let declaration = semantic.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = semantic.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    if !variable_declaration.kind.is_const()
        && semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    declarator.init.as_ref().is_some_and(|initializer| {
        updater_dayjs_expression_resolves_to_default_module(
            initializer,
            semantic,
            module_record,
            file_path,
            module_names,
            allow_static_dayjs_factory,
            depth,
            visited_paths,
            visited_symbol_ids,
        )
    })
}

fn updater_dayjs_foreign_export_resolves_to_default_module(
    file_path: &Path,
    exported_name: &str,
    module_names: &[&str],
    allow_static_dayjs_factory: bool,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> bool {
    if depth > DAYJS_FACTORY_EXPORT_DEPTH {
        return false;
    }
    let normalized_path =
        std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf());
    if !visited_paths.insert(normalized_path) {
        return false;
    }
    updater_dayjs_with_foreign_program(file_path, |program, semantic, module_record| {
        if let Some(local_name) = module_record.local_export_entries.iter().find_map(|entry| {
            let matches_export = match &entry.export_name {
                ExportExportName::Name(name) => name.name() == exported_name,
                ExportExportName::Default(_) => exported_name == "default",
                ExportExportName::Null => false,
            };
            matches_export.then(|| entry.local_name.name()).flatten()
        }) && let Some(symbol_id) = semantic.scoping().get_root_binding(local_name.into())
            && updater_dayjs_symbol_resolves_to_default_module(
                symbol_id,
                semantic,
                module_record,
                file_path,
                module_names,
                allow_static_dayjs_factory,
                depth,
                &mut visited_paths.clone(),
                &mut FxHashSet::default(),
            )
        {
            return true;
        }
        if exported_name == "default"
            && semantic.nodes().iter().any(|node| {
                let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
                    return false;
                };
                declaration
                    .declaration
                    .as_expression()
                    .is_some_and(|expression| {
                        updater_dayjs_expression_resolves_to_default_module(
                            expression,
                            semantic,
                            module_record,
                            file_path,
                            module_names,
                            allow_static_dayjs_factory,
                            depth,
                            &mut visited_paths.clone(),
                            &mut FxHashSet::default(),
                        )
                    })
            })
        {
            return true;
        }
        if let Some((module_source, imported_name)) =
            updater_dayjs_foreign_reexport_target(exported_name, module_record)
        {
            if module_names.contains(&module_source)
                && (imported_name == "default"
                    || allow_static_dayjs_factory && matches!(imported_name, "unix" | "utc"))
            {
                return true;
            }
            if let Some(reexported_path) =
                updater_dayjs_resolve_first_party_module_path(file_path, module_source)
                && updater_dayjs_foreign_export_resolves_to_default_module(
                    &reexported_path,
                    imported_name,
                    module_names,
                    allow_static_dayjs_factory,
                    depth + 1,
                    &mut visited_paths.clone(),
                )
            {
                return true;
            }
        }
        let mut matching_star_export_count = 0;
        for statement in &program.body {
            let Statement::ExportAllDeclaration(declaration) = statement else {
                continue;
            };
            if declaration.export_kind.is_type() || declaration.exported.is_some() {
                continue;
            }
            let Some(reexported_path) = updater_dayjs_resolve_first_party_module_path(
                file_path,
                declaration.source.value.as_str(),
            ) else {
                continue;
            };
            if updater_dayjs_foreign_export_resolves_to_default_module(
                &reexported_path,
                exported_name,
                module_names,
                allow_static_dayjs_factory,
                depth + 1,
                &mut visited_paths.clone(),
            ) {
                matching_star_export_count += 1;
            }
        }
        matching_star_export_count == 1
    })
    .unwrap_or(false)
}

#[allow(clippy::too_many_arguments)]
fn updater_dayjs_symbol_resolves_to_default_module<'a>(
    symbol_id: SymbolId,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
    file_path: &Path,
    module_names: &[&str],
    allow_static_dayjs_factory: bool,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    if let Some(import_entry) = module_record.import_entries.iter().find(|entry| {
        !entry.is_type
            && semantic
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    }) {
        let imported_name = match &import_entry.import_name {
            ImportImportName::Default(_) => "default",
            ImportImportName::Name(name) => name.name(),
            ImportImportName::NamespaceObject => return false,
        };
        if module_names.contains(&import_entry.module_request.name())
            && (imported_name == "default"
                || allow_static_dayjs_factory && matches!(imported_name, "unix" | "utc"))
        {
            return true;
        }
        let Some(imported_path) = updater_dayjs_resolve_first_party_module_path(
            file_path,
            import_entry.module_request.name(),
        ) else {
            return false;
        };
        return updater_dayjs_foreign_export_resolves_to_default_module(
            &imported_path,
            imported_name,
            module_names,
            allow_static_dayjs_factory,
            depth + 1,
            visited_paths,
        );
    }
    let declaration = semantic.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    declarator.init.as_ref().is_some_and(|initializer| {
        updater_dayjs_expression_resolves_to_default_module(
            initializer,
            semantic,
            module_record,
            file_path,
            module_names,
            allow_static_dayjs_factory,
            depth,
            visited_paths,
            visited_symbol_ids,
        )
    })
}

fn updater_dayjs_foreign_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .filter(|entry| !entry.is_type)
        .find_map(|entry| {
            let candidate_exported_name = match &entry.export_name {
                ExportExportName::Name(name) => name.name(),
                ExportExportName::Default(_) => "default",
                ExportExportName::Null => return None,
            };
            if candidate_exported_name != exported_name {
                return None;
            }
            let module_source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((module_source, imported_name))
        })
}

fn updater_dayjs_resolve_first_party_module_path(
    from_file_path: &Path,
    module_source: &str,
) -> Option<PathBuf> {
    if Path::new(module_source).is_absolute() {
        return None;
    }
    if module_source.starts_with('.') {
        return updater_dayjs_resolve_module_with_tsconfig(
            from_file_path,
            module_source,
            TsconfigDiscovery::Auto,
        );
    }
    let mut current_directory = from_file_path.parent()?;
    for _ in 0..DAYJS_TSCONFIG_DIRECTORY_DEPTH {
        for config_filename in ["tsconfig.json", "jsconfig.json"] {
            let config_file = current_directory.join(config_filename);
            if !config_file.is_file() {
                continue;
            }
            if let Some(resolved_path) = updater_dayjs_resolve_module_with_tsconfig(
                from_file_path,
                module_source,
                TsconfigDiscovery::Manual(TsconfigOptions {
                    config_file,
                    references: TsconfigReferences::Disabled,
                }),
            ) {
                return Some(resolved_path);
            }
        }
        current_directory = current_directory.parent()?;
    }
    None
}

fn updater_dayjs_resolve_module_with_tsconfig(
    from_file_path: &Path,
    module_source: &str,
    tsconfig: TsconfigDiscovery,
) -> Option<PathBuf> {
    let resolver = Resolver::new(ResolveOptions {
        extensions: VALID_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect(),
        main_fields: vec!["module".into(), "main".into(), "browser".into()],
        condition_names: vec![
            "import".into(),
            "default".into(),
            "module".into(),
            "browser".into(),
            "require".into(),
        ],
        extension_alias: vec![
            (
                ".js".into(),
                vec![".js".into(), ".ts".into(), ".tsx".into(), ".jsx".into()],
            ),
            (".jsx".into(), vec![".jsx".into(), ".tsx".into()]),
            (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
            (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
        ],
        tsconfig: Some(tsconfig),
        ..ResolveOptions::default()
    });
    let resolved_path = resolver
        .resolve_file(from_file_path, module_source)
        .ok()?
        .path()
        .to_path_buf();
    if resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules")
        || resolved_path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
            })
    {
        return None;
    }
    Some(resolved_path)
}

fn updater_dayjs_with_foreign_program<T>(
    file_path: &Path,
    analyze: impl for<'a> FnOnce(&oxc_ast::ast::Program<'a>, &Semantic<'a>, &ModuleRecord) -> T,
) -> Option<T> {
    let metadata = std::fs::metadata(file_path).ok()?;
    if !metadata.is_file() || metadata.len() > DAYJS_CROSS_FILE_PARSE_MAX_BYTES {
        return None;
    }
    let source = std::fs::read_to_string(file_path).ok()?;
    let source_type = SourceType::from_path(file_path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    Some(analyze(program, &semantic, &module_record))
}

fn updater_resolve_direct_expression<'a, 'b>(
    expression: &'b Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> &'b Expression<'a>
where
    'a: 'b,
{
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return expression;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return expression;
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return expression;
    }
    resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
        .map_or(expression, |initializer| {
            updater_resolve_direct_expression(initializer, ctx, visited_symbol_ids)
        })
}

fn updater_is_global_object(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if matches!(identifier.name.as_str(), "globalThis" | "self" | "window")
            && ctx.is_reference_to_global_variable(identifier))
}

fn updater_is_global_history(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    if matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "history" && ctx.is_reference_to_global_variable(identifier))
    {
        return true;
    }
    expression.as_member_expression().is_some_and(|member| {
        member.static_property_name() == Some("history")
            && updater_is_global_object(member.object(), ctx)
    })
}

fn updater_is_statically_unreachable(
    node: &AstNode<'_>,
    boundary_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == boundary_function_id {
            return false;
        }
        let unreachable = match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                let test = static_literal_truthiness(&statement.test);
                statement.consequent.span().contains_inclusive(child_span) && test == Some(false)
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span().contains_inclusive(child_span))
                        && test == Some(true)
            }
            AstKind::ConditionalExpression(conditional) => {
                let test = static_literal_truthiness(&conditional.test);
                conditional.consequent.span().contains_inclusive(child_span) && test == Some(false)
                    || conditional.alternate.span().contains_inclusive(child_span)
                        && test == Some(true)
            }
            AstKind::LogicalExpression(logical)
                if logical.right.span().contains_inclusive(child_span) =>
            {
                let left = static_literal_truthiness(&logical.left);
                logical.operator == LogicalOperator::And && left == Some(false)
                    || logical.operator == LogicalOperator::Or && left == Some(true)
            }
            _ => false,
        };
        if unreachable {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn updater_can_execute_before_suspension(
    candidate: &AstNode<'_>,
    function_id: NodeId,
    suspension_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> bool {
    let target_block = ctx.nodes().cfg_id(candidate.id());
    let mut suspension_blocks = FxHashSet::default();
    for suspension_id in suspension_node_ids_by_function
        .get(&function_id)
        .into_iter()
        .flatten()
    {
        let suspension = ctx.nodes().get_node(*suspension_id);
        if suspension.span().contains_inclusive(candidate.span()) {
            continue;
        }
        let suspension_block = ctx.nodes().cfg_id(*suspension_id);
        if suspension_block == target_block {
            if suspension.span().start < candidate.span().start {
                return false;
            }
        } else {
            suspension_blocks.insert(suspension_block);
        }
    }
    updater_cfg_block_can_reach_without_suspension(
        ctx.nodes().cfg_id(function_id),
        target_block,
        &suspension_blocks,
        ctx,
    )
}

fn updater_cfg_block_can_reach_without_suspension(
    source_block: oxc_cfg::BlockNodeId,
    target_block: oxc_cfg::BlockNodeId,
    suspension_blocks: &FxHashSet<oxc_cfg::BlockNodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    if source_block == target_block {
        return true;
    }
    let graph = ctx.cfg().graph();
    let mut visited_blocks = FxHashSet::default();
    let mut pending_blocks = vec![source_block];
    while let Some(current_block) = pending_blocks.pop() {
        if !visited_blocks.insert(current_block) || suspension_blocks.contains(&current_block) {
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
            let next_block = oxc_cfg::graph::visit::EdgeRef::target(&edge);
            if next_block == target_block {
                return true;
            }
            pending_blocks.push(next_block);
        }
    }
    false
}

fn updater_assignment_receiver<'a>(target: &'a AssignmentTarget<'a>) -> Option<&'a Expression<'a>> {
    target.as_member_expression().map(|member| member.object())
}

fn updater_simple_assignment_receiver<'a>(
    target: &'a SimpleAssignmentTarget<'a>,
) -> Option<&'a Expression<'a>> {
    target.as_member_expression().map(|member| member.object())
}

fn updater_member_receiver<'a>(expression: &'a Expression<'a>) -> Option<&'a Expression<'a>> {
    expression
        .get_inner_expression()
        .as_member_expression()
        .map(|member| member.object())
}

fn updater_write_receiver_is_external(
    receiver: &Expression<'_>,
    updater_function: StateUpdaterFunction,
    executed_function_ids: &FxHashSet<NodeId>,
    call_node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
    ctx: &LintContext<'_>,
) -> bool {
    if let Expression::Identifier(identifier) = receiver.get_inner_expression() {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
        if symbol_id.is_some_and(|symbol_id| {
            let declaration = ctx.symbol_declaration(symbol_id);
            executed_function_ids.iter().any(|function_id| {
                ctx.nodes()
                    .get_node(*function_id)
                    .span()
                    .contains_inclusive(declaration.span())
            }) && matches!(resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
                .map(Expression::get_inner_expression),
                Some(Expression::CallExpression(call))
                    if call.callee.get_inner_expression().as_member_expression()
                        .is_some_and(|member| member.static_property_name().as_deref() == Some("map")))
        }) {
            return true;
        }
        return updater_receiver_is_external(
            identifier,
            updater_function,
            executed_function_ids,
            call_node_ids_by_function,
            ctx,
        );
    }
    if updater_member_receiver_has_unproven_local_property(receiver, executed_function_ids, ctx) {
        return true;
    }
    let Some(root_identifier) = updater_member_root_identifier(receiver) else {
        return false;
    };
    if updater_receiver_resolves_to_updater_parameter(
        root_identifier,
        updater_function,
        ctx,
        &mut FxHashSet::default(),
    ) {
        return true;
    }
    let root_symbol_id = ctx
        .scoping()
        .get_reference(root_identifier.reference_id())
        .symbol_id();
    if root_symbol_id.is_some_and(|symbol_id| {
        let declaration = ctx.symbol_declaration(symbol_id);
        executed_function_ids.iter().any(|function_id| {
            ctx.nodes()
                .get_node(*function_id)
                .span()
                .contains_inclusive(declaration.span())
        }) && matches!(
            resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
                .map(Expression::get_inner_expression),
            Some(Expression::ArrayExpression(_))
        )
    }) {
        return true;
    }
    updater_receiver_is_external(
        root_identifier,
        updater_function,
        executed_function_ids,
        call_node_ids_by_function,
        ctx,
    )
}

fn updater_member_receiver_has_unproven_local_property(
    receiver: &Expression<'_>,
    executed_function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = receiver.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(property_name) = member.static_property_name() else {
        return false;
    };
    let Expression::Identifier(root_identifier) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(root_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    if !executed_function_ids.iter().any(|function_id| {
        ctx.nodes()
            .get_node(*function_id)
            .span()
            .contains_inclusive(declaration.span())
    }) {
        return false;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::ObjectExpression(object)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let mut has_spread = false;
    for property in object.properties.iter().rev() {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => {
                has_spread = true;
                break;
            }
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().as_deref() == Some(property_name.as_ref()) =>
            {
                return false;
            }
            _ => {}
        }
    }
    has_spread
}

fn updater_member_root_identifier<'a>(
    expression: &'a Expression<'a>,
) -> Option<&'a oxc_ast::ast::IdentifierReference<'a>> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier),
        expression => updater_member_root_identifier(expression.as_member_expression()?.object()),
    }
}
