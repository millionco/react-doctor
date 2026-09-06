use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, CallExpression, Expression, JSXAttributeName, JSXAttributeValue,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const ARRAY_MUTATING_METHODS: [&str; 9] = [
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

#[derive(Debug, Default, Clone)]
pub struct NoFillMapElementAsKey;

declare_oxc_lint!(
    /// Warns when a value produced by fill is reused as a React key.
    NoFillMapElementAsKey,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a fill element is reused as a React key.",
);

impl Rule for NoFillMapElementAsKey {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        if !matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier) if identifier.name == "key"
        ) {
            return;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let Some(key_expression) = container.expression.as_expression() else {
            return;
        };
        let Some((key_name, key_symbol_id)) = fill_key_identifier(key_expression, ctx) else {
            return;
        };
        let Some((callback_node, map_call, map_receiver)) = enclosing_fill_map_callback(node, ctx)
        else {
            return;
        };
        let Some(parameter) = sole_identifier_parameter(callback_node) else {
            return;
        };
        if parameter.name.as_str() != key_name || key_symbol_id != Some(parameter.symbol_id()) {
            return;
        }
        if ctx
            .scoping()
            .get_resolved_references(parameter.symbol_id())
            .filter(|reference| reference.is_write())
            .map(|reference| ctx.nodes().get_node(reference.node_id()))
            .any(|write_node| node_dominates_node(write_node, node, ctx))
        {
            return;
        }
        let Some(length_argument) = resolve_fill_length_argument(map_receiver, ctx) else {
            return;
        };
        if matches!(
            length_argument.get_inner_expression(),
            Expression::NumericLiteral(number) if number.value <= 1.0
        ) {
            return;
        }
        if fill_binding_passed_to_dominating_call(map_receiver, map_call, ctx) {
            return;
        }

        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Every item in this list gets the same key because `.fill()` makes every element identical and \"{key_name}\" is bound to that element, not the position — add the index as the second parameter (`.map((_, {key_name}) => …)`) so React can tell your list items apart."
            ))
            .with_label(attribute.span),
        );
    }
}

fn fill_key_identifier<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(String, Option<SymbolId>)> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some((
            identifier.name.to_string(),
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id(),
        )),
        Expression::TemplateLiteral(template) if template.expressions.len() == 1 => {
            let Expression::Identifier(identifier) = template.expressions[0].get_inner_expression()
            else {
                return None;
            };
            Some((
                identifier.name.to_string(),
                ctx.scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id(),
            ))
        }
        Expression::CallExpression(call) => fill_key_identifier_from_call(call, ctx),
        _ => None,
    }
}

fn fill_key_identifier_from_call(
    call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<(String, Option<SymbolId>)> {
    if let Some(member) = call.callee.get_inner_expression().as_member_expression()
        && member_expression_identifier_property_name(member) == Some("toString")
        && let Expression::Identifier(identifier) = member.object().get_inner_expression()
    {
        return Some((
            identifier.name.to_string(),
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id(),
        ));
    }
    let Expression::Identifier(coercer) = call.callee.get_inner_expression() else {
        return None;
    };
    if !matches!(coercer.name.as_str(), "String" | "Number")
        || ctx
            .scoping()
            .get_reference(coercer.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    let Expression::Identifier(identifier) = call
        .arguments
        .first()
        .and_then(Argument::as_expression)?
        .get_inner_expression()
    else {
        return None;
    };
    Some((
        identifier.name.to_string(),
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id(),
    ))
}

fn enclosing_fill_map_callback<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b AstNode<'a>, &'a CallExpression<'a>, &'a Expression<'a>)> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let callback_span = match ancestor.kind() {
            AstKind::ArrowFunctionExpression(function) => function.span,
            AstKind::Function(function)
                if function.r#type == oxc_ast::ast::FunctionType::FunctionExpression =>
            {
                function.span
            }
            _ => continue,
        };
        let parent = ctx.nodes().parent_node(ancestor.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return None;
        };
        if !call
            .arguments
            .iter()
            .filter_map(Argument::as_expression)
            .any(|argument| argument.span() == callback_span)
        {
            return None;
        }
        let member = call.callee.get_inner_expression().as_member_expression()?;
        if member.static_property_name() != Some("map") {
            return None;
        }
        return Some((ancestor, call, member.object()));
    }
    None
}

