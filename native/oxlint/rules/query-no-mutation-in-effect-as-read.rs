use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ACKNOWLEDGEMENT_FIELD_NAMES: [&str; 7] = [
    "code", "error", "errors", "message", "ok", "status", "success",
];
const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const READ_INTENT_WORDS: [&str; 11] = [
    "check", "fetch", "find", "get", "list", "load", "lookup", "query", "read", "retrieve",
    "search",
];
const WRITE_INTENT_WORDS: [&str; 16] = [
    "add", "create", "delete", "insert", "mutate", "patch", "post", "put", "remove", "save",
    "send", "set", "submit", "update", "upload", "write",
];
const TANSTACK_QUERY_MODULE_SOURCES: [&str; 2] = ["@tanstack/react-query", "react-query"];
const MESSAGE: &str = "This `useMutation` call is driven from an effect and its response is consumed as read data, so the result is neither cached nor deduplicated like a query.";

#[derive(Clone, Copy)]
struct StatusTarget {
    symbol_id: oxc_semantic::SymbolId,
    property_name: Option<&'static str>,
    source_property_name: &'static str,
}

#[derive(Clone)]
struct EffectFunctionPath {
    function_id: oxc_semantic::NodeId,
    invocation_node_ids: Vec<oxc_semantic::NodeId>,
    function_ids: Vec<oxc_semantic::NodeId>,
}

#[derive(Debug, Default, Clone)]
pub struct QueryNoMutationInEffectAsRead;

declare_oxc_lint!(
    /// Disallow using an effect-driven mutation as a read.
    QueryNoMutationInEffectAsRead,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow using an effect-driven mutation as a read.",
);

impl Rule for QueryNoMutationInEffectAsRead {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let effect_function_paths = collect_effect_function_paths(ctx);
        if effect_function_paths.is_empty() {
            return;
        }
        for declaration_node in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = declaration_node.kind() else {
                continue;
            };
            let Some(Expression::CallExpression(initializer)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                continue;
            };
            if !module_api_path_matches(
                &initializer.callee,
                &["useMutation"],
                &TANSTACK_QUERY_MODULE_SOURCES,
                false,
                ctx,
            ) || !declarator_has_read_intent(declarator, initializer, ctx)
            {
                continue;
            }

            let result_symbol_ids = mutation_result_symbol_ids(declarator, ctx);
            let method_symbol_ids = mutation_method_symbol_ids(declarator, &result_symbol_ids, ctx);
            let status_targets = mutation_status_targets(declarator, &result_symbol_ids, ctx);
            let has_shared_consumer =
                mutation_data_is_consumed(declarator, &result_symbol_ids, ctx)
                    || options_consume_response(
                        initializer
                            .arguments
                            .first()
                            .and_then(|argument| argument.as_expression()),
                        ctx,
                    );

            for call_node in ctx.nodes().iter() {
                let AstKind::CallExpression(call_expression) = call_node.kind() else {
                    continue;
                };
                let Some(function_node) = crate::ast_util::get_enclosing_function(call_node, ctx)
                else {
                    continue;
                };
                if !is_mutation_method_call(
                    call_expression,
                    &result_symbol_ids,
                    &method_symbol_ids,
                    ctx,
                ) {
                    continue;
                }
                let has_active_effect_path = effect_function_paths.iter().any(|path| {
                    path.function_id == function_node.id()
                        && !path_has_run_once_latch(call_node, ctx)
                        && !path_has_status_guard(call_node, &status_targets, ctx)
                        && path.invocation_node_ids.iter().all(|node_id| {
                            let invocation_node = ctx.nodes().get_node(*node_id);
                            !path_has_run_once_latch(invocation_node, ctx)
                                && !path_has_status_guard(invocation_node, &status_targets, ctx)
                        })
                });
                if !has_active_effect_path {
                    continue;
                }
                if !has_shared_consumer
                    && !mutation_call_result_is_consumed(call_node, call_expression, ctx)
                {
                    continue;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(initializer.span));
                break;
            }
        }
    }
}

