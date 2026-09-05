use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BinaryExpression, BindingIdentifier, BindingPattern,
        CallExpression, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName,
        JSXAttributeValue, JSXChild, JSXElement, JSXElementName, JSXExpression, JSXFragment,
        JSXMemberExpressionObject, TSSignature, TSType, TSTypeName,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

const ITERATOR_METHOD_NAMES: [&str; 3] = ["flatMap", "forEach", "map"];

#[derive(Debug, Default, Clone)]
pub struct NoArrayIndexAsKey;

declare_oxc_lint!(
    /// Disallow positional array indexes as React keys.
    NoArrayIndexAsKey,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Array index used as a key",
);

impl Rule for NoArrayIndexAsKey {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        check_element_keys(element, node, ctx);
    }
}

fn check_element_keys<'a>(element: &JSXElement<'a>, node: &AstNode<'a>, ctx: &LintContext<'a>) {
    for attribute in &element.opening_element.attributes {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            continue;
        };
        if !matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "key") {
            continue;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            continue;
        };
        let Some(index_binding) = find_positional_index_binding(node, &container.expression, ctx)
        else {
            continue;
        };
        if index_binding
            .iterator_call
            .is_some_and(|call| iterator_call_exempts_index_key(call, ctx))
            || index_binding.is_placeholder_loop
            || has_aria_hidden_ancestor(element, node.id(), index_binding.is_data_indexed_loop, ctx)
            || template_has_outer_member_identity(
                &container.expression,
                index_binding.binding_function_span,
                ctx,
            )
            || element_is_exempt_stateless_row(element, &container.expression, &index_binding, ctx)
        {
            continue;
        }
        if jsx_expression_uses_index_or_alias(
            &container.expression,
            index_binding.symbol_id,
            ctx,
            0,
        ) {
            let index_name = jsx_expression_index_candidate(
                &container.expression,
                index_binding.symbol_id,
                ctx,
                0,
            )
            .map(|candidate| candidate.name)
            .unwrap_or_else(|| index_binding.name.clone());
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users can see & submit the wrong data when this list reorders or filters, so use a stable id like `key={{item.id}}`, not the array index \"{}\".",
                    index_name
                ))
                .with_label(attribute.span),
            );
        }
    }
}

struct PositionalIndexBinding<'node, 'ast> {
    name: String,
    symbol_id: SymbolId,
    iterator_call: Option<&'node CallExpression<'ast>>,
    binding_function_span: Option<Span>,
    item_symbol_ids: Vec<SymbolId>,
    is_data_indexed_loop: bool,
    is_placeholder_loop: bool,
}

struct IndexKeyCandidate {
    name: String,
    order: Vec<u32>,
}

fn find_positional_index_binding<'node, 'ast>(
    node: &AstNode<'ast>,
    key_expression: &JSXExpression<'ast>,
    ctx: &'node LintContext<'ast>,
) -> Option<PositionalIndexBinding<'node, 'ast>> {
    let mut bindings = Vec::new();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let (parameters, function_span) = match ancestor.kind() {
            AstKind::ArrowFunctionExpression(function) => (&function.params, function.span),
            AstKind::Function(function) => (&function.params, function.span),
            _ => continue,
        };
        let iterator_call = direct_iterator_call_of_function(ancestor, ctx);
        for (parameter_index, parameter) in parameters.items.iter().enumerate() {
            let parameter_identifiers = parameter.pattern.get_binding_identifiers();
            if parameter_index == 0
                && iterator_call.is_some_and(|call| iterator_source_contains_entries(call, ctx))
                && let Some(identifier) = parameter_identifiers.first()
                && matches!(identifier.name.as_str(), "i" | "idx" | "index")
                && jsx_expression_uses_index_or_alias(
                    key_expression,
                    identifier.symbol_id(),
                    ctx,
                    0,
                )
            {
                bindings.push(PositionalIndexBinding {
                    name: identifier.name.to_string(),
                    symbol_id: identifier.symbol_id(),
                    iterator_call,
                    binding_function_span: Some(function_span),
                    item_symbol_ids: parameter_identifiers
                        .iter()
                        .skip(1)
                        .map(|identifier| identifier.symbol_id())
                        .collect(),
                    is_data_indexed_loop: false,
                    is_placeholder_loop: false,
                });
            }
            let Some(identifier) = parameter.pattern.get_binding_identifier() else {
                continue;
            };
            if !matches!(identifier.name.as_str(), "i" | "idx" | "index")
                || parameter_index == 0 && iterator_call.is_some()
            {
                continue;
            }
            let symbol_id = identifier.symbol_id();
            if !jsx_expression_uses_index_or_alias(key_expression, symbol_id, ctx, 0) {
                continue;
            }
            bindings.push(PositionalIndexBinding {
                name: identifier.name.to_string(),
                symbol_id,
                iterator_call,
                binding_function_span: Some(function_span),
                item_symbol_ids: parameters.items.first().map_or_else(Vec::new, |parameter| {
                    parameter
                        .pattern
                        .get_binding_identifiers()
                        .into_iter()
                        .map(BindingIdentifier::symbol_id)
                        .collect()
                }),
                is_data_indexed_loop: false,
                is_placeholder_loop: false,
            });
        }
    }
    bindings.extend(
        key_expression
            .as_expression()
            .and_then(|expression| resolve_non_parameter_index_binding(expression, ctx, 0)),
    );
    bindings.into_iter().min_by_key(|binding| {
        jsx_expression_index_candidate(key_expression, binding.symbol_id, ctx, 0)
            .map_or_else(|| vec![u32::MAX], |candidate| candidate.order)
    })
}

fn iterator_source_contains_entries(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let source = if is_global_method_call(call, "Array", "from") {
        call.arguments.first().and_then(Argument::as_expression)
    } else {
        call.callee
            .as_member_expression()
            .map(oxc_ast::ast::MemberExpression::object)
    };
    source.is_some_and(|source| expression_contains_array_entries_call(source, ctx))
}

fn expression_contains_array_entries_call(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|node| {
        span.contains_inclusive(node.span())
            && matches!(node.kind(), AstKind::CallExpression(call) if is_array_entries_call(call))
    })
}

fn is_array_entries_call(call: &CallExpression<'_>) -> bool {
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    member.static_property_name() == Some("entries")
        && !matches!(member.object().get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "Object")
}

fn direct_iterator_call_of_function<'node, 'ast>(
    function_node: &AstNode<'ast>,
    ctx: &'node LintContext<'ast>,
) -> Option<&'node CallExpression<'ast>> {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return None;
    };
    if is_global_method_call(call, "Array", "from") {
        return call
            .arguments
            .get(1)
            .is_some_and(|argument| callback_argument_matches(Some(argument), function_node))
            .then_some(call);
    }
    if !call
        .arguments
        .first()
        .is_some_and(|argument| callback_argument_matches(Some(argument), function_node))
    {
        return None;
    }
    let member = call.callee.as_member_expression()?;
    let method_name = member_expression_identifier_property_name(member)?;
    ITERATOR_METHOD_NAMES.contains(&method_name).then_some(call)
}

fn callback_argument_matches(argument: Option<&Argument<'_>>, callback_node: &AstNode<'_>) -> bool {
    match (argument, callback_node.kind()) {
        (
            Some(Argument::ArrowFunctionExpression(argument_function)),
            AstKind::ArrowFunctionExpression(callback_function),
        ) => argument_function.span == callback_function.span,
        (
            Some(Argument::FunctionExpression(argument_function)),
            AstKind::Function(callback_function),
        ) => argument_function.span == callback_function.span,
        _ => false,
    }
}

