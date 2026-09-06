use std::path::{Path, PathBuf};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, CallExpression, Expression, FunctionType, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan, SourceType, VALID_EXTENSIONS};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::{ExportExportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const MESSAGE: &str = "This resets a loading/busy flag only on the success path: if the awaited call rejects the reset never runs and the flag stays stuck truthy (a spinner that never stops, a button disabled forever). Move the reset into a `finally` block, or mirror it on every catch, so it clears on rejection too.";
const CROSS_FILE_RESOLUTION_BUDGET_PER_FILE: usize = 3;

#[derive(Debug, Default, Clone)]
pub struct NoLoadingFlagResetOutsideFinally;

declare_oxc_lint!(
    /// Require async loading-state resets to cover rejection paths.
    NoLoadingFlagResetOutsideFinally,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Loading flag reset outside finally.",
);

impl Rule for NoLoadingFlagResetOutsideFinally {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !loading_reset_test_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let async_function_ids = ctx
            .nodes()
            .iter()
            .filter(|node| loading_reset_is_async_function(node))
            .map(AstNode::id)
            .collect::<Vec<_>>();
        let async_function_id_set = async_function_ids.iter().copied().collect::<FxHashSet<_>>();
        let mut evidence_by_function =
            FxHashMap::<NodeId, LoadingFunctionEvidence<'_, 'a>>::default();
        let mut node_ids_by_function = FxHashMap::<NodeId, Vec<NodeId>>::default();
        let mut assignment_node_ids = Vec::new();
        let mut method_definition_node_ids = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::AssignmentExpression(_) => assignment_node_ids.push(node.id()),
                AstKind::MethodDefinition(_) => method_definition_node_ids.push(node.id()),
                _ => {}
            }
            let Some(function_id) = loading_reset_enclosing_function_id(node, ctx) else {
                continue;
            };
            node_ids_by_function
                .entry(function_id)
                .or_default()
                .push(node.id());
            if !async_function_id_set.contains(&function_id) {
                continue;
            }
            let evidence = evidence_by_function.entry(function_id).or_default();
            match node.kind() {
                AstKind::AwaitExpression(_) => evidence.awaits.push(node),
                AstKind::CallExpression(call) => {
                    if let Some((key, value)) = loading_reset_setter_value(call, ctx) {
                        evidence
                            .setter_calls
                            .push(LoadingSetterCall { node, key, value });
                    }
                }
                _ => {}
            }
        }
        for (function_id, evidence) in &mut evidence_by_function {
            let function_node = ctx.nodes().get_node(*function_id);
            let Some(node_ids) = node_ids_by_function.get(function_id) else {
                continue;
            };
            for node_id in node_ids {
                let node = ctx.nodes().get_node(*node_id);
                let AstKind::CallExpression(call) = node.kind() else {
                    continue;
                };
                if loading_reset_setter_value(call, ctx).is_some()
                    || loading_reset_context(node, function_node, ctx) == LoadingResetContext::Plain
                {
                    continue;
                }
                for key in loading_reset_sync_helper_reset_keys(call, ctx, &node_ids_by_function) {
                    evidence.setter_calls.push(LoadingSetterCall {
                        node,
                        key,
                        value: false,
                    });
                }
            }
        }
        let mut cross_file_analysis = LoadingResetCrossFileAnalysis {
            node_ids_by_function,
            assignment_node_ids,
            method_definition_node_ids,
            ..LoadingResetCrossFileAnalysis::default()
        };
        for function_id in async_function_ids {
            let Some(evidence) = evidence_by_function.remove(&function_id) else {
                continue;
            };
            loading_reset_analyze_function(
                ctx.nodes().get_node(function_id),
                evidence.awaits,
                evidence.setter_calls,
                ctx,
                &mut cross_file_analysis,
            );
        }
    }
}

