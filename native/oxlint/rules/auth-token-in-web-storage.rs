use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::{node::NodeId, operator::LogicalOperator};
use rustc_hash::FxHashMap;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Storing an auth token in `localStorage`/`sessionStorage` exposes it to any XSS on the page: JavaScript can read web storage and exfiltrate the token. Keep tokens in an `HttpOnly`, `Secure`, `SameSite` cookie instead.";
const STORAGE_NAMES: [&str; 2] = ["localStorage", "sessionStorage"];
const STORAGE_GLOBALS: [&str; 3] = ["window", "globalThis", "self"];

static SENSITIVE_KEY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)token|jwt|secret|password|passwd|credential|api[-_]?key|bearer|private[-_]?key"
);
static NON_AUTH_TOKEN_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)csrf|xsrf|device|fcm|apns|push|design|tokeniz|syntax|css|theme|color");
static STRONG_AUTH_KEY_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u)jwt|secret|password|passwd|credential|private[-_]?key|api[-_]?key|bearer|access[-_]?token|refresh[-_]?token|auth[-_]?token|id[-_]?token|session"
);

#[derive(Debug, Default, Clone)]
pub struct AuthTokenInWebStorage;

#[derive(Clone, Copy)]
struct StorageHelperSink {
    key_parameter_index: usize,
    value_parameter_index: usize,
}

declare_oxc_lint!(
    /// Disallow storing authentication credentials in web storage.
    AuthTokenInWebStorage,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow storing authentication credentials in web storage.",
);

impl Rule for AuthTokenInWebStorage {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let mut helper_sink_cache = FxHashMap::<NodeId, Vec<StorageHelperSink>>::default();
        for node in ctx.nodes().iter() {
            inspect_storage_write(node, ctx, &mut helper_sink_cache);
        }
    }
}

fn inspect_storage_write<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    helper_sink_cache: &mut FxHashMap<NodeId, Vec<StorageHelperSink>>,
) {
    match node.kind() {
        AstKind::CallExpression(call_expression) => {
            let callee = call_expression.callee.get_inner_expression();
            let mut key_arguments = Vec::new();
            if let Expression::StaticMemberExpression(member_expression) = callee
                && member_expression.property.name == "setItem"
                && is_web_storage_object(
                    member_expression.object.get_inner_expression(),
                    ctx,
                    &mut Vec::new(),
                )
            {
                if let Some(key_argument) = call_expression
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                {
                    key_arguments.push(key_argument);
                }
            } else if let Expression::Identifier(identifier) = callee
                && let Some(function_id) = function_id_for_identifier(identifier, ctx)
            {
                let helper_sinks = helper_sink_cache
                    .entry(function_id)
                    .or_insert_with(|| find_storage_helper_sinks(function_id, ctx));
                for sink in helper_sinks {
                    let key_argument = call_expression
                        .arguments
                        .get(sink.key_parameter_index)
                        .and_then(Argument::as_expression);
                    let value_argument = call_expression
                        .arguments
                        .get(sink.value_parameter_index)
                        .and_then(Argument::as_expression);
                    if let (Some(key_argument), Some(_)) = (key_argument, value_argument) {
                        key_arguments.push(key_argument);
                    }
                }
            }
            if key_arguments.iter().any(|key_argument| {
                resolve_static_key_string(key_argument, ctx)
                    .is_some_and(|key| is_auth_credential_key(&key))
            }) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
            }
        }
        AstKind::AssignmentExpression(assignment_expression) => {
            let Some(member_expression) = assignment_expression.left.as_member_expression() else {
                return;
            };
            if !is_web_storage_object(
                member_expression.object().get_inner_expression(),
                ctx,
                &mut Vec::new(),
            ) {
                return;
            }
            let Some(property_name) = static_member_name(member_expression) else {
                return;
            };
            if is_auth_credential_key(property_name) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(member_expression.span()));
            }
        }
        _ => {}
    }
}

fn is_auth_credential_key(key: &str) -> bool {
    SENSITIVE_KEY_PATTERN.is_match(key)
        && (!NON_AUTH_TOKEN_PATTERN.is_match(key) || STRONG_AUTH_KEY_PATTERN.is_match(key))
}

fn is_direct_web_storage_object(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::Identifier(identifier) => STORAGE_NAMES.contains(&identifier.name.as_str()),
        Expression::StaticMemberExpression(member_expression) => {
            matches!(
                &member_expression.object,
                Expression::Identifier(global) if STORAGE_GLOBALS.contains(&global.name.as_str())
            ) && STORAGE_NAMES.contains(&member_expression.property.name.as_str())
        }
        _ => false,
    }
}