fn collect_effect_function_paths(ctx: &LintContext<'_>) -> Vec<EffectFunctionPath> {
    let mut effect_function_paths = Vec::new();
    for node in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            continue;
        };
        if !is_react_hook_call(call_expression, &EFFECT_HOOK_NAMES, ctx) {
            continue;
        }
        let Some(callback_expression) = call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            continue;
        };
        let mut callback_ids = Vec::new();
        collect_selected_effect_callback_ids(callback_expression, ctx, &mut callback_ids);
        effect_function_paths.extend(callback_ids.into_iter().map(|callback_id| {
            EffectFunctionPath {
                function_id: callback_id,
                invocation_node_ids: Vec::new(),
                function_ids: vec![callback_id],
            }
        }));
    }
    let mut pending_function_paths = effect_function_paths.clone();
    while let Some(function_path) = pending_function_paths.pop() {
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx)
                != Some(function_path.function_id)
            {
                continue;
            }
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            if let Some(called_function_id) =
                exact_local_callback_function_id(&call_expression.callee, ctx, &mut Vec::new())
                && !function_path.function_ids.contains(&called_function_id)
            {
                let mut called_function_path = function_path.clone();
                called_function_path.function_id = called_function_id;
                called_function_path
                    .invocation_node_ids
                    .push(candidate.id());
                called_function_path.function_ids.push(called_function_id);
                effect_function_paths.push(called_function_path.clone());
                pending_function_paths.push(called_function_path);
            }
        }
    }
    effect_function_paths
}

fn collect_selected_effect_callback_ids<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    callback_ids: &mut Vec<oxc_semantic::NodeId>,
) {
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            collect_selected_effect_callback_ids(&conditional.consequent, ctx, callback_ids);
            collect_selected_effect_callback_ids(&conditional.alternate, ctx, callback_ids);
        }
        Expression::LogicalExpression(logical) => {
            collect_selected_effect_callback_ids(&logical.right, ctx, callback_ids);
            if logical.operator != oxc_syntax::operator::LogicalOperator::And {
                collect_selected_effect_callback_ids(&logical.left, ctx, callback_ids);
            }
        }
        Expression::SequenceExpression(sequence) => {
            if let Some(last_expression) = sequence.expressions.last() {
                collect_selected_effect_callback_ids(last_expression, ctx, callback_ids);
            }
        }
        expression => {
            let Some((_, callback_span)) = resolve_local_react_callback(expression, ctx) else {
                return;
            };
            if let Some(callback_id) = ctx.nodes().iter().find_map(|candidate| {
                (candidate.span() == callback_span
                    && matches!(
                        candidate.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    ))
                .then_some(candidate.id())
            }) {
                callback_ids.push(callback_id);
            }
        }
    }
}

fn declarator_has_read_intent<'a>(
    declarator: &oxc_ast::ast::VariableDeclarator<'_>,
    initializer: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut names = Vec::new();
    if let BindingPattern::BindingIdentifier(identifier) = &declarator.id {
        names.push(identifier.name.to_string());
    }
    for property_name in ["mutate", "mutateAsync"] {
        for symbol_id in binding_symbols_for_property(&declarator.id, property_name) {
            names.push(ctx.scoping().symbol_name(symbol_id).to_string());
        }
    }
    if let Some(name) = mutation_function_name(initializer, ctx) {
        names.push(name.to_string());
    }
    !names.iter().any(|name| has_write_intent_name(name))
        && names.iter().any(|name| has_read_intent_name(name))
}

fn mutation_function_name<'a>(
    initializer: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    let argument = initializer.arguments.first()?.as_expression()?;
    if let Some(options) = resolve_options_object(argument, ctx, &mut FxHashSet::default()) {
        let mutation_function = options.properties.iter().find_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            (property.key.static_name().as_deref() == Some("mutationFn")).then_some(&property.value)
        })?;
        return expression_binding_name(mutation_function, ctx);
    }
    expression_binding_name(argument, ctx)
}

fn expression_binding_name<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            matches!(
                declaration.kind(),
                AstKind::Function(_) | AstKind::VariableDeclarator(_)
            )
            .then_some(identifier.name.as_str())
        }
        expression => expression
            .as_member_expression()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name),
    }
}

fn has_read_intent_name(name: &str) -> bool {
    let words = tokenize_query_identifier_words(name);
    if words
        .windows(2)
        .any(|words| words[0] == "check" && matches!(words[1].as_str(), "in" | "out"))
    {
        return false;
    }
    words.iter().enumerate().any(|(index, word)| {
        (word == "list" && index == 0)
            || (word != "list" && READ_INTENT_WORDS.contains(&word.as_str()))
    })
}

