use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Argument, CallExpression, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This passes an href/hash-derived string to a DOM selector API, which throws a `DOMException` on an invalid CSS selector instead of returning null. Wrap the call in try/catch or escape the value with `CSS.escape`.";
const SELECTOR_QUERY_METHOD_NAMES: [&str; 4] =
    ["querySelector", "querySelectorAll", "matches", "closest"];
const STRING_DERIVATION_METHOD_NAMES: [&str; 12] = [
    "slice",
    "substring",
    "substr",
    "replace",
    "replaceAll",
    "concat",
    "trim",
    "trimStart",
    "trimEnd",
    "toLowerCase",
    "toUpperCase",
    "normalize",
];
const DOM_ELEMENT_NAME_SEGMENTS: [&str; 15] = [
    "el",
    "elem",
    "element",
    "node",
    "anchor",
    "target",
    "current",
    "ref",
    "dom",
    "body",
    "document",
    "container",
    "parent",
    "link",
    "button",
];

static HREF_HASH_NAME_PATTERN: Lazy<Regex> = lazy_regex!(r"(?i)(?:href|hash)");
static NON_DOM_RECEIVER_NAME_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:rout(?:e|er)|pattern|history|matcher)");
static SAFE_SELECTOR_VALIDATION_PATTERN: Lazy<Regex> =
    lazy_regex!(r#"(?:\^#\[A-Za-z\]|\^#\[a-zA-Z\]|\^#\[a-z\]|\^\[A-Za-z\]|\^\[a-zA-Z\])"#);
static PREDICATE_CALLEE_NAME_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)^(?:(?:is|has|can|check|validate?).*|.*valid.*)$");

#[derive(Debug, Default, Clone)]
pub struct NoNonLiteralSelectorQueryWithoutTryCatch;

declare_oxc_lint!(
    /// Disallow unguarded DOM selector queries with href-derived selectors.
    NoNonLiteralSelectorQueryWithoutTryCatch,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unguarded DOM selector queries with href-derived selectors.",
);

impl Rule for NoNonLiteralSelectorQueryWithoutTryCatch {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
            return;
        };
        let Some(method_name) = member.static_property_name() else {
            return;
        };
        if !SELECTOR_QUERY_METHOD_NAMES.contains(&method_name)
            || matches!(method_name, "matches" | "closest")
                && !is_likely_dom_element_receiver(member.object())
        {
            return;
        }
        let Some(selector_argument) = call.arguments.first().and_then(Argument::as_expression)
        else {
            return;
        };
        if is_string_literal_selector(selector_argument)
            || !selector_argument_taints_to_href(selector_argument, ctx)
            || selector_comes_from_literal_href_table(selector_argument, node, ctx)
            || selector_is_shape_validated(node, selector_argument, ctx)
            || find_guarding_try_statement(node.id(), ctx)
            || is_inside_catch_guarded_promise_callback(node, ctx)
            || is_in_helper_only_invoked_inside_try(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
    }
}

fn is_string_literal_selector(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(_) => true,
        Expression::TemplateLiteral(template) => template.expressions.is_empty(),
        _ => false,
    }
}

fn selector_argument_taints_to_href<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_href_hash_derived_expression(expression, ctx, 0) {
        return true;
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    identifier_initializer(identifier, ctx)
        .is_some_and(|initializer| is_href_hash_derived_expression(initializer, ctx, 0))
}

fn is_href_hash_derived_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    if depth > 8 {
        return false;
    }
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.get_member_expr()
        && member
            .static_property_name()
            .is_some_and(|name| matches!(name, "href" | "hash"))
    {
        return true;
    }
    match expression {
        Expression::ConditionalExpression(conditional) => {
            is_href_hash_derived_expression(&conditional.consequent, ctx, depth + 1)
                || is_href_hash_derived_expression(&conditional.alternate, ctx, depth + 1)
        }
        Expression::CallExpression(call) => {
            is_href_get_attribute_call(call)
                || is_string_derivation_call_on_href_receiver(call, ctx, depth + 1)
                || is_href_hash_named_call(call) && !is_sanitized_selector_helper_call(call, ctx)
        }
        _ => false,
    }
}