fn is_web_storage_object<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if is_direct_web_storage_object(expression) {
        return true;
    }
    match expression {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = reference_symbol_id(identifier, ctx) else {
                return false;
            };
            if visited_symbol_ids.contains(&symbol_id) {
                return false;
            }
            let Some(initializer) = const_symbol_initializer(symbol_id, ctx) else {
                return false;
            };
            visited_symbol_ids.push(symbol_id);
            let is_storage = is_web_storage_object(initializer, ctx, visited_symbol_ids);
            visited_symbol_ids.pop();
            is_storage
        }
        Expression::CallExpression(call_expression) => {
            let Expression::Identifier(callee) = call_expression.callee.get_inner_expression()
            else {
                return false;
            };
            let Some(callee_symbol_id) = reference_symbol_id(callee, ctx) else {
                return false;
            };
            if visited_symbol_ids.contains(&callee_symbol_id) {
                return false;
            }
            let Some(function_id) = function_id_for_identifier(callee, ctx) else {
                return false;
            };
            visited_symbol_ids.push(callee_symbol_id);
            let returns_storage =
                function_returns_web_storage(function_id, ctx, visited_symbol_ids);
            visited_symbol_ids.pop();
            returns_storage
        }
        _ => false,
    }
}

fn is_web_storage_factory_result<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if is_web_storage_object(expression, ctx, &mut visited_symbol_ids.clone()) {
        return true;
    }
    match expression {
        Expression::ConditionalExpression(conditional_expression) => {
            let consequent = conditional_expression.consequent.get_inner_expression();
            let alternate = conditional_expression.alternate.get_inner_expression();
            let consequent_is_nullish = is_nullish_expression(consequent);
            let alternate_is_nullish = is_nullish_expression(alternate);
            (consequent_is_nullish
                || is_web_storage_factory_result(consequent, ctx, &mut visited_symbol_ids.clone()))
                && (alternate_is_nullish
                    || is_web_storage_factory_result(
                        alternate,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    ))
                && (!consequent_is_nullish || !alternate_is_nullish)
        }
        Expression::LogicalExpression(logical_expression) => {
            if logical_expression.operator == LogicalOperator::And {
                return is_web_storage_factory_result(
                    logical_expression.right.get_inner_expression(),
                    ctx,
                    visited_symbol_ids,
                );
            }
            let left = logical_expression.left.get_inner_expression();
            let right = logical_expression.right.get_inner_expression();
            let left_is_storage =
                is_web_storage_factory_result(left, ctx, &mut visited_symbol_ids.clone());
            let right_is_storage =
                is_web_storage_factory_result(right, ctx, &mut visited_symbol_ids.clone());
            (left_is_storage || is_nullish_expression(left))
                && (right_is_storage || is_nullish_expression(right))
                && (left_is_storage || right_is_storage)
        }
        _ => false,
    }
}

fn function_returns_web_storage(
    function_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return is_web_storage_factory_result(expression, ctx, visited_symbol_ids);
    }
    let body_span = match function_node.kind() {
        AstKind::Function(function) => function.body.as_ref().map(|body| body.span),
        AstKind::ArrowFunctionExpression(function) => Some(function.body.span()),
        _ => None,
    };
    let Some(body_span) = body_span else {
        return false;
    };
    let mut did_return_web_storage = false;
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if !body_span.contains_inclusive(candidate.span())
            || nearest_enclosing_function_id(candidate, ctx) != Some(function_id)
        {
            continue;
        }
        let Some(argument) = return_statement.argument.as_ref() else {
            continue;
        };
        if is_nullish_expression(argument.get_inner_expression()) {
            continue;
        }
        if !is_web_storage_factory_result(argument, ctx, visited_symbol_ids) {
            return false;
        }
        did_return_web_storage = true;
    }
    did_return_web_storage
}

fn find_storage_helper_sinks(function_id: NodeId, ctx: &LintContext<'_>) -> Vec<StorageHelperSink> {
    let function_node = ctx.nodes().get_node(function_id);
    let (parameters, body_span) = match function_node.kind() {
        AstKind::Function(function) => (
            function.params.as_ref(),
            function.body.as_ref().map(|body| body.span),
        ),
        AstKind::ArrowFunctionExpression(function) => {
            (function.params.as_ref(), Some(function.body.span()))
        }
        _ => return Vec::new(),
    };
    let Some(body_span) = body_span else {
        return Vec::new();
    };
    let parameter_symbol_ids = parameters
        .items
        .iter()
        .map(|parameter| {
            parameter
                .pattern
                .get_binding_identifier()
                .map(|identifier| identifier.symbol_id())
        })
        .collect::<Vec<_>>();
    let mut sinks = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        if !body_span.contains_inclusive(candidate.span())
            || nearest_enclosing_function_id(candidate, ctx) != Some(function_id)
        {
            continue;
        }
        let Expression::StaticMemberExpression(member_expression) =
            call_expression.callee.get_inner_expression()
        else {
            continue;
        };
        if member_expression.property.name != "setItem"
            || !is_web_storage_object(
                member_expression.object.get_inner_expression(),
                ctx,
                &mut Vec::new(),
            )
        {
            continue;
        }
        let Some(key_expression) = call_expression
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        let Some(value_expression) = call_expression
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        let Some(key_parameter_index) = parameter_index(
            key_expression,
            &parameter_symbol_ids,
            false,
            ctx,
            &mut Vec::new(),
        ) else {
            continue;
        };
        let Some(value_parameter_index) = parameter_index(
            value_expression,
            &parameter_symbol_ids,
            true,
            ctx,
            &mut Vec::new(),
        ) else {
            continue;
        };
        sinks.push(StorageHelperSink {
            key_parameter_index,
            value_parameter_index,
        });
    }
    sinks
}