fn resolve_non_parameter_index_binding<'node, 'ast>(
    expression: &Expression<'ast>,
    ctx: &'node LintContext<'ast>,
    depth: usize,
) -> Option<PositionalIndexBinding<'node, 'ast>> {
    if depth > 4 {
        return None;
    }
    if let Expression::Identifier(identifier) = expression.get_inner_expression() {
        let symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        let declaration = ctx.symbol_declaration(symbol_id);
        if let AstKind::VariableDeclarator(declarator) = declaration.kind() {
            if let Some(initializer) = &declarator.init
                && !matches!(
                    initializer.get_inner_expression(),
                    Expression::NumericLiteral(_)
                )
                && let Some(binding) =
                    resolve_non_parameter_index_binding(initializer, ctx, depth + 1)
            {
                return Some(binding);
            }
            if matches!(identifier.name.as_str(), "i" | "idx" | "index")
                && variable_declarator_is_entries_or_loop_counter(
                    declaration.id(),
                    symbol_id,
                    expression.span(),
                    matches!(
                        declarator
                            .init
                            .as_ref()
                            .map(Expression::get_inner_expression),
                        Some(Expression::NumericLiteral(_))
                    ),
                    ctx,
                )
            {
                let is_data_indexed_loop =
                    enclosing_loop_is_data_indexed(expression.span(), symbol_id, ctx);
                return Some(PositionalIndexBinding {
                    name: identifier.name.to_string(),
                    symbol_id,
                    iterator_call: None,
                    binding_function_span: None,
                    item_symbol_ids: Vec::new(),
                    is_data_indexed_loop,
                    is_placeholder_loop: !is_data_indexed_loop
                        && enclosing_loop_is_placeholder(expression.span(), symbol_id, ctx),
                });
            }
        }
        return None;
    }
    match expression.get_inner_expression() {
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .find_map(|expression| resolve_non_parameter_index_binding(expression, ctx, depth + 1)),
        Expression::BinaryExpression(binary) => {
            resolve_non_parameter_index_binding(&binary.left, ctx, depth + 1)
                .or_else(|| resolve_non_parameter_index_binding(&binary.right, ctx, depth + 1))
        }
        Expression::LogicalExpression(logical) => {
            resolve_non_parameter_index_binding(&logical.left, ctx, depth + 1)
                .or_else(|| resolve_non_parameter_index_binding(&logical.right, ctx, depth + 1))
        }
        Expression::ConditionalExpression(conditional) => {
            resolve_non_parameter_index_binding(&conditional.consequent, ctx, depth + 1).or_else(
                || resolve_non_parameter_index_binding(&conditional.alternate, ctx, depth + 1),
            )
        }
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .and_then(|expression| resolve_non_parameter_index_binding(expression, ctx, depth + 1)),
        Expression::UnaryExpression(unary) => {
            resolve_non_parameter_index_binding(&unary.argument, ctx, depth + 1)
        }
        Expression::CallExpression(call) => {
            let source = if call.callee.as_member_expression().is_some_and(|member| {
                member_expression_identifier_property_name(member)
                    .is_some_and(|name| name == "toString")
            }) {
                call.callee
                    .as_member_expression()
                    .map(|member| member.object())
            } else if matches!(&call.callee, Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "String" | "Number"))
            {
                call.arguments.first().and_then(Argument::as_expression)
            } else {
                None
            };
            source.and_then(|expression| {
                resolve_non_parameter_index_binding(expression, ctx, depth + 1)
            })
        }
        _ => None,
    }
}

fn variable_declarator_is_entries_or_loop_counter(
    declaration_id: oxc_semantic::NodeId,
    symbol_id: SymbolId,
    reference_span: Span,
    has_numeric_initializer: bool,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(declaration_id) {
        if let AstKind::ForOfStatement(statement) = ancestor.kind()
            && matches!(statement.right.get_inner_expression(), Expression::CallExpression(call) if is_array_entries_call(call))
        {
            return true;
        }
        if has_numeric_initializer && matches!(ancestor.kind(), AstKind::ForStatement(_)) {
            return true;
        }
    }
    has_numeric_initializer
        && (binding_is_mutated(symbol_id, ctx)
            || ctx
                .nodes()
                .ancestors(
                    ctx.nodes()
                        .iter()
                        .find(|node| node.span() == reference_span)
                        .map_or(declaration_id, AstNode::id),
                )
                .any(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::WhileStatement(_) | AstKind::DoWhileStatement(_)
                    )
                }))
}

fn enclosing_loop_is_data_indexed(
    reference_span: Span,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(reference_node) = ctx
        .nodes()
        .iter()
        .find(|node| node.span() == reference_span)
    else {
        return false;
    };
    ctx.nodes().ancestors(reference_node.id()).any(|ancestor| {
        let (test, body_span) = match ancestor.kind() {
            AstKind::WhileStatement(statement) => (&statement.test, statement.body.span()),
            AstKind::DoWhileStatement(statement) => (&statement.test, statement.body.span()),
            _ => return false,
        };
        loop_has_matching_indexed_collection(test, body_span, symbol_id, ancestor.id(), ctx)
    })
}

fn enclosing_loop_is_placeholder(
    reference_span: Span,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(reference_node) = ctx
        .nodes()
        .iter()
        .find(|node| node.span() == reference_span)
    else {
        return false;
    };
    ctx.nodes().ancestors(reference_node.id()).any(|ancestor| {
        let test = match ancestor.kind() {
            AstKind::ForStatement(statement) => statement.test.as_ref(),
            AstKind::WhileStatement(statement) => Some(&statement.test),
            AstKind::DoWhileStatement(statement) => Some(&statement.test),
            _ => return false,
        };
        test.is_none_or(|test| !loop_test_bounds_counter_by_length(test, symbol_id, ctx))
    })
}

fn loop_test_bounds_counter_by_length(
    test: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let test_span = test.span();
    ctx.nodes().iter().any(|node| {
        if !test_span.contains_inclusive(node.span()) {
            return false;
        }
        let AstKind::BinaryExpression(binary) = node.kind() else {
            return false;
        };
        if !matches!(
            binary.operator,
            BinaryOperator::LessThan
                | BinaryOperator::LessEqualThan
                | BinaryOperator::GreaterThan
                | BinaryOperator::GreaterEqualThan
        ) {
            return false;
        }
        (expression_reads_symbol(&binary.left, symbol_id, ctx)
            && expression_reads_length(&binary.right, ctx))
            || (expression_reads_symbol(&binary.right, symbol_id, ctx)
                && expression_reads_length(&binary.left, ctx))
    })
}

fn expression_reads_symbol(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|node| {
        span.contains_inclusive(node.span())
            && matches!(node.kind(), AstKind::IdentifierReference(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(symbol_id))
    })
}

fn expression_reads_length(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|node| {
        span.contains_inclusive(node.span())
            && matches!(node.kind(), AstKind::StaticMemberExpression(member)
                if member.property.name == "length" && is_static_member_chain(&member.object))
    })
}

fn loop_has_matching_indexed_collection(
    test: &Expression<'_>,
    body_span: Span,
    symbol_id: SymbolId,
    loop_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if !expression_reads_symbol(test, symbol_id, ctx) {
        return false;
    }
    let length_bound_collections: Vec<&Expression<'_>> = ctx
        .nodes()
        .iter()
        .filter_map(|node| {
            if !test.span().contains_inclusive(node.span()) {
                return None;
            }
            let AstKind::StaticMemberExpression(member) = node.kind() else {
                return None;
            };
            (member.property.name == "length" && is_static_member_chain(&member.object))
                .then_some(&member.object)
        })
        .collect();
    if length_bound_collections.is_empty() {
        return false;
    }
    ctx.nodes().iter().any(|node| {
        if !body_span.contains_inclusive(node.span())
            || !node_is_in_loop_scope(node.id(), loop_id, ctx)
        {
            return false;
        }
        let AstKind::ComputedMemberExpression(member) = node.kind() else {
            return false;
        };
        let Expression::Identifier(index) = member.expression.get_inner_expression() else {
            return false;
        };
        ctx.scoping()
            .get_reference(index.reference_id())
            .symbol_id()
            == Some(symbol_id)
            && length_bound_collections
                .iter()
                .any(|collection| same_static_member_chain(collection, &member.object, ctx))
    })
}

fn node_is_in_loop_scope(
    node_id: oxc_semantic::NodeId,
    loop_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == loop_id {
            return true;
        }
        if matches!(
            ancestor.kind(),
            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
        ) {
            return false;
        }
    }
    false
}

fn is_static_member_chain(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(_) | Expression::ThisExpression(_) => true,
        Expression::StaticMemberExpression(member) => is_static_member_chain(&member.object),
        _ => false,
    }
}

fn same_static_member_chain(
    first: &Expression<'_>,
    second: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match (first.get_inner_expression(), second.get_inner_expression()) {
        (Expression::ThisExpression(_), Expression::ThisExpression(_)) => true,
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            first.name == second.name
                && ctx
                    .scoping()
                    .get_reference(first.reference_id())
                    .symbol_id()
                    == ctx
                        .scoping()
                        .get_reference(second.reference_id())
                        .symbol_id()
        }
        (Expression::StaticMemberExpression(first), Expression::StaticMemberExpression(second)) => {
            first.property.name == second.property.name
                && same_static_member_chain(&first.object, &second.object, ctx)
        }
        _ => false,
    }
}