fn loading_reset_is_async_function(node: &AstNode<'_>) -> bool {
    matches!(
        node.kind(),
        AstKind::Function(function)
            if function.r#async
                && matches!(function.r#type, FunctionType::FunctionDeclaration | FunctionType::FunctionExpression)
    ) || matches!(node.kind(), AstKind::ArrowFunctionExpression(function) if function.r#async)
}

#[derive(Default)]
struct LoadingResetCrossFileAnalysis {
    budgeted_specifiers: FxHashSet<String>,
    results: FxHashMap<(String, String), bool>,
    node_ids_by_function: FxHashMap<NodeId, Vec<NodeId>>,
    assignment_node_ids: Vec<NodeId>,
    method_definition_node_ids: Vec<NodeId>,
    class_helper_results: FxHashMap<(u32, u32, String), bool>,
}

fn loading_reset_test_file(ctx: &ContextHost<'_>) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    let basename = filename.rsplit('/').next().unwrap_or(filename.as_str());
    if [".test.", ".spec.", ".cy."]
        .iter()
        .any(|suffix| basename.contains(suffix))
    {
        return true;
    }
    let rooted = if filename.starts_with('/') {
        filename
    } else {
        format!("/{filename}")
    };
    [
        "/__tests__/",
        "/__test__/",
        "/__mocks__/",
        "/tests/",
        "/test/",
    ]
    .iter()
    .any(|segment| rooted.contains(segment))
}

struct LoadingSetterCall<'node, 'ast> {
    node: &'node AstNode<'ast>,
    key: LoadingSetterKey,
    value: bool,
}

#[derive(Default)]
struct LoadingFunctionEvidence<'node, 'ast> {
    awaits: Vec<&'node AstNode<'ast>>,
    setter_calls: Vec<LoadingSetterCall<'node, 'ast>>,
}

#[derive(Clone, PartialEq, Eq)]
enum LoadingSetterKey {
    Global(String),
    Symbol(SymbolId),
}

fn loading_reset_analyze_function<'node, 'ast>(
    function_node: &'node AstNode<'ast>,
    mut awaits: Vec<&'node AstNode<'ast>>,
    setter_calls: Vec<LoadingSetterCall<'node, 'ast>>,
    ctx: &'node LintContext<'ast>,
    cross_file_analysis: &mut LoadingResetCrossFileAnalysis,
) {
    if awaits.is_empty()
        || !setter_calls.iter().any(|call| call.value)
        || !setter_calls.iter().any(|call| !call.value)
    {
        return;
    }
    awaits.retain(|node| {
        let AstKind::AwaitExpression(await_expression) = node.kind() else {
            return false;
        };
        loading_reset_await_can_reject(&await_expression.argument, ctx, cross_file_analysis)
    });
    for reset in setter_calls.iter().filter(|call| {
        !call.value
            && loading_reset_context(call.node, function_node, ctx) != LoadingResetContext::Plain
    }) {
        let reset_context = loading_reset_context(reset.node, function_node, ctx);
        if loading_reset_exceptional_reset_is_unconditional(
            reset.node,
            function_node,
            ctx,
            cross_file_analysis,
        ) || (reset_context == LoadingResetContext::Finally
            && loading_reset_conditional_finalizer_is_lifecycle_guarded(
                reset.node,
                ctx,
                cross_file_analysis,
            ))
        {
            continue;
        }
        let protects_rejecting_await = setter_calls.iter().rev().any(|truthy_set| {
            truthy_set.value
                && truthy_set.key == reset.key
                && truthy_set.node.span().start < reset.node.span().start
                && !loading_reset_nodes_are_exclusive(truthy_set.node, reset.node, ctx)
                && awaits.iter().any(|await_node| {
                    truthy_set.node.span().start < await_node.span().start
                        && await_node.span().end < reset.node.span().start
                        && !loading_reset_nodes_are_exclusive(truthy_set.node, await_node, ctx)
                        && loading_reset_exceptional_reset_protects_await(
                            reset.node, await_node, ctx,
                        )
                })
        });
        if protects_rejecting_await {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(reset.node.span()));
            return;
        }
    }
    for reset in setter_calls.iter().filter(|call| {
        !call.value
            && loading_reset_context(call.node, function_node, ctx) == LoadingResetContext::Plain
    }) {
        for truthy_set in setter_calls.iter().rev().filter(|call| {
            call.value && call.key == reset.key && call.node.span().start < reset.node.span().start
        }) {
            if loading_reset_nodes_are_exclusive(truthy_set.node, reset.node, ctx) {
                continue;
            }
            let await_node = awaits.iter().find(|await_node| {
                truthy_set.node.span().start < await_node.span().start
                    && await_node.span().end < reset.node.span().start
                    && !loading_reset_nodes_are_exclusive(truthy_set.node, await_node, ctx)
                    && !loading_reset_nodes_are_exclusive(await_node, reset.node, ctx)
                    && !loading_reset_await_is_exceptionally_protected(
                        await_node,
                        reset,
                        &setter_calls,
                        function_node,
                        ctx,
                        cross_file_analysis,
                    )
            });
            if await_node.is_some() {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(reset.node.span()));
                return;
            }
            break;
        }
    }
}

fn loading_reset_setter_value(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(LoadingSetterKey, bool)> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id();
    let (key, setter_name) = if let Some(symbol_id) = symbol_id {
        let (canonical_symbol_id, setter_name) =
            loading_reset_hook_setter(symbol_id, ctx, &mut Vec::new())?;
        (LoadingSetterKey::Symbol(canonical_symbol_id), setter_name)
    } else {
        (
            LoadingSetterKey::Global(identifier.name.to_string()),
            identifier.name.as_str(),
        )
    };
    if !loading_reset_name(setter_name) {
        return None;
    }
    let argument = call.arguments.first().and_then(Argument::as_expression)?;
    let value = match argument.get_inner_expression() {
        Expression::BooleanLiteral(literal) => literal.value,
        Expression::ArrowFunctionExpression(function) => {
            let returned = function.get_expression()?;
            let Expression::BooleanLiteral(literal) = returned.get_inner_expression() else {
                return None;
            };
            literal.value
        }
        _ => return None,
    };
    Some((key, value))
}

fn loading_reset_hook_setter<'a>(
    setter_symbol_id: SymbolId,
    ctx: &'a LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<(SymbolId, &'a str)> {
    if visited_symbol_ids.contains(&setter_symbol_id) {
        return None;
    }
    visited_symbol_ids.push(setter_symbol_id);
    let declaration = ctx.symbol_declaration(setter_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if let BindingPattern::BindingIdentifier(binding) = &declarator.id
        && binding.symbol_id() == setter_symbol_id
        && matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
        && let Some(Expression::Identifier(alias_target)) = declarator.init.as_ref()
        && let Some(alias_target_symbol_id) = ctx
            .scoping()
            .get_reference(alias_target.reference_id())
            .symbol_id()
    {
        return loading_reset_hook_setter(alias_target_symbol_id, ctx, visited_symbol_ids);
    }
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter) =
        pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    let Expression::CallExpression(hook_call) = declarator.init.as_ref()? else {
        return None;
    };
    (setter.symbol_id() == setter_symbol_id
        && is_react_hook_call(hook_call, &["useState", "useReducer"], ctx))
    .then_some((setter_symbol_id, setter.name.as_str()))
}

fn loading_reset_name(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    [
        "loading",
        "busy",
        "submitting",
        "saving",
        "pending",
        "fetching",
        "processing",
        "uploading",
        "spinner",
        "disabl",
        "refreshing",
        "updating",
        "inflight",
        "working",
        "posting",
        "sending",
        "deleting",
    ]
    .iter()
    .any(|fragment| lowercase.contains(fragment))
}