fn parameter_index<'a>(
    expression: &'a Expression<'a>,
    parameter_symbol_ids: &[Option<oxc_semantic::SymbolId>],
    can_unwrap_serialization: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<usize> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let symbol_id = reference_symbol_id(identifier, ctx)?;
        if let Some(index) = parameter_symbol_ids
            .iter()
            .position(|parameter_symbol_id| *parameter_symbol_id == Some(symbol_id))
        {
            return Some(index);
        }
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        let initializer = const_symbol_initializer(symbol_id, ctx)?;
        visited_symbol_ids.push(symbol_id);
        let index = parameter_index(
            initializer,
            parameter_symbol_ids,
            can_unwrap_serialization,
            ctx,
            visited_symbol_ids,
        );
        visited_symbol_ids.pop();
        return index;
    }
    if can_unwrap_serialization
        && let Expression::CallExpression(call_expression) = expression
        && let Expression::StaticMemberExpression(member_expression) =
            call_expression.callee.get_inner_expression()
        && matches!(&member_expression.object, Expression::Identifier(identifier) if identifier.name == "JSON")
        && member_expression.property.name == "stringify"
    {
        return call_expression
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|argument| {
                parameter_index(
                    argument,
                    parameter_symbol_ids,
                    true,
                    ctx,
                    visited_symbol_ids,
                )
            });
    }
    None
}

fn function_id_for_identifier(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let mut symbol_id = reference_symbol_id(identifier, ctx)?;
    let mut visited_symbol_ids = Vec::new();
    loop {
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        visited_symbol_ids.push(symbol_id);
        let declaration = ctx.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Function(function) => return Some(function.node_id.get()),
            AstKind::VariableDeclarator(declarator) => {
                let parent = ctx.nodes().parent_node(declaration.id());
                if !matches!(
                    parent.kind(),
                    AstKind::VariableDeclaration(variable_declaration)
                        if variable_declaration.kind.is_const()
                ) || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding| binding.symbol_id() != symbol_id)
                {
                    return None;
                }
                match declarator.init.as_ref()?.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => {
                        return Some(function.node_id.get());
                    }
                    Expression::FunctionExpression(function) => {
                        return Some(function.node_id.get());
                    }
                    Expression::Identifier(alias) => symbol_id = reference_symbol_id(alias, ctx)?,
                    _ => return None,
                }
            }
            _ => return None,
        }
    }
}

fn const_symbol_initializer<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    declarator.init.as_ref()
}

fn resolve_static_key_string(expression: &Expression<'_>, ctx: &LintContext<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(string_literal) => Some(string_literal.value.to_string()),
        Expression::TemplateLiteral(template_literal)
            if template_literal.expressions.is_empty() && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            Some(quasi.value.cooked.as_ref()?.to_string())
        }
        Expression::Identifier(identifier) if identifier.name != "undefined" => {
            let symbol_id = reference_symbol_id(identifier, ctx)?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let initializer = declarator.init.as_ref()?;
            if matches!(initializer, Expression::Identifier(_)) {
                return None;
            }
            resolve_static_key_string(initializer, ctx)
        }
        _ => None,
    }
}

fn static_member_name<'a>(member_expression: &'a MemberExpression<'a>) -> Option<&'a str> {
    match member_expression {
        MemberExpression::StaticMemberExpression(member_expression) => {
            Some(member_expression.property.name.as_str())
        }
        MemberExpression::ComputedMemberExpression(member_expression) => {
            let Expression::StringLiteral(property) = &member_expression.expression else {
                return None;
            };
            Some(property.value.as_str())
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn nearest_enclosing_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node.id())
        .find_map(|ancestor| match ancestor.kind() {
            AstKind::Function(function) => Some(function.node_id.get()),
            AstKind::ArrowFunctionExpression(function) => Some(function.node_id.get()),
            _ => None,
        })
}

fn reference_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}
