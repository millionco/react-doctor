use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpression, ArrayExpressionElement, BindingPattern, CallExpression,
        Expression, MemberExpression, Statement, TSType,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;
use oxc_syntax::operator::{LogicalOperator, UnaryOperator};
use rustc_hash::FxHashSet;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SMALL_LITERAL_ARRAY_MAX_ELEMENTS: usize = 9;
const STRING_SPLIT_CHAIN_MAX_HOPS: usize = 12;

#[derive(Debug, Default, Clone)]
pub struct JsCombineIterations;

declare_oxc_lint!(
    /// Combine chained eager array iterations into one pass.
    JsCombineIterations,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Combine chained eager array iterations into one pass.",
);

impl Rule for JsCombineIterations {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let candidates = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::CallExpression(call) = node.kind() else {
                    return None;
                };
                combine_iterations_candidate(call).map(
                    |(inner_call, inner_method, outer_method)| {
                        (call, inner_call, inner_method, outer_method)
                    },
                )
            })
            .collect::<Vec<_>>();
        let mut covered_calls = FxHashSet::default();
        let mut generator_names = None;
        for (call, inner_call, inner_method, outer_method) in candidates {
            if covered_calls.contains(&call_span_key(call)) {
                covered_calls.insert(call_span_key(inner_call));
                continue;
            }
            if combine_iterations_is_exempt_pair(call, inner_call, inner_method, outer_method) {
                continue;
            }
            let generator_names =
                generator_names.get_or_insert_with(|| collect_generator_names(ctx));
            if receiver_chain_is_iterator_rooted(member_object(&inner_call.callee), generator_names)
                || is_small_literal_array_rooted_chain(member_object(&inner_call.callee), ctx)
                || is_string_split_rooted_chain(member_object(&inner_call.callee))
            {
                continue;
            }
            covered_calls.insert(call_span_key(inner_call));
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This loops over your list twice because .{inner_method}().{outer_method}() makes two passes, so do it in one pass with .reduce() or a for...of loop"
                ))
                .with_label(call.span),
            );
        }
    }
}

fn combine_iterations_candidate<'a>(
    call: &'a CallExpression<'a>,
) -> Option<(&'a CallExpression<'a>, &'a str, &'a str)> {
    let outer_member = call.callee.as_member_expression()?;
    let outer_method = member_identifier_property_name(outer_member)?;
    if !is_chainable_iteration_method(outer_method) {
        return None;
    }
    let Expression::CallExpression(inner_call) = outer_member.object().get_inner_expression()
    else {
        return None;
    };
    let inner_member = inner_call.callee.as_member_expression()?;
    let inner_method = member_identifier_property_name(inner_member)?;
    is_chainable_iteration_method(inner_method).then_some((inner_call, inner_method, outer_method))
}

fn combine_iterations_is_exempt_pair(
    outer_call: &CallExpression<'_>,
    inner_call: &CallExpression<'_>,
    inner_method: &str,
    outer_method: &str,
) -> bool {
    if outer_method == "filter"
        && outer_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(is_boolean_or_identity_filter)
    {
        return true;
    }
    if inner_method == "filter"
        && inner_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(is_boolean_or_identity_filter)
    {
        return true;
    }
    let filter_argument = if inner_method == "map" && outer_method == "filter" {
        outer_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
    } else if inner_method == "filter" && outer_method == "map" {
        inner_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
    } else {
        None
    };
    filter_argument.is_some_and(|argument| {
        is_null_filtering_predicate(argument) || is_type_predicate_arrow(argument)
    })
}

fn member_identifier_property_name<'a>(member: &'a MemberExpression<'a>) -> Option<&'a str> {
    match member {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = &member.expression else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn member_kind_identifier_property_name<'a>(
    member: oxc_ast::MemberExpressionKind<'a>,
) -> Option<&'a str> {
    match member {
        oxc_ast::MemberExpressionKind::Static(member) => Some(member.property.name.as_str()),
        oxc_ast::MemberExpressionKind::Computed(member) => {
            let Expression::Identifier(identifier) = &member.expression else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        oxc_ast::MemberExpressionKind::PrivateField(_) => None,
    }
}

fn member_object<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    expression
        .as_member_expression()
        .expect("candidate callees are member expressions")
        .object()
}