fn sole_identifier_parameter<'a>(
    callback_node: &AstNode<'a>,
) -> Option<&'a oxc_ast::ast::BindingIdentifier<'a>> {
    let parameters = match callback_node.kind() {
        AstKind::ArrowFunctionExpression(function) => &function.params,
        AstKind::Function(function)
            if function.r#type == oxc_ast::ast::FunctionType::FunctionExpression =>
        {
            &function.params
        }
        _ => return None,
    };
    if parameters.items.len() != 1 || parameters.rest.is_some() {
        return None;
    }
    let BindingPattern::BindingIdentifier(identifier) = &parameters.items[0].pattern else {
        return None;
    };
    Some(identifier)
}

fn resolve_fill_length_argument<'a>(
    receiver: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if let Some(length_argument) = fill_receiver_length_argument(receiver, ctx) {
        return Some(length_argument);
    }
    let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
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
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
        || !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        )
        || filled_array_is_mutated(symbol_id, ctx)
    {
        return None;
    }
    fill_receiver_length_argument(declarator.init.as_ref()?, ctx)
}

fn fill_receiver_length_argument<'a>(
    receiver: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let Expression::CallExpression(fill_call) = receiver.get_inner_expression() else {
        return None;
    };
    let member = fill_call
        .callee
        .get_inner_expression()
        .as_member_expression()?;
    if member.static_property_name() != Some("fill") {
        return None;
    }
    array_constructor_length_argument(member.object(), ctx)
}

fn array_constructor_length_argument<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let (callee, arguments) = match expression.get_inner_expression() {
        Expression::CallExpression(call) => (&call.callee, &call.arguments),
        Expression::NewExpression(construction) => (&construction.callee, &construction.arguments),
        _ => return None,
    };
    let Expression::Identifier(array) = callee.get_inner_expression() else {
        return None;
    };
    if array.name != "Array"
        || ctx
            .scoping()
            .get_reference(array.reference_id())
            .symbol_id()
            .is_some()
    {
        return None;
    }
    arguments.first()?.as_expression()
}

fn filled_array_is_mutated(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            if reference.is_write() {
                return true;
            }
            let identifier_node = ctx.nodes().get_node(reference.node_id());
            let member_node = transparent_expression_root(identifier_node, ctx);
            let parent = ctx.nodes().parent_node(member_node.id());
            let (object, method_name) = match parent.kind() {
                AstKind::StaticMemberExpression(member) => {
                    (&member.object, Some(member.property.name.as_str()))
                }
                AstKind::ComputedMemberExpression(member) => {
                    let method_name = match &member.expression {
                        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                        _ => None,
                    };
                    (&member.object, method_name)
                }
                _ => return false,
            };
            if object.span() != member_node.span() {
                return false;
            }
            let member_root = transparent_expression_root(parent, ctx);
            let consumer = ctx.nodes().parent_node(member_root.id());
            if matches!(consumer.kind(), AstKind::AssignmentExpression(assignment) if assignment.left.span() == member_root.span())
            {
                return true;
            }
            matches!(
                consumer.kind(),
                AstKind::CallExpression(call)
                    if call.callee.span() == member_root.span()
                        && method_name.is_some_and(|method_name| ARRAY_MUTATING_METHODS.contains(&method_name))
            )
        })
}

fn fill_binding_passed_to_dominating_call(
    receiver: &Expression<'_>,
    map_call: &CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = receiver.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let Some(map_node) = ctx
        .nodes()
        .iter()
        .find(|candidate| candidate.span() == map_call.span)
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let argument_node = transparent_expression_root(reference_node, ctx);
            let call_node = ctx.nodes().parent_node(argument_node.id());
            let AstKind::CallExpression(call) = call_node.kind() else {
                return false;
            };
            if !call.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|expression| expression.span() == argument_node.span())
            }) {
                return false;
            }
            if call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| {
                    matches!(member, oxc_ast::ast::MemberExpression::StaticMemberExpression(_))
                        && matches!(member.object().get_inner_expression(), Expression::Identifier(console) if console.name == "console" && ctx.scoping().get_reference(console.reference_id()).symbol_id().is_none())
                })
            {
                return false;
            }
            node_dominates_node(call_node, map_node, ctx)
        })
}