fn iterator_call_exempts_index_key(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    if is_global_method_call(call, "Array", "from") {
        return array_from_has_placeholder_length(call)
            || call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|source| is_provably_string_valued(source, ctx, 0));
    }
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    is_positionally_stable_receiver(member.object(), ctx, 0)
}

fn is_positionally_stable_receiver(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    if depth > 4 {
        return false;
    }
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return false;
        };
        if is_static_default_literal_receiver(symbol_id, ctx) {
            return true;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let Some(initializer) = &declarator.init else {
            return false;
        };
        if binding_is_mutated(symbol_id, ctx) {
            return false;
        }
        if is_fixed_use_memo_call(initializer, ctx) {
            return true;
        }
        return is_positionally_stable_receiver(initializer, ctx, depth + 1);
    }
    if let Expression::ArrayExpression(array) = expression {
        return matches!(array.elements.as_slice(), [ArrayExpressionElement::SpreadElement(spread)]
            if is_provably_string_valued(&spread.argument, ctx, 0)
                || is_positionally_stable_receiver(&spread.argument, ctx, depth + 1));
    }
    if let Expression::NewExpression(construction) = expression {
        return matches!(&construction.callee, Expression::Identifier(identifier)
            if identifier.name == "Array" && construction.arguments.len() <= 1);
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    if matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "Array") {
        return call.arguments.len() <= 1;
    }
    if is_global_method_call(call, "Array", "from") {
        return true;
    }
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    let Some(method_name) = member_expression_identifier_property_name(member) else {
        return false;
    };
    matches!(method_name, "fill" | "flat")
        && is_positionally_stable_receiver(member.object(), ctx, depth + 1)
}

fn is_static_default_literal_receiver(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::FormalParameter(parameter) = declaration.kind() else {
        return false;
    };
    let Some(default_expression) = pattern_default_for_symbol(&parameter.pattern, symbol_id) else {
        return false;
    };
    if is_spread_free_nonempty_array(default_expression) {
        return true;
    }
    let Expression::Identifier(identifier) = default_expression.get_inner_expression() else {
        return false;
    };
    let Some(default_symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    stable_const_initializer(default_symbol_id, ctx).is_some_and(is_spread_free_nonempty_array)
        && !binding_is_mutated(default_symbol_id, ctx)
}

fn pattern_default_for_symbol<'borrow, 'ast>(
    pattern: &'borrow BindingPattern<'ast>,
    symbol_id: SymbolId,
) -> Option<&'borrow Expression<'ast>> {
    match pattern {
        BindingPattern::AssignmentPattern(assignment)
            if assignment
                .left
                .get_binding_identifiers()
                .iter()
                .any(|identifier| identifier.symbol_id() == symbol_id) =>
        {
            Some(&assignment.right)
        }
        BindingPattern::ObjectPattern(object) => object
            .properties
            .iter()
            .find_map(|property| pattern_default_for_symbol(&property.value, symbol_id)),
        BindingPattern::ArrayPattern(array) => array
            .elements
            .iter()
            .flatten()
            .find_map(|element| pattern_default_for_symbol(element, symbol_id)),
        _ => None,
    }
}

fn array_from_has_placeholder_length(call: &CallExpression<'_>) -> bool {
    let Some(Argument::ObjectExpression(object)) = call.arguments.first() else {
        return false;
    };
    object.properties.iter().any(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if property.key.static_name().as_deref() != Some("length") {
            return false;
        }
        matches!(
            property.value.get_inner_expression(),
            Expression::NumericLiteral(_) | Expression::Identifier(_)
        ) || property
            .value
            .as_member_expression()
            .is_some_and(|member| member.static_property_name() == Some("length"))
    })
}

fn is_provably_string_valued(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    if depth > 4 {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::StringLiteral(_) | Expression::TemplateLiteral(_) => true,
        Expression::CallExpression(call) if matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "String") => {
            true
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            if let AstKind::VariableDeclarator(declarator) = declaration.kind()
                && let Some(initializer) = &declarator.init
                && is_provably_string_valued(initializer, ctx, depth + 1)
            {
                return true;
            }
            symbol_has_string_annotation(symbol_id, ctx, depth)
        }
        _ => false,
    }
}

fn symbol_has_string_annotation(symbol_id: SymbolId, ctx: &LintContext<'_>, depth: usize) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => {
            declarator
                .type_annotation
                .as_ref()
                .is_some_and(|annotation| {
                    matches!(&annotation.type_annotation, TSType::TSStringKeyword(_))
                })
        }
        AstKind::FormalParameter(parameter) => {
            if parameter
                .pattern
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
            {
                return parameter
                    .type_annotation
                    .as_ref()
                    .is_some_and(|annotation| {
                        matches!(&annotation.type_annotation, TSType::TSStringKeyword(_))
                    });
            }
            let BindingPattern::ObjectPattern(object_pattern) = &parameter.pattern else {
                return false;
            };
            let Some(property_name) = object_pattern.properties.iter().find_map(|property| {
                property
                    .value
                    .get_binding_identifiers()
                    .iter()
                    .any(|identifier| identifier.symbol_id() == symbol_id)
                    .then(|| property.key.static_name())
                    .flatten()
            }) else {
                return false;
            };
            parameter
                .type_annotation
                .as_ref()
                .is_some_and(|annotation| {
                    type_declares_string_property(
                        &annotation.type_annotation,
                        property_name.as_ref(),
                        ctx,
                        depth + 1,
                    )
                })
        }
        _ => false,
    }
}

fn type_declares_string_property(
    type_node: &TSType<'_>,
    property_name: &str,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    if depth > 4 {
        return false;
    }
    match type_node {
        TSType::TSTypeLiteral(literal) => {
            type_members_declare_string_property(&literal.members, property_name)
        }
        TSType::TSTypeReference(reference) => {
            let TSTypeName::IdentifierReference(identifier) = &reference.type_name else {
                return false;
            };
            ctx.nodes().iter().any(|node| match node.kind() {
                AstKind::TSInterfaceDeclaration(interface)
                    if interface.id.name == identifier.name =>
                {
                    type_members_declare_string_property(&interface.body.body, property_name)
                }
                AstKind::TSTypeAliasDeclaration(alias) if alias.id.name == identifier.name => {
                    type_declares_string_property(
                        &alias.type_annotation,
                        property_name,
                        ctx,
                        depth + 1,
                    )
                }
                _ => false,
            })
        }
        _ => false,
    }
}

fn type_members_declare_string_property(members: &[TSSignature<'_>], property_name: &str) -> bool {
    members.iter().any(|member| {
        let TSSignature::TSPropertySignature(property) = member else {
            return false;
        };
        !property.computed
            && property.key.static_name().as_deref() == Some(property_name)
            && property.type_annotation.as_ref().is_some_and(|annotation| {
                matches!(&annotation.type_annotation, TSType::TSStringKeyword(_))
            })
    })
}

fn binding_is_mutated(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    const MUTATING_METHODS: [&str; 9] = [
        "copyWithin",
        "fill",
        "pop",
        "push",
        "reverse",
        "shift",
        "sort",
        "splice",
        "unshift",
    ];
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return true;
            }
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let member_node = ctx.nodes().parent_node(reference_node.id());
            let is_mutating_member = match member_node.kind() {
                AstKind::StaticMemberExpression(member)
                    if member.object.span() == reference_node.span() =>
                {
                    MUTATING_METHODS.contains(&member.property.name.as_str())
                }
                AstKind::ComputedMemberExpression(member)
                    if member.object.span() == reference_node.span() =>
                {
                    member
                        .static_property_name()
                        .as_deref()
                        .is_some_and(|method| MUTATING_METHODS.contains(&method))
                }
                _ => false,
            };
            is_mutating_member
                && matches!(
                    ctx.nodes().parent_node(member_node.id()).kind(),
                    AstKind::CallExpression(_)
                )
        })
}

fn is_fixed_use_memo_call(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    let is_use_memo = matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "useMemo")
        || call.callee.as_member_expression().is_some_and(|member| {
            member_expression_identifier_property_name(member).is_some_and(|name| name == "useMemo")
        });
    if !is_use_memo {
        return false;
    }
    if matches!(call.arguments.get(1), Some(Argument::ArrayExpression(array)) if array.elements.is_empty())
    {
        return true;
    }
    call.arguments
        .first()
        .and_then(Argument::as_expression)
        .is_some_and(|factory| use_memo_factory_returns_only_fixed_arrays(factory, ctx))
}

