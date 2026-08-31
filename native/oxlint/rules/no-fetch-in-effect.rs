use oxc_ast::{
    AstKind,
    ast::{Argument, AssignmentTarget, Expression, Statement, VariableDeclarationKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const FETCH_CALLEE_NAMES: [&str; 5] = ["fetch", "ky", "got", "wretch", "ofetch"];
const FETCH_MEMBER_OBJECTS: [&str; 6] = ["axios", "ky", "got", "ofetch", "wretch", "request"];
const PROMISE_CONTINUATION_METHOD_NAMES: [&str; 3] = ["then", "catch", "finally"];
const MESSAGE: &str = "fetch() inside useEffect can race, double-fire, or leak. Use a data-fetching layer or Server Component instead.";

#[derive(Debug, Default, Clone)]
pub struct NoFetchInEffect;

declare_oxc_lint!(
    /// Disallow uncancelled network requests in effects.
    NoFetchInEffect,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Data fetching inside an effect.",
);

impl Rule for NoFetchInEffect {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx) {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(callback_id) = exact_local_function_id(
                callback_expression,
                ctx,
                &mut Vec::new(),
                &mut resolution_cache,
            ) else {
                continue;
            };
            let analysis_function_ids = fetch_effect_analysis_function_ids(callback_id, ctx);
            let requests = fetch_effect_network_requests(&analysis_function_ids, ctx);
            if requests.is_empty() {
                continue;
            }
            if let Some(cleanup_id) = fetch_effect_cleanup_function_id(callback_id, ctx)
                && fetch_effect_requests_have_correlated_cancellation(
                    &requests,
                    &analysis_function_ids,
                    callback_id,
                    cleanup_id,
                    ctx,
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(effect_call.span));
        }
    }
}

fn fetch_effect_analysis_function_ids(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<NodeId> {
    let mut function_ids = FxHashSet::default();
    let mut pending_function_ids = vec![callback_id];
    while let Some(function_id) = pending_function_ids.pop() {
        if !function_ids.insert(function_id) {
            continue;
        }
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            if let Some(called_function_id) =
                fetch_effect_resolve_local_function_id(&call.callee, ctx)
            {
                pending_function_ids.push(called_function_id);
            }
            for argument in &call.arguments {
                let Some(expression) = argument.as_expression() else {
                    continue;
                };
                if let Some(argument_function_id) =
                    fetch_effect_resolve_local_function_id(expression, ctx)
                {
                    pending_function_ids.push(argument_function_id);
                }
            }
        }
    }
    function_ids
}

fn fetch_effect_resolve_local_function_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
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
                    .and_then(fetch_effect_direct_function_id),
                _ => None,
            }
        }
        _ => None,
    }
}

fn fetch_effect_network_requests(
    function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    let mut requests = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let function_id = local_callback_nearest_function_id(candidate.id(), ctx)?;
            if !function_ids.contains(&function_id) {
                return None;
            }
            match candidate.kind() {
                AstKind::CallExpression(call) if fetch_effect_is_network_call(call, ctx) => {
                    Some(candidate.id())
                }
                AstKind::NewExpression(construction)
                    if matches!(construction.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "XMLHttpRequest") =>
                {
                    Some(candidate.id())
                }
                _ => None,
            }
        })
        .collect::<Vec<_>>();
    requests.sort_unstable_by_key(|request_id| ctx.nodes().get_node(*request_id).span().start);
    requests
}

fn fetch_effect_is_network_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier)
            if FETCH_CALLEE_NAMES.contains(&identifier.name.as_str()) =>
        {
            fetch_effect_identifier_is_unbound_or_imported(identifier, ctx)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if FETCH_MEMBER_OBJECTS.contains(&identifier.name.as_str())
                    && fetch_effect_identifier_is_unbound_or_imported(identifier, ctx))
        }),
    }
}

fn fetch_effect_identifier_is_unbound_or_imported<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    matches!(
        ctx.symbol_declaration(symbol_id).kind(),
        AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
    )
}