fn has_write_intent_name(name: &str) -> bool {
    tokenize_query_identifier_words(name)
        .iter()
        .any(|word| WRITE_INTENT_WORDS.contains(&word.as_str()))
}

fn tokenize_query_identifier_words(name: &str) -> Vec<String> {
    let characters = name.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        if !characters[index].is_ascii_alphanumeric() {
            index += 1;
            continue;
        }
        let start = index;
        if characters[index].is_ascii_digit() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_digit() {
                index += 1;
            }
        } else if characters[index].is_ascii_uppercase() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_uppercase() {
                if index + 1 < characters.len() && characters[index + 1].is_ascii_lowercase() {
                    break;
                }
                index += 1;
            }
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        } else {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        }
        words.push(
            characters[start..index]
                .iter()
                .collect::<String>()
                .to_ascii_lowercase(),
        );
    }
    words
}

fn mutation_result_symbol_ids(
    declarator: &oxc_ast::ast::VariableDeclarator<'_>,
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_semantic::SymbolId> {
    let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
        return FxHashSet::default();
    };
    collect_const_alias_symbol_ids(binding.symbol_id(), ctx)
}

fn mutation_method_symbol_ids(
    declarator: &oxc_ast::ast::VariableDeclarator<'_>,
    result_symbol_ids: &FxHashSet<oxc_semantic::SymbolId>,
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_semantic::SymbolId> {
    let mut method_symbol_ids = FxHashSet::default();
    for property_name in ["mutate", "mutateAsync"] {
        for symbol_id in binding_symbols_for_property(&declarator.id, property_name) {
            method_symbol_ids.extend(collect_const_alias_symbol_ids(symbol_id, ctx));
        }
    }
    for result_symbol_id in result_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(*result_symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let member_node = ctx.nodes().parent_node(reference_root.id());
            if let AstKind::VariableDeclarator(alias_declarator) = member_node.kind()
                && alias_declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == reference_root.span())
            {
                for property_name in ["mutate", "mutateAsync"] {
                    for symbol_id in
                        binding_symbols_for_property(&alias_declarator.id, property_name)
                    {
                        method_symbol_ids.extend(collect_const_alias_symbol_ids(symbol_id, ctx));
                    }
                }
                continue;
            }
            let Some(member_expression) = member_node.kind().as_member_expression_kind() else {
                continue;
            };
            if !member_expression
                .static_property_name()
                .is_some_and(|name| matches!(name.as_ref(), "mutate" | "mutateAsync"))
            {
                continue;
            }
            let member_root = transparent_expression_root(member_node, ctx);
            let parent = ctx.nodes().parent_node(member_root.id());
            let AstKind::VariableDeclarator(alias_declarator) = parent.kind() else {
                continue;
            };
            if alias_declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != member_root.span())
            {
                continue;
            }
            if let Some(binding) = alias_declarator.id.get_binding_identifier() {
                method_symbol_ids.extend(collect_const_alias_symbol_ids(binding.symbol_id(), ctx));
            }
        }
    }
    method_symbol_ids
}

fn is_mutation_method_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    result_symbol_ids: &FxHashSet<oxc_semantic::SymbolId>,
    method_symbol_ids: &FxHashSet<oxc_semantic::SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| method_symbol_ids.contains(&symbol_id)),
        expression => expression.as_member_expression().is_some_and(|member| {
            member
                .static_property_name()
                .is_some_and(|name| matches!(name.as_ref(), "mutate" | "mutateAsync"))
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some_and(|symbol_id| result_symbol_ids.contains(&symbol_id)))
        }),
    }
}

