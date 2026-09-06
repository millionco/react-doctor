use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, CallExpression, Expression, JSXChild, JSXElement, JSXElementName,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};
use rustc_hash::FxHashMap;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This catch replaces a failure with an empty collection, and that same state renders a no-results message, so users see an empty result instead of an error. Preserve an error and retry path instead of writing `[]`.";
const SYNCHRONOUS_THROW_RESOLUTION_DEPTH: usize = 3;
const EMPTY_RESULT_CONTAINER_NAMES: [&str; 9] = [
    "article", "aside", "div", "li", "main", "p", "section", "span", "td",
];
const HIDDEN_CLASS_NAMES: [&str; 3] = ["collapse", "hidden", "invisible"];

static EMPTY_RESULT_TEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)\b(?:no\s+(?:data|entries|events|files|items?|matches?|messages?|notifications?|orders?|posts?|products?|records?|results?|tasks?|users?)|nothing\s+(?:found|here|to\s+(?:display|show))|(?:collection|inbox|list|results?)\s+is\s+empty)\b"
);
static ERROR_RESULT_TEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)\b(?:error(?:ed|s)?|fail(?:ed|ure)?|unable)\b");
static HIDDEN_ARBITRARY_CLASS_TOKEN_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)^\[(?:display\s*:\s*none|visibility\s*:\s*hidden)\]$");

#[derive(Debug, Default, Clone)]
pub struct NoCollapseRequestErrorToEmptyState;

#[derive(Default)]
struct CollapseAnalysis {
    node_ids_by_function: FxHashMap<NodeId, Vec<NodeId>>,
}

declare_oxc_lint!(
    /// Disallow collapsing a request failure into a collection's empty-result state.
    NoCollapseRequestErrorToEmptyState,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow collapsing a request failure into an empty collection state.",
);

impl Rule for NoCollapseRequestErrorToEmptyState {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let analysis = collapse_build_analysis(ctx);
        let mut function_resolution_cache = LocalFunctionResolutionCache::default();
        for catch_node in ctx.nodes().iter() {
            let AstKind::CatchClause(catch_clause) = catch_node.kind() else {
                continue;
            };
            let Some((component_function_id, state_symbol_id, report_span)) =
                collapse_empty_catch_state_pair(
                    catch_node,
                    catch_clause,
                    ctx,
                    &analysis,
                    &mut function_resolution_cache,
                )
            else {
                continue;
            };
            let component_function = ctx.nodes().get_node(component_function_id);
            let Some(empty_result_node) = collapse_direct_empty_result_render(
                component_function,
                state_symbol_id,
                ctx,
                &analysis,
            ) else {
                continue;
            };
            if collapse_has_prior_preempting_route(
                component_function,
                empty_result_node,
                ctx,
                &analysis,
            ) || !nodes_can_co_execute(catch_node, empty_result_node, ctx)
                || collapse_nodes_on_exclusive_conditional_branches(
                    catch_node,
                    empty_result_node,
                    component_function,
                    ctx,
                )
                || collapse_nodes_on_contradictory_guard_branches(
                    catch_node,
                    empty_result_node,
                    ctx,
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(report_span));
        }
    }
}

fn collapse_nodes_on_exclusive_conditional_branches(
    first_node: &AstNode<'_>,
    second_node: &AstNode<'_>,
    boundary: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut first_branches = FxHashMap::default();
    let mut first_child = first_node;
    for first_ancestor in ctx.nodes().ancestors(first_node.id()) {
        if matches!(
            first_ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        match first_ancestor.kind() {
            AstKind::IfStatement(statement) => {
                if statement.consequent.span() == first_child.span() {
                    first_branches.insert(first_ancestor.id(), false);
                } else if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span() == first_child.span())
                {
                    first_branches.insert(first_ancestor.id(), true);
                }
            }
            AstKind::ConditionalExpression(conditional) => {
                if conditional.consequent.span() == first_child.span() {
                    first_branches.insert(first_ancestor.id(), false);
                } else if conditional.alternate.span() == first_child.span() {
                    first_branches.insert(first_ancestor.id(), true);
                }
            }
            _ => {}
        }
        if first_ancestor.id() == boundary.id() {
            break;
        }
        first_child = first_ancestor;
    }

    let mut second_child = second_node;
    for second_ancestor in ctx.nodes().ancestors(second_node.id()) {
        if matches!(
            second_ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let second_branch = match second_ancestor.kind() {
            AstKind::IfStatement(statement) => {
                if statement.consequent.span() == second_child.span() {
                    Some(false)
                } else if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span() == second_child.span())
                {
                    Some(true)
                } else {
                    None
                }
            }
            AstKind::ConditionalExpression(conditional) => {
                if conditional.consequent.span() == second_child.span() {
                    Some(false)
                } else if conditional.alternate.span() == second_child.span() {
                    Some(true)
                } else {
                    None
                }
            }
            _ => None,
        };
        if second_branch.is_some_and(|branch| {
            first_branches
                .get(&second_ancestor.id())
                .is_some_and(|first_branch| *first_branch != branch)
        }) {
            return true;
        }
        if second_ancestor.id() == boundary.id() {
            return false;
        }
        second_child = second_ancestor;
    }
    false
}