fn fetch_effect_cleanup_function_id(callback_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    if let AstKind::ArrowFunctionExpression(callback) = ctx.nodes().get_node(callback_id).kind()
        && let Some(expression) = callback.get_expression()
        && let Some(function_id) = fetch_effect_direct_function_id(expression)
    {
        return Some(function_id);
    }
    let mut cleanup = None;
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            continue;
        }
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if let Some(function_id) = return_statement
            .argument
            .as_ref()
            .and_then(fetch_effect_direct_function_id)
        {
            cleanup = Some(function_id);
        }
    }
    cleanup
}

fn fetch_effect_direct_function_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn fetch_effect_requests_have_correlated_cancellation(
    requests: &[NodeId],
    analysis_function_ids: &FxHashSet<NodeId>,
    callback_id: NodeId,
    cleanup_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let aborted_controller_keys = fetch_effect_cleanup_aborted_controller_keys(cleanup_id, ctx);
    let cancellation_flag_symbols = fetch_effect_cancellation_flag_symbols(callback_id, ctx);
    let assigned_flag_symbols =
        fetch_effect_cleanup_assigned_flag_symbols(cleanup_id, &cancellation_flag_symbols, ctx);
    let completion_sinks = fetch_effect_completion_sinks(analysis_function_ids, ctx);
    requests.iter().all(|request_id| {
        fetch_effect_request_controller_key(*request_id, ctx)
            .is_some_and(|key| aborted_controller_keys.contains(&key))
            || fetch_effect_request_has_guarded_completion_sinks(
                *request_id,
                &completion_sinks,
                &assigned_flag_symbols,
                ctx,
            )
    })
}

fn fetch_effect_cleanup_aborted_controller_keys(
    cleanup_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    let mut keys = FxHashSet::default();
    let cleanup_span = ctx.nodes().get_node(cleanup_id).span();
    for candidate in ctx.nodes().iter() {
        if !cleanup_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
            continue;
        };
        if member.property.name != "abort" {
            continue;
        }
        if let Some(key) = resolve_expression_key(&member.object, ctx, &mut Vec::new()) {
            keys.insert(key);
        }
    }
    keys
}

fn fetch_effect_cancellation_flag_symbols(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    let mut symbols = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
            continue;
        };
        let Some(binding) = declarator.id.get_binding_identifier() else {
            continue;
        };
        if !fetch_effect_name_is_cancellation_flag(&binding.name)
            || !matches!(declarator.init.as_ref().map(Expression::get_inner_expression), Some(Expression::BooleanLiteral(literal)) if !literal.value)
        {
            continue;
        }
        let declaration = ctx.nodes().parent_node(candidate.id());
        if !matches!(declaration.kind(), AstKind::VariableDeclaration(variable) if variable.kind == VariableDeclarationKind::Let)
        {
            continue;
        }
        let body = ctx.nodes().parent_node(declaration.id());
        if matches!(body.kind(), AstKind::FunctionBody(_))
            && ctx.nodes().parent_node(body.id()).id() == callback_id
        {
            symbols.insert(format!("symbol:{}", binding.symbol_id().index()));
        }
    }
    symbols
}

fn fetch_effect_name_is_cancellation_flag(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    lowercase.contains("cancel") || lowercase.contains("ignore")
}

fn fetch_effect_cleanup_assigned_flag_symbols(
    cleanup_id: NodeId,
    cancellation_flag_symbols: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    let mut assigned = FxHashSet::default();
    let cleanup_span = ctx.nodes().get_node(cleanup_id).span();
    for candidate in ctx.nodes().iter() {
        if !cleanup_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            continue;
        };
        if !matches!(assignment.right.get_inner_expression(), Expression::BooleanLiteral(literal) if literal.value)
        {
            continue;
        }
        let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
            continue;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            continue;
        };
        let key = format!("symbol:{}", symbol_id.index());
        if cancellation_flag_symbols.contains(&key) {
            assigned.insert(key);
        }
    }
    assigned
}