fn use_memo_factory_returns_only_fixed_arrays(
    factory: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let (function_span, expression_body) = match factory.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => (function.span, function.get_expression()),
        Expression::FunctionExpression(function) => (function.span, None),
        _ => return false,
    };
    if let Some(expression) = expression_body {
        return is_spread_free_nonempty_array(expression);
    }
    let mut did_find_return = false;
    let mut all_returns_are_fixed_arrays = true;
    for node in ctx
        .nodes()
        .iter()
        .filter(|node| function_span.contains_inclusive(node.span()))
    {
        let AstKind::ReturnStatement(statement) = node.kind() else {
            continue;
        };
        if nearest_function_span(node.id(), ctx) != Some(function_span) {
            continue;
        }
        did_find_return = true;
        if statement
            .argument
            .as_ref()
            .is_none_or(|argument| !is_spread_free_nonempty_array(argument))
        {
            all_returns_are_fixed_arrays = false;
            break;
        }
    }
    did_find_return && all_returns_are_fixed_arrays
}

fn nearest_function_span(node_id: oxc_semantic::NodeId, ctx: &LintContext<'_>) -> Option<Span> {
    ctx.nodes()
        .ancestors(node_id)
        .find_map(|ancestor| match ancestor.kind() {
            AstKind::ArrowFunctionExpression(function) => Some(function.span),
            AstKind::Function(function) => Some(function.span),
            _ => None,
        })
}

fn is_spread_free_nonempty_array(expression: &Expression<'_>) -> bool {
    let Expression::ArrayExpression(array) = expression.get_inner_expression() else {
        return false;
    };
    !array.elements.is_empty()
        && array
            .elements
            .iter()
            .all(|element| !matches!(element, ArrayExpressionElement::SpreadElement(_)))
}

fn is_global_method_call(call: &CallExpression<'_>, object_name: &str, method_name: &str) -> bool {
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return false;
    };
    member.property.name == method_name
        && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == object_name)
}

fn jsx_expression_uses_index_or_alias(
    expression: &JSXExpression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    expression
        .as_expression()
        .is_some_and(|expression| expression_uses_index(expression, symbol_id, ctx, depth))
}

fn jsx_expression_index_candidate(
    expression: &JSXExpression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    depth: usize,
) -> Option<IndexKeyCandidate> {
    expression
        .as_expression()
        .and_then(|expression| expression_index_candidate(expression, symbol_id, ctx, depth))
}

fn expression_index_candidate(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    depth: usize,
) -> Option<IndexKeyCandidate> {
    if depth > 4 {
        return None;
    }
    if let Expression::Identifier(identifier) = expression.get_inner_expression() {
        if is_index_reference(expression, symbol_id, ctx) {
            return Some(IndexKeyCandidate {
                name: identifier.name.to_string(),
                order: vec![identifier.span.start],
            });
        }
        if let Some(alias_symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            && let AstKind::VariableDeclarator(declarator) =
                ctx.symbol_declaration(alias_symbol_id).kind()
            && let Some(initializer) = &declarator.init
            && let Some(mut candidate) =
                expression_index_candidate(initializer, symbol_id, ctx, depth + 1)
        {
            candidate.name = identifier.name.to_string();
            candidate.order.insert(0, identifier.span.start);
            return Some(candidate);
        }
        return None;
    }
    match expression.get_inner_expression() {
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .find_map(|slot| expression_index_candidate(slot, symbol_id, ctx, depth + 1)),
        Expression::BinaryExpression(binary) => {
            if binary_expression_uses_index(binary, symbol_id, ctx, depth + 1) {
                expression_index_candidate(&binary.left, symbol_id, ctx, depth + 1).or_else(|| {
                    expression_index_candidate(&binary.right, symbol_id, ctx, depth + 1)
                })
            } else {
                None
            }
        }
        Expression::LogicalExpression(logical) => {
            let left_value = read_static_key_branch_value(&logical.left, ctx, 0);
            let selected_expression = match logical.operator {
                oxc_syntax::operator::LogicalOperator::And
                    if left_value.is_some_and(|value| value.is_truthy == Some(false)) =>
                {
                    Some(&logical.left)
                }
                oxc_syntax::operator::LogicalOperator::And
                    if left_value.is_some_and(|value| value.is_truthy == Some(true)) =>
                {
                    Some(&logical.right)
                }
                oxc_syntax::operator::LogicalOperator::Or
                    if left_value.is_some_and(|value| value.is_truthy == Some(true)) =>
                {
                    Some(&logical.left)
                }
                oxc_syntax::operator::LogicalOperator::Or
                    if left_value.is_some_and(|value| value.is_truthy == Some(false)) =>
                {
                    Some(&logical.right)
                }
                oxc_syntax::operator::LogicalOperator::Coalesce
                    if left_value.is_some_and(|value| value.is_nullish == Some(false)) =>
                {
                    Some(&logical.left)
                }
                oxc_syntax::operator::LogicalOperator::Coalesce
                    if left_value.is_some_and(|value| value.is_nullish == Some(true)) =>
                {
                    Some(&logical.right)
                }
                _ => None,
            };
            if let Some(selected_expression) = selected_expression {
                expression_index_candidate(selected_expression, symbol_id, ctx, depth + 1)
            } else {
                expression_index_candidate(&logical.left, symbol_id, ctx, depth + 1).or_else(|| {
                    expression_index_candidate(&logical.right, symbol_id, ctx, depth + 1)
                })
            }
        }
        Expression::ConditionalExpression(conditional) => {
            match read_static_key_branch_value(&conditional.test, ctx, 0)
                .and_then(|value| value.is_truthy)
            {
                Some(true) => {
                    expression_index_candidate(&conditional.consequent, symbol_id, ctx, depth + 1)
                }
                Some(false) => {
                    expression_index_candidate(&conditional.alternate, symbol_id, ctx, depth + 1)
                }
                None => {
                    expression_index_candidate(&conditional.consequent, symbol_id, ctx, depth + 1)
                        .or_else(|| {
                            expression_index_candidate(
                                &conditional.alternate,
                                symbol_id,
                                ctx,
                                depth + 1,
                            )
                        })
                }
            }
        }
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .and_then(|final_| expression_index_candidate(final_, symbol_id, ctx, depth + 1)),
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus | UnaryOperator::BitwiseNot
            ) =>
        {
            expression_index_candidate(&unary.argument, symbol_id, ctx, depth + 1)
        }
        Expression::CallExpression(call) => {
            if let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression()
                && member.property.name == "toString"
            {
                return expression_index_candidate(&member.object, symbol_id, ctx, depth + 1);
            }
            if matches!(&call.callee, Expression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "String" | "Number")
                    && ctx.is_reference_to_global_variable(identifier))
            {
                return call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .and_then(|argument| {
                        expression_index_candidate(argument, symbol_id, ctx, depth + 1)
                    });
            }
            None
        }
        _ => None,
    }
}