fn loading_reset_await_can_reject<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    cross_file_analysis: &mut LoadingResetCrossFileAnalysis,
) -> bool {
    let expression = expression.get_inner_expression();
    if loading_reset_definitely_fulfilled_value(expression, ctx) {
        return false;
    }
    let Expression::CallExpression(call) = expression else {
        return true;
    };
    if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
        let method = static_member_expression_property_name(member);
        if method == Some("allSettled")
            && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Promise" && ctx.is_reference_to_global_variable(identifier))
        {
            return !call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| loading_reset_all_settled_argument_is_safe(argument, ctx));
        }
        if method == Some("all")
            && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Promise" && ctx.is_reference_to_global_variable(identifier))
        {
            return !call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|argument| {
                    loading_reset_promise_all_argument_is_safe(
                        argument,
                        call,
                        ctx,
                        cross_file_analysis,
                    )
                });
        }
        if method == Some("catch") {
            let Some(handler) = call.arguments.first().and_then(Argument::as_expression) else {
                return true;
            };
            let object = member.object().get_inner_expression();
            let is_promise_chain = matches!(object, Expression::CallExpression(_))
                || matches!(object, Expression::NewExpression(expression)
                    if matches!(expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                        if identifier.name == "Promise" && ctx.is_reference_to_global_variable(identifier)));
            if is_promise_chain
                && loading_reset_catch_handler_never_rejects(handler, ctx, cross_file_analysis)
            {
                return false;
            }
        }
        if method == Some("unwrap") {
            return true;
        }
        if matches!(
            member.object().get_inner_expression(),
            Expression::ThisExpression(_)
        ) && loading_reset_class_helper_never_rejects(call, ctx, cross_file_analysis)
        {
            return false;
        }
    }
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return true;
    };
    if loading_reset_local_helper_never_rejects(identifier, ctx, cross_file_analysis) {
        return false;
    }
    !(identifier.name.to_ascii_lowercase().ends_with("dispatch")
        && call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|argument| {
                matches!(
                    argument.get_inner_expression(),
                    Expression::CallExpression(_)
                )
            }))
        && !loading_reset_imported_helper_never_rejects(identifier, ctx, cross_file_analysis)
}

fn loading_reset_local_helper_never_rejects(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(function_id) =
        loading_reset_local_function_id(symbol_id, ctx, &mut FxHashSet::default())
    else {
        return false;
    };
    loading_reset_function_never_rejects(function_id, ctx, cross_file_analysis)
}

fn loading_reset_function_never_rejects(
    function_id: NodeId,
    ctx: &LintContext<'_>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if !loading_reset_is_async_function(function_node) {
        return false;
    }
    cross_file_analysis
        .node_ids_by_function
        .get(&function_id)
        .into_iter()
        .flatten()
        .all(|node_id| {
            let node = ctx.nodes().get_node(*node_id);
            match node.kind() {
                AstKind::AwaitExpression(_)
                | AstKind::ThrowStatement(_)
                | AstKind::NewExpression(_) => loading_reset_inside_non_rethrowing_try(
                    node,
                    function_id,
                    ctx,
                    cross_file_analysis,
                ),
                AstKind::CallExpression(call) => {
                    loading_reset_inside_non_rethrowing_try(
                        node,
                        function_id,
                        ctx,
                        cross_file_analysis,
                    ) || loading_reset_is_proven_non_throwing_call(call, ctx)
                }
                AstKind::ReturnStatement(statement) => statement
                    .argument
                    .as_ref()
                    .is_none_or(|argument| loading_reset_definitely_fulfilled_value(argument, ctx)),
                _ => true,
            }
        })
}

fn loading_reset_class_helper_never_rejects(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
    cross_file_analysis: &mut LoadingResetCrossFileAnalysis,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = static_member_expression_property_name(member) else {
        return false;
    };
    let Some(class_node) = ctx
        .nodes()
        .ancestors(call.node_id.get())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::Class(_)))
    else {
        return false;
    };
    let cache_key = (
        class_node.span().start,
        class_node.span().end,
        method_name.to_string(),
    );
    if let Some(result) = cross_file_analysis.class_helper_results.get(&cache_key) {
        return *result;
    }
    let is_mutated = cross_file_analysis
        .assignment_node_ids
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .any(|node| {
            if !class_node.span().contains_inclusive(node.span()) {
                return false;
            }
            let AstKind::AssignmentExpression(assignment) = node.kind() else {
                return false;
            };
            assignment
                .left
                .as_member_expression()
                .is_some_and(|target| {
                    static_member_expression_property_name(target) == Some(method_name)
                        && matches!(
                            target.object().get_inner_expression(),
                            Expression::ThisExpression(_)
                        )
                })
        });
    let function_id = if is_mutated {
        None
    } else {
        cross_file_analysis
            .method_definition_node_ids
            .iter()
            .map(|node_id| ctx.nodes().get_node(*node_id))
            .find_map(|node| {
                if !class_node.span().contains_inclusive(node.span()) {
                    return None;
                }
                let AstKind::MethodDefinition(method) = node.kind() else {
                    return None;
                };
                (!method.computed
                    && method.key.static_name().as_deref() == Some(method_name)
                    && method.value.r#async)
                    .then_some(method.value.node_id.get())
            })
    };
    let result = function_id.is_some_and(|function_id| {
        loading_reset_function_never_rejects(function_id, ctx, cross_file_analysis)
    });
    cross_file_analysis
        .class_helper_results
        .insert(cache_key, result);
    result
}

fn loading_reset_local_function_id(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) => Some(declaration.id()),
        AstKind::VariableDeclarator(declarator) => {
            if !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            {
                return None;
            }
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(alias) => {
                    let alias_symbol_id = ctx
                        .scoping()
                        .get_reference(alias.reference_id())
                        .symbol_id()?;
                    loading_reset_local_function_id(alias_symbol_id, ctx, visited_symbol_ids)
                }
                Expression::CallExpression(call)
                    if is_react_hook_call(call, &["useCallback"], ctx) =>
                {
                    match call
                        .arguments
                        .first()?
                        .as_expression()?
                        .get_inner_expression()
                    {
                        Expression::ArrowFunctionExpression(function) => {
                            Some(function.node_id.get())
                        }
                        Expression::FunctionExpression(function) => Some(function.node_id.get()),
                        _ => None,
                    }
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn loading_reset_sync_helper_reset_keys(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
    node_ids_by_function: &FxHashMap<NodeId, Vec<NodeId>>,
) -> Vec<LoadingSetterKey> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return Vec::new();
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return Vec::new();
    };
    let Some(function_id) =
        loading_reset_local_function_id(symbol_id, ctx, &mut FxHashSet::default())
    else {
        return Vec::new();
    };
    let function_node = ctx.nodes().get_node(function_id);
    if loading_reset_is_async_function(function_node) {
        return Vec::new();
    }
    node_ids_by_function
        .get(&function_id)
        .into_iter()
        .flatten()
        .filter_map(|node_id| {
            let node = ctx.nodes().get_node(*node_id);
            let AstKind::CallExpression(setter_call) = node.kind() else {
                return None;
            };
            let (key, value) = loading_reset_setter_value(setter_call, ctx)?;
            (!value && loading_reset_node_is_unconditional_in_function(node, function_id, ctx))
                .then_some(key)
        })
        .collect()
}