fn fetch_effect_completion_sinks(
    analysis_function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return None;
            };
            let function_id = local_callback_nearest_function_id(candidate.id(), ctx)?;
            let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                return None;
            };
            (analysis_function_ids.contains(&function_id)
                && callee.name.starts_with("set")
                && callee
                    .name
                    .as_bytes()
                    .get(3)
                    .is_some_and(u8::is_ascii_uppercase))
            .then_some(candidate.id())
        })
        .collect()
}

fn fetch_effect_request_controller_key(
    request_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let request_node = ctx.nodes().get_node(request_id);
    if matches!(request_node.kind(), AstKind::NewExpression(_)) {
        let parent = ctx.nodes().parent_node(request_id);
        let AstKind::VariableDeclarator(declarator) = parent.kind() else {
            return None;
        };
        if !declarator
            .init
            .as_ref()
            .is_some_and(|initializer| initializer.span() == request_node.span())
        {
            return None;
        }
        return declarator
            .id
            .get_binding_identifier()
            .map(|binding| format!("symbol:{}", binding.symbol_id().index()));
    }
    let AstKind::CallExpression(call) = request_node.kind() else {
        return None;
    };
    for argument in &call.arguments {
        let Some(expression) = argument.as_expression() else {
            continue;
        };
        let Some(options) = fetch_effect_resolve_const_value(expression, ctx, &mut Vec::new())
        else {
            continue;
        };
        let Expression::ObjectExpression(object) = options.get_inner_expression() else {
            continue;
        };
        for property in &object.properties {
            let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if property.key.static_name().as_deref() != Some("signal") {
                continue;
            }
            let key = resolve_expression_key(&property.value, ctx, &mut Vec::new())?;
            return key.strip_suffix(".signal").map(str::to_string);
        }
    }
    None
}

fn fetch_effect_resolve_const_value<'node, 'ast>(
    expression: &'node Expression<'ast>,
    ctx: &'node LintContext<'ast>,
    visited: &mut Vec<SymbolId>,
) -> Option<&'node Expression<'ast>> {
    let expression = expression.get_inner_expression();
    let Expression::Identifier(identifier) = expression else {
        return Some(expression);
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited.contains(&symbol_id) {
        return Some(expression);
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Some(expression);
    };
    if !matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
    {
        return Some(expression);
    }
    visited.push(symbol_id);
    fetch_effect_resolve_const_value(declarator.init.as_ref()?, ctx, visited)
}

fn fetch_effect_request_has_guarded_completion_sinks(
    request_id: NodeId,
    completion_sinks: &[NodeId],
    assigned_flag_symbols: &FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> bool {
    let following_sinks = completion_sinks
        .iter()
        .copied()
        .filter(|sink_id| fetch_effect_is_completion_sink_for_request(*sink_id, request_id, ctx))
        .collect::<Vec<_>>();
    !following_sinks.is_empty()
        && following_sinks.iter().all(|sink_id| {
            assigned_flag_symbols
                .iter()
                .any(|flag_key| fetch_effect_sink_is_cancellation_guarded(*sink_id, flag_key, ctx))
        })
}

fn fetch_effect_is_completion_sink_for_request(
    sink_id: NodeId,
    request_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(request_function_id) = local_callback_nearest_function_id(request_id, ctx) else {
        return false;
    };
    let Some(sink_function_id) = local_callback_nearest_function_id(sink_id, ctx) else {
        return false;
    };
    if request_function_id == sink_function_id {
        return ctx
            .nodes()
            .ancestors(request_id)
            .take_while(|ancestor| ancestor.id() != request_function_id)
            .any(|ancestor| matches!(ancestor.kind(), AstKind::AwaitExpression(_)))
            && ctx.nodes().get_node(sink_id).span().start
                > ctx.nodes().get_node(request_id).span().start;
    }
    let function_node = ctx.nodes().get_node(sink_function_id);
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(continuation_call) = parent.kind() else {
        return false;
    };
    if !continuation_call.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_node.span())
    }) {
        return false;
    }
    let Expression::StaticMemberExpression(member) =
        continuation_call.callee.get_inner_expression()
    else {
        return false;
    };
    PROMISE_CONTINUATION_METHOD_NAMES.contains(&member.property.name.as_str())
        && member
            .object
            .span()
            .contains_inclusive(ctx.nodes().get_node(request_id).span())
}

