use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, FunctionType, MemberExpression, ObjectPropertyKind, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This is slow because .every() compares two arrays item by item, so check `a.length === b.length` first to bail out immediately when sizes differ";
const LENGTH_PRESERVING_METHOD_NAMES: [&str; 6] =
    ["slice", "map", "sort", "reverse", "toSorted", "toReversed"];

#[derive(Debug, Default, Clone)]
pub struct JsLengthCheckFirst;

declare_oxc_lint!(
    /// Require a cheap length guard before comparing arrays element by element.
    JsLengthCheckFirst,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Require a length check before an element-wise array comparison.",
);

impl Rule for JsLengthCheckFirst {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Some(every_member) = call.callee.as_member_expression() else {
            return;
        };
        if js_length_identifier_property_name(every_member) != Some("every") {
            return;
        }
        let Some(callback) = call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some((callback_span, index_parameter_name)) = js_length_callback_parts(callback) else {
            return;
        };
        let Some(indexed_array) =
            js_length_find_indexed_array_with_equality(callback_span, index_parameter_name, ctx)
        else {
            return;
        };

        let receiver_array = every_member.object();
        let resolved_receiver = js_length_resolve_array_source(receiver_array, node.span(), ctx);
        let resolved_indexed = js_length_resolve_array_source(indexed_array, node.span(), ctx);
        if js_length_expressions_equal(resolved_receiver, resolved_indexed, ctx) {
            return;
        }
        if js_length_equal_cardinality_object_projections(receiver_array, indexed_array, ctx)
            || js_length_equal_cardinality_object_projections(
                resolved_receiver,
                resolved_indexed,
                ctx,
            )
        {
            return;
        }
        let pairs = [
            (receiver_array, indexed_array),
            (resolved_receiver, resolved_indexed),
        ];
        if js_length_has_earlier_logical_guard(node, &pairs, ctx)
            || js_length_has_dominating_guard(node, &pairs, ctx)
            || js_length_is_inside_prefix_named_function(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
    }
}

fn js_length_identifier_property_name<'a>(member: &'a MemberExpression<'a>) -> Option<&'a str> {
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

fn js_length_callback_parts<'a>(expression: &'a Expression<'a>) -> Option<(Span, &'a str)> {
    match js_length_strip_parentheses(expression) {
        Expression::ArrowFunctionExpression(function) => {
            let index_parameter = function.params.items.get(1)?;
            let BindingPattern::BindingIdentifier(identifier) = &index_parameter.pattern else {
                return None;
            };
            Some((function.body.span(), identifier.name.as_str()))
        }
        Expression::FunctionExpression(function) => {
            let index_parameter = function.params.items.get(1)?;
            let BindingPattern::BindingIdentifier(identifier) = &index_parameter.pattern else {
                return None;
            };
            Some((function.body.as_ref()?.span(), identifier.name.as_str()))
        }
        _ => None,
    }
}

fn js_length_find_indexed_array_with_equality<'a>(
    callback_span: Span,
    index_parameter_name: &str,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let mut indexed_array = None;
    for candidate in ctx.nodes().iter() {
        if !callback_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::ComputedMemberExpression(member) = candidate.kind() else {
            continue;
        };
        if !matches!(&member.expression, Expression::Identifier(identifier) if identifier.name == index_parameter_name)
        {
            continue;
        }
        indexed_array.get_or_insert(&member.object);
    }
    let has_indexed_equality = ctx.nodes().iter().any(|candidate| {
        if !callback_span.contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::BinaryExpression(binary) = candidate.kind() else {
            return false;
        };
        if !matches!(
            binary.operator,
            BinaryOperator::Equality
                | BinaryOperator::StrictEquality
                | BinaryOperator::Inequality
                | BinaryOperator::StrictInequality
        ) {
            return false;
        }
        ctx.nodes().iter().any(|comparison_candidate| {
            binary
                .span
                .contains_inclusive(comparison_candidate.span())
                && matches!(comparison_candidate.kind(), AstKind::ComputedMemberExpression(member)
                    if matches!(&member.expression, Expression::Identifier(identifier) if identifier.name == index_parameter_name))
        })
    });
    has_indexed_equality.then_some(indexed_array).flatten()
}