fn is_href_get_attribute_call(call: &CallExpression<'_>) -> bool {
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return false;
    };
    if member.static_property_name().as_deref() != Some("getAttribute") {
        return false;
    }
    matches!(
        call.arguments.first(),
        Some(Argument::StringLiteral(literal)) if matches!(literal.value.as_str(), "href" | "hash")
    )
}

fn is_string_derivation_call_on_href_receiver<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
    depth: usize,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().get_member_expr() else {
        return false;
    };
    if !member
        .static_property_name()
        .is_some_and(|name| STRING_DERIVATION_METHOD_NAMES.contains(&name))
    {
        return false;
    }
    let receiver = member.object().get_inner_expression();
    matches!(receiver, Expression::Identifier(identifier) if HREF_HASH_NAME_PATTERN.is_match(identifier.name.as_str()))
        || is_href_hash_derived_expression(receiver, ctx, depth)
}

fn is_href_hash_named_call(call: &CallExpression<'_>) -> bool {
    let callee = call.callee.get_inner_expression();
    match callee {
        Expression::Identifier(identifier) => {
            HREF_HASH_NAME_PATTERN.is_match(identifier.name.as_str())
        }
        _ => callee.get_member_expr().is_some_and(|member| {
            member
                .static_property_name()
                .is_some_and(|name| HREF_HASH_NAME_PATTERN.is_match(name))
        }),
    }
}

fn is_sanitized_selector_helper_call<'a>(call: &CallExpression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    if ctx
        .nodes()
        .ancestors(declaration.id())
        .any(|ancestor| matches!(ancestor.kind(), AstKind::ImportDeclaration(_)))
    {
        return true;
    }
    let Some(function_node_id) = resolve_symbol_function_node_id(symbol_id, ctx) else {
        return false;
    };
    let function_node = ctx.nodes().get_node(function_node_id);
    let source = ctx.source_range(function_node.span());
    if !source.contains("return") {
        return source_has_selector_sanitizer(source);
    }
    let return_expressions = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::ReturnStatement(statement) = candidate.kind() else {
                return None;
            };
            if !function_node.span().contains_inclusive(candidate.span())
                || nearest_function_id(candidate, ctx) != Some(function_node.id())
            {
                return None;
            }
            statement.argument.as_ref()
        })
        .collect::<Vec<_>>();
    !return_expressions.is_empty()
        && return_expressions
            .iter()
            .all(|expression| source_has_selector_sanitizer(ctx.source_range(expression.span())))
}

fn source_has_selector_sanitizer(source: &str) -> bool {
    source.contains("CSS.escape")
        || source
            .split(|character: char| !character.is_ascii_alphabetic())
            .any(|word| word.eq_ignore_ascii_case("cssescape"))
        || SAFE_SELECTOR_VALIDATION_PATTERN.is_match(source)
}

fn resolve_symbol_function_node_id(symbol_id: SymbolId, ctx: &LintContext<'_>) -> Option<NodeId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) => Some(declaration.id()),
        AstKind::VariableDeclarator(declarator) => {
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            let node_id = match initializer {
                Expression::FunctionExpression(function) => function.node_id.get(),
                Expression::ArrowFunctionExpression(function) => function.node_id.get(),
                _ => return None,
            };
            Some(node_id)
        }
        _ => None,
    }
}

fn nearest_function_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn is_likely_dom_element_receiver(expression: &Expression<'_>) -> bool {
    let receiver_name = match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .get_member_expr()
            .and_then(oxc_ast::ast::MemberExpression::static_property_name),
    };
    let Some(receiver_name) = receiver_name else {
        return false;
    };
    if NON_DOM_RECEIVER_NAME_PATTERN.is_match(receiver_name) {
        return false;
    }
    split_identifier_segments(receiver_name)
        .iter()
        .any(|segment| DOM_ELEMENT_NAME_SEGMENTS.contains(&segment.as_str()))
}