fn call_span_key(call: &CallExpression<'_>) -> (u32, u32) {
    (call.span.start, call.span.end)
}

fn is_chainable_iteration_method(method_name: &str) -> bool {
    matches!(method_name, "map" | "filter" | "forEach" | "flatMap")
}

fn is_small_array_non_mutating_method(method_name: &str) -> bool {
    is_chainable_iteration_method(method_name) || matches!(method_name, "find" | "some")
}

fn is_boolean_or_identity_filter(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name == "Boolean",
        Expression::ArrowFunctionExpression(arrow) if arrow.params.items.len() == 1 => {
            let BindingPattern::BindingIdentifier(parameter) = &arrow.params.items[0].pattern
            else {
                return false;
            };
            if let Some(body) = arrow.get_expression() {
                return is_identity_filter_body(body, parameter.name.as_str());
            }
            let Some(body) = arrow.get_function_body() else {
                return false;
            };
            if !body.directives.is_empty() {
                return false;
            }
            let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
                return false;
            };
            statement
                .argument
                .as_ref()
                .is_some_and(|argument| is_identity_filter_body(argument, parameter.name.as_str()))
        }
        _ => false,
    }
}

fn is_identity_filter_body(expression: &Expression<'_>, parameter_name: &str) -> bool {
    match expression {
        Expression::Identifier(identifier) => identifier.name == parameter_name,
        Expression::UnaryExpression(outer)
            if outer.operator == UnaryOperator::LogicalNot
                && matches!(&outer.argument, Expression::UnaryExpression(inner)
                    if inner.operator == UnaryOperator::LogicalNot
                        && matches!(&inner.argument, Expression::Identifier(identifier) if identifier.name == parameter_name)) =>
        {
            true
        }
        _ => false,
    }
}

fn is_null_filtering_predicate(expression: &Expression<'_>) -> bool {
    let Expression::ArrowFunctionExpression(arrow) = expression.get_inner_expression() else {
        return false;
    };
    if arrow.params.items.is_empty() && arrow.params.rest.is_none() {
        return false;
    }
    if let Some(body) = arrow.get_expression() {
        return is_null_filtering_predicate_body(body);
    }
    let Some(body) = arrow.get_function_body() else {
        return false;
    };
    if !body.directives.is_empty() {
        return false;
    }
    let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
        return false;
    };
    statement
        .argument
        .as_ref()
        .is_some_and(is_null_filtering_predicate_body)
}

fn is_null_filtering_predicate_body(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::BinaryExpression(binary) if binary.operator.is_equality() => {
            combine_iterations_is_nullish_expression(&binary.left)
                || combine_iterations_is_nullish_expression(&binary.right)
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            is_null_filtering_predicate_body(&logical.left)
                && is_null_filtering_predicate_body(&logical.right)
        }
        _ => false,
    }
}

fn combine_iterations_is_nullish_expression(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        _ => false,
    }
}

fn is_type_predicate_arrow(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::ArrowFunctionExpression(arrow)
            if arrow.return_type.as_ref().is_some_and(|annotation| matches!(&annotation.type_annotation, TSType::TSTypePredicate(_)))
    )
}

fn receiver_chain_is_iterator_rooted<'a>(
    mut receiver: &'a Expression<'a>,
    generator_names: &FxHashSet<&str>,
) -> bool {
    loop {
        let Expression::CallExpression(call) = receiver.get_inner_expression() else {
            return false;
        };
        if is_iterator_producing_call(call, generator_names) {
            return true;
        }
        let Some(member) = call.callee.as_member_expression() else {
            return false;
        };
        if !member_identifier_property_name(member).is_some_and(is_chainable_iteration_method) {
            return false;
        }
        receiver = member.object();
    }
}