fn js_length_strip_parentheses<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    expression.get_inner_expression()
}

fn js_length_peel_derivation<'a>(expression: &'a Expression<'a>) -> (&'a Expression<'a>, bool) {
    let mut current = js_length_strip_parentheses(expression);
    let mut did_peel = false;
    loop {
        if let Expression::ArrayExpression(array) = current
            && let [oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread)] =
                array.elements.as_slice()
        {
            current = js_length_strip_parentheses(&spread.argument);
            did_peel = true;
            continue;
        }
        let Expression::CallExpression(call) = current else {
            return (current, did_peel);
        };
        let Some(member) = call.callee.as_member_expression() else {
            return (current, did_peel);
        };
        let Some(method_name) = js_length_identifier_property_name(member) else {
            return (current, did_peel);
        };
        if method_name == "from"
            && call.arguments.len() == 1
            && matches!(js_length_strip_parentheses(member.object()), Expression::Identifier(identifier) if identifier.name == "Array")
            && let Some(argument) = call.arguments[0].as_expression()
        {
            current = js_length_strip_parentheses(argument);
            did_peel = true;
            continue;
        }
        if LENGTH_PRESERVING_METHOD_NAMES.contains(&method_name)
            && !(method_name == "slice" && !call.arguments.is_empty())
        {
            current = js_length_strip_parentheses(member.object());
            did_peel = true;
            continue;
        }
        return (current, did_peel);
    }
}

fn js_length_resolve_array_source<'a>(
    expression: &'a Expression<'a>,
    use_span: Span,
    ctx: &LintContext<'a>,
) -> &'a Expression<'a> {
    let (mut current, _) = js_length_peel_derivation(expression);
    let mut visited = rustc_hash::FxHashSet::default();
    for _ in 0..8 {
        let Expression::Identifier(identifier) = current else {
            break;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            break;
        };
        if !visited.insert(symbol_id) {
            break;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        if declaration.span().start >= use_span.start {
            break;
        }
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            break;
        };
        let AstKind::VariableDeclaration(variable_declaration) =
            ctx.nodes().parent_node(declaration.id()).kind()
        else {
            break;
        };
        if !variable_declaration.kind.is_const() {
            break;
        }
        let Some(initializer) = &declarator.init else {
            break;
        };
        let (peeled, did_peel) = js_length_peel_derivation(initializer);
        if !did_peel {
            break;
        }
        current = peeled;
    }
    current
}

fn js_length_object_projection<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'a str, &'a Expression<'a>)> {
    let Expression::CallExpression(call) = js_length_strip_parentheses(expression) else {
        return None;
    };
    if call.arguments.len() != 1 {
        return None;
    }
    let member = call.callee.as_member_expression()?;
    let Expression::Identifier(object_identifier) = js_length_strip_parentheses(member.object())
    else {
        return None;
    };
    if object_identifier.name != "Object"
        || ctx
            .scoping()
            .get_reference(object_identifier.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    let method_name = member.static_property_name()?;
    if !matches!(method_name.as_ref(), "keys" | "values") {
        return None;
    }
    Some((
        if method_name == "keys" {
            "keys"
        } else {
            "values"
        },
        call.arguments[0].as_expression()?,
    ))
}

fn js_length_equal_cardinality_object_projections<'a>(
    receiver: &'a Expression<'a>,
    indexed: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((receiver_method, receiver_source)) = js_length_object_projection(receiver, ctx)
    else {
        return false;
    };
    let Some((indexed_method, indexed_source)) = js_length_object_projection(indexed, ctx) else {
        return false;
    };
    if receiver_method == indexed_method {
        return false;
    }
    let receiver_root = js_length_stable_plain_object_root(receiver_source, ctx, &mut Vec::new());
    let indexed_root = js_length_stable_plain_object_root(indexed_source, ctx, &mut Vec::new());
    receiver_root.is_some() && receiver_root == indexed_root
}