fn expression_uses_index(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    if depth > 4 {
        return false;
    }
    if is_index_reference(expression, symbol_id, ctx) {
        return true;
    }
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(alias_symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        && let AstKind::VariableDeclarator(declarator) =
            ctx.symbol_declaration(alias_symbol_id).kind()
        && let Some(initializer) = &declarator.init
    {
        return expression_uses_index(initializer, symbol_id, ctx, depth + 1);
    }
    match expression.get_inner_expression() {
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .any(|expression| expression_uses_index(expression, symbol_id, ctx, depth + 1)),
        Expression::BinaryExpression(binary) => {
            binary_expression_uses_index(binary, symbol_id, ctx, depth + 1)
        }
        Expression::LogicalExpression(logical) => {
            let left_value = read_static_key_branch_value(&logical.left, ctx, 0);
            match logical.operator {
                oxc_syntax::operator::LogicalOperator::And
                    if left_value.is_some_and(|value| value.is_truthy == Some(false)) =>
                {
                    expression_uses_index(&logical.left, symbol_id, ctx, depth + 1)
                }
                oxc_syntax::operator::LogicalOperator::And
                    if left_value.is_some_and(|value| value.is_truthy == Some(true)) =>
                {
                    expression_uses_index(&logical.right, symbol_id, ctx, depth + 1)
                }
                oxc_syntax::operator::LogicalOperator::Or
                    if left_value.is_some_and(|value| value.is_truthy == Some(true)) =>
                {
                    expression_uses_index(&logical.left, symbol_id, ctx, depth + 1)
                }
                oxc_syntax::operator::LogicalOperator::Or
                    if left_value.is_some_and(|value| value.is_truthy == Some(false)) =>
                {
                    expression_uses_index(&logical.right, symbol_id, ctx, depth + 1)
                }
                oxc_syntax::operator::LogicalOperator::Coalesce
                    if left_value.is_some_and(|value| value.is_nullish == Some(false)) =>
                {
                    expression_uses_index(&logical.left, symbol_id, ctx, depth + 1)
                }
                oxc_syntax::operator::LogicalOperator::Coalesce
                    if left_value.is_some_and(|value| value.is_nullish == Some(true)) =>
                {
                    expression_uses_index(&logical.right, symbol_id, ctx, depth + 1)
                }
                _ => {
                    expression_uses_index(&logical.left, symbol_id, ctx, depth + 1)
                        || expression_uses_index(&logical.right, symbol_id, ctx, depth + 1)
                }
            }
        }
        Expression::ConditionalExpression(conditional) => {
            match read_static_key_branch_value(&conditional.test, ctx, 0)
                .and_then(|value| value.is_truthy)
            {
                Some(true) => {
                    expression_uses_index(&conditional.consequent, symbol_id, ctx, depth + 1)
                }
                Some(false) => {
                    expression_uses_index(&conditional.alternate, symbol_id, ctx, depth + 1)
                }
                None => {
                    expression_uses_index(&conditional.consequent, symbol_id, ctx, depth + 1)
                        || expression_uses_index(&conditional.alternate, symbol_id, ctx, depth + 1)
                }
            }
        }
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .is_some_and(|expression| expression_uses_index(expression, symbol_id, ctx, depth + 1)),
        Expression::UnaryExpression(unary)
            if matches!(
                unary.operator,
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus | UnaryOperator::BitwiseNot
            ) =>
        {
            expression_uses_index(&unary.argument, symbol_id, ctx, depth + 1)
        }
        Expression::CallExpression(call) => {
            if matches!(call.callee.get_inner_expression(), Expression::StaticMemberExpression(member)
                if member.property.name == "toString"
                    && expression_uses_index(&member.object, symbol_id, ctx, depth + 1))
            {
                return true;
            }
            matches!(&call.callee, Expression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "String" | "Number")
                    && ctx.is_reference_to_global_variable(identifier))
                && call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        expression_uses_index(argument, symbol_id, ctx, depth + 1)
                    })
        }
        _ => false,
    }
}

fn binary_expression_uses_index(
    binary: &BinaryExpression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    let left_is_empty_string = matches!(binary.left.get_inner_expression(), Expression::StringLiteral(literal) if literal.value.is_empty());
    let right_is_empty_string = matches!(binary.right.get_inner_expression(), Expression::StringLiteral(literal) if literal.value.is_empty());
    if binary.operator == BinaryOperator::Addition {
        if left_is_empty_string
            && matches!(
                binary.right.get_inner_expression(),
                Expression::Identifier(_)
            )
        {
            return expression_uses_index(&binary.right, symbol_id, ctx, depth);
        }
        if right_is_empty_string
            && matches!(
                binary.left.get_inner_expression(),
                Expression::Identifier(_)
            )
        {
            return expression_uses_index(&binary.left, symbol_id, ctx, depth);
        }
    }
    if !matches!(
        binary.operator,
        BinaryOperator::Addition
            | BinaryOperator::Subtraction
            | BinaryOperator::Multiplication
            | BinaryOperator::Division
            | BinaryOperator::Remainder
    ) {
        return false;
    }
    if matches!(
        binary.right.get_inner_expression(),
        Expression::NumericLiteral(_)
    ) && matches!(
        binary.left.get_inner_expression(),
        Expression::Identifier(_)
    ) {
        return expression_uses_index(&binary.left, symbol_id, ctx, depth);
    }
    matches!(
        binary.left.get_inner_expression(),
        Expression::NumericLiteral(_)
    ) && matches!(
        binary.right.get_inner_expression(),
        Expression::Identifier(_)
    ) && expression_uses_index(&binary.right, symbol_id, ctx, depth)
}

#[derive(Clone, Copy)]
struct StaticKeyBranchValue {
    is_nullish: Option<bool>,
    is_truthy: Option<bool>,
}

fn read_static_key_branch_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    depth: usize,
) -> Option<StaticKeyBranchValue> {
    if depth > 4 {
        return None;
    }
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(StaticKeyBranchValue {
            is_nullish: Some(false),
            is_truthy: Some(literal.value),
        }),
        Expression::NullLiteral(_) => Some(StaticKeyBranchValue {
            is_nullish: Some(true),
            is_truthy: Some(false),
        }),
        Expression::NumericLiteral(literal) => Some(StaticKeyBranchValue {
            is_nullish: Some(false),
            is_truthy: Some(literal.value != 0.0 && !literal.value.is_nan()),
        }),
        Expression::StringLiteral(literal) => Some(StaticKeyBranchValue {
            is_nullish: Some(false),
            is_truthy: Some(!literal.value.is_empty()),
        }),
        Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ClassExpression(_)
        | Expression::NewExpression(_) => Some(StaticKeyBranchValue {
            is_nullish: Some(false),
            is_truthy: Some(true),
        }),
        Expression::TemplateLiteral(template) => Some(StaticKeyBranchValue {
            is_nullish: Some(false),
            is_truthy: template
                .quasis
                .iter()
                .any(|quasi| !quasi.value.raw.is_empty())
                .then_some(true),
        }),
        Expression::BinaryExpression(_) => Some(StaticKeyBranchValue {
            is_nullish: Some(false),
            is_truthy: None,
        }),
        Expression::Identifier(identifier) => {
            if let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            {
                return stable_const_initializer(symbol_id, ctx).and_then(|initializer| {
                    read_static_key_branch_value(initializer, ctx, depth + 1)
                });
            }
            match identifier.name.as_str() {
                "undefined" => Some(StaticKeyBranchValue {
                    is_nullish: Some(true),
                    is_truthy: Some(false),
                }),
                "NaN" => Some(StaticKeyBranchValue {
                    is_nullish: Some(false),
                    is_truthy: Some(false),
                }),
                "Infinity" => Some(StaticKeyBranchValue {
                    is_nullish: Some(false),
                    is_truthy: Some(true),
                }),
                _ => None,
            }
        }
        Expression::CallExpression(call)
            if matches!(&call.callee, Expression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "String" | "Number")
                    && ctx.is_reference_to_global_variable(identifier)) =>
        {
            Some(StaticKeyBranchValue {
                is_nullish: Some(false),
                is_truthy: None,
            })
        }
        Expression::UnaryExpression(unary) => match unary.operator {
            UnaryOperator::Void => Some(StaticKeyBranchValue {
                is_nullish: Some(true),
                is_truthy: Some(false),
            }),
            UnaryOperator::Typeof => Some(StaticKeyBranchValue {
                is_nullish: Some(false),
                is_truthy: Some(true),
            }),
            UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus | UnaryOperator::BitwiseNot => {
                Some(StaticKeyBranchValue {
                    is_nullish: Some(false),
                    is_truthy: None,
                })
            }
            UnaryOperator::LogicalNot => {
                let value = read_static_key_branch_value(&unary.argument, ctx, depth + 1)?;
                Some(StaticKeyBranchValue {
                    is_nullish: Some(false),
                    is_truthy: value.is_truthy.map(|truthy| !truthy),
                })
            }
            _ => None,
        },
        Expression::SequenceExpression(sequence) => {
            sequence.expressions.last().and_then(|final_expression| {
                read_static_key_branch_value(final_expression, ctx, depth + 1)
            })
        }
        Expression::LogicalExpression(logical) => {
            let left = read_static_key_branch_value(&logical.left, ctx, depth + 1);
            if let Some(left) = left {
                match logical.operator {
                    oxc_syntax::operator::LogicalOperator::And if left.is_truthy.is_some() => {
                        return if left.is_truthy == Some(true) {
                            read_static_key_branch_value(&logical.right, ctx, depth + 1)
                        } else {
                            Some(left)
                        };
                    }
                    oxc_syntax::operator::LogicalOperator::Or if left.is_truthy.is_some() => {
                        return if left.is_truthy == Some(true) {
                            Some(left)
                        } else {
                            read_static_key_branch_value(&logical.right, ctx, depth + 1)
                        };
                    }
                    oxc_syntax::operator::LogicalOperator::Coalesce
                        if left.is_nullish.is_some() =>
                    {
                        return if left.is_nullish == Some(true) {
                            read_static_key_branch_value(&logical.right, ctx, depth + 1)
                        } else {
                            Some(left)
                        };
                    }
                    _ => {}
                }
            }
            let left = left.unwrap_or(StaticKeyBranchValue {
                is_nullish: None,
                is_truthy: None,
            });
            let right = read_static_key_branch_value(&logical.right, ctx, depth + 1).unwrap_or(
                StaticKeyBranchValue {
                    is_nullish: None,
                    is_truthy: None,
                },
            );
            Some(match logical.operator {
                oxc_syntax::operator::LogicalOperator::Or => StaticKeyBranchValue {
                    is_nullish: (right.is_nullish == Some(false)).then_some(false),
                    is_truthy: (right.is_truthy == Some(true)).then_some(true),
                },
                oxc_syntax::operator::LogicalOperator::And => StaticKeyBranchValue {
                    is_nullish: (left.is_nullish == Some(false) && right.is_nullish == Some(false))
                        .then_some(false),
                    is_truthy: (right.is_truthy == Some(false)).then_some(false),
                },
                oxc_syntax::operator::LogicalOperator::Coalesce => StaticKeyBranchValue {
                    is_nullish: (right.is_nullish == Some(false)).then_some(false),
                    is_truthy: (left.is_truthy.is_some() && left.is_truthy == right.is_truthy)
                        .then_some(left.is_truthy)
                        .flatten(),
                },
            })
        }
        Expression::ConditionalExpression(conditional) => {
            let test = read_static_key_branch_value(&conditional.test, ctx, depth + 1);
            if let Some(truthy) = test.and_then(|value| value.is_truthy) {
                return read_static_key_branch_value(
                    if truthy {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    ctx,
                    depth + 1,
                );
            }
            let consequent = read_static_key_branch_value(&conditional.consequent, ctx, depth + 1)?;
            let alternate = read_static_key_branch_value(&conditional.alternate, ctx, depth + 1)?;
            Some(StaticKeyBranchValue {
                is_nullish: (consequent.is_nullish == alternate.is_nullish)
                    .then_some(consequent.is_nullish)
                    .flatten(),
                is_truthy: (consequent.is_truthy == alternate.is_truthy)
                    .then_some(consequent.is_truthy)
                    .flatten(),
            })
        }
        _ => None,
    }
}

