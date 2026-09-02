use oxc_ast::{
    AstKind,
    ast::{Expression, FunctionType, ImportDeclarationSpecifier, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "`flushSync` forces an immediate update, which skips View Transitions and concurrent rendering.";
const DOM_MEASUREMENT_NAMES: [&str; 16] = [
    "getBoundingClientRect",
    "getClientRects",
    "getComputedStyle",
    "getAnimations",
    "scrollIntoView",
    "elementFromPoint",
    "offsetWidth",
    "offsetHeight",
    "offsetTop",
    "offsetLeft",
    "clientWidth",
    "clientHeight",
    "scrollTop",
    "scrollLeft",
    "scrollWidth",
    "scrollHeight",
];
const IMPERATIVE_DOM_MUTATION_NAMES: [&str; 9] = [
    "blur",
    "focus",
    "restoreSelection",
    "scroll",
    "scrollBy",
    "scrollIntoView",
    "scrollTo",
    "setRangeText",
    "setSelectionRange",
];
const AWARENESS_SELECTION_SIGNAL_NAMES: [&str; 2] = ["remoteOperations", "restoreSelection"];

#[derive(Debug, Default, Clone)]
pub struct NoFlushSync;

#[derive(Clone, Copy)]
struct FlushSyncFollowingStatement {
    owner_id: NodeId,
    span: Span,
    is_function_like: bool,
}

#[derive(Default)]
struct FlushSyncAnalysis {
    bare_calls_by_name: FxHashMap<String, Vec<NodeId>>,
    function_ids_calling_measurement: FxHashSet<NodeId>,
    function_ids_reading_measurement: FxHashSet<NodeId>,
    function_ids_using_awareness_signal: FxHashSet<NodeId>,
    imperative_call_spans_by_owner: FxHashMap<NodeId, Vec<Span>>,
    imperative_dom_function_names: FxHashSet<String>,
    imperative_helper_call_spans_by_owner: FxHashMap<NodeId, Vec<Span>>,
    imports_awareness_library: bool,
    imports_imperative_dom_library: bool,
    measuring_function_names: FxHashSet<String>,
}

declare_oxc_lint!(
    /// Warns when flushSync can bypass View Transitions and concurrent rendering.
    NoFlushSync,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when flushSync bypasses View Transitions.",
);

impl Rule for NoFlushSync {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = flush_sync_build_analysis(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
                continue;
            };
            if import_declaration.source.value != "react-dom" {
                continue;
            }
            for specifier in import_declaration.specifiers.iter().flatten() {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                if specifier.imported.name().as_str() != "flushSync" {
                    continue;
                }
                let local_name = specifier.local.name.as_str();
                if analysis.imports_imperative_dom_library
                    || flush_sync_has_awareness_exemption(local_name, &analysis, ctx)
                    || flush_sync_has_call_exemption(local_name, &analysis, ctx)
                {
                    continue;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(specifier.span));
            }
        }
    }
}