fn loading_reset_node_is_unconditional_in_function(
    node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::SwitchCase(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
        ) {
            return false;
        }
    }
    false
}

fn loading_reset_inside_non_rethrowing_try(
    node: &AstNode<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    let mut child = node;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_id {
            break;
        }
        if let AstKind::TryStatement(statement) = ancestor.kind()
            && statement.block.span().contains_inclusive(child.span())
            && let Some(handler) = &statement.handler
            && !cross_file_analysis
                .node_ids_by_function
                .get(&function_id)
                .into_iter()
                .flatten()
                .map(|node_id| ctx.nodes().get_node(*node_id))
                .any(|candidate| {
                    handler.span().contains_inclusive(candidate.span())
                        && matches!(candidate.kind(), AstKind::ThrowStatement(_))
                })
        {
            return true;
        }
        child = ancestor;
    }
    false
}

fn loading_reset_all_settled_argument_is_safe<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| match element {
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => true,
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(_) => false,
            element => element
                .as_expression()
                .is_some_and(loading_reset_all_settled_element_evaluation_is_safe),
        }),
        Expression::Identifier(identifier) => {
            resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
                loading_reset_all_settled_argument_is_safe(initializer, ctx)
            })
        }
        _ => false,
    }
}

fn loading_reset_promise_all_argument_is_safe<'a>(
    expression: &'a Expression<'a>,
    promise_all_call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| match element {
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => true,
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(_) => false,
            element => element.as_expression().is_some_and(|expression| {
                loading_reset_definitely_non_thenable_value(expression, ctx)
            }),
        }),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) else {
                return false;
            };
            let Expression::ArrayExpression(array) = initializer.get_inner_expression() else {
                return false;
            };
            array.elements.iter().all(|element| match element {
                oxc_ast::ast::ArrayExpressionElement::Elision(_) => true,
                oxc_ast::ast::ArrayExpressionElement::SpreadElement(_) => false,
                element => element.as_expression().is_some_and(|expression| {
                    loading_reset_definitely_non_thenable_value(expression, ctx)
                }),
            }) && loading_reset_array_mutations_are_safe(
                symbol_id,
                promise_all_call,
                ctx,
                cross_file_analysis,
            )
        }
        _ => false,
    }
}

fn loading_reset_array_mutations_are_safe(
    root_symbol_id: SymbolId,
    promise_all_call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    let mut alias_symbol_ids = FxHashSet::from_iter([root_symbol_id]);
    let mut pending_symbol_ids = vec![root_symbol_id];
    while let Some(symbol_id) = pending_symbol_ids.pop() {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(reference_node.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != reference_node.span())
                || !matches!(ctx.nodes().parent_kind(parent.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            {
                continue;
            }
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            if alias_symbol_ids.insert(binding.symbol_id()) {
                pending_symbol_ids.push(binding.symbol_id());
            }
        }
    }
    let promise_function_id = loading_reset_enclosing_function_id(
        ctx.nodes().get_node(promise_all_call.node_id.get()),
        ctx,
    );
    let Some(promise_function_id) = promise_function_id else {
        return false;
    };
    cross_file_analysis
        .node_ids_by_function
        .get(&promise_function_id)
        .into_iter()
        .flatten()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .filter(|node| node.span().start < promise_all_call.span.start)
        .all(|node| match node.kind() {
            AstKind::AssignmentExpression(assignment) => {
                let Some(member) = assignment.left.as_member_expression() else {
                    return true;
                };
                if !loading_reset_member_object_has_symbol(member, &alias_symbol_ids, ctx) {
                    return true;
                }
                assignment.operator.as_str() == "="
                    && member.static_property_name().is_some_and(|property_name| {
                        !property_name.is_empty()
                            && property_name
                                .chars()
                                .all(|character| character.is_ascii_digit())
                    })
                    && loading_reset_definitely_non_thenable_value(&assignment.right, ctx)
            }
            AstKind::CallExpression(call) => {
                let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                    return true;
                };
                if !loading_reset_member_object_has_symbol(member, &alias_symbol_ids, ctx) {
                    return true;
                }
                static_member_expression_property_name(member) == Some("push")
                    && call.arguments.iter().all(|argument| {
                        argument.as_expression().is_some_and(|expression| {
                            loading_reset_definitely_non_thenable_value(expression, ctx)
                        })
                    })
            }
            _ => true,
        })
}

fn loading_reset_member_object_has_symbol(
    member: &oxc_ast::ast::MemberExpression<'_>,
    symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
            .is_some_and(|symbol_id| symbol_ids.contains(&symbol_id)))
}

fn loading_reset_definitely_non_thenable_value<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::FunctionExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::ObjectExpression(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| match element {
            oxc_ast::ast::ArrayExpressionElement::Elision(_) => true,
            oxc_ast::ast::ArrayExpressionElement::SpreadElement(_) => false,
            element => element.as_expression().is_some_and(|expression| {
                loading_reset_definitely_non_thenable_value(expression, ctx)
            }),
        }),
        Expression::Identifier(identifier) => {
            resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
                loading_reset_definitely_non_thenable_value(initializer, ctx)
            })
        }
        _ => false,
    }
}

fn loading_reset_all_settled_element_evaluation_is_safe(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::Identifier(_)
            | Expression::NullLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::FunctionExpression(_)
            | Expression::ArrowFunctionExpression(_)
    )
}

fn loading_reset_catch_handler_never_rejects(
    handler: &Expression<'_>,
    ctx: &LintContext<'_>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    let handler = handler.get_inner_expression();
    let handler_node_id = match handler {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    };
    match handler {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(returned) = function.get_expression() {
                return loading_reset_definitely_fulfilled_value(returned, ctx);
            }
        }
        Expression::FunctionExpression(_) => {}
        _ => return false,
    }
    let Some(handler_node_id) = handler_node_id else {
        return false;
    };
    cross_file_analysis
        .node_ids_by_function
        .get(&handler_node_id)
        .into_iter()
        .flatten()
        .all(|node_id| {
            let node = ctx.nodes().get_node(*node_id);
            match node.kind() {
                AstKind::AwaitExpression(_)
                | AstKind::ThrowStatement(_)
                | AstKind::NewExpression(_) => false,
                AstKind::CallExpression(call) => {
                    loading_reset_catch_call_is_proven_non_throwing(call, ctx)
                }
                AstKind::ReturnStatement(statement) => {
                    statement.argument.as_ref().is_none_or(|expression| {
                        loading_reset_definitely_fulfilled_value(expression, ctx)
                    })
                }
                _ => true,
            }
        })
}