fn collect_const_alias_symbol_ids(
    root_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> FxHashSet<oxc_semantic::SymbolId> {
    let mut symbol_ids = FxHashSet::from_iter([root_symbol_id]);
    let mut pending_symbol_ids = vec![root_symbol_id];
    while let Some(symbol_id) = pending_symbol_ids.pop() {
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_root =
                transparent_expression_root(ctx.nodes().get_node(reference.node_id()), ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                continue;
            };
            let declaration = ctx.nodes().parent_node(parent.id());
            if !matches!(declaration.kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
                || declarator
                    .init
                    .as_ref()
                    .is_none_or(|initializer| initializer.span() != reference_root.span())
            {
                continue;
            }
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            if symbol_ids.insert(binding.symbol_id()) {
                pending_symbol_ids.push(binding.symbol_id());
            }
        }
    }
    symbol_ids
}

fn binding_symbols_for_property(
    pattern: &BindingPattern<'_>,
    property_name: &str,
) -> Vec<oxc_semantic::SymbolId> {
    let BindingPattern::ObjectPattern(pattern) = pattern else {
        return Vec::new();
    };
    pattern
        .properties
        .iter()
        .filter(|property| property.key.static_name().as_deref() == Some(property_name))
        .filter_map(|property| {
            property
                .value
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        })
        .collect()
}

fn mutation_data_is_consumed(
    declarator: &oxc_ast::ast::VariableDeclarator<'_>,
    result_symbol_ids: &FxHashSet<oxc_semantic::SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    for symbol_id in binding_symbols_for_property(&declarator.id, "data") {
        if symbol_has_consumer_read(symbol_id, ctx, &mut FxHashSet::default()) {
            return true;
        }
    }
    for result_symbol_id in result_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(*result_symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if let Some(member) = parent.kind().as_member_expression_kind()
                && member.static_property_name().as_deref() == Some("data")
                && response_expression_is_consumed(parent, ctx, &mut FxHashSet::default())
            {
                return true;
            }
            let AstKind::VariableDeclarator(alias_declarator) = parent.kind() else {
                continue;
            };
            if alias_declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != reference_root.span())
            {
                continue;
            }
            for data_symbol_id in binding_symbols_for_property(&alias_declarator.id, "data") {
                if symbol_has_consumer_read(data_symbol_id, ctx, &mut FxHashSet::default()) {
                    return true;
                }
            }
        }
    }
    false
}

fn symbol_has_consumer_read(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            response_expression_is_consumed(
                ctx.nodes().get_node(reference.node_id()),
                ctx,
                visited_symbol_ids,
            )
        })
}

fn response_expression_is_consumed<'a>(
    expression_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<oxc_semantic::SymbolId>,
) -> bool {
    if is_effect_dependency_reference(expression_node, ctx)
        || is_guard_only_reference(expression_node, ctx)
    {
        return false;
    }
    let mut expression_root = transparent_expression_root(expression_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let propagates = match parent.kind() {
            AstKind::SequenceExpression(sequence) => sequence
                .expressions
                .last()
                .is_some_and(|expression| expression.span() == expression_root.span()),
            AstKind::ConditionalExpression(conditional) => {
                conditional.consequent.span() == expression_root.span()
                    || conditional.alternate.span() == expression_root.span()
            }
            AstKind::LogicalExpression(logical) => logical.right.span() == expression_root.span(),
            _ => false,
        };
        if !propagates {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    let parent = ctx.nodes().parent_node(expression_root.id());
    if let Some(member) = parent.kind().as_member_expression_kind() {
        return member
            .static_property_name()
            .is_none_or(|name| !ACKNOWLEDGEMENT_FIELD_NAMES.contains(&name.as_ref()));
    }
    match parent.kind() {
        AstKind::SequenceExpression(sequence)
            if sequence
                .expressions
                .last()
                .is_none_or(|expression| expression.span() != expression_root.span()) =>
        {
            false
        }
        AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => false,
        AstKind::ExpressionStatement(_) => false,
        AstKind::VariableDeclarator(declarator)
            if declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == expression_root.span()) =>
        {
            match &declarator.id {
                BindingPattern::ObjectPattern(pattern) => object_pattern_consumes_response(pattern),
                BindingPattern::BindingIdentifier(binding) => {
                    symbol_has_consumer_read(binding.symbol_id(), ctx, visited_symbol_ids)
                }
                _ => true,
            }
        }
        _ => true,
    }
}

fn is_effect_dependency_reference(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for parent in ctx.nodes().ancestors(node.id()) {
        if matches!(
            parent.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let AstKind::ArrayExpression(array) = parent.kind() else {
            continue;
        };
        let array_root = transparent_expression_root(parent, ctx);
        let call_node = ctx.nodes().parent_node(array_root.id());
        let AstKind::CallExpression(call) = call_node.kind() else {
            return false;
        };
        return call
            .arguments
            .get(1)
            .and_then(|argument| argument.as_expression())
            .is_some_and(|argument| argument.span() == array_root.span())
            && is_react_hook_call(call, &EFFECT_HOOK_NAMES, ctx)
            && !array.elements.is_empty();
    }
    false
}

fn is_guard_only_reference<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        AstKind::UnaryExpression(unary) => unary.operator == UnaryOperator::LogicalNot,
        AstKind::CallExpression(call) => {
            call.arguments
                .first()
                .and_then(|argument| argument.as_expression())
                .is_some_and(|argument| argument.span() == root.span())
                && matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Boolean" && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
        AstKind::LogicalExpression(logical) => {
            if logical.left.span() == root.span()
                && logical.operator == oxc_syntax::operator::LogicalOperator::And
            {
                true
            } else {
                is_guard_only_reference(parent, ctx)
            }
        }
        AstKind::ConditionalExpression(conditional) if conditional.test.span() == root.span() => {
            true
        }
        AstKind::ConditionalExpression(_) | AstKind::SequenceExpression(_) => {
            is_guard_only_reference(parent, ctx)
        }
        AstKind::IfStatement(statement) => statement.test.span() == root.span(),
        AstKind::WhileStatement(statement) => statement.test.span() == root.span(),
        AstKind::DoWhileStatement(statement) => statement.test.span() == root.span(),
        AstKind::ForStatement(statement) => statement
            .test
            .as_ref()
            .is_some_and(|test| test.span() == root.span()),
        AstKind::BinaryExpression(binary) if is_equality_operator(binary.operator) => {
            let other = if binary.left.span() == root.span() {
                &binary.right
            } else {
                &binary.left
            };
            is_nullish_expression(other)
        }
        _ => false,
    }
}

fn object_pattern_consumes_response(pattern: &oxc_ast::ast::ObjectPattern<'_>) -> bool {
    pattern.properties.iter().any(|property| {
        property
            .key
            .static_name()
            .is_none_or(|name| !ACKNOWLEDGEMENT_FIELD_NAMES.contains(&name.as_ref()))
    }) || pattern.rest.is_some()
}

fn resolve_options_object<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<oxc_semantic::SymbolId>,
) -> Option<&'a oxc_ast::ast::ObjectExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => Some(object),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let initializer = declarator.init.as_ref()?;
            resolve_options_object(initializer, ctx, visited_symbol_ids)
        }
        _ => None,
    }
}