fn js_length_stable_plain_object_root(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::SymbolId> {
    let Expression::Identifier(identifier) = js_length_strip_parentheses(expression) else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if visited.contains(&symbol_id) {
        return None;
    }
    visited.push(symbol_id);
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
    if !variable_declaration.kind.is_const() {
        return None;
    }
    let initializer = declarator.init.as_ref()?;
    if js_length_global_freeze_argument(initializer, ctx)
        .is_some_and(js_length_is_plain_data_object)
    {
        return Some(symbol_id);
    }
    js_length_stable_plain_object_root(initializer, ctx, visited)
}

fn js_length_global_freeze_argument<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let Expression::CallExpression(call) = js_length_strip_parentheses(expression) else {
        return None;
    };
    if call.arguments.len() != 1 {
        return None;
    }
    let MemberExpression::StaticMemberExpression(member) = call.callee.as_member_expression()?
    else {
        return None;
    };
    let Expression::Identifier(object_identifier) = js_length_strip_parentheses(&member.object)
    else {
        return None;
    };
    if member.property.name != "freeze"
        || object_identifier.name != "Object"
        || ctx
            .scoping()
            .get_reference(object_identifier.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    call.arguments[0].as_expression()
}

fn js_length_is_plain_data_object(expression: &Expression<'_>) -> bool {
    let Expression::ObjectExpression(object) = js_length_strip_parentheses(expression) else {
        return false;
    };
    object.properties.iter().all(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        property.kind == oxc_ast::ast::PropertyKind::Init
            && !property.method
            && match js_length_strip_parentheses(&property.value) {
                Expression::StringLiteral(_)
                | Expression::BooleanLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::RegExpLiteral(_)
                | Expression::NullLiteral(_) => true,
                Expression::TemplateLiteral(template) => template.expressions.is_empty(),
                _ => false,
            }
    })
}