fn collapse_nodes_on_contradictory_guard_branches(
    first_node: &AstNode<'_>,
    second_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut first_requirements = FxHashMap::default();
    let mut first_child = first_node;
    for first_ancestor in ctx.nodes().ancestors(first_node.id()) {
        if matches!(
            first_ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        if let AstKind::IfStatement(statement) = first_ancestor.kind()
            && let Some((symbol_id, polarity)) =
                collapse_stable_boolean_guard_reference(&statement.test, ctx)
        {
            if statement.consequent.span() == first_child.span() {
                first_requirements.insert(symbol_id, polarity);
            } else if statement
                .alternate
                .as_ref()
                .is_some_and(|alternate| alternate.span() == first_child.span())
            {
                first_requirements.insert(symbol_id, !polarity);
            }
        }
        first_child = first_ancestor;
    }

    let mut second_child = second_node;
    for second_ancestor in ctx.nodes().ancestors(second_node.id()) {
        if matches!(
            second_ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        if let AstKind::IfStatement(statement) = second_ancestor.kind()
            && let Some((symbol_id, polarity)) =
                collapse_stable_boolean_guard_reference(&statement.test, ctx)
        {
            let required_value = if statement.consequent.span() == second_child.span() {
                Some(polarity)
            } else if statement
                .alternate
                .as_ref()
                .is_some_and(|alternate| alternate.span() == second_child.span())
            {
                Some(!polarity)
            } else {
                None
            };
            if required_value.is_some_and(|required_value| {
                first_requirements
                    .get(&symbol_id)
                    .is_some_and(|first_required_value| *first_required_value != required_value)
            }) {
                return true;
            }
        }
        second_child = second_ancestor;
    }
    false
}

fn collapse_stable_boolean_guard_reference(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(SymbolId, bool)> {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            collapse_stable_boolean_guard_reference(&unary.argument, ctx)
                .map(|(symbol_id, polarity)| (symbol_id, !polarity))
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            ctx.scoping()
                .get_resolved_references(symbol_id)
                .all(|reference| reference.is_read() && !reference.is_write())
                .then_some((symbol_id, true))
        }
        _ => None,
    }
}

fn collapse_build_analysis(ctx: &LintContext<'_>) -> CollapseAnalysis {
    let mut analysis = CollapseAnalysis::default();
    for node in ctx.nodes().iter() {
        let Some(function_id) = collapse_nearest_function_id(node.id(), ctx) else {
            continue;
        };
        analysis
            .node_ids_by_function
            .entry(function_id)
            .or_default()
            .push(node.id());
    }
    analysis
}

fn collapse_empty_catch_state_pair<'a>(
    catch_node: &AstNode<'a>,
    catch_clause: &'a oxc_ast::ast::CatchClause<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> Option<(NodeId, SymbolId, Span)> {
    let try_node = ctx.nodes().parent_node(catch_node.id());
    let AstKind::TryStatement(try_statement) = try_node.kind() else {
        return None;
    };
    if try_statement.finalizer.is_some()
        || try_statement.handler.as_ref()?.span != catch_clause.span
    {
        return None;
    }
    let catch_function = collapse_nearest_function(catch_node, ctx)?;
    if !is_node_reachable_within_function(catch_node, catch_function, ctx)
        || !collapse_has_proven_request_await(
            &try_statement.block,
            catch_function,
            ctx,
            analysis,
            function_resolution_cache,
        )
    {
        return None;
    }
    let [Statement::ExpressionStatement(statement)] = catch_clause.body.body.as_slice() else {
        return None;
    };
    let Expression::CallExpression(setter_call) = statement.expression.get_inner_expression()
    else {
        return None;
    };
    let Expression::Identifier(setter_identifier) = setter_call.callee.get_inner_expression()
    else {
        return None;
    };
    let [next_state_argument] = setter_call.arguments.as_slice() else {
        return None;
    };
    let next_state_expression = next_state_argument.as_expression()?;
    if !collapse_is_proven_empty_array(next_state_expression, true) {
        return None;
    }
    let setter_symbol_id = ctx
        .scoping()
        .get_reference(setter_identifier.reference_id())
        .symbol_id()?;
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
    if setter_binding.symbol_id() != setter_symbol_id {
        return None;
    }
    let Expression::CallExpression(use_state_call) =
        declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    let [initializer_argument] = use_state_call.arguments.as_slice() else {
        return None;
    };
    if !collapse_is_use_state_call(use_state_call, ctx)
        || !collapse_is_proven_empty_array(initializer_argument.as_expression()?, true)
    {
        return None;
    }
    let component_function = collapse_nearest_function(declaration, ctx)?;
    Some((
        component_function.id(),
        state_binding.symbol_id(),
        statement.span,
    ))
}