fn split_identifier_segments(name: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    for character in name.chars() {
        if !character.is_ascii_alphabetic() {
            if !current.is_empty() {
                segments.push(current.to_ascii_lowercase());
                current.clear();
            }
            continue;
        }
        if character.is_ascii_uppercase() && !current.is_empty() {
            segments.push(current.to_ascii_lowercase());
            current.clear();
        }
        current.push(character);
    }
    if !current.is_empty() {
        segments.push(current.to_ascii_lowercase());
    }
    segments
}

fn selector_is_shape_validated<'a>(
    call_node: &AstNode<'a>,
    selector: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let selector_symbol_id = match selector.get_inner_expression() {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id(),
        _ => None,
    };
    let Some(selector_symbol_id) = selector_symbol_id else {
        return false;
    };
    if is_pinned_by_enclosing_switch_case(call_node, selector_symbol_id, ctx) {
        return true;
    }
    let call_start = call_node.span().start;
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start >= call_start
            || !candidate_precedes_in_same_function(candidate, call_node, ctx)
        {
            return false;
        }
        let (validation_span, is_dominating) = match candidate.kind() {
            AstKind::IfStatement(statement) => {
                let test_source = ctx.source_range(statement.test.span()).trim();
                let call_is_inside_consequent = statement
                    .consequent
                    .span()
                    .contains_inclusive(call_node.span());
                let call_is_inside_alternate = statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(call_node.span()));
                let is_negated = test_source.starts_with('!');
                let encloses_valid_branch = call_is_inside_consequent
                    && !is_negated
                    && logical_test_can_dominate(test_source)
                    || call_is_inside_alternate && is_negated;
                let precedes_after_early_exit = statement.span.end < call_start
                    && is_early_exit_source(ctx.source_range(statement.consequent.span()))
                    && is_negated;
                (
                    statement.test.span(),
                    encloses_valid_branch || precedes_after_early_exit,
                )
            }
            AstKind::ConditionalExpression(expression) => {
                let is_negated = ctx
                    .source_range(expression.test.span())
                    .trim()
                    .starts_with('!');
                (
                    expression.test.span(),
                    expression
                        .consequent
                        .span()
                        .contains_inclusive(call_node.span())
                        && !is_negated
                        || expression
                            .alternate
                            .span()
                            .contains_inclusive(call_node.span())
                            && is_negated,
                )
            }
            AstKind::LogicalExpression(expression) => (
                expression.left.span(),
                expression.right.span().contains_inclusive(call_node.span())
                    && ctx.source_range(candidate.span()).contains("&&"),
            ),
            AstKind::ExpressionStatement(statement) if statement.span.end < call_start => (
                statement.expression.span(),
                source_is_pinning_assertion(ctx.source_range(statement.expression.span())),
            ),
            _ => return false,
        };
        is_dominating
            && (source_has_selector_validation(ctx.source_range(validation_span))
                || validation_span_has_named_regex_predicate(
                    validation_span,
                    selector_symbol_id,
                    ctx,
                ))
            && subtree_references_symbol(validation_span, selector_symbol_id, ctx)
            && !symbol_is_written_between(selector_symbol_id, validation_span.end, call_start, ctx)
    })
}

fn logical_test_can_dominate(source: &str) -> bool {
    !source.contains("||")
        || source
            .split("||")
            .all(|branch| source_has_selector_validation(branch.trim()))
}