fn fetch_effect_sink_is_cancellation_guarded(
    sink_id: NodeId,
    flag_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let sink_span = ctx.nodes().get_node(sink_id).span();
    for ancestor in ctx.nodes().ancestors(sink_id) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement) => {
                let condition =
                    fetch_effect_read_cancellation_condition(&statement.test, flag_key, ctx);
                if statement.consequent.span().contains_inclusive(sink_span)
                    && condition == Some(false)
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span().contains_inclusive(sink_span))
                        && condition == Some(true)
                {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let condition =
                    fetch_effect_read_cancellation_condition(&expression.test, flag_key, ctx);
                if expression.consequent.span().contains_inclusive(sink_span)
                    && condition == Some(false)
                    || expression.alternate.span().contains_inclusive(sink_span)
                        && condition == Some(true)
                {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(sink_span) =>
            {
                let condition =
                    fetch_effect_read_cancellation_condition(&expression.left, flag_key, ctx);
                if expression.operator == LogicalOperator::And && condition == Some(false)
                    || expression.operator == LogicalOperator::Or && condition == Some(true)
                {
                    return true;
                }
            }
            AstKind::BlockStatement(block) => {
                let Some(statement_index) = block
                    .body
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(sink_span))
                else {
                    continue;
                };
                if block.body[..statement_index].iter().any(|previous| {
                    let Statement::IfStatement(statement) = previous else {
                        return false;
                    };
                    let condition =
                        fetch_effect_read_cancellation_condition(&statement.test, flag_key, ctx);
                    condition == Some(true) && statement_always_exits(&statement.consequent)
                        || condition == Some(false)
                            && statement
                                .alternate
                                .as_ref()
                                .is_some_and(|alternate| statement_always_exits(alternate))
                }) {
                    return true;
                }
            }
            AstKind::FunctionBody(body) => {
                let Some(statement_index) = body
                    .statements
                    .iter()
                    .position(|statement| statement.span().contains_inclusive(sink_span))
                else {
                    continue;
                };
                if body.statements[..statement_index].iter().any(|previous| {
                    let Statement::IfStatement(statement) = previous else {
                        return false;
                    };
                    let condition =
                        fetch_effect_read_cancellation_condition(&statement.test, flag_key, ctx);
                    condition == Some(true) && statement_always_exits(&statement.consequent)
                        || condition == Some(false)
                            && statement
                                .alternate
                                .as_ref()
                                .is_some_and(|alternate| statement_always_exits(alternate))
                }) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn fetch_effect_read_cancellation_condition(
    expression: &Expression<'_>,
    flag_key: &str,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        expression
            if resolve_expression_key(expression, ctx, &mut Vec::new()).as_deref()
                == Some(flag_key) =>
        {
            Some(true)
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            fetch_effect_read_cancellation_condition(&unary.argument, flag_key, ctx)
                .map(|value| !value)
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            let left = fetch_effect_read_cancellation_condition(&binary.left, flag_key, ctx);
            let right = fetch_effect_read_cancellation_condition(&binary.right, flag_key, ctx);
            let left_boolean = match binary.left.get_inner_expression() {
                Expression::BooleanLiteral(literal) => Some(literal.value),
                _ => None,
            };
            let right_boolean = match binary.right.get_inner_expression() {
                Expression::BooleanLiteral(literal) => Some(literal.value),
                _ => None,
            };
            let compared_value = match (left, right, left_boolean, right_boolean) {
                (Some(_), _, _, Some(value)) => value,
                (_, Some(_), Some(value), _) => value,
                _ => return None,
            };
            Some(match binary.operator {
                BinaryOperator::Equality | BinaryOperator::StrictEquality => compared_value,
                _ => !compared_value,
            })
        }
        _ => None,
    }
}