fn collapse_is_use_state_call<'a>(call: &CallExpression<'a>, ctx: &LintContext<'a>) -> bool {
    is_react_api_call(call, "useState", ctx)
        || matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "useState"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn collapse_is_proven_empty_array(expression: &Expression<'_>, allow_updater: bool) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array) => array.elements.is_empty(),
        Expression::ArrowFunctionExpression(function) if allow_updater && !function.r#async => {
            if let Some(returned_expression) = function.get_expression() {
                return collapse_is_proven_empty_array(returned_expression, false);
            }
            let Some(body) = function.body.as_function_body() else {
                return false;
            };
            collapse_single_empty_array_return(&body.statements)
        }
        Expression::FunctionExpression(function)
            if allow_updater && !function.r#async && !function.generator =>
        {
            function
                .body
                .as_ref()
                .is_some_and(|body| collapse_single_empty_array_return(&body.statements))
        }
        _ => false,
    }
}

fn collapse_single_empty_array_return(statements: &[Statement<'_>]) -> bool {
    let [Statement::ReturnStatement(return_statement)] = statements else {
        return false;
    };
    return_statement
        .argument
        .as_ref()
        .is_some_and(|expression| collapse_is_proven_empty_array(expression, false))
}

fn collapse_has_proven_request_await<'a>(
    try_block: &'a oxc_ast::ast::BlockStatement<'a>,
    owner_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    collapse_function_node_ids(owner_function.id(), analysis)
        .map(|node_id| ctx.nodes().get_node(node_id))
        .any(|candidate| {
            let AstKind::AwaitExpression(await_expression) = candidate.kind() else {
                return false;
            };
            try_block.span.contains_inclusive(candidate.span())
                && collapse_nearest_function_id(candidate.id(), ctx) == Some(owner_function.id())
                && is_node_reachable_within_function(candidate, owner_function, ctx)
                && !collapse_await_caught_before_boundary(candidate, try_block.span, ctx)
                && (collapse_expression_has_escaping_global_fetch(
                    &await_expression.argument,
                    owner_function.id(),
                    ctx,
                    analysis,
                    function_resolution_cache,
                ) || collapse_awaited_exact_local_request(
                    &await_expression.argument,
                    ctx,
                    analysis,
                    function_resolution_cache,
                ))
        })
}

fn collapse_awaited_exact_local_request<'a>(
    awaited_expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Expression::CallExpression(call) = awaited_expression.get_inner_expression() else {
        return false;
    };
    let Some(function_id) = exact_local_function_id(
        &call.callee,
        ctx,
        &mut Vec::new(),
        function_resolution_cache,
    ) else {
        return false;
    };
    collapse_local_function_produces_request(
        ctx.nodes().get_node(function_id),
        ctx,
        analysis,
        function_resolution_cache,
    )
}

fn collapse_local_function_produces_request<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    match function_node.kind() {
        AstKind::Function(function) if function.generator => return false,
        AstKind::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                return collapse_expression_has_escaping_global_fetch(
                    expression,
                    function_node.id(),
                    ctx,
                    analysis,
                    function_resolution_cache,
                );
            }
        }
        AstKind::Function(_) => {}
        _ => return false,
    }
    if collapse_function_node_ids(function_node.id(), analysis)
        .map(|node_id| ctx.nodes().get_node(node_id))
        .any(|candidate| matches!(candidate.kind(), AstKind::TryStatement(_)))
    {
        return false;
    }
    collapse_function_node_ids(function_node.id(), analysis)
        .map(|node_id| ctx.nodes().get_node(node_id))
        .any(|candidate| {
            if !is_node_reachable_within_function(candidate, function_node, ctx) {
                return false;
            }
            match candidate.kind() {
                AstKind::AwaitExpression(await_expression) => {
                    collapse_expression_has_escaping_global_fetch(
                        &await_expression.argument,
                        function_node.id(),
                        ctx,
                        analysis,
                        function_resolution_cache,
                    )
                }
                AstKind::ReturnStatement(return_statement) => return_statement
                    .argument
                    .as_ref()
                    .is_some_and(|expression| {
                        collapse_expression_has_escaping_global_fetch(
                            expression,
                            function_node.id(),
                            ctx,
                            analysis,
                            function_resolution_cache,
                        )
                    }),
                _ => false,
            }
        })
}

fn collapse_expression_has_escaping_global_fetch<'a>(
    expression: &Expression<'a>,
    owner_function_id: NodeId,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let expression_span = expression.span();
    let owner_function = ctx.nodes().get_node(owner_function_id);
    collapse_function_node_ids(owner_function_id, analysis)
        .map(|node_id| ctx.nodes().get_node(node_id))
        .any(|candidate| {
            let AstKind::CallExpression(fetch_call) = candidate.kind() else {
                return false;
            };
            expression_span.contains_inclusive(candidate.span())
                && collapse_nearest_function_id(candidate.id(), ctx) == Some(owner_function_id)
                && is_node_reachable_within_function(candidate, owner_function, ctx)
                && collapse_is_global_fetch_call(fetch_call, ctx)
                && !collapse_fetch_chain_absorbs_rejection(
                    candidate,
                    expression_span,
                    ctx,
                    analysis,
                    function_resolution_cache,
                )
        })
}