fn loading_reset_catch_call_is_proven_non_throwing(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = static_member_expression_property_name(member) else {
        return false;
    };
    if matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "console" && ctx.is_reference_to_global_variable(identifier))
    {
        return matches!(
            method_name,
            "debug" | "error" | "info" | "log" | "trace" | "warn"
        );
    }
    method_name == "resolve"
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Promise" && ctx.is_reference_to_global_variable(identifier))
        && call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_none_or(|argument| loading_reset_definitely_fulfilled_value(argument, ctx))
}

fn loading_reset_definitely_fulfilled_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrayExpression(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            static_member_expression_property_name(member) == Some("resolve")
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "Promise" && ctx.is_reference_to_global_variable(identifier))
                && call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_none_or(|argument| loading_reset_definitely_fulfilled_value(argument, ctx))
        }
        _ => false,
    }
}

fn loading_reset_imported_helper_never_rejects(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    cross_file_analysis: &mut LoadingResetCrossFileAnalysis,
) -> bool {
    let Some(request) = loading_reset_import_request(identifier, ctx) else {
        return false;
    };
    let cache_export_name = request.returned_property.as_ref().map_or_else(
        || request.exported_name.clone(),
        |property_name| format!("{}#{property_name}", request.exported_name),
    );
    let cache_key = (request.module_source.clone(), cache_export_name);
    if let Some(result) = cross_file_analysis.results.get(&cache_key) {
        return *result;
    }
    if !cross_file_analysis
        .budgeted_specifiers
        .contains(&request.module_source)
    {
        if cross_file_analysis.budgeted_specifiers.len() >= CROSS_FILE_RESOLUTION_BUDGET_PER_FILE {
            return false;
        }
        cross_file_analysis
            .budgeted_specifiers
            .insert(request.module_source.clone());
    }
    let Some(file_path) =
        loading_reset_resolve_first_party_module_path(ctx.file_path(), &request.module_source)
    else {
        cross_file_analysis.results.insert(cache_key, false);
        return false;
    };
    let result = loading_reset_foreign_export_never_rejects(
        &file_path,
        &request.exported_name,
        request.returned_property.as_deref(),
    );
    cross_file_analysis.results.insert(cache_key, result);
    result
}

struct LoadingResetImportRequest {
    module_source: String,
    exported_name: String,
    returned_property: Option<String>,
}

fn loading_reset_import_request(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<LoadingResetImportRequest> {
    let mut symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return None;
    }
    let mut visited_symbol_ids = FxHashSet::default();
    let (import_entry, returned_property) = loop {
        if !visited_symbol_ids.insert(symbol_id) {
            return None;
        }
        if let Some(import_entry) = ctx.module_record().import_entries.iter().find(|entry| {
            !entry.is_type
                && ctx
                    .scoping()
                    .get_root_binding(entry.local_name.name().into())
                    == Some(symbol_id)
        }) {
            break (import_entry, None);
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return None;
        };
        if !matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
        {
            return None;
        }
        if let BindingPattern::ObjectPattern(pattern) = &declarator.id {
            let property = pattern.properties.iter().find(|property| {
                !property.computed
                    && matches!(&property.value, BindingPattern::BindingIdentifier(binding)
                        if binding.symbol_id() == symbol_id)
            })?;
            let property_name = property.key.static_name()?.to_string();
            let Expression::CallExpression(hook_call) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            let Expression::Identifier(hook_identifier) = hook_call.callee.get_inner_expression()
            else {
                return None;
            };
            let hook_name = hook_identifier.name.as_str();
            if !hook_name.starts_with("use")
                || !hook_name.as_bytes().get(3).is_some_and(|character| {
                    character.is_ascii_uppercase() || character.is_ascii_digit()
                })
            {
                return None;
            }
            let hook_symbol_id = ctx
                .scoping()
                .get_reference(hook_identifier.reference_id())
                .symbol_id()?;
            let hook_import = ctx.module_record().import_entries.iter().find(|entry| {
                !entry.is_type
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(hook_symbol_id)
            })?;
            break (hook_import, Some(property_name));
        }
        if declarator
            .id
            .get_binding_identifier()
            .is_none_or(|binding| binding.symbol_id() != symbol_id)
        {
            return None;
        }
        let Some(Expression::Identifier(alias_target)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return None;
        };
        let Some(alias_symbol_id) = ctx
            .scoping()
            .get_reference(alias_target.reference_id())
            .symbol_id()
        else {
            return None;
        };
        symbol_id = alias_symbol_id;
    };
    let exported_name = match &import_entry.import_name {
        ImportImportName::Name(name) => name.name().to_string(),
        ImportImportName::Default(_) => "default".to_string(),
        ImportImportName::NamespaceObject => return None,
    };
    Some(LoadingResetImportRequest {
        module_source: import_entry.module_request.name().to_string(),
        exported_name,
        returned_property,
    })
}