fn options_consume_response<'a>(
    expression: Option<&'a Expression<'a>>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(expression) = expression else {
        return false;
    };
    let Some(options) = resolve_options_object(expression, ctx, &mut FxHashSet::default()) else {
        return false;
    };
    options.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        matches!(
            property.key.static_name().as_deref(),
            Some("onSuccess" | "onSettled")
        ) && handler_consumes_response(&property.value, ctx)
    })
}

fn handler_consumes_response<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Some((_, function_span)) = resolve_local_react_callback(expression, ctx) else {
        return false;
    };
    let Some(function_node) = ctx
        .nodes()
        .iter()
        .find(|candidate| candidate.span() == function_span)
    else {
        return false;
    };
    let parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.items.first().map(|item| &item.pattern),
        AstKind::ArrowFunctionExpression(function) => {
            function.params.items.first().map(|item| &item.pattern)
        }
        _ => None,
    };
    match parameter {
        Some(BindingPattern::BindingIdentifier(binding)) => {
            symbol_has_consumer_read(binding.symbol_id(), ctx, &mut FxHashSet::default())
        }
        Some(BindingPattern::ObjectPattern(pattern)) => object_pattern_consumes_response(pattern),
        _ => false,
    }
}

fn mutation_call_result_is_consumed<'a>(
    call_node: &AstNode<'a>,
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let call_root = transparent_expression_root(call_node, ctx);
    let parent = ctx.nodes().parent_node(call_root.id());
    if matches!(parent.kind(), AstKind::AwaitExpression(_)) {
        return response_expression_is_consumed(parent, ctx, &mut FxHashSet::default());
    }
    if let Some(member) = parent.kind().as_member_expression_kind()
        && member.static_property_name().as_deref() == Some("then")
    {
        let member_root = transparent_expression_root(parent, ctx);
        let then_node = ctx.nodes().parent_node(member_root.id());
        if let AstKind::CallExpression(then_call) = then_node.kind()
            && let Some(handler) = then_call
                .arguments
                .first()
                .and_then(|argument| argument.as_expression())
            && handler_consumes_response(handler, ctx)
        {
            return true;
        }
    }
    options_consume_response(
        call_expression
            .arguments
            .get(1)
            .and_then(|argument| argument.as_expression()),
        ctx,
    )
}