fn collapse_is_global_fetch_call(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == "fetch"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            if member.static_property_name() != Some("fetch") {
                return false;
            }
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return false;
            };
            matches!(receiver.name.as_str(), "globalThis" | "window")
                && ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    .is_none()
        }
    }
}

fn collapse_fetch_chain_absorbs_rejection<'a>(
    fetch_node: &AstNode<'a>,
    boundary: Span,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let mut child = fetch_node;
    for ancestor in ctx.nodes().ancestors(fetch_node.id()) {
        if !boundary.contains_inclusive(ancestor.span()) {
            break;
        }
        match ancestor.kind() {
            kind if kind
                .as_member_expression_kind()
                .is_some_and(|member| member.object().span().contains_inclusive(child.span())) => {}
            AstKind::CallExpression(call)
                if call.callee.span().contains_inclusive(child.span()) =>
            {
                if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
                    let rejection_handler = match member.static_property_name() {
                        Some("catch") => call.arguments.first(),
                        Some("then") => call.arguments.get(1),
                        _ => None,
                    };
                    if rejection_handler
                        .and_then(Argument::as_expression)
                        .is_some_and(|handler| {
                            collapse_handler_is_absorbing(
                                handler,
                                ctx,
                                analysis,
                                function_resolution_cache,
                            )
                        })
                    {
                        return true;
                    }
                }
            }
            AstKind::ParenthesizedExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSSatisfiesExpression(_)
            | AstKind::TSTypeAssertion(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::TSInstantiationExpression(_)
            | AstKind::ChainExpression(_) => {}
            _ => break,
        }
        child = ancestor;
    }
    false
}

fn collapse_handler_is_absorbing<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(function_id) = exact_local_function_id_including_generators(
        expression,
        ctx,
        &mut Vec::new(),
        function_resolution_cache,
    ) else {
        return false;
    };
    let function_node = ctx.nodes().get_node(function_id);
    if collapse_subtree_can_throw_synchronously(
        function_id,
        function_id,
        SYNCHRONOUS_THROW_RESOLUTION_DEPTH,
        ctx,
        analysis,
        function_resolution_cache,
        &mut rustc_hash::FxHashSet::default(),
    ) {
        return false;
    }
    for node_id in collapse_function_node_ids(function_id, analysis) {
        let node = ctx.nodes().get_node(node_id);
        match node.kind() {
            AstKind::ThrowStatement(_) | AstKind::AwaitExpression(_) => return false,
            AstKind::CallExpression(call) => {
                if collapse_is_proven_non_throwing_call(call, ctx)
                    || collapse_is_non_rejecting_promise_resolve(call, ctx)
                    || collapse_call_carries_rejection_handler(
                        call,
                        ctx,
                        analysis,
                        function_resolution_cache,
                    )
                {
                    continue;
                }
                let Some(local_function_id) = exact_local_function_id_including_generators(
                    &call.callee,
                    ctx,
                    &mut Vec::new(),
                    function_resolution_cache,
                ) else {
                    return false;
                };
                if collapse_subtree_can_throw_synchronously(
                    local_function_id,
                    local_function_id,
                    SYNCHRONOUS_THROW_RESOLUTION_DEPTH,
                    ctx,
                    analysis,
                    function_resolution_cache,
                    &mut rustc_hash::FxHashSet::default(),
                ) {
                    return false;
                }
            }
            AstKind::ReturnStatement(statement) => {
                if statement.argument.as_ref().is_some_and(|result| {
                    collapse_handler_result_can_reject(
                        result,
                        ctx,
                        analysis,
                        function_resolution_cache,
                    )
                }) {
                    return false;
                }
            }
            _ => {}
        }
    }
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(result) = function.get_expression()
    {
        return !collapse_handler_result_can_reject(
            result,
            ctx,
            analysis,
            function_resolution_cache,
        );
    }
    matches!(
        function_node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    )
}

fn collapse_chain_carries_rejection_handler<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            collapse_call_carries_rejection_handler(call, ctx, analysis, function_resolution_cache)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            collapse_chain_carries_rejection_handler(
                member.object(),
                ctx,
                analysis,
                function_resolution_cache,
            )
        }),
    }
}

fn collapse_call_carries_rejection_handler<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let handler = match member.static_property_name() {
        Some("catch")
            if collapse_has_promise_like_receiver(
                member.object(),
                ctx,
                &mut rustc_hash::FxHashSet::default(),
            ) =>
        {
            call.arguments.first()
        }
        Some("then") => call.arguments.get(1),
        _ => None,
    };
    if handler
        .and_then(Argument::as_expression)
        .is_some_and(|handler| {
            collapse_handler_is_absorbing(handler, ctx, analysis, function_resolution_cache)
        })
    {
        return true;
    }
    collapse_chain_carries_rejection_handler(
        member.object(),
        ctx,
        analysis,
        function_resolution_cache,
    )
}