fn stable_const_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return None;
    };
    (variable_declaration.kind.is_const()
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id))
    .then(|| declarator.init.as_ref())?
}

fn is_index_reference(
    expression: &Expression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id() == Some(symbol_id))
}

fn has_aria_hidden_ancestor(
    element: &JSXElement<'_>,
    node_id: oxc_semantic::NodeId,
    is_data_indexed_loop: bool,
    ctx: &LintContext<'_>,
) -> bool {
    if is_data_indexed_loop {
        return false;
    }
    if element
        .opening_element
        .attributes
        .iter()
        .any(is_literal_true_aria_hidden)
    {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::JSXElement(element)
                if element
                    .opening_element
                    .attributes
                    .iter()
                    .any(is_literal_true_aria_hidden) =>
            {
                return true;
            }
            AstKind::ArrowFunctionExpression(_) | AstKind::Function(_) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                if !matches!(parent.kind(), AstKind::CallExpression(call) if call.arguments.iter().any(|argument| callback_argument_matches(Some(argument), ancestor)))
                {
                    return false;
                }
            }
            AstKind::Program(_) => return false,
            _ => {}
        }
    }
    false
}

fn is_literal_true_aria_hidden(attribute: &JSXAttributeItem<'_>) -> bool {
    let JSXAttributeItem::Attribute(attribute) = attribute else {
        return false;
    };
    if !matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "aria-hidden")
    {
        return false;
    }
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(literal)) => literal.value == "true",
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(&container.expression, JSXExpression::BooleanLiteral(literal) if literal.value)
        }
        _ => false,
    }
}

fn template_has_outer_member_identity(
    expression: &JSXExpression<'_>,
    binding_function_span: Option<Span>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(binding_function_span) = binding_function_span else {
        return false;
    };
    let Some(mut expression) = expression.as_expression() else {
        return false;
    };
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        && let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
        && let Some(initializer) = &declarator.init
    {
        expression = initializer;
    }
    let Expression::TemplateLiteral(template) = expression.get_inner_expression() else {
        return false;
    };
    if template.expressions.len() < 2 {
        return false;
    }
    template.expressions.iter().any(|slot| {
        expression_root_identifier_symbol(slot, ctx).is_some_and(|symbol_id| {
            !binding_function_span.contains_inclusive(ctx.symbol_declaration(symbol_id).span())
        }) && !matches!(slot.get_inner_expression(), Expression::Identifier(_))
    })
}

fn expression_root_identifier_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let mut expression = expression.get_inner_expression();
    if let Expression::CallExpression(call) = expression
        && matches!(&call.callee, Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "String" | "Number"))
    {
        expression = call
            .arguments
            .first()?
            .as_expression()?
            .get_inner_expression();
    }
    loop {
        if let Some(member) = expression.as_member_expression() {
            expression = member.object().get_inner_expression();
            continue;
        }
        let Expression::Identifier(identifier) = expression else {
            return None;
        };
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
    }
}

fn iterator_call_receiver<'a>(call: &'a CallExpression<'a>) -> Option<&'a Expression<'a>> {
    if is_global_method_call(call, "Array", "from") {
        return call.arguments.first().and_then(Argument::as_expression);
    }
    call.callee
        .as_member_expression()
        .map(oxc_ast::ast::MemberExpression::object)
}

fn is_dynamic_react_children_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    if depth > 4 {
        return false;
    }
    let expression = expression.get_inner_expression();
    if is_react_children_to_array_call(expression, ctx)
        || is_react_children_array_normalization(expression, ctx)
    {
        return true;
    }
    if let Expression::Identifier(identifier) = expression
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        && let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
        && let Some(initializer) = &declarator.init
    {
        return is_dynamic_react_children_expression(initializer, ctx, depth + 1)
            || is_mutated_react_children_accumulator(symbol_id, ctx, depth + 1);
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    member.static_property_name() == Some("filter")
        && is_dynamic_react_children_expression(member.object(), ctx, depth + 1)
}

fn is_react_children_to_array_call(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    let Some(to_array) = call.callee.as_member_expression() else {
        return false;
    };
    if to_array.static_property_name() != Some("toArray")
        || !is_react_children_object(to_array.object(), ctx)
    {
        return false;
    }
    call.arguments
        .first()
        .and_then(Argument::as_expression)
        .is_some_and(|argument| is_children_parameter(argument, ctx))
}

fn is_react_children_object(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
    {
        return react_import_matches(symbol_id, "Children", false, ctx);
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("Children") {
        return false;
    }
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return false;
    };
    if identifier.name == "React" && ctx.is_reference_to_global_variable(identifier) {
        return true;
    }
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| react_import_matches(symbol_id, "default", true, ctx))
}

fn react_import_matches(
    symbol_id: SymbolId,
    imported_name: &str,
    allow_namespace: bool,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == "react"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && match &entry.import_name {
                crate::module_record::ImportImportName::NamespaceObject => allow_namespace,
                crate::module_record::ImportImportName::Default(_) => imported_name == "default",
                crate::module_record::ImportImportName::Name(name) => name.name() == imported_name,
            }
    })
}