fn mutation_status_targets(
    declarator: &oxc_ast::ast::VariableDeclarator<'_>,
    result_symbol_ids: &FxHashSet<oxc_semantic::SymbolId>,
    ctx: &LintContext<'_>,
) -> Vec<StatusTarget> {
    let mut targets = Vec::new();
    if !result_symbol_ids.is_empty() {
        for symbol_id in result_symbol_ids {
            for property_name in ["data", "isSuccess", "status"] {
                targets.push(StatusTarget {
                    symbol_id: *symbol_id,
                    property_name: Some(property_name),
                    source_property_name: property_name,
                });
            }
        }
        return targets;
    }
    for property_name in ["data", "isSuccess", "status"] {
        for symbol_id in binding_symbols_for_property(&declarator.id, property_name) {
            for alias_symbol_id in collect_const_alias_symbol_ids(symbol_id, ctx) {
                targets.push(StatusTarget {
                    symbol_id: alias_symbol_id,
                    property_name: None,
                    source_property_name: property_name,
                });
            }
        }
    }
    targets
}

fn path_has_status_guard<'a>(
    call_node: &AstNode<'a>,
    targets: &[StatusTarget],
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        if let AstKind::IfStatement(statement) = ancestor.kind()
            && statement
                .consequent
                .span()
                .contains_inclusive(call_node.span())
            && targets
                .iter()
                .any(|target| status_test_matches(&statement.test, target, false, ctx))
        {
            return true;
        }
    }
    let Some(function_node) = crate::ast_util::get_enclosing_function(call_node, ctx) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IfStatement(statement) = candidate.kind() else {
            return false;
        };
        local_callback_nearest_function_id(candidate.id(), ctx) == Some(function_node.id())
            && candidate.span().start < call_node.span().start
            && query_mutation_statement_precedes_path_node(candidate, call_node, ctx)
            && statement_always_exits(&statement.consequent)
            && targets
                .iter()
                .any(|target| status_test_matches(&statement.test, target, true, ctx))
    })
}

fn query_mutation_statement_precedes_path_node<'a>(
    statement: &AstNode<'a>,
    path_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().ancestors(path_node.id()).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::BlockStatement(_))
            && ctx.nodes().parent_node(statement.id()).id() == ancestor.id()
            && statement.span().end <= path_node.span().start
    })
}

fn status_test_matches(
    expression: &Expression<'_>,
    target: &StatusTarget,
    positive: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::UnaryExpression(unary) = expression
        && unary.operator == UnaryOperator::LogicalNot
    {
        return status_test_matches(&unary.argument, target, !positive, ctx);
    }
    if expression_matches_status_target(expression, target, ctx) {
        return positive && target.source_property_name == "isSuccess";
    }
    let Expression::BinaryExpression(binary) = expression else {
        return false;
    };
    let (other, matches_target) = if expression_matches_status_target(&binary.left, target, ctx) {
        (&binary.right, true)
    } else if expression_matches_status_target(&binary.right, target, ctx) {
        (&binary.left, true)
    } else {
        (&binary.left, false)
    };
    if !matches_target {
        return false;
    }
    let is_equality = matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    );
    let is_inequality = matches!(
        binary.operator,
        BinaryOperator::Inequality | BinaryOperator::StrictInequality
    );
    match target.source_property_name {
        "data" => {
            if positive {
                is_inequality && is_nullish_expression(other)
            } else {
                is_equality && is_nullish_expression(other)
            }
        }
        "status" => {
            static_string_value(other) == Some("success")
                && if positive { is_equality } else { is_inequality }
        }
        _ => static_boolean_value(other).is_some_and(|value| {
            if positive {
                (is_equality && value) || (is_inequality && !value)
            } else {
                (is_equality && !value) || (is_inequality && value)
            }
        }),
    }
}

fn expression_matches_status_target(
    expression: &Expression<'_>,
    target: &StatusTarget,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => target.property_name.is_none()
            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(target.symbol_id),
        expression => expression.as_member_expression().is_some_and(|member| {
            target.property_name.is_some_and(|property_name| member.static_property_name() == Some(property_name))
                && matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(target.symbol_id))
        }),
    }
}