fn collapse_has_promise_like_receiver<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut rustc_hash::FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(_) | Expression::NewExpression(_) => true,
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            visited.insert(symbol_id)
                && collapse_direct_unreassigned_initializer(symbol_id, ctx).is_some_and(
                    |initializer| collapse_has_promise_like_receiver(initializer, ctx, visited),
                )
        }
        _ => false,
    }
}

fn collapse_direct_unreassigned_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
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
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    if variable_declaration.kind.is_const() {
        return declarator.init.as_ref();
    }
    let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
    let symbol_name = ctx.scoping().symbol_name(symbol_id);
    let has_same_scope_sibling = ctx.scoping().symbol_ids().any(|candidate_symbol_id| {
        candidate_symbol_id != symbol_id
            && ctx.scoping().symbol_scope_id(candidate_symbol_id) == symbol_scope_id
            && ctx.scoping().symbol_name(candidate_symbol_id) == symbol_name
    });
    if !matches!(
        variable_declaration.kind,
        oxc_ast::ast::VariableDeclarationKind::Let | oxc_ast::ast::VariableDeclarationKind::Var
    ) || has_same_scope_sibling
        || !ctx.scoping().symbol_redeclarations(symbol_id).is_empty()
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| !reference.is_read() || reference.is_write())
    {
        return None;
    }
    declarator.init.as_ref()
}

fn collapse_is_non_rejecting_promise_construction<'a>(
    allocation: &oxc_ast::ast::NewExpression<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Expression::Identifier(promise_identifier) = allocation.callee.get_inner_expression()
    else {
        return false;
    };
    if promise_identifier.name != "Promise"
        || ctx
            .scoping()
            .get_reference(promise_identifier.reference_id())
            .symbol_id()
            .is_some()
    {
        return false;
    }
    let Some(executor) = allocation
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    if !matches!(
        executor.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    let Some(executor_id) = exact_local_function_id_including_generators(
        executor,
        ctx,
        &mut Vec::new(),
        function_resolution_cache,
    ) else {
        return false;
    };
    let executor_node = ctx.nodes().get_node(executor_id);
    let (parameter_count, resolve_name) = match executor_node.kind() {
        AstKind::ArrowFunctionExpression(function) => (
            function.params.items.len() + usize::from(function.params.rest.is_some()),
            function
                .params
                .items
                .first()
                .and_then(|parameter| match &parameter.pattern {
                    BindingPattern::BindingIdentifier(binding) => Some(binding.name.as_str()),
                    _ => None,
                }),
        ),
        AstKind::Function(function) => (
            function.params.items.len() + usize::from(function.params.rest.is_some()),
            function
                .params
                .items
                .first()
                .and_then(|parameter| match &parameter.pattern {
                    BindingPattern::BindingIdentifier(binding) => Some(binding.name.as_str()),
                    _ => None,
                }),
        ),
        _ => return false,
    };
    if parameter_count >= 2
        || collapse_subtree_can_throw_synchronously(
            executor_id,
            executor_id,
            SYNCHRONOUS_THROW_RESOLUTION_DEPTH,
            ctx,
            analysis,
            function_resolution_cache,
            &mut rustc_hash::FxHashSet::default(),
        )
    {
        return false;
    }
    let Some(resolve_name) = resolve_name else {
        return true;
    };
    !ctx.nodes().iter().any(|node| {
        if !executor_node.span().contains_inclusive(node.span()) {
            return false;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            return false;
        };
        if !matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == resolve_name)
        {
            return false;
        }
        match call.arguments.first() {
            None => false,
            Some(argument) => argument
                .as_expression()
                .is_none_or(|value| !collapse_is_definitely_non_thenable(value)),
        }
    })
}

fn collapse_subtree_can_throw_synchronously<'a>(
    root_function_id: NodeId,
    function_boundary_id: NodeId,
    remaining_depth: usize,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
    visited_functions: &mut rustc_hash::FxHashSet<NodeId>,
) -> bool {
    for node_id in collapse_function_node_ids(root_function_id, analysis) {
        let node = ctx.nodes().get_node(node_id);
        if matches!(node.kind(), AstKind::ThrowStatement(_))
            && !collapse_inside_absorbing_try(node, function_boundary_id, ctx, analysis)
        {
            return true;
        }
        if remaining_depth == 0
            || collapse_inside_absorbing_try(node, function_boundary_id, ctx, analysis)
        {
            continue;
        }
        let AstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        let Some(called_function_id) = exact_local_function_id_including_generators(
            &call.callee,
            ctx,
            &mut Vec::new(),
            function_resolution_cache,
        ) else {
            continue;
        };
        let called_function = ctx.nodes().get_node(called_function_id);
        let is_async = match called_function.kind() {
            AstKind::ArrowFunctionExpression(function) => function.r#async,
            AstKind::Function(function) => function.r#async,
            _ => true,
        };
        if is_async || !visited_functions.insert(called_function_id) {
            continue;
        }
        if collapse_subtree_can_throw_synchronously(
            called_function_id,
            called_function_id,
            remaining_depth - 1,
            ctx,
            analysis,
            function_resolution_cache,
            visited_functions,
        ) {
            return true;
        }
    }
    false
}