fn flush_sync_build_analysis(ctx: &LintContext<'_>) -> FlushSyncAnalysis {
    let mut analysis = FlushSyncAnalysis::default();
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::ImportDeclaration(import_declaration) => {
                let source = import_declaration.source.value.as_str();
                analysis.imports_imperative_dom_library |=
                    flush_sync_is_imperative_dom_library(source);
                analysis.imports_awareness_library |= flush_sync_is_awareness_library(source);
            }
            AstKind::CallExpression(call) => {
                if let Expression::Identifier(callee) = &call.callee {
                    analysis
                        .bare_calls_by_name
                        .entry(callee.name.to_string())
                        .or_default()
                        .push(node.id());
                    if flush_sync_is_measurement_helper_name(callee.name.as_str()) {
                        flush_sync_mark_enclosing_function_ids(
                            node,
                            &mut analysis.function_ids_reading_measurement,
                            ctx,
                        );
                    }
                }
                if call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                    .and_then(|member| member.static_property_name())
                    .is_some_and(|name| IMPERATIVE_DOM_MUTATION_NAMES.contains(&name.as_ref()))
                {
                    let owner_id = flush_sync_execution_owner_id(node, ctx);
                    analysis
                        .imperative_call_spans_by_owner
                        .entry(owner_id)
                        .or_default()
                        .push(node.span());
                }
            }
            AstKind::StaticMemberExpression(member)
                if DOM_MEASUREMENT_NAMES.contains(&member.property.name.as_str()) =>
            {
                flush_sync_mark_enclosing_function_ids(
                    node,
                    &mut analysis.function_ids_reading_measurement,
                    ctx,
                );
            }
            AstKind::ComputedMemberExpression(member)
                if matches!(&member.expression, Expression::Identifier(identifier)
                    if DOM_MEASUREMENT_NAMES.contains(&identifier.name.as_str())) =>
            {
                flush_sync_mark_enclosing_function_ids(
                    node,
                    &mut analysis.function_ids_reading_measurement,
                    ctx,
                );
            }
            AstKind::IdentifierReference(identifier)
                if AWARENESS_SELECTION_SIGNAL_NAMES.contains(&identifier.name.as_str()) =>
            {
                flush_sync_mark_enclosing_function_ids(
                    node,
                    &mut analysis.function_ids_using_awareness_signal,
                    ctx,
                );
            }
            AstKind::IdentifierName(identifier)
                if AWARENESS_SELECTION_SIGNAL_NAMES.contains(&identifier.name.as_str()) =>
            {
                flush_sync_mark_enclosing_function_ids(
                    node,
                    &mut analysis.function_ids_using_awareness_signal,
                    ctx,
                );
            }
            AstKind::BindingIdentifier(identifier)
                if AWARENESS_SELECTION_SIGNAL_NAMES.contains(&identifier.name.as_str()) =>
            {
                flush_sync_mark_enclosing_function_ids(
                    node,
                    &mut analysis.function_ids_using_awareness_signal,
                    ctx,
                );
            }
            _ => {}
        }
    }
    for node in ctx.nodes().iter() {
        match node.kind() {
            AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration => {
                let Some(name) = function
                    .id
                    .as_ref()
                    .map(|identifier| identifier.name.as_str())
                else {
                    continue;
                };
                if function.body.is_none() {
                    continue;
                }
                flush_sync_index_matching_function(name, node.id(), &mut analysis);
            }
            AstKind::VariableDeclarator(declarator) => {
                let Some(name) = declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.name.as_str())
                else {
                    continue;
                };
                let Some(initializer) = &declarator.init else {
                    continue;
                };
                let function_expression = if let Expression::CallExpression(call) = initializer
                    && matches!(&call.callee, Expression::Identifier(identifier)
                        if flush_sync_is_hook_name(identifier.name.as_str()))
                {
                    call.arguments
                        .first()
                        .and_then(|argument| argument.as_expression())
                } else {
                    Some(initializer)
                };
                let Some(function_id) =
                    function_expression.and_then(flush_sync_function_expression_id)
                else {
                    continue;
                };
                flush_sync_index_matching_function(name, function_id, &mut analysis);
            }
            _ => {}
        }
    }
    flush_sync_finalize_indexes(&mut analysis, ctx);
    analysis
}

fn flush_sync_index_matching_function(
    name: &str,
    function_id: NodeId,
    analysis: &mut FlushSyncAnalysis,
) {
    if analysis
        .function_ids_reading_measurement
        .contains(&function_id)
    {
        analysis.measuring_function_names.insert(name.to_string());
    }
    if analysis
        .imperative_call_spans_by_owner
        .contains_key(&function_id)
    {
        analysis
            .imperative_dom_function_names
            .insert(name.to_string());
    }
}

fn flush_sync_function_expression_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => {
            function.body.as_ref().map(|_| function.node_id.get())
        }
        _ => None,
    }
}