fn js_length_expressions_equal(
    first: &Expression<'_>,
    second: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let first = js_length_strip_parentheses(first);
    let second = js_length_strip_parentheses(second);
    match (first, second) {
        (Expression::Identifier(first), Expression::Identifier(second)) => {
            first.name == second.name
        }
        (Expression::ThisExpression(_), Expression::ThisExpression(_))
        | (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        (Expression::PrivateFieldExpression(first), Expression::PrivateFieldExpression(second)) => {
            first.field.name == second.field.name
        }
        (Expression::StringLiteral(first), Expression::StringLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BooleanLiteral(first), Expression::BooleanLiteral(second)) => {
            first.value == second.value
        }
        (Expression::NumericLiteral(first), Expression::NumericLiteral(second)) => {
            first.value == second.value
        }
        (Expression::BigIntLiteral(first), Expression::BigIntLiteral(second)) => {
            first.value == second.value
        }
        (Expression::CallExpression(first), Expression::CallExpression(second)) => {
            js_length_expressions_equal(&first.callee, &second.callee, ctx)
                && first.arguments.len() == second.arguments.len()
                && first.arguments.iter().zip(&second.arguments).all(
                    |(first_argument, second_argument)| {
                        let (Some(first_argument), Some(second_argument)) = (
                            first_argument.as_expression(),
                            second_argument.as_expression(),
                        ) else {
                            return false;
                        };
                        js_length_expressions_equal(first_argument, second_argument, ctx)
                    },
                )
        }
        _ => match (first.as_member_expression(), second.as_member_expression()) {
            (
                Some(MemberExpression::StaticMemberExpression(first)),
                Some(MemberExpression::StaticMemberExpression(second)),
            ) => {
                first.property.name == second.property.name
                    && js_length_expressions_equal(&first.object, &second.object, ctx)
            }
            (
                Some(MemberExpression::ComputedMemberExpression(first)),
                Some(MemberExpression::ComputedMemberExpression(second)),
            ) => {
                js_length_expressions_equal(&first.object, &second.object, ctx)
                    && js_length_expressions_equal(&first.expression, &second.expression, ctx)
            }
            (
                Some(MemberExpression::PrivateFieldExpression(first)),
                Some(MemberExpression::PrivateFieldExpression(second)),
            ) => {
                first.field.name == second.field.name
                    && js_length_expressions_equal(&first.object, &second.object, ctx)
            }
            _ => false,
        },
    }
}

fn js_length_is_length_comparison(
    expression: &Expression<'_>,
    receiver: &Expression<'_>,
    indexed: &Expression<'_>,
    allow_equality: bool,
    allow_mismatch: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::BinaryExpression(binary) = js_length_strip_parentheses(expression) else {
        return false;
    };
    let operator_matches = (allow_equality
        && matches!(
            binary.operator,
            BinaryOperator::Equality | BinaryOperator::StrictEquality
        ))
        || (allow_mismatch
            && matches!(
                binary.operator,
                BinaryOperator::Inequality
                    | BinaryOperator::StrictInequality
                    | BinaryOperator::GreaterThan
                    | BinaryOperator::LessThan
                    | BinaryOperator::GreaterEqualThan
                    | BinaryOperator::LessEqualThan
            ));
    if !operator_matches {
        return false;
    }
    let (Some(left), Some(right)) = (
        binary.left.as_member_expression(),
        binary.right.as_member_expression(),
    ) else {
        return false;
    };
    if js_length_identifier_property_name(left) != Some("length")
        || js_length_identifier_property_name(right) != Some("length")
    {
        return false;
    }
    (js_length_expressions_equal(left.object(), receiver, ctx)
        && js_length_expressions_equal(right.object(), indexed, ctx))
        || (js_length_expressions_equal(left.object(), indexed, ctx)
            && js_length_expressions_equal(right.object(), receiver, ctx))
}

fn js_length_guard_chain_contains(
    expression: &Expression<'_>,
    operator: LogicalOperator,
    pairs: &[(&Expression<'_>, &Expression<'_>)],
    allow_equality: bool,
    allow_mismatch: bool,
    ctx: &LintContext<'_>,
) -> bool {
    if let Expression::LogicalExpression(logical) = js_length_strip_parentheses(expression)
        && logical.operator == operator
    {
        return js_length_guard_chain_contains(
            &logical.left,
            operator,
            pairs,
            allow_equality,
            allow_mismatch,
            ctx,
        ) || js_length_guard_chain_contains(
            &logical.right,
            operator,
            pairs,
            allow_equality,
            allow_mismatch,
            ctx,
        );
    }
    pairs.iter().any(|(receiver, indexed)| {
        js_length_is_length_comparison(
            expression,
            receiver,
            indexed,
            allow_equality,
            allow_mismatch,
            ctx,
        )
    })
}

fn js_length_has_earlier_logical_guard(
    node: &AstNode<'_>,
    pairs: &[(&Expression<'_>, &Expression<'_>)],
    ctx: &LintContext<'_>,
) -> bool {
    let mut current_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::LogicalExpression(logical)
                if logical.right.span().contains_inclusive(current_span) =>
            {
                let (allow_equality, allow_mismatch) = match logical.operator {
                    LogicalOperator::And => (true, true),
                    LogicalOperator::Or => (false, true),
                    _ => return false,
                };
                if js_length_guard_chain_contains(
                    &logical.left,
                    logical.operator,
                    pairs,
                    allow_equality,
                    allow_mismatch,
                    ctx,
                ) {
                    return true;
                }
                current_span = ancestor.span();
            }
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
                current_span = ancestor.span();
            }
            AstKind::ChainExpression(_) | AstKind::ParenthesizedExpression(_) => {
                current_span = ancestor.span();
            }
            _ => break,
        }
    }
    false
}

fn js_length_statement_terminates(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ReturnStatement(_) | Statement::ThrowStatement(_) => true,
        Statement::BlockStatement(block) => block.body.iter().any(js_length_statement_terminates),
        _ => false,
    }
}