fn is_iterator_producing_call(
    call: &CallExpression<'_>,
    generator_names: &FxHashSet<&str>,
) -> bool {
    if let Some(member) = call.callee.as_member_expression() {
        let Some(method_name) = member_identifier_property_name(member) else {
            return false;
        };
        let receiver = member.object().get_inner_expression();
        if method_name == "from"
            && matches!(receiver, Expression::Identifier(identifier) if identifier.name == "Iterator")
        {
            return true;
        }
        if !matches!(method_name, "values" | "keys" | "entries") {
            return false;
        }
        return !matches!(receiver, Expression::Identifier(identifier) if identifier.name == "Object");
    }
    matches!(&call.callee, Expression::Identifier(identifier) if generator_names.contains(identifier.name.as_str()))
}

fn is_string_split_rooted_chain<'a>(mut receiver: &'a Expression<'a>) -> bool {
    for _ in 0..STRING_SPLIT_CHAIN_MAX_HOPS {
        let Expression::CallExpression(call) = receiver.get_inner_expression() else {
            return false;
        };
        let Some(member) = call.callee.as_member_expression() else {
            return false;
        };
        let Some(method_name) = member_identifier_property_name(member) else {
            return false;
        };
        if method_name == "split" {
            return true;
        }
        if !is_chainable_iteration_method(method_name) {
            return false;
        }
        receiver = member.object();
    }
    false
}

fn is_small_literal_array_rooted_chain<'a>(
    mut receiver: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    loop {
        match receiver.get_inner_expression() {
            Expression::ArrayExpression(array) => return is_small_literal_array(array),
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
                if !matches!(&declarator.id, BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id)
                    || !declarator
                        .init
                        .as_ref()
                        .is_some_and(|initializer| matches!(initializer.get_inner_expression(), Expression::ArrayExpression(array) if is_small_literal_array(array)))
                {
                    return false;
                }
                let AstKind::VariableDeclaration(variable_declaration) =
                    ctx.nodes().parent_node(declaration.id()).kind()
                else {
                    return false;
                };
                if matches!(
                    variable_declaration.kind,
                    oxc_ast::ast::VariableDeclarationKind::Using
                        | oxc_ast::ast::VariableDeclarationKind::AwaitUsing
                ) {
                    return false;
                }
                return ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .all(|reference| {
                        reference.is_read()
                            && !reference.is_write()
                            && is_non_mutating_small_array_method_reference(
                                reference.node_id(),
                                ctx,
                            )
                    });
            }
            Expression::CallExpression(call) => {
                let Some(member) = call.callee.as_member_expression() else {
                    return false;
                };
                if !member_identifier_property_name(member)
                    .is_some_and(is_chainable_iteration_method)
                {
                    return false;
                }
                receiver = member.object();
            }
            _ => return false,
        }
    }
}

fn is_small_literal_array(array: &ArrayExpression<'_>) -> bool {
    !array.elements.is_empty()
        && array.elements.len() <= SMALL_LITERAL_ARRAY_MAX_ELEMENTS
        && array
            .elements
            .iter()
            .all(|element| !matches!(element, ArrayExpressionElement::SpreadElement(_)))
}

fn is_non_mutating_small_array_method_reference(
    reference_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let reference_root = transparent_expression_root(ctx.nodes().get_node(reference_id), ctx);
    let member_node = ctx.nodes().parent_node(reference_root.id());
    let Some(member) = member_node.kind().as_member_expression_kind() else {
        return false;
    };
    if member.object().span() != reference_root.span()
        || !member_kind_identifier_property_name(member)
            .is_some_and(is_small_array_non_mutating_method)
    {
        return false;
    }
    let call_node = ctx.nodes().parent_node(member_node.id());
    matches!(call_node.kind(), AstKind::CallExpression(call) if call.callee.span() == member_node.span())
}

fn collect_generator_names<'a>(ctx: &LintContext<'a>) -> FxHashSet<&'a str> {
    ctx.nodes()
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::Function(function) if function.generator && function.is_function_declaration() => {
                function.id.as_ref().map(|identifier| identifier.name.as_str())
            }
            AstKind::VariableDeclarator(declarator) => {
                let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                    return None;
                };
                matches!(declarator.init.as_ref(), Some(Expression::FunctionExpression(function)) if function.generator)
                    .then(|| identifier.name.as_str())
            }
            _ => None,
        })
        .collect()
}