fn flush_sync_finalize_indexes(analysis: &mut FlushSyncAnalysis, ctx: &LintContext<'_>) {
    let measuring_call_ids = analysis
        .measuring_function_names
        .iter()
        .flat_map(|name| analysis.bare_calls_by_name.get(name).into_iter().flatten())
        .copied()
        .collect::<Vec<_>>();
    for call_id in measuring_call_ids {
        flush_sync_mark_enclosing_function_ids(
            ctx.nodes().get_node(call_id),
            &mut analysis.function_ids_calling_measurement,
            ctx,
        );
    }
    let imperative_helper_call_ids = analysis
        .imperative_dom_function_names
        .iter()
        .flat_map(|name| analysis.bare_calls_by_name.get(name).into_iter().flatten())
        .copied()
        .collect::<Vec<_>>();
    for call_id in imperative_helper_call_ids {
        let call_node = ctx.nodes().get_node(call_id);
        let owner_id = flush_sync_execution_owner_id(call_node, ctx);
        analysis
            .imperative_helper_call_spans_by_owner
            .entry(owner_id)
            .or_default()
            .push(call_node.span());
    }
    for spans in analysis.imperative_call_spans_by_owner.values_mut() {
        spans.sort_unstable_by_key(|span| span.start);
    }
    for spans in analysis.imperative_helper_call_spans_by_owner.values_mut() {
        spans.sort_unstable_by_key(|span| span.start);
    }
}

fn flush_sync_mark_enclosing_function_ids(
    node: &AstNode<'_>,
    function_ids: &mut FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            function_ids.insert(ancestor.id());
        }
    }
}

fn flush_sync_execution_owner_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> NodeId {
    ctx.nodes()
        .ancestors(node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)
            )
        })
        .expect("execution owner")
        .id()
}

fn flush_sync_is_hook_name(name: &str) -> bool {
    name.strip_prefix("use")
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(|character| character.is_ascii_uppercase())
}

fn flush_sync_is_measurement_helper_name(name: &str) -> bool {
    let Some(remainder) = ["get", "measure", "read"]
        .into_iter()
        .find_map(|prefix| name.strip_prefix(prefix))
    else {
        return false;
    };
    [
        "Width", "Height", "Rect", "Rects", "Size", "Bounds", "Position",
    ]
    .into_iter()
    .any(|suffix| {
        remainder.strip_suffix(suffix).is_some_and(|middle| {
            middle
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        })
    })
}

fn flush_sync_is_imperative_dom_library(source: &str) -> bool {
    source.starts_with("@floating-ui/")
        || source.starts_with("@popperjs/")
        || matches!(source, "react-popper" | "popper.js")
        || source.starts_with("shaka-player")
}

fn flush_sync_is_awareness_library(source: &str) -> bool {
    matches!(
        source,
        "@softmaple/awareness/hooks" | "@softmaple/awareness/mapping"
    )
}

fn flush_sync_has_awareness_exemption(
    local_name: &str,
    analysis: &FlushSyncAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    analysis.imports_awareness_library
        && analysis
            .bare_calls_by_name
            .get(local_name)
            .into_iter()
            .flatten()
            .any(|call_id| {
                let call_node = ctx.nodes().get_node(*call_id);
                crate::ast_util::get_enclosing_function(call_node, ctx).is_some_and(|function| {
                    analysis
                        .function_ids_using_awareness_signal
                        .contains(&function.id())
                })
            })
}

fn flush_sync_has_call_exemption(
    local_name: &str,
    analysis: &FlushSyncAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    analysis
        .bare_calls_by_name
        .get(local_name)
        .into_iter()
        .flatten()
        .any(|call_id| {
            let call_node = ctx.nodes().get_node(*call_id);
            flush_sync_is_inside_start_view_transition(call_node, ctx)
                || flush_sync_enclosing_function_chain_reads_measurement(call_node, analysis, ctx)
                || flush_sync_is_followed_by_imperative_dom_mutation(call_node, analysis, ctx)
        })
}

