use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, CallExpression, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::{node::NodeId, operator::UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

static VERSIONED_KEY_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)(?:[._:-]v[0-9]+|@[0-9]+|\bv[0-9]+\b)");
static CAMEL_CASE_VERSIONED_KEY_PATTERN: Lazy<Regex> = lazy_regex!(r"[a-z]V[0-9]+");

#[derive(Debug, Default, Clone)]
pub struct ClientLocalstorageNoVersion;

struct PendingStorageWrite {
    key: String,
    key_span: Span,
}

declare_oxc_lint!(
    /// Require versioned localStorage keys for JSON payloads.
    ClientLocalstorageNoVersion,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require versioned localStorage keys for JSON payloads.",
);

impl Rule for ClientLocalstorageNoVersion {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let pending_writes = collect_unversioned_json_storage_writes(ctx);
        if pending_writes.is_empty() {
            return;
        }
        let safely_validated_keys = collect_safely_validated_local_storage_keys(ctx);
        for pending_write in pending_writes {
            if safely_validated_keys.contains(&pending_write.key) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "localStorage.setItem(\"{}\", JSON.stringify(...)) has no version, so changing the data shape later crashes your users' saved sessions. Add one to the key (e.g. \"{}:v1\").",
                    pending_write.key, pending_write.key
                ))
                .with_label(pending_write.key_span),
            );
        }
    }
}

fn collect_unversioned_json_storage_writes(ctx: &LintContext<'_>) -> Vec<PendingStorageWrite> {
    let mut pending_writes = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !is_local_storage_method_call(call_expression, "setItem") {
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
            .map(Expression::get_inner_expression)
        else {
            continue;
        };
        let Expression::CallExpression(stringify_call) = value_expression else {
            continue;
        };
        if !is_json_stringify_call(stringify_call) {
            continue;
        }
        let Some(key) = resolve_local_storage_string_key(key_expression, ctx) else {
            continue;
        };
        if is_versioned_local_storage_key(&key) {
            continue;
        }
        pending_writes.push(PendingStorageWrite {
            key,
            key_span: key_expression.span(),
        });
    }
    pending_writes
}

fn is_versioned_local_storage_key(key: &str) -> bool {
    VERSIONED_KEY_PATTERN.is_match(key) || CAMEL_CASE_VERSIONED_KEY_PATTERN.is_match(key)
}

fn is_json_stringify_call(call_expression: &CallExpression<'_>) -> bool {
    let Expression::StaticMemberExpression(member_expression) =
        call_expression.callee.get_inner_expression()
    else {
        return false;
    };
    matches!(
        member_expression.object.get_inner_expression(),
        Expression::Identifier(receiver)
            if receiver.name == "JSON" && member_expression.property.name == "stringify"
    )
}

fn is_json_parse_call(call_expression: &CallExpression<'_>) -> bool {
    let Expression::StaticMemberExpression(member_expression) =
        call_expression.callee.get_inner_expression()
    else {
        return false;
    };
    matches!(
        member_expression.object.get_inner_expression(),
        Expression::Identifier(receiver)
            if receiver.name == "JSON" && member_expression.property.name == "parse"
    )
}

fn is_local_storage_method_call(call_expression: &CallExpression<'_>, method_name: &str) -> bool {
    let Expression::StaticMemberExpression(member_expression) =
        call_expression.callee.get_inner_expression()
    else {
        return false;
    };
    matches!(
        member_expression.object.get_inner_expression(),
        Expression::Identifier(receiver)
            if receiver.name == "localStorage" && member_expression.property.name == method_name
    )
}

fn resolve_local_storage_string_key(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match expression {
        Expression::StringLiteral(string_literal) => Some(string_literal.value.to_string()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
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
            let Expression::StringLiteral(string_literal) = declarator.init.as_ref()? else {
                return None;
            };
            Some(string_literal.value.to_string())
        }
        _ => None,
    }
}