fn is_children_parameter(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    if identifier.name != "children" {
        return false;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    matches!(
        ctx.symbol_declaration(symbol_id).kind(),
        AstKind::FormalParameter(_)
    )
}

fn is_react_children_array_normalization(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::ConditionalExpression(conditional) = expression else {
        return false;
    };
    let Expression::CallExpression(test) = conditional.test.get_inner_expression() else {
        return false;
    };
    let Some(is_array) = test.callee.as_member_expression() else {
        return false;
    };
    if is_array.static_property_name() != Some("isArray")
        || !matches!(is_array.object().get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Array" && ctx.is_reference_to_global_variable(identifier))
    {
        return false;
    }
    let Some(tested) = test.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    if !is_children_parameter(tested, ctx) {
        return false;
    }
    (same_identifier_binding(&conditional.consequent, tested, ctx)
        && single_element_array_contains(&conditional.alternate, tested, ctx))
        || (same_identifier_binding(&conditional.alternate, tested, ctx)
            && single_element_array_contains(&conditional.consequent, tested, ctx))
}

fn same_identifier_binding(
    first: &Expression<'_>,
    second: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let (Expression::Identifier(first), Expression::Identifier(second)) =
        (first.get_inner_expression(), second.get_inner_expression())
    else {
        return false;
    };
    ctx.scoping()
        .get_reference(first.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| {
            ctx.scoping()
                .get_reference(second.reference_id())
                .symbol_id()
                == Some(symbol_id)
        })
}

fn single_element_array_contains(
    expression: &Expression<'_>,
    tested: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::ArrayExpression(array) = expression.get_inner_expression() else {
        return false;
    };
    let [element] = array.elements.as_slice() else {
        return false;
    };
    let Some(Expression::Identifier(identifier)) = element
        .as_expression()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Expression::Identifier(tested) = tested.get_inner_expression() else {
        return false;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_some_and(|symbol_id| {
            ctx.scoping()
                .get_reference(tested.reference_id())
                .symbol_id()
                == Some(symbol_id)
        })
}

fn is_mutated_react_children_accumulator(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    if depth > 4 {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(declarator.init.as_ref().map(Expression::get_inner_expression), Some(Expression::ArrayExpression(array)) if array.elements.is_empty())
    {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(node.id());
            let AstKind::StaticMemberExpression(member) = parent.kind() else {
                return false;
            };
            if member.property.name != "push" {
                return false;
            }
            let call_node = ctx.nodes().parent_node(parent.id());
            let AstKind::CallExpression(call) = call_node.kind() else {
                return false;
            };
            call.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    expression_contains_react_child_iteration_value(argument, ctx, depth + 1)
                })
            })
        })
}

fn expression_contains_react_child_iteration_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    depth: usize,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|node| {
        span.contains_inclusive(node.span())
            && matches!(node.kind(), AstKind::IdentifierReference(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(|symbol_id| {
                    let declaration = ctx.symbol_declaration(symbol_id);
                    let AstKind::VariableDeclarator(_) = declaration.kind() else { return false; };
                    let variable_declaration = ctx.nodes().parent_node(declaration.id());
                    let for_of = ctx.nodes().parent_node(variable_declaration.id());
                    matches!(for_of.kind(), AstKind::ForOfStatement(statement)
                        if is_dynamic_react_children_expression(&statement.right, ctx, depth + 1))
                }))
    })
}

fn collect_derived_row_content_symbols(
    binding: &PositionalIndexBinding<'_, '_>,
    ctx: &LintContext<'_>,
) -> Vec<SymbolId> {
    let Some(function_span) = binding.binding_function_span else {
        return Vec::new();
    };
    let mut symbols = Vec::new();
    for node in ctx
        .nodes()
        .iter()
        .filter(|node| function_span.contains_inclusive(node.span()))
        .take(200)
    {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            continue;
        };
        if nearest_function_span(node.id(), ctx) != Some(function_span) {
            continue;
        }
        let Some(identifier) = declarator.id.get_binding_identifier() else {
            continue;
        };
        let Some(initializer) = &declarator.init else {
            continue;
        };
        if derived_expression_root_identifier_symbol(initializer, ctx)
            .is_some_and(|root| binding.item_symbol_ids.contains(&root))
        {
            symbols.push(identifier.symbol_id());
        }
    }
    symbols
}

fn element_is_exempt_stateless_row(
    element: &JSXElement<'_>,
    key_expression: &JSXExpression<'_>,
    binding: &PositionalIndexBinding<'_, '_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut derived_symbol_ids = collect_derived_row_content_symbols(binding, ctx);
    let has_dynamic_react_children = binding
        .iterator_call
        .and_then(iterator_call_receiver)
        .is_some_and(|receiver| is_dynamic_react_children_expression(receiver, ctx, 0));
    if let JSXElementName::MemberExpression(member) = &element.opening_element.name {
        return matches!(&member.object, JSXMemberExpressionObject::IdentifierReference(identifier) if identifier.name == "React")
            && member.property.name == "Fragment"
            && !children_are_stateful(
                &element.children,
                binding,
                &derived_symbol_ids,
                true,
                true,
                !has_dynamic_react_children,
                ctx,
            );
    }
    let name = match &element.opening_element.name {
        JSXElementName::Identifier(name) => name.name.as_str(),
        JSXElementName::IdentifierReference(name) if name.name == "Fragment" => "Fragment",
        _ => return false,
    };
    if is_pure_svg_primitive(name) {
        return !binding
            .binding_function_span
            .is_some_and(|span| function_span_has_null_return(span, ctx));
    }
    if name == "Fragment" {
        let has_element_child = element
            .children
            .iter()
            .any(|child| matches!(child, JSXChild::Element(_)));
        return !children_are_stateful(
            &element.children,
            binding,
            &derived_symbol_ids,
            true,
            true,
            !has_element_child && !has_dynamic_react_children,
            ctx,
        );
    }
    if !is_stateless_html_leaf(name) {
        return false;
    }
    if opening_element_is_stateful(&element.opening_element) {
        return false;
    }
    let is_inline_text = is_inline_text_leaf(name);
    if !has_dynamic_react_children {
        derived_symbol_ids.extend(key_template_item_symbols(
            key_expression,
            &binding.item_symbol_ids,
            ctx,
        ));
    }
    !children_are_stateful(
        &element.children,
        binding,
        &derived_symbol_ids,
        false,
        is_inline_text,
        false,
        ctx,
    )
}

fn key_template_item_symbols(
    key_expression: &JSXExpression<'_>,
    item_symbol_ids: &[SymbolId],
    ctx: &LintContext<'_>,
) -> Vec<SymbolId> {
    let Some(mut expression) = key_expression.as_expression() else {
        return Vec::new();
    };
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        && let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
        && let Some(initializer) = &declarator.init
    {
        expression = initializer;
    }
    let Expression::TemplateLiteral(template) = expression.get_inner_expression() else {
        return Vec::new();
    };
    template
        .expressions
        .iter()
        .filter_map(|slot| {
            let Expression::Identifier(identifier) = slot.get_inner_expression() else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .filter(|symbol_id| item_symbol_ids.contains(symbol_id))
        })
        .collect()
}

fn children_are_stateful(
    children: &[JSXChild<'_>],
    binding: &PositionalIndexBinding<'_, '_>,
    derived_symbol_ids: &[SymbolId],
    allow_any_member_read: bool,
    allow_item_member_read: bool,
    allow_bare_item: bool,
    ctx: &LintContext<'_>,
) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Text(_) => false,
        JSXChild::Spread(_) => false,
        JSXChild::Element(element) => {
            opening_element_is_stateful(&element.opening_element)
                || children_are_stateful(
                    &element.children,
                    binding,
                    derived_symbol_ids,
                    allow_any_member_read,
                    allow_item_member_read,
                    allow_bare_item,
                    ctx,
                )
        }
        JSXChild::Fragment(fragment) => fragment_children_are_stateful(
            fragment,
            binding,
            derived_symbol_ids,
            allow_any_member_read,
            allow_item_member_read,
            allow_bare_item,
            ctx,
        ),
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| {
                expression_is_stateful_row_content(
                    expression,
                    binding,
                    derived_symbol_ids,
                    allow_any_member_read,
                    allow_item_member_read,
                    allow_bare_item,
                    true,
                    ctx,
                )
            }),
    })
}

fn fragment_children_are_stateful(
    fragment: &JSXFragment<'_>,
    binding: &PositionalIndexBinding<'_, '_>,
    derived_symbol_ids: &[SymbolId],
    allow_any_member_read: bool,
    allow_item_member_read: bool,
    allow_bare_item: bool,
    ctx: &LintContext<'_>,
) -> bool {
    children_are_stateful(
        &fragment.children,
        binding,
        derived_symbol_ids,
        allow_any_member_read,
        allow_item_member_read,
        allow_bare_item,
        ctx,
    )
}