fn collapse_inside_absorbing_try(
    node: &AstNode<'_>,
    function_boundary_id: NodeId,
    ctx: &LintContext<'_>,
    analysis: &CollapseAnalysis,
) -> bool {
    let mut child = node;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == function_boundary_id {
            break;
        }
        if let AstKind::TryStatement(statement) = ancestor.kind()
            && statement.block.span == child.span()
            && let Some(handler) = &statement.handler
        {
            let handler_rethrows =
                collapse_function_node_ids(function_boundary_id, analysis).any(|node_id| {
                    let candidate = ctx.nodes().get_node(node_id);
                    handler.span.contains_inclusive(candidate.span())
                        && matches!(candidate.kind(), AstKind::ThrowStatement(_))
                });
            if !handler_rethrows {
                return true;
            }
        }
        child = ancestor;
    }
    false
}

pub(super) fn collapse_is_proven_non_throwing_call<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    if ctx
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
        .is_some()
    {
        return false;
    }
    let method_name = member.static_property_name();
    if receiver.name == "performance" && method_name == Some("now") {
        return call.arguments.is_empty();
    }
    if receiver.name == "console" {
        return matches!(
            method_name,
            Some("debug" | "error" | "info" | "log" | "trace" | "warn")
        );
    }
    receiver.name == "Math"
        && method_name == Some("round")
        && call.arguments.len() == 1
        && call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(|argument| {
                collapse_is_proven_non_throwing_number_expression(
                    argument,
                    ctx,
                    &mut rustc_hash::FxHashSet::default(),
                )
            })
}

fn collapse_is_proven_non_throwing_number_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited: &mut rustc_hash::FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(_) => true,
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            matches!(member.object().get_inner_expression(), Expression::Identifier(receiver)
                if receiver.name == "performance"
                    && ctx.scoping().get_reference(receiver.reference_id()).symbol_id().is_none())
                && member.static_property_name() == Some("now")
                && call.arguments.is_empty()
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited.insert(symbol_id) {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(ctx.nodes().parent_kind(declaration.id()), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
                && declaration.span().start < identifier.span().start
                && !ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    collapse_is_proven_non_throwing_number_expression(initializer, ctx, visited)
                })
        }
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::UnaryPlus | UnaryOperator::UnaryNegation
            ) =>
        {
            collapse_is_proven_non_throwing_number_expression(&unary.argument, ctx, visited)
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Addition
                    | BinaryOperator::Subtraction
                    | BinaryOperator::Multiplication
                    | BinaryOperator::Division
                    | BinaryOperator::Remainder
                    | BinaryOperator::Exponential
            ) =>
        {
            collapse_is_proven_non_throwing_number_expression(
                &binary.left,
                ctx,
                &mut visited.clone(),
            ) && collapse_is_proven_non_throwing_number_expression(
                &binary.right,
                ctx,
                &mut visited.clone(),
            )
        }
        _ => false,
    }
}

fn collapse_handler_result_can_reject<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    analysis: &CollapseAnalysis,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if collapse_is_definitely_non_thenable(expression) {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            !collapse_is_non_rejecting_promise_resolve(call, ctx)
                && !collapse_chain_carries_rejection_handler(
                    expression,
                    ctx,
                    analysis,
                    function_resolution_cache,
                )
        }
        Expression::NewExpression(allocation) => !collapse_is_non_rejecting_promise_construction(
            allocation,
            ctx,
            analysis,
            function_resolution_cache,
        ),
        _ => true,
    }
}

fn collapse_is_non_rejecting_promise_resolve(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.is_computed() || member.static_property_name() != Some("resolve") {
        return false;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    receiver.name == "Promise"
        && ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            .is_none()
        && match call.arguments.first() {
            None => true,
            Some(argument) => argument
                .as_expression()
                .is_some_and(collapse_is_definitely_non_thenable),
        }
}

fn collapse_is_definitely_non_thenable(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_) => true,
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| {
            !matches!(
                element,
                oxc_ast::ast::ArrayExpressionElement::SpreadElement(_)
            )
        }),
        Expression::ObjectExpression(object) => object.properties.iter().all(|property| {
            matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                if property.kind == oxc_ast::ast::PropertyKind::Init
                    && !property.computed
                    && collapse_is_definitely_non_thenable(&property.value))
        }),
        _ => false,
    }
}

fn collapse_await_caught_before_boundary(
    await_node: &AstNode<'_>,
    boundary: Span,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(await_node.id()) {
        if ancestor.span() == boundary {
            break;
        }
        let AstKind::TryStatement(statement) = ancestor.kind() else {
            continue;
        };
        if !statement.block.span.contains_inclusive(await_node.span()) {
            continue;
        }
        if statement.finalizer.is_some() {
            return true;
        }
        if let Some(handler) = &statement.handler
            && !matches!(handler.body.body.as_slice(), [Statement::ThrowStatement(_)])
        {
            return true;
        }
    }
    false
}