fn validation_span_has_named_regex_predicate(
    validation_span: Span,
    selector_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !validation_span.contains_inclusive(call.span)
            || !subtree_references_symbol(call.span, selector_symbol_id, ctx)
        {
            return false;
        }
        let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
            return false;
        };
        if !PREDICATE_CALLEE_NAME_PATTERN.is_match(callee.name.as_str()) {
            return false;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
        else {
            return false;
        };
        resolve_symbol_function_node_id(symbol_id, ctx).is_some_and(|function_id| {
            SAFE_SELECTOR_VALIDATION_PATTERN
                .is_match(ctx.source_range(ctx.nodes().get_node(function_id).span()))
        })
    })
}

fn is_pinned_by_enclosing_switch_case(
    call_node: &AstNode<'_>,
    selector_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(case_node) = ctx
        .nodes()
        .ancestors(call_node.id())
        .find(|ancestor| matches!(ancestor.kind(), AstKind::SwitchCase(_)))
    else {
        return false;
    };
    let AstKind::SwitchCase(case) = case_node.kind() else {
        return false;
    };
    let Some(Expression::StringLiteral(test)) =
        case.test.as_ref().map(Expression::get_inner_expression)
    else {
        return false;
    };
    if !is_safe_hash_selector_literal_value(test.value.as_str()) {
        return false;
    }
    ctx.nodes().ancestors(case_node.id()).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::SwitchStatement(statement) if subtree_references_symbol(statement.discriminant.span(), selector_symbol_id, ctx))
    })
}

fn source_has_selector_validation(source: &str) -> bool {
    SAFE_SELECTOR_VALIDATION_PATTERN.is_match(source)
        || source.contains(".indexOf(")
        || source.contains(".includes(")
        || source.contains(".has(")
        || source.contains(".some(")
        || source.contains(".every(")
        || source_contains_safe_hash_literal(source)
        || source.contains(" in ")
        || source.contains(".toMatch(")
}

fn source_is_pinning_assertion(source: &str) -> bool {
    source.starts_with("expect(")
        && (source.contains(".toMatch(")
            || source.contains(".toBe(") && source_contains_safe_hash_literal(source)
            || source.contains(".toEqual(") && source_contains_safe_hash_literal(source)
            || source.contains(".toStrictEqual(") && source_contains_safe_hash_literal(source))
}

fn source_contains_safe_hash_literal(source: &str) -> bool {
    source
        .split(['\'', '"'])
        .any(is_safe_hash_selector_literal_value)
}

fn subtree_references_symbol(span: Span, symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| span.contains_inclusive(ctx.nodes().get_node(reference.node_id()).span()))
}

fn candidate_precedes_in_same_function(
    candidate: &AstNode<'_>,
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    nearest_function_id(candidate, ctx) == nearest_function_id(call_node, ctx)
}

fn is_early_exit_source(source: &str) -> bool {
    let source =
        source.trim_start_matches(|character: char| character == '{' || character.is_whitespace());
    source.starts_with("return")
        || source.starts_with("throw")
        || source.starts_with("continue")
        || source.starts_with("break")
}