fn path_has_run_once_latch<'a>(call_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for node in ctx.nodes().iter() {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            continue;
        };
        let Some(binding) = declarator.id.get_binding_identifier() else {
            continue;
        };
        let Some(Expression::CallExpression(initializer)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            continue;
        };
        if !is_react_api_call(initializer, "useRef", ctx)
            || ref_symbol_has_resetting_write(binding.symbol_id(), ctx)
        {
            continue;
        }
        let ref_symbol_id = binding.symbol_id();
        let mut guard_start = None;
        for candidate in ctx.nodes().iter() {
            let AstKind::IfStatement(statement) = candidate.kind() else {
                continue;
            };
            let is_early_exit_guard = candidate.span().start < call_node.span().start
                && node_dominates_node(candidate, call_node, ctx)
                && statement_always_exits(&statement.consequent)
                && ref_test_matches(&statement.test, ref_symbol_id, true, ctx);
            let is_enclosing_guard = statement
                .consequent
                .span()
                .contains_inclusive(call_node.span())
                && ref_test_matches(&statement.test, ref_symbol_id, false, ctx);
            if is_early_exit_guard || is_enclosing_guard {
                guard_start = Some(candidate.span().start);
                break;
            }
        }
        let Some(guard_start) = guard_start else {
            continue;
        };
        if ctx.nodes().iter().any(|candidate| {
            candidate.span().start > guard_start
                && candidate.span().start < call_node.span().start
                && node_dominates_node(candidate, call_node, ctx)
                && assigned_true_ref_symbol(candidate, ctx) == Some(ref_symbol_id)
        }) {
            return true;
        }
    }
    false
}

fn ref_test_matches(
    expression: &Expression<'_>,
    ref_symbol_id: oxc_semantic::SymbolId,
    positive: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::UnaryExpression(unary) = expression
        && unary.operator == UnaryOperator::LogicalNot
    {
        return ref_test_matches(&unary.argument, ref_symbol_id, !positive, ctx);
    }
    if ref_current_symbol(expression, ctx) == Some(ref_symbol_id) {
        return positive;
    }
    let Expression::BinaryExpression(binary) = expression else {
        return false;
    };
    let other = if ref_current_symbol(&binary.left, ctx) == Some(ref_symbol_id) {
        &binary.right
    } else if ref_current_symbol(&binary.right, ctx) == Some(ref_symbol_id) {
        &binary.left
    } else {
        return false;
    };
    let Some(value) = static_boolean_value(other) else {
        return false;
    };
    let value_when_true = if matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    ) {
        value
    } else if matches!(
        binary.operator,
        BinaryOperator::Inequality | BinaryOperator::StrictInequality
    ) {
        !value
    } else {
        return false;
    };
    value_when_true == positive
}

fn ref_current_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let member = expression.get_inner_expression().as_member_expression()?;
    ref_current_member_symbol(member, ctx)
}

fn ref_current_member_symbol(
    member: &oxc_ast::ast::MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    if member.static_property_name().as_deref() != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let Expression::CallExpression(call) = declarator.init.as_ref()?.get_inner_expression() else {
        return None;
    };
    is_react_api_call(call, "useRef", ctx).then_some(symbol_id)
}

fn assigned_true_ref_symbol(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let AstKind::AssignmentExpression(assignment) = node.kind() else {
        return None;
    };
    if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
        || static_boolean_value(&assignment.right) != Some(true)
    {
        return None;
    }
    let member = assignment.left.as_member_expression()?;
    ref_current_member_symbol(member, ctx)
}

fn ref_symbol_has_resetting_write(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_root =
                transparent_expression_root(ctx.nodes().get_node(reference.node_id()), ctx);
            let member_node = ctx.nodes().parent_node(reference_root.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some("current") {
                return false;
            }
            let member_root = transparent_expression_root(member_node, ctx);
            let parent = ctx.nodes().parent_node(member_root.id());
            match parent.kind() {
                AstKind::AssignmentExpression(assignment)
                    if assignment.left.span() == member_root.span() =>
                {
                    assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
                        || static_boolean_value(&assignment.right) != Some(true)
                }
                AstKind::UpdateExpression(_) => true,
                _ => false,
            }
        })
}

fn static_boolean_value(expression: &Expression<'_>) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}

fn static_string_value<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
            .quasis
            .first()
            .and_then(|quasi| quasi.value.cooked.as_ref())
            .map(|value| value.as_str()),
        _ => None,
    }
}

fn is_equality_operator(operator: BinaryOperator) -> bool {
    matches!(
        operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    )
}