fn expression_is_stateful_row_content(
    expression: &Expression<'_>,
    binding: &PositionalIndexBinding<'_, '_>,
    derived_symbol_ids: &[SymbolId],
    allow_any_member_read: bool,
    allow_item_member_read: bool,
    allow_bare_item: bool,
    is_direct_jsx_expression: bool,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::JSXElement(element) => {
            return opening_element_is_stateful(&element.opening_element)
                || children_are_stateful(
                    &element.children,
                    binding,
                    derived_symbol_ids,
                    allow_any_member_read,
                    allow_item_member_read,
                    allow_bare_item,
                    ctx,
                );
        }
        Expression::JSXFragment(fragment) => {
            return fragment_children_are_stateful(
                fragment,
                binding,
                derived_symbol_ids,
                allow_any_member_read,
                allow_item_member_read,
                allow_bare_item,
                ctx,
            );
        }
        _ => {}
    }
    if !is_direct_jsx_expression {
        return match expression.get_inner_expression() {
            Expression::ConditionalExpression(conditional) => {
                expression_is_stateful_row_content(
                    &conditional.consequent,
                    binding,
                    derived_symbol_ids,
                    allow_any_member_read,
                    allow_item_member_read,
                    allow_bare_item,
                    false,
                    ctx,
                ) || expression_is_stateful_row_content(
                    &conditional.alternate,
                    binding,
                    derived_symbol_ids,
                    allow_any_member_read,
                    allow_item_member_read,
                    allow_bare_item,
                    false,
                    ctx,
                )
            }
            Expression::LogicalExpression(logical) => {
                expression_is_stateful_row_content(
                    &logical.left,
                    binding,
                    derived_symbol_ids,
                    allow_any_member_read,
                    allow_item_member_read,
                    allow_bare_item,
                    false,
                    ctx,
                ) || expression_is_stateful_row_content(
                    &logical.right,
                    binding,
                    derived_symbol_ids,
                    allow_any_member_read,
                    allow_item_member_read,
                    allow_bare_item,
                    false,
                    ctx,
                )
            }
            _ => false,
        };
    }
    if expression_is_optional_chain(expression) {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_) => false,
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            !symbol_id.is_some_and(|id| {
                derived_symbol_ids.contains(&id)
                    || allow_bare_item && binding.item_symbol_ids.contains(&id)
            })
        }
        expression if expression.as_member_expression().is_some() => {
            if allow_any_member_read {
                return false;
            }
            let root = expression_root_identifier_symbol(expression, ctx);
            !root.is_some_and(|id| allow_item_member_read && binding.item_symbol_ids.contains(&id))
        }
        Expression::ConditionalExpression(conditional) => {
            expression_is_stateful_row_content(
                &conditional.consequent,
                binding,
                derived_symbol_ids,
                allow_any_member_read,
                allow_item_member_read,
                allow_bare_item,
                false,
                ctx,
            ) || expression_is_stateful_row_content(
                &conditional.alternate,
                binding,
                derived_symbol_ids,
                allow_any_member_read,
                allow_item_member_read,
                allow_bare_item,
                false,
                ctx,
            )
        }
        Expression::LogicalExpression(logical) => {
            expression_is_stateful_row_content(
                &logical.left,
                binding,
                derived_symbol_ids,
                allow_any_member_read,
                allow_item_member_read,
                allow_bare_item,
                false,
                ctx,
            ) || expression_is_stateful_row_content(
                &logical.right,
                binding,
                derived_symbol_ids,
                allow_any_member_read,
                allow_item_member_read,
                allow_bare_item,
                false,
                ctx,
            )
        }
        Expression::CallExpression(call) => {
            let Expression::Identifier(callee) = &call.callee else {
                return true;
            };
            let callee_symbol_id = ctx
                .scoping()
                .get_reference(callee.reference_id())
                .symbol_id();
            !(allow_any_member_read
                && callee_symbol_id.is_some_and(|id| binding.item_symbol_ids.contains(&id)))
        }
        _ => false,
    }
}

fn expression_is_optional_chain(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            call.optional || expression_is_optional_chain(&call.callee)
        }
        expression if expression.as_member_expression().is_some() => {
            expression.as_member_expression().is_some_and(|member| {
                member.optional() || expression_is_optional_chain(member.object())
            })
        }
        _ => false,
    }
}

fn derived_expression_root_identifier_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let mut current = expression.get_inner_expression();
    loop {
        if let Expression::CallExpression(call) = current {
            current = call
                .callee
                .as_member_expression()?
                .object()
                .get_inner_expression();
            continue;
        }
        if let Some(member) = current.as_member_expression() {
            current = member.object().get_inner_expression();
            continue;
        }
        let Expression::Identifier(identifier) = current else {
            return None;
        };
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
    }
}

fn opening_element_is_stateful(opening: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    match &opening.name {
        JSXElementName::IdentifierReference(_)
        | JSXElementName::MemberExpression(_)
        | JSXElementName::NamespacedName(_)
        | JSXElementName::ThisExpression(_) => return true,
        JSXElementName::Identifier(identifier) => {
            let name = identifier.name.as_str();
            if name.chars().next().is_some_and(char::is_uppercase)
                || matches!(
                    name,
                    "input"
                        | "textarea"
                        | "select"
                        | "option"
                        | "optgroup"
                        | "button"
                        | "form"
                        | "output"
                        | "progress"
                        | "meter"
                        | "video"
                        | "audio"
                        | "source"
                        | "track"
                        | "img"
                        | "picture"
                        | "iframe"
                        | "embed"
                        | "object"
                        | "a"
                        | "details"
                        | "summary"
                        | "dialog"
                        | "canvas"
                )
            {
                return true;
            }
        }
    }
    opening.attributes.iter().any(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        matches!(&attribute.name, JSXAttributeName::Identifier(name) if matches!(name.name.to_ascii_lowercase().as_str(), "autofocus" | "contenteditable" | "draggable" | "tabindex"))
            && (matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name.eq_ignore_ascii_case("tabindex"))
                || !attribute_is_static_false(attribute))
    })
}

fn attribute_is_static_false(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(literal)) => literal.value == "false",
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(&container.expression, JSXExpression::BooleanLiteral(literal) if !literal.value)
        }
        _ => false,
    }
}

fn function_span_has_null_return(span: Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        span.contains_inclusive(node.span())
            && nearest_function_span(node.id(), ctx) == Some(span)
            && matches!(node.kind(), AstKind::ReturnStatement(statement) if matches!(statement.argument.as_ref().map(Expression::get_inner_expression), Some(Expression::NullLiteral(_))))
    })
}

fn is_pure_svg_primitive(name: &str) -> bool {
    matches!(
        name,
        "circle"
            | "ellipse"
            | "g"
            | "line"
            | "path"
            | "polygon"
            | "polyline"
            | "rect"
            | "stop"
            | "text"
            | "tspan"
            | "defs"
            | "use"
            | "mask"
            | "marker"
            | "linearGradient"
            | "radialGradient"
            | "clipPath"
            | "filter"
            | "feGaussianBlur"
            | "feOffset"
            | "feMerge"
            | "feMergeNode"
            | "feColorMatrix"
            | "feFlood"
            | "feComposite"
            | "title"
            | "desc"
    )
}

fn is_stateless_html_leaf(name: &str) -> bool {
    matches!(
        name,
        "div"
            | "span"
            | "p"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "header"
            | "footer"
            | "section"
            | "article"
            | "aside"
            | "main"
            | "nav"
            | "li"
            | "ul"
            | "ol"
            | "dl"
            | "dt"
            | "dd"
            | "tr"
            | "td"
            | "th"
            | "tbody"
            | "thead"
            | "tfoot"
            | "table"
            | "caption"
            | "colgroup"
            | "col"
            | "strong"
            | "em"
            | "small"
            | "b"
            | "i"
            | "u"
            | "s"
            | "mark"
            | "del"
            | "ins"
            | "sub"
            | "sup"
            | "abbr"
            | "cite"
            | "code"
            | "kbd"
            | "samp"
            | "pre"
            | "blockquote"
            | "q"
            | "br"
            | "hr"
            | "wbr"
            | "figure"
            | "figcaption"
            | "label"
            | "legend"
            | "fieldset"
            | "address"
            | "time"
            | "data"
            | "var"
            | "ruby"
            | "rt"
            | "rp"
            | "bdi"
            | "bdo"
    )
}

fn is_inline_text_leaf(name: &str) -> bool {
    matches!(
        name,
        "span"
            | "b"
            | "i"
            | "em"
            | "strong"
            | "small"
            | "mark"
            | "del"
            | "ins"
            | "sub"
            | "sup"
            | "u"
            | "s"
            | "code"
            | "kbd"
            | "samp"
            | "var"
            | "abbr"
            | "cite"
            | "q"
            | "bdi"
            | "bdo"
            | "time"
            | "data"
    )
}