fn collapse_direct_empty_result_render<'node, 'ast>(
    component_function: &'node AstNode<'ast>,
    state_symbol_id: SymbolId,
    ctx: &'node LintContext<'ast>,
    analysis: &CollapseAnalysis,
) -> Option<&'node AstNode<'ast>> {
    collapse_function_node_ids(component_function.id(), analysis)
        .map(|node_id| ctx.nodes().get_node(node_id))
        .find(|candidate| {
            if !is_node_reachable_within_function(candidate, component_function, ctx) {
                return false;
            }
            match candidate.kind() {
                AstKind::IfStatement(statement) => {
                    collapse_empty_condition_kind(&statement.test, state_symbol_id, ctx)
                        == Some(true)
                        && collapse_direct_return_expression(&statement.consequent).is_some_and(
                            |expression| collapse_is_explicit_empty_result(expression, ctx),
                        )
                }
                AstKind::ConditionalExpression(conditional) => {
                    let Some(is_empty_when_truthy) =
                        collapse_empty_condition_kind(&conditional.test, state_symbol_id, ctx)
                    else {
                        return false;
                    };
                    let empty_branch = if is_empty_when_truthy {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    };
                    collapse_is_directly_rendered(candidate, component_function, ctx)
                        && collapse_is_explicit_empty_result(empty_branch, ctx)
                }
                _ => false,
            }
        })
}

fn collapse_empty_condition_kind(
    expression: &Expression<'_>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    let expression = expression.get_inner_expression();
    if collapse_is_exact_state_length(expression, state_symbol_id, ctx) {
        return Some(false);
    }
    if let Expression::UnaryExpression(unary) = expression
        && unary.operator == UnaryOperator::LogicalNot
        && collapse_is_exact_state_length(&unary.argument, state_symbol_id, ctx)
    {
        return Some(true);
    }
    let Expression::BinaryExpression(binary) = expression else {
        return None;
    };
    if binary.operator != BinaryOperator::StrictEquality {
        return None;
    }
    if collapse_is_zero_literal(&binary.left)
        && collapse_is_exact_state_length(&binary.right, state_symbol_id, ctx)
        || collapse_is_zero_literal(&binary.right)
            && collapse_is_exact_state_length(&binary.left, state_symbol_id, ctx)
    {
        return Some(true);
    }
    None
}

fn collapse_is_zero_literal(expression: &Expression<'_>) -> bool {
    matches!(expression.get_inner_expression(), Expression::NumericLiteral(literal) if literal.value == 0.0)
}

fn collapse_is_exact_state_length(
    expression: &Expression<'_>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("length") {
        return false;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
        == Some(state_symbol_id)
}

fn collapse_direct_return_expression<'a>(
    statement: &'a Statement<'a>,
) -> Option<&'a Expression<'a>> {
    match statement {
        Statement::ReturnStatement(statement) => statement.argument.as_ref(),
        Statement::BlockStatement(block) => {
            let [Statement::ReturnStatement(statement)] = block.body.as_slice() else {
                return None;
            };
            statement.argument.as_ref()
        }
        _ => None,
    }
}

fn collapse_is_explicit_empty_result<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::JSXElement(element) = expression.get_inner_expression() else {
        return false;
    };
    if !collapse_is_static_intrinsic_jsx(element, ctx) {
        return false;
    }
    let normalized_text = get_static_jsx_text(element)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    EMPTY_RESULT_TEXT_PATTERN.is_match(&normalized_text)
        && !ERROR_RESULT_TEXT_PATTERN.is_match(&normalized_text)
}

fn collapse_is_static_intrinsic_jsx<'a>(
    element: &'a JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let JSXElementName::Identifier(name) = &element.opening_element.name else {
        return false;
    };
    if !EMPTY_RESULT_CONTAINER_NAMES.contains(&name.name.as_str())
        || !collapse_opening_element_is_visible(&element.opening_element, ctx)
    {
        return false;
    }
    element.children.iter().all(|child| match child {
        JSXChild::Text(_) => true,
        JSXChild::Element(child_element) => collapse_is_static_intrinsic_jsx(child_element, ctx),
        JSXChild::ExpressionContainer(container) => match container.expression.as_expression() {
            None => true,
            Some(Expression::StringLiteral(_)) => true,
            Some(Expression::TemplateLiteral(template)) => template.expressions.is_empty(),
            Some(expression) => matches!(
                expression.get_inner_expression(),
                Expression::StringLiteral(_)
            ),
        },
        _ => false,
    })
}