fn selector_comes_from_literal_href_table<'a>(
    selector: &Expression<'a>,
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(selector_member) = selector.get_inner_expression().get_member_expr() else {
        return false;
    };
    let Expression::Identifier(item_identifier) = selector_member.object().get_inner_expression()
    else {
        return false;
    };
    let Some(item_symbol_id) = ctx
        .scoping()
        .get_reference(item_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let item_declaration = ctx.symbol_declaration(item_symbol_id);
    if !matches!(item_declaration.kind(), AstKind::FormalParameter(_)) {
        return false;
    }
    let Some(callback_node) = ctx
        .nodes()
        .ancestors(item_declaration.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
    else {
        return false;
    };
    let Some(iteration_call_node) = ctx.nodes().ancestors(callback_node.id()).find(|ancestor| {
        matches!(ancestor.kind(), AstKind::CallExpression(call) if call.arguments.iter().any(|argument| argument.span().contains_inclusive(callback_node.span())))
    }) else {
        return false;
    };
    let AstKind::CallExpression(iteration_call) = iteration_call_node.kind() else {
        return false;
    };
    let Some(iteration_member) = iteration_call
        .callee
        .get_inner_expression()
        .get_member_expr()
    else {
        return false;
    };
    if !iteration_member
        .static_property_name()
        .is_some_and(|name| matches!(name, "map" | "forEach" | "filter" | "flatMap" | "find"))
    {
        return false;
    }
    let table_receiver = iteration_member.object().get_inner_expression();
    if is_literal_href_table(table_receiver) {
        return true;
    }
    let Expression::Identifier(table_identifier) = table_receiver else {
        return false;
    };
    let Some(table_symbol_id) = ctx
        .scoping()
        .get_reference(table_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(table_initializer) = identifier_initializer(table_identifier, ctx) else {
        return false;
    };
    is_literal_href_table(table_initializer)
        && !symbol_is_written_between(
            table_symbol_id,
            table_initializer.span().end,
            call_node.span().start,
            ctx,
        )
}

fn is_literal_href_table(expression: &Expression<'_>) -> bool {
    let Expression::ArrayExpression(array) = expression.get_inner_expression() else {
        return false;
    };
    !array.elements.is_empty()
        && array.elements.iter().all(|element| {
            let Some(Expression::ObjectExpression(object)) = element.as_expression() else {
                return false;
            };
            object.properties.iter().all(|property| {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return false;
                };
                let Some(property_name) = property.key.static_name() else {
                    return false;
                };
                property_name != "href"
                    || matches!(
                        property.value.get_inner_expression(),
                        Expression::StringLiteral(literal)
                            if is_safe_hash_selector_literal_value(literal.value.as_str())
                    )
            })
        })
}

fn is_safe_hash_selector_literal_value(value: &str) -> bool {
    let Some(rest) = value.strip_prefix('#') else {
        return false;
    };
    let mut characters = rest.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_alphabetic())
        && characters
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
}

fn symbol_is_written_between(
    symbol_id: SymbolId,
    lower_bound: u32,
    upper_bound: u32,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let span = ctx.nodes().get_node(reference.node_id()).span();
            reference.is_write() && span.start > lower_bound && span.end < upper_bound
        })
}

fn is_inside_catch_guarded_promise_callback(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for function_node in ctx.nodes().ancestors(node.id()).filter(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) {
        let parent = ctx.nodes().parent_node(function_node.id());
        let AstKind::CallExpression(then_call) = parent.kind() else {
            continue;
        };
        if !then_call
            .callee
            .get_member_expr()
            .is_some_and(|member| member.static_property_name().as_deref() == Some("then"))
        {
            continue;
        }
        let mut chain_call_node = parent;
        loop {
            let member_node = ctx.nodes().parent_node(chain_call_node.id());
            let Some(member) = member_node.kind().as_member_expression_kind() else {
                break;
            };
            if member.object().span() != chain_call_node.span() {
                break;
            }
            let next_call_node = ctx.nodes().parent_node(member_node.id());
            let AstKind::CallExpression(next_call) = next_call_node.kind() else {
                break;
            };
            if next_call.callee.span() != member_node.span() {
                break;
            }
            match member.static_property_name().as_deref() {
                Some("catch") => return true,
                Some("then") if next_call.arguments.len() >= 2 => return true,
                _ => chain_call_node = next_call_node,
            }
        }
    }
    false
}

fn is_in_helper_only_invoked_inside_try(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(function_node) = ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) else {
        return false;
    };
    let symbol_id = match function_node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id()),
        AstKind::ArrowFunctionExpression(_) => {
            let parent = ctx.nodes().parent_node(function_node.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return false;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.symbol_id())
        }
        _ => None,
    };
    let Some(symbol_id) = symbol_id else {
        return false;
    };
    let mut call_site_count = 0;
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference_node.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return false;
        };
        if call.callee.span() != reference_node.span()
            || !find_guarding_try_statement(parent.id(), ctx)
        {
            return false;
        }
        call_site_count += 1;
    }
    call_site_count > 0
}