fn loading_reset_resolve_first_party_module_path(
    from_file_path: &Path,
    module_source: &str,
) -> Option<PathBuf> {
    if Path::new(module_source).is_absolute() {
        return None;
    }
    let resolver = Resolver::new(ResolveOptions {
        extensions: VALID_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect(),
        main_fields: vec!["module".into(), "main".into()],
        condition_names: vec!["module".into(), "import".into()],
        extension_alias: vec![
            (".js".into(), vec![".js".into(), ".ts".into()]),
            (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
            (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
        ],
        tsconfig: Some(TsconfigDiscovery::Auto),
        ..ResolveOptions::default()
    });
    let resolution = resolver.resolve_file(from_file_path, module_source).ok()?;
    let resolved_path = resolution.path().to_path_buf();
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn loading_reset_foreign_export_never_rejects(
    file_path: &Path,
    exported_name: &str,
    returned_property: Option<&str>,
) -> bool {
    let Ok(source_text) = std::fs::read_to_string(file_path) else {
        return false;
    };
    let Ok(source_type) = SourceType::from_path(file_path) else {
        return false;
    };
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source_text, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return false;
    }
    let semantic_return =
        SemanticBuilder::new_linter().build(allocator.alloc(parser_return.program));
    if !semantic_return.diagnostics.is_empty() {
        return false;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    let Some(mut function_id) =
        loading_reset_foreign_exported_function_id(exported_name, &semantic, &module_record)
    else {
        return false;
    };
    if let Some(property_name) = returned_property {
        let Some(returned_function_id) = loading_reset_foreign_hook_returned_function_id(
            function_id,
            property_name,
            &semantic,
            &module_record,
        ) else {
            return false;
        };
        function_id = returned_function_id;
    }
    let function_node = semantic.nodes().get_node(function_id);
    if !matches!(
        function_node.kind(),
        AstKind::Function(function) if function.r#async
    ) && !matches!(
        function_node.kind(),
        AstKind::ArrowFunctionExpression(function) if function.r#async
    ) {
        return false;
    }
    semantic.nodes().iter().all(|node| {
        if !function_node.span().contains_inclusive(node.span())
            || loading_reset_foreign_enclosing_function_id(node, &semantic) != Some(function_id)
        {
            return true;
        }
        match node.kind() {
            AstKind::AwaitExpression(_) | AstKind::ThrowStatement(_) => {
                loading_reset_foreign_inside_non_rethrowing_try(node, function_id, &semantic)
            }
            AstKind::CallExpression(call) => {
                loading_reset_foreign_inside_non_rethrowing_try(node, function_id, &semantic)
                    || loading_reset_foreign_call_is_non_throwing(call, &semantic)
            }
            AstKind::NewExpression(_) => {
                loading_reset_foreign_inside_non_rethrowing_try(node, function_id, &semantic)
            }
            _ => true,
        }
    })
}

fn loading_reset_foreign_exported_function_id(
    exported_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<NodeId> {
    let local_name = module_record
        .local_export_entries
        .iter()
        .find_map(|entry| {
            let matches_export = match &entry.export_name {
                ExportExportName::Name(name) => name.name() == exported_name,
                ExportExportName::Default(_) => exported_name == "default",
                ExportExportName::Null => false,
            };
            matches_export.then(|| entry.local_name.name()).flatten()
        })?;
    let symbol_id = semantic.scoping().get_root_binding(local_name.into())?;
    if semantic
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return None;
    }
    let declaration = semantic.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => Some(declaration.id()),
        AstKind::VariableDeclarator(declarator) => {
            if !matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
            {
                return None;
            }
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            loading_reset_foreign_wrapped_function_id(initializer, semantic, module_record)
        }
        _ => None,
    }
}

fn loading_reset_foreign_wrapped_function_id(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<NodeId> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::CallExpression(call)
            if loading_reset_foreign_is_react_api_call(
                call,
                &["useCallback"],
                semantic,
                module_record,
            ) =>
        {
            let argument = call.arguments.first()?.as_expression()?;
            loading_reset_foreign_wrapped_function_id(argument, semantic, module_record)
        }
        _ => None,
    }
}

fn loading_reset_foreign_is_react_api_call(
    call: &CallExpression<'_>,
    names: &[&str],
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            module_record.import_entries.iter().any(|entry| {
                entry.module_request.name() == "react"
                    && semantic
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
                    && matches!(&entry.import_name, ImportImportName::Name(name)
                        if names.contains(&name.name()))
            })
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            let Some(property_name) = static_member_expression_property_name(member) else {
                return false;
            };
            if !names.contains(&property_name) {
                return false;
            }
            let Expression::Identifier(object) = member.object().get_inner_expression() else {
                return false;
            };
            let symbol_id = semantic
                .scoping()
                .get_reference(object.reference_id())
                .symbol_id();
            if symbol_id.is_none() {
                return object.name == "React";
            }
            module_record.import_entries.iter().any(|entry| {
                entry.module_request.name() == "react"
                    && semantic
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == symbol_id
                    && matches!(
                        &entry.import_name,
                        ImportImportName::Default(_) | ImportImportName::NamespaceObject
                    )
            })
        }),
    }
}

fn loading_reset_foreign_hook_returned_function_id(
    hook_function_id: NodeId,
    property_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<NodeId> {
    let returned_object = loading_reset_foreign_returned_object_expression(
        hook_function_id,
        semantic,
        module_record,
    )?;
    returned_object.properties.iter().find_map(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property.computed || property.key.static_name().as_deref() != Some(property_name) {
            return None;
        }
        loading_reset_foreign_wrapped_function_id(&property.value, semantic, module_record).or_else(
            || {
                let Expression::Identifier(identifier) = property.value.get_inner_expression()
                else {
                    return None;
                };
                let symbol_id = semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?;
                if semantic
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
                {
                    return None;
                }
                let declaration = semantic.symbol_declaration(symbol_id);
                let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                    return None;
                };
                if !matches!(semantic.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()) {
                    return None;
                }
                let initializer = declarator.init.as_ref()?;
                loading_reset_foreign_wrapped_function_id(initializer, semantic, module_record)
            },
        )
    })
}

fn loading_reset_foreign_returned_object_expression<'a>(
    function_id: NodeId,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    let function_node = semantic.nodes().get_node(function_id);
    let direct_expression = match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) => function.get_expression(),
        _ => None,
    };
    if let Some(expression) = direct_expression {
        return loading_reset_foreign_unwrap_returned_object(expression, semantic, module_record);
    }
    semantic.nodes().iter().find_map(|node| {
        if loading_reset_foreign_enclosing_function_id(node, semantic) != Some(function_id) {
            return None;
        }
        let AstKind::ReturnStatement(statement) = node.kind() else {
            return None;
        };
        loading_reset_foreign_unwrap_returned_object(
            statement.argument.as_ref()?,
            semantic,
            module_record,
        )
    })
}