fn collect_safely_validated_local_storage_keys(ctx: &LintContext<'_>) -> FxHashSet<String> {
    let mut read_counts_by_key = FxHashMap::<String, usize>::default();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !is_local_storage_method_call(call_expression, "getItem") {
            continue;
        }
        let Some(key) = call_expression
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(|expression| resolve_local_storage_string_key(expression, ctx))
        else {
            continue;
        };
        *read_counts_by_key.entry(key).or_default() += 1;
    }

    let mut safe_read_counts_by_key = FxHashMap::<String, usize>::default();
    let mut safe_read_symbol_ids = FxHashSet::<SymbolId>::default();
    for node in ctx.nodes().iter() {
        let AstKind::TryStatement(try_statement) = node.kind() else {
            continue;
        };
        let Some(handler) = &try_statement.handler else {
            continue;
        };
        if !catch_returns_storage_fallback(handler, ctx) {
            continue;
        }
        let try_function_owner = nearest_storage_function_node_id(node.id(), ctx);
        let mut raw_value_keys = FxHashMap::<SymbolId, String>::default();
        let mut parsed_value_sources = FxHashMap::<SymbolId, SymbolId>::default();
        for candidate in ctx.nodes().iter() {
            if !try_statement
                .block
                .span
                .contains_inclusive(candidate.span())
                || nearest_storage_function_node_id(candidate.id(), ctx) != try_function_owner
            {
                continue;
            }
            if let AstKind::VariableDeclarator(declarator) = candidate.kind()
                && let Some(binding) = declarator.id.get_binding_identifier()
                && let Some(initializer) = declarator.init.as_ref()
            {
                let initializer = initializer.get_inner_expression();
                if let Expression::CallExpression(get_item_call) = initializer
                    && is_local_storage_method_call(get_item_call, "getItem")
                    && let Some(key) = get_item_call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .and_then(|expression| resolve_local_storage_string_key(expression, ctx))
                {
                    raw_value_keys.insert(binding.symbol_id(), key);
                }
                if let Expression::CallExpression(parse_call) = initializer
                    && is_json_parse_call(parse_call)
                    && let Some(Expression::Identifier(raw_value_identifier)) = parse_call
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                    && let Some(raw_value_symbol_id) = ctx
                        .scoping()
                        .get_reference(raw_value_identifier.reference_id())
                        .symbol_id()
                    && raw_value_keys.contains_key(&raw_value_symbol_id)
                {
                    parsed_value_sources.insert(binding.symbol_id(), raw_value_symbol_id);
                }
            }
            let AstKind::ConditionalExpression(conditional_expression) = candidate.kind() else {
                continue;
            };
            let parent = ctx.nodes().parent_node(candidate.id());
            if !matches!(
                parent.kind(),
                AstKind::ReturnStatement(return_statement)
                    if return_statement.argument.as_ref().is_some_and(|argument| {
                        argument.span() == conditional_expression.span
                    })
            ) {
                continue;
            }
            let Expression::CallExpression(validator_call) =
                conditional_expression.test.get_inner_expression()
            else {
                continue;
            };
            let Some(Expression::Identifier(tested_value)) = validator_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(parsed_value_symbol_id) = ctx
                .scoping()
                .get_reference(tested_value.reference_id())
                .symbol_id()
            else {
                continue;
            };
            let Some(raw_value_symbol_id) =
                parsed_value_sources.get(&parsed_value_symbol_id).copied()
            else {
                continue;
            };
            let Expression::Identifier(returned_value) =
                conditional_expression.consequent.get_inner_expression()
            else {
                continue;
            };
            if ctx
                .scoping()
                .get_reference(returned_value.reference_id())
                .symbol_id()
                != Some(parsed_value_symbol_id)
            {
                continue;
            }
            let Some(validator_function_id) =
                resolve_storage_validator_function_id(&validator_call.callee, ctx)
            else {
                continue;
            };
            if !storage_validator_checks_payload_properties(validator_function_id, ctx) {
                continue;
            }
            let Some(key) = raw_value_keys.get(&raw_value_symbol_id) else {
                continue;
            };
            if safe_read_symbol_ids.insert(raw_value_symbol_id) {
                *safe_read_counts_by_key.entry(key.clone()).or_default() += 1;
            }
        }
    }

    read_counts_by_key
        .into_iter()
        .filter_map(|(key, read_count)| {
            (safe_read_counts_by_key.get(&key).copied() == Some(read_count)).then_some(key)
        })
        .collect()
}

fn catch_returns_storage_fallback(
    handler: &oxc_ast::ast::CatchClause<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let handler_function_owner = nearest_storage_function_node_id(handler.node_id.get(), ctx);
    let mut has_return = false;
    let mut has_throw = false;
    for candidate in ctx.nodes().iter() {
        if !handler.body.span.contains_inclusive(candidate.span())
            || nearest_storage_function_node_id(candidate.id(), ctx) != handler_function_owner
        {
            continue;
        }
        match candidate.kind() {
            AstKind::ReturnStatement(_) => has_return = true,
            AstKind::ThrowStatement(_) => has_throw = true,
            _ => {}
        }
    }
    has_return && !has_throw
}

fn resolve_storage_validator_function_id(
    callee: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let Expression::Identifier(identifier) = callee.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(function.node_id.get()),
        AstKind::VariableDeclarator(declarator) => match declarator.init.as_ref()? {
            Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
            Expression::FunctionExpression(function) => Some(function.node_id.get()),
            _ => None,
        },
        _ => None,
    }
}

fn storage_validator_checks_payload_properties(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    let (parameters, body_span) = match function_node.kind() {
        AstKind::Function(function) => (
            function.params.as_ref(),
            function.body.as_ref().map(|body| body.span),
        ),
        AstKind::ArrowFunctionExpression(function) => {
            (function.params.as_ref(), Some(function.body.span()))
        }
        _ => return false,
    };
    let Some(body_span) = body_span else {
        return false;
    };
    let Some(first_parameter) = parameters.items.first() else {
        return false;
    };
    let BindingPattern::BindingIdentifier(parameter_binding) = &first_parameter.pattern else {
        return false;
    };
    let mut payload_symbol_ids = FxHashSet::from_iter([parameter_binding.symbol_id()]);
    for candidate in ctx.nodes().iter() {
        if !body_span.contains_inclusive(candidate.span())
            || nearest_storage_function_node_id(candidate.id(), ctx) != Some(function_id)
        {
            continue;
        }
        if let AstKind::VariableDeclarator(declarator) = candidate.kind()
            && let Some(alias_binding) = declarator.id.get_binding_identifier()
            && let Some(Expression::Identifier(initializer)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            && let Some(initializer_symbol_id) = ctx
                .scoping()
                .get_reference(initializer.reference_id())
                .symbol_id()
            && payload_symbol_ids.contains(&initializer_symbol_id)
        {
            payload_symbol_ids.insert(alias_binding.symbol_id());
        }
        let AstKind::UnaryExpression(unary_expression) = candidate.kind() else {
            continue;
        };
        if unary_expression.operator != UnaryOperator::Typeof {
            continue;
        }
        let Some(member_expression) = unary_expression
            .argument
            .get_inner_expression()
            .as_member_expression()
        else {
            continue;
        };
        let Expression::Identifier(receiver) = member_expression.object().get_inner_expression()
        else {
            continue;
        };
        if ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| payload_symbol_ids.contains(&symbol_id))
        {
            return true;
        }
    }
    false
}

fn nearest_storage_function_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