fn js_length_has_dominating_guard(
    node: &AstNode<'_>,
    pairs: &[(&Expression<'_>, &Expression<'_>)],
    ctx: &LintContext<'_>,
) -> bool {
    let mut child_span = node.span();
    let compared_root_names: Vec<&str> = pairs
        .iter()
        .flat_map(|(receiver, indexed)| [receiver, indexed])
        .filter_map(|expression| js_length_root_identifier_name(expression))
        .collect();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let parameters = match ancestor.kind() {
            AstKind::Function(function) => Some(function.params.items.as_slice()),
            AstKind::ArrowFunctionExpression(function) => Some(function.params.items.as_slice()),
            _ => None,
        };
        if let Some(parameters) = parameters {
            let mut parameter_names = rustc_hash::FxHashSet::default();
            for parameter in parameters {
                collect_binding_pattern_names(&parameter.pattern, &mut parameter_names);
            }
            if compared_root_names
                .iter()
                .any(|name| parameter_names.contains(*name))
            {
                return false;
            }
        }
        if let AstKind::IfStatement(statement) = ancestor.kind()
            && statement.consequent.span().contains_inclusive(child_span)
            && js_length_guard_chain_contains(
                &statement.test,
                LogicalOperator::And,
                pairs,
                true,
                false,
                ctx,
            )
        {
            return true;
        }
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => Some(block.body.as_slice()),
            AstKind::FunctionBody(body) => Some(body.statements.as_slice()),
            AstKind::Program(program) => Some(program.body.as_slice()),
            _ => None,
        };
        if let Some(statements) = statements
            && let Some(child_index) = statements
                .iter()
                .position(|statement| statement.span().contains_inclusive(child_span))
        {
            for statement in &statements[..child_index] {
                let Statement::IfStatement(guard) = statement else {
                    continue;
                };
                if js_length_statement_terminates(&guard.consequent)
                    && js_length_guard_chain_contains(
                        &guard.test,
                        LogicalOperator::Or,
                        pairs,
                        false,
                        true,
                        ctx,
                    )
                    && !js_length_arrays_reassigned_between(
                        guard.span.end,
                        child_span.start,
                        pairs,
                        ctx,
                    )
                {
                    return true;
                }
            }
        }
        child_span = ancestor.span();
    }
    false
}

fn js_length_root_identifier_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    let mut current = js_length_strip_parentheses(expression);
    loop {
        match current {
            Expression::Identifier(identifier) => return Some(identifier.name.as_str()),
            _ => {
                let member = current.as_member_expression()?;
                current = js_length_strip_parentheses(member.object());
            }
        }
    }
}

fn js_length_arrays_reassigned_between(
    start: u32,
    end: u32,
    pairs: &[(&Expression<'_>, &Expression<'_>)],
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start < start || candidate.span().end > end {
            return false;
        }
        let target = match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => assignment.left.get_expression(),
            AstKind::UpdateExpression(update) => update.argument.get_expression(),
            _ => None,
        };
        target.is_some_and(|target| {
            pairs.iter().any(|(receiver, indexed)| {
                js_length_expressions_equal(target, receiver, ctx)
                    || js_length_expressions_equal(target, indexed, ctx)
            })
        })
    })
}

fn js_length_is_inside_prefix_named_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::Function(function) => {
                if function.r#type == FunctionType::FunctionDeclaration
                    && function.id.as_ref().is_some_and(|identifier| {
                        js_length_is_prefix_name(identifier.name.as_str())
                    })
                {
                    return true;
                }
                let parent = ctx.nodes().parent_node(ancestor.id());
                return matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
                    if declarator.id.get_binding_identifier().is_some_and(|identifier| js_length_is_prefix_name(identifier.name.as_str())));
            }
            AstKind::ArrowFunctionExpression(_) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                return matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
                    if declarator.id.get_binding_identifier().is_some_and(|identifier| js_length_is_prefix_name(identifier.name.as_str())));
            }
            _ => {}
        }
    }
    false
}

fn js_length_is_prefix_name(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    lowercase.contains("prefix") || lowercase.contains("startswith")
}