fn loading_reset_foreign_unwrap_returned_object<'a>(
    expression: &'a Expression<'a>,
    semantic: &Semantic<'a>,
    module_record: &ModuleRecord,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => Some(object),
        Expression::CallExpression(call)
            if loading_reset_foreign_is_react_api_call(
                call,
                &["useMemo"],
                semantic,
                module_record,
            ) =>
        {
            let factory = call.arguments.first()?.as_expression()?;
            let function_id =
                loading_reset_foreign_wrapped_function_id(factory, semantic, module_record)?;
            loading_reset_foreign_returned_object_expression(function_id, semantic, module_record)
        }
        _ => None,
    }
}

fn loading_reset_foreign_enclosing_function_id(
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

fn loading_reset_foreign_inside_non_rethrowing_try(
    node: &AstNode<'_>,
    function_id: NodeId,
    semantic: &Semantic<'_>,
) -> bool {
    let mut child = node;
    for ancestor in semantic.nodes().ancestors(node.id()) {
        if ancestor.id() == function_id {
            break;
        }
        if let AstKind::TryStatement(statement) = ancestor.kind()
            && statement.block.span().contains_inclusive(child.span())
            && let Some(handler) = &statement.handler
            && !semantic.nodes().iter().any(|candidate| {
                handler.span().contains_inclusive(candidate.span())
                    && loading_reset_foreign_enclosing_function_id(candidate, semantic)
                        == Some(function_id)
                    && matches!(candidate.kind(), AstKind::ThrowStatement(_))
            })
        {
            return true;
        }
        child = ancestor;
    }
    false
}

fn loading_reset_foreign_call_is_non_throwing(
    call: &CallExpression<'_>,
    semantic: &Semantic<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = static_member_expression_property_name(member) else {
        return false;
    };
    if !matches!(method_name, "log" | "warn" | "error" | "info" | "debug") {
        return false;
    }
    matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "console"
            && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LoadingResetContext {
    Catch,
    Finally,
    Plain,
}

fn loading_reset_exceptional_reset_protects_await(
    reset_node: &AstNode<'_>,
    await_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(reset_node.id()) {
        match ancestor.kind() {
            AstKind::CatchClause(_) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                return matches!(parent.kind(), AstKind::TryStatement(statement)
                    if statement.block.span().contains_inclusive(await_node.span()));
            }
            AstKind::TryStatement(statement)
                if statement.finalizer.as_ref().is_some_and(|finalizer| {
                    finalizer.span().contains_inclusive(reset_node.span())
                }) =>
            {
                return statement.block.span().contains_inclusive(await_node.span());
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
    }
    false
}

fn loading_reset_exceptional_reset_is_unconditional(
    reset_node: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    let mut protection_span = None;
    let mut is_finalizer = false;
    let mut child = reset_node;
    for ancestor in ctx.nodes().ancestors(reset_node.id()) {
        if ancestor.id() == function_node.id() {
            break;
        }
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::SwitchCase(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
        ) {
            return false;
        }
        match ancestor.kind() {
            AstKind::CatchClause(clause) => {
                protection_span = Some(clause.body.span());
                break;
            }
            AstKind::TryStatement(statement)
                if statement
                    .finalizer
                    .as_ref()
                    .is_some_and(|finalizer| finalizer.span() == child.span()) =>
            {
                is_finalizer = true;
                protection_span = statement
                    .finalizer
                    .as_ref()
                    .map(|finalizer| finalizer.span());
                break;
            }
            _ => {}
        }
        child = ancestor;
    }
    let Some(protection_span) = protection_span else {
        return false;
    };
    !cross_file_analysis
        .node_ids_by_function
        .get(&function_node.id())
        .into_iter()
        .flatten()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .any(|candidate| {
            protection_span.contains_inclusive(candidate.span())
                && candidate.span().start < reset_node.span().start
                && match candidate.kind() {
                    AstKind::ReturnStatement(_)
                    | AstKind::ThrowStatement(_)
                    | AstKind::NewExpression(_) => true,
                    AstKind::CallExpression(call) => {
                        !is_finalizer && !loading_reset_is_proven_non_throwing_call(call, ctx)
                    }
                    _ => false,
                }
        })
}

fn loading_reset_exceptional_reset_is_structurally_unconditional(
    reset_node: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(reset_node.id()) {
        if ancestor.id() == function_node.id() {
            return false;
        }
        if matches!(ancestor.kind(), AstKind::CatchClause(_)) {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::IfStatement(_)
                | AstKind::SwitchCase(_)
                | AstKind::ConditionalExpression(_)
                | AstKind::LogicalExpression(_)
                | AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
        ) {
            return false;
        }
    }
    false
}

fn loading_reset_conditional_finalizer_is_lifecycle_guarded(
    reset_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    let guard_expression = ctx.nodes().ancestors(reset_node.id()).find_map(|ancestor| {
        let AstKind::IfStatement(statement) = ancestor.kind() else {
            return None;
        };
        (statement.alternate.is_none()
            && statement
                .consequent
                .span()
                .contains_inclusive(reset_node.span()))
        .then_some(&statement.test)
    });
    let Some(guard_expression) = guard_expression else {
        return false;
    };
    let Some(guard_member) = guard_expression
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    if static_member_expression_property_name(guard_member) != Some("current") {
        return false;
    }
    let Expression::Identifier(guard_identifier) = guard_member.object().get_inner_expression()
    else {
        return false;
    };
    let Some(guard_symbol_id) = ctx
        .scoping()
        .get_reference(guard_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(guard_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(initializer)) = declarator.init.as_ref() else {
        return false;
    };
    if !is_react_hook_call(initializer, &["useRef"], ctx)
        || !matches!(initializer.arguments.first().and_then(Argument::as_expression).map(Expression::get_inner_expression), Some(Expression::BooleanLiteral(literal)) if literal.value)
    {
        return false;
    }
    cross_file_analysis
        .assignment_node_ids
        .iter()
        .map(|node_id| ctx.nodes().get_node(*node_id))
        .any(|candidate| {
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        let Some(target) = assignment.left.as_member_expression() else {
            return false;
        };
        static_member_expression_property_name(target) == Some("current")
            && matches!(target.object().get_inner_expression(), Expression::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(guard_symbol_id))
            && matches!(assignment.right.get_inner_expression(), Expression::BooleanLiteral(literal) if !literal.value)
        })
}

fn loading_reset_is_proven_non_throwing_call(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(member) = call.callee.get_inner_expression().as_member_expression()
        && matches!(
            static_member_expression_property_name(member),
            Some("log" | "warn" | "error" | "info" | "debug")
        )
        && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "console" && ctx.is_reference_to_global_variable(identifier))
    {
        return true;
    }
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    if ctx.is_reference_to_global_variable(identifier) {
        let name = identifier.name.as_str();
        return name
            .strip_prefix("set")
            .and_then(|suffix| suffix.as_bytes().first())
            .is_some_and(u8::is_ascii_uppercase);
    }
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
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    let Some(BindingPattern::BindingIdentifier(setter)) =
        pattern.elements.get(1).and_then(Option::as_ref)
    else {
        return false;
    };
    let Some(Expression::CallExpression(hook_call)) = declarator.init.as_ref() else {
        return false;
    };
    setter.symbol_id() == symbol_id
        && is_react_hook_call(hook_call, &["useState", "useReducer"], ctx)
}

fn loading_reset_context(
    node: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> LoadingResetContext {
    let mut child = node;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_node.id() {
            break;
        }
        if matches!(ancestor.kind(), AstKind::CatchClause(_)) {
            return LoadingResetContext::Catch;
        }
        if let AstKind::TryStatement(statement) = ancestor.kind()
            && statement
                .finalizer
                .as_ref()
                .is_some_and(|finalizer| finalizer.span().contains_inclusive(child.span()))
        {
            return LoadingResetContext::Finally;
        }
        child = ancestor;
    }
    LoadingResetContext::Plain
}

fn loading_reset_await_is_exceptionally_protected<'node, 'ast>(
    await_node: &'node AstNode<'ast>,
    trailing_reset: &LoadingSetterCall<'node, 'ast>,
    calls: &[LoadingSetterCall<'node, 'ast>],
    function_node: &'node AstNode<'ast>,
    ctx: &'node LintContext<'ast>,
    cross_file_analysis: &LoadingResetCrossFileAnalysis,
) -> bool {
    for ancestor in ctx.nodes().ancestors(await_node.id()) {
        if ancestor.id() == function_node.id() {
            break;
        }
        let AstKind::TryStatement(statement) = ancestor.kind() else {
            continue;
        };
        if !statement.block.span().contains_inclusive(await_node.span()) {
            continue;
        }
        if statement.finalizer.as_ref().is_some_and(|finalizer| {
            calls.iter().any(|call| {
                !call.value
                    && call.key == trailing_reset.key
                    && finalizer.span().contains_inclusive(call.node.span())
            })
        }) {
            return true;
        }
        let Some(handler) = &statement.handler else {
            continue;
        };
        let mirrored_reset = calls.iter().any(|call| {
            !call.value
                && call.key == trailing_reset.key
                && handler.span().contains_inclusive(call.node.span())
                && loading_reset_exceptional_reset_is_structurally_unconditional(
                    call.node,
                    function_node,
                    ctx,
                )
        });
        if mirrored_reset {
            return true;
        }
        if statement.span.end >= trailing_reset.node.span().start {
            continue;
        }
        let catch_exits = cross_file_analysis
            .node_ids_by_function
            .get(&function_node.id())
            .into_iter()
            .flatten()
            .map(|node_id| ctx.nodes().get_node(*node_id))
            .any(|candidate| {
                handler.span().contains_inclusive(candidate.span())
                    && matches!(
                        candidate.kind(),
                        AstKind::ReturnStatement(_) | AstKind::ThrowStatement(_)
                    )
            });
        if !catch_exits {
            return true;
        }
    }
    false
}

fn loading_reset_nodes_are_exclusive(
    first: &AstNode<'_>,
    second: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(first.id()) {
        let (consequent_span, alternate_span) = match ancestor.kind() {
            AstKind::IfStatement(statement) => (
                statement.consequent.span(),
                statement
                    .alternate
                    .as_ref()
                    .map(|alternate| alternate.span()),
            ),
            AstKind::ConditionalExpression(expression) => (
                expression.consequent.span(),
                Some(expression.alternate.span()),
            ),
            _ => continue,
        };
        let first_in_consequent = consequent_span.contains_inclusive(first.span());
        let second_in_consequent = consequent_span.contains_inclusive(second.span());
        let first_in_alternate =
            alternate_span.is_some_and(|span| span.contains_inclusive(first.span()));
        let second_in_alternate =
            alternate_span.is_some_and(|span| span.contains_inclusive(second.span()));
        if first_in_consequent && second_in_alternate || first_in_alternate && second_in_consequent
        {
            return true;
        }
    }
    let first_case = ctx
        .nodes()
        .ancestors(first.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::SwitchCase(_)));
    let second_case = ctx
        .nodes()
        .ancestors(second.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::SwitchCase(_)));
    let (Some(first_case), Some(second_case)) = (first_case, second_case) else {
        return false;
    };
    if first_case.id() == second_case.id() {
        return false;
    }
    let first_switch = ctx.nodes().parent_node(first_case.id());
    let second_switch = ctx.nodes().parent_node(second_case.id());
    if first_switch.id() != second_switch.id() {
        return false;
    }
    let AstKind::SwitchStatement(switch_statement) = first_switch.kind() else {
        return false;
    };
    let first_index = switch_statement
        .cases
        .iter()
        .position(|candidate| candidate.span == first_case.span());
    let second_index = switch_statement
        .cases
        .iter()
        .position(|candidate| candidate.span == second_case.span());
    let (Some(first_index), Some(second_index)) = (first_index, second_index) else {
        return false;
    };
    let earlier_index = first_index.min(second_index);
    let later_index = first_index.max(second_index);
    switch_statement.cases[earlier_index..later_index]
        .iter()
        .any(|case| {
            case.consequent
                .last()
                .is_some_and(loading_reset_statement_always_exits)
        })
}

fn loading_reset_statement_always_exits(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::BreakStatement(_)
        | Statement::ContinueStatement(_)
        | Statement::ReturnStatement(_)
        | Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(block) => block
            .body
            .last()
            .is_some_and(loading_reset_statement_always_exits),
        Statement::IfStatement(statement) => {
            statement.alternate.as_ref().is_some_and(|alternate| {
                loading_reset_statement_always_exits(&statement.consequent)
                    && loading_reset_statement_always_exits(alternate)
            })
        }
        _ => false,
    }
}

fn loading_reset_enclosing_function_id(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