fn flush_sync_is_inside_start_view_transition(
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(call_node.id()).any(|ancestor| {
        let AstKind::CallExpression(call) = ancestor.kind() else {
            return false;
        };
        match &call.callee {
            Expression::Identifier(identifier) => identifier.name == "startViewTransition",
            Expression::StaticMemberExpression(member) => {
                member.property.name == "startViewTransition"
            }
            Expression::ComputedMemberExpression(member) => {
                matches!(&member.expression, Expression::Identifier(identifier)
                    if identifier.name == "startViewTransition")
            }
            _ => false,
        }
    })
}

fn flush_sync_enclosing_function_chain_reads_measurement(
    call_node: &AstNode<'_>,
    analysis: &FlushSyncAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().ancestors(call_node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && (analysis
            .function_ids_reading_measurement
            .contains(&ancestor.id())
            || analysis
                .function_ids_calling_measurement
                .contains(&ancestor.id()))
    })
}

fn flush_sync_owner_has_event_in_span(
    events_by_owner: &FxHashMap<NodeId, Vec<Span>>,
    owner_id: NodeId,
    root_span: Span,
) -> bool {
    let Some(events) = events_by_owner.get(&owner_id) else {
        return false;
    };
    let event_index = events.partition_point(|event| event.start < root_span.start);
    events
        .get(event_index)
        .is_some_and(|event| root_span.contains_inclusive(*event))
}

fn flush_sync_is_followed_by_imperative_dom_mutation(
    call_node: &AstNode<'_>,
    analysis: &FlushSyncAnalysis,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(following) = flush_sync_following_statement(call_node, ctx) else {
        return false;
    };
    !following.is_function_like
        && (flush_sync_owner_has_event_in_span(
            &analysis.imperative_call_spans_by_owner,
            following.owner_id,
            following.span,
        ) || flush_sync_owner_has_event_in_span(
            &analysis.imperative_helper_call_spans_by_owner,
            following.owner_id,
            following.span,
        ))
}

fn flush_sync_following_statement(
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<FlushSyncFollowingStatement> {
    let owner_id = flush_sync_execution_owner_id(call_node, ctx);
    let mut current = call_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let following = match parent.kind() {
            AstKind::FunctionBody(body) => {
                flush_sync_next_statement(&body.statements, current.span(), owner_id)
            }
            AstKind::BlockStatement(block) => {
                flush_sync_next_statement(&block.body, current.span(), owner_id)
            }
            AstKind::Program(program) => {
                flush_sync_next_statement(&program.body, current.span(), owner_id)
            }
            AstKind::StaticBlock(block) => {
                flush_sync_next_statement(&block.body, current.span(), owner_id)
            }
            AstKind::SwitchCase(case) => {
                flush_sync_next_statement(&case.consequent, current.span(), owner_id)
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return None,
            kind if flush_sync_is_non_expression_statement(kind) => return None,
            _ => {
                current = parent;
                continue;
            }
        };
        return following;
    }
}

fn flush_sync_next_statement(
    statements: &[Statement<'_>],
    current_span: Span,
    owner_id: NodeId,
) -> Option<FlushSyncFollowingStatement> {
    let index = statements
        .iter()
        .position(|statement| statement.span() == current_span)?;
    let statement = statements.get(index + 1)?;
    Some(FlushSyncFollowingStatement {
        owner_id,
        span: statement.span(),
        is_function_like: matches!(statement, Statement::FunctionDeclaration(_)),
    })
}

fn flush_sync_is_non_expression_statement(kind: AstKind<'_>) -> bool {
    matches!(
        kind,
        AstKind::IfStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::WhileStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_)
            | AstKind::SwitchStatement(_)
            | AstKind::ReturnStatement(_)
            | AstKind::ThrowStatement(_)
            | AstKind::TryStatement(_)
            | AstKind::WithStatement(_)
            | AstKind::LabeledStatement(_)
            | AstKind::BreakStatement(_)
            | AstKind::ContinueStatement(_)
            | AstKind::DebuggerStatement(_)
            | AstKind::EmptyStatement(_)
    )
}