fn collapse_opening_element_is_visible<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_statically_hidden_from_screen_reader(opening_element, ctx) {
        return false;
    }
    for attribute_name in ["aria-hidden", "hidden", "style"] {
        let resolution = resolve_static_jsx_attribute(opening_element, attribute_name, false);
        if resolution.is_present || resolution.is_unknown {
            return false;
        }
    }
    for attribute_name in ["class", "className"] {
        let resolution = resolve_static_jsx_attribute(opening_element, attribute_name, false);
        if resolution.is_unknown {
            return false;
        }
        if !resolution.is_present {
            continue;
        }
        let Some(class_name) = collapse_static_class_name(&resolution) else {
            return false;
        };
        if tailwind_class_name_tokens(class_name).iter().any(|token| {
            HIDDEN_CLASS_NAMES.contains(&token.utility)
                || HIDDEN_ARBITRARY_CLASS_TOKEN_PATTERN.is_match(token.utility)
        }) {
            return false;
        }
    }
    true
}

fn collapse_static_class_name<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a str> {
    if let Some(attribute) = resolution.attribute {
        return get_string_literal_attribute_value(attribute);
    }
    resolution.expression.and_then(get_static_string_expression)
}

fn collapse_is_directly_rendered<'a>(
    expression_node: &AstNode<'a>,
    component_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut root = transparent_expression_root(expression_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        match parent.kind() {
            AstKind::JSXExpressionContainer(container)
                if container.expression.span().contains_inclusive(root.span())
                    && !matches!(
                        ctx.nodes().parent_node(parent.id()).kind(),
                        AstKind::JSXAttribute(_)
                    ) =>
            {
                root = parent;
            }
            AstKind::JSXElement(element) => {
                if !collapse_opening_element_is_visible(&element.opening_element, ctx) {
                    return false;
                }
                root = parent;
            }
            AstKind::JSXFragment(_) => root = parent,
            _ => break,
        }
    }
    let parent = ctx.nodes().parent_node(root.id());
    if matches!(parent.kind(), AstKind::ArrowFunctionExpression(function)
        if function.get_expression().is_some_and(|body| body.span() == root.span()))
    {
        return parent.id() == component_function.id();
    }
    matches!(parent.kind(), AstKind::ReturnStatement(_))
        && collapse_nearest_function_id(parent.id(), ctx) == Some(component_function.id())
}

fn collapse_has_prior_preempting_route(
    component_function: &AstNode<'_>,
    empty_result_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
    analysis: &CollapseAnalysis,
) -> bool {
    collapse_function_node_ids(component_function.id(), analysis)
        .map(|node_id| ctx.nodes().get_node(node_id))
        .any(|candidate| {
            if candidate.span().start >= empty_result_node.span().start
                || !is_node_reachable_within_function(candidate, component_function, ctx)
            {
                return false;
            }
            match candidate.kind() {
                AstKind::IfStatement(statement) => collapse_if_route_can_preempt(
                    statement,
                    empty_result_node.span(),
                    component_function,
                    ctx,
                    analysis,
                ),
                AstKind::SwitchStatement(statement) => statement.cases.iter().any(|case| {
                    !case.span.contains_inclusive(empty_result_node.span())
                        && collapse_span_has_reachable_return(
                            case.span,
                            component_function,
                            ctx,
                            analysis,
                        )
                }),
                _ => false,
            }
        })
}

fn collapse_if_route_can_preempt(
    statement: &oxc_ast::ast::IfStatement<'_>,
    empty_result_span: Span,
    component_function: &AstNode<'_>,
    ctx: &LintContext<'_>,
    analysis: &CollapseAnalysis,
) -> bool {
    if !statement.span.contains_inclusive(empty_result_span) {
        return collapse_span_has_reachable_return(
            statement.span,
            component_function,
            ctx,
            analysis,
        );
    }
    if statement
        .consequent
        .span()
        .contains_inclusive(empty_result_span)
    {
        return statement.alternate.as_ref().is_some_and(|alternate| {
            collapse_span_has_reachable_return(alternate.span(), component_function, ctx, analysis)
        });
    }
    collapse_span_has_reachable_return(
        statement.consequent.span(),
        component_function,
        ctx,
        analysis,
    )
}

fn collapse_span_has_reachable_return(
    span: Span,
    component_function: &AstNode<'_>,
    ctx: &LintContext<'_>,
    analysis: &CollapseAnalysis,
) -> bool {
    collapse_function_node_ids(component_function.id(), analysis)
        .map(|node_id| ctx.nodes().get_node(node_id))
        .any(|candidate| {
            span.contains_inclusive(candidate.span())
                && collapse_nearest_function_id(candidate.id(), ctx)
                    == Some(component_function.id())
                && matches!(candidate.kind(), AstKind::ReturnStatement(_))
                && is_node_reachable_within_function(candidate, component_function, ctx)
        })
}

fn collapse_function_node_ids(
    function_id: NodeId,
    analysis: &CollapseAnalysis,
) -> impl Iterator<Item = NodeId> + '_ {
    analysis
        .node_ids_by_function
        .get(&function_id)
        .into_iter()
        .flatten()
        .copied()
}

fn collapse_nearest_function<'a, 'ctx>(
    node: &AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    collapse_nearest_function_id(node.id(), ctx)
        .map(|function_id| ctx.nodes().get_node(function_id))
}

fn collapse_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
