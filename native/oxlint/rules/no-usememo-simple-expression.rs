use oxc_ast::{
    ast::{
        ArrayExpressionElement, BindingPattern, ChainElement, Expression, FunctionBody,
        ObjectPropertyKind, Statement,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::UnaryOperator;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MUTATING_ARRAY_METHODS: [&str; 9] = [
    "push",
    "pop",
    "shift",
    "unshift",
    "splice",
    "sort",
    "reverse",
    "fill",
    "copyWithin",
];
const CHEAP_EXPRESSION_MESSAGE: &str = "This costs more than it saves because useMemo is wrapping a value that's already cheap, so remove the useMemo";
const TRIVIAL_CONTAINER_MESSAGE: &str = "This useMemo rebuilds a tiny literal whose reference is never relied on, so remove the useMemo and build the value inline";

#[derive(Debug, Default, Clone)]
pub struct NoUsememoSimpleExpression;

declare_oxc_lint!(
    /// Warns when useMemo wraps a cheap value or an identity-free trivial container.
    NoUsememoSimpleExpression,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when useMemo wraps a cheap value or an identity-free trivial container.",
);

impl Rule for NoUsememoSimpleExpression {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(memo_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(memo_call, &["useMemo"], ctx) {
            return;
        }
        let Some(callback) = memo_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(return_expression) = callback_return_expression(callback) else {
            return;
        };
        let message = if is_trivially_cheap_expression(return_expression) {
            CHEAP_EXPRESSION_MESSAGE
        } else if is_trivial_container_literal(return_expression)
            && is_memo_identity_unused(node, ctx)
        {
            TRIVIAL_CONTAINER_MESSAGE
        } else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(memo_call.span));
    }
}

fn callback_return_expression<'a>(callback: &'a Expression<'a>) -> Option<&'a Expression<'a>> {
    match callback {
        Expression::ArrowFunctionExpression(arrow_function) => arrow_function
            .get_expression()
            .or_else(|| single_return_expression(arrow_function.get_function_body()?)),
        Expression::FunctionExpression(function) => {
            single_return_expression(function.body.as_deref()?)
        }
        _ => None,
    }
}

fn single_return_expression<'a>(body: &'a FunctionBody<'a>) -> Option<&'a Expression<'a>> {
    if !body.directives.is_empty() || body.statements.len() != 1 {
        return None;
    }
    let Statement::ReturnStatement(return_statement) = &body.statements[0] else {
        return None;
    };
    return_statement.argument.as_ref()
}

fn is_simple_expression(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if expression.is_literal() || expression.is_identifier_reference() {
        return true;
    }
    match expression {
        Expression::TemplateLiteral(template_literal) => template_literal.expressions.is_empty(),
        Expression::BinaryExpression(binary_expression) => {
            is_simple_expression(&binary_expression.left)
                && is_simple_expression(&binary_expression.right)
        }
        Expression::UnaryExpression(unary_expression) => {
            is_simple_expression(&unary_expression.argument)
        }
        Expression::ConditionalExpression(conditional_expression) => {
            is_simple_expression(&conditional_expression.test)
                && is_simple_expression(&conditional_expression.consequent)
                && is_simple_expression(&conditional_expression.alternate)
        }
        Expression::ChainExpression(chain_expression) => {
            is_simple_chain_element(&chain_expression.expression)
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                !member_expression.is_computed() && is_simple_expression(member_expression.object())
            }),
    }
}

fn is_simple_chain_element(chain_element: &ChainElement<'_>) -> bool {
    if let Some(member_expression) = chain_element.as_member_expression() {
        return !member_expression.is_computed()
            && is_simple_expression(member_expression.object());
    }
    match chain_element {
        ChainElement::TSNonNullExpression(non_null_expression) => {
            is_simple_expression(&non_null_expression.expression)
        }
        _ => false,
    }
}

fn is_trivially_cheap_expression(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    is_simple_expression(expression)
        && !expression.is_identifier_reference()
        && !is_member_expression(expression)
}

fn is_member_expression(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::ChainExpression(chain_expression) => match &chain_expression.expression {
            ChainElement::TSNonNullExpression(non_null_expression) => {
                is_member_expression(&non_null_expression.expression)
            }
            chain_element => chain_element.as_member_expression().is_some(),
        },
        expression => expression.as_member_expression().is_some(),
    }
}

fn is_trivial_container_literal(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrayExpression(array_expression) => {
            array_expression.elements.iter().all(|element| {
                let Some(expression) = ArrayExpressionElement::as_expression(element) else {
                    return false;
                };
                is_simple_expression(expression)
            })
        }
        Expression::ObjectExpression(object_expression) => {
            object_expression.properties.iter().all(|property| {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return false;
                };
                !property.computed && is_simple_expression(&property.value)
            })
        }
        _ => false,
    }
}

fn is_memo_identity_unused<'a>(memo_call_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let memo_usage_root = transparent_expression_root(memo_call_node, ctx);
    let parent = ctx.nodes().parent_node(memo_usage_root.id());
    if matches!(parent.kind(), AstKind::ExpressionStatement(_)) {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != memo_usage_root.kind().span())
    {
        return false;
    }
    match &declarator.id {
        BindingPattern::ArrayPattern(_) | BindingPattern::ObjectPattern(_) => true,
        BindingPattern::BindingIdentifier(binding_identifier) => ctx
            .scoping()
            .get_resolved_references(binding_identifier.symbol_id())
            .all(|reference| reference.is_read() && is_non_escaping_read(reference.node_id(), ctx)),
        BindingPattern::AssignmentPattern(_) => false,
    }
}

fn is_non_escaping_read<'a>(
    reference_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_node = ctx.nodes().get_node(reference_node_id);
    let read_root = transparent_expression_root(reference_node, ctx);
    let member_node = ctx.nodes().parent_node(read_root.id());
    let Some((object_span, is_computed, property_name)) = member_access(member_node.kind()) else {
        return false;
    };
    if object_span != read_root.kind().span() {
        return false;
    }
    let member_use = transparent_expression_root(member_node, ctx);
    let member_use_span = member_use.kind().span();
    let member_use_parent = ctx.nodes().parent_node(member_use.id());
    match member_use_parent.kind() {
        AstKind::AssignmentExpression(assignment_expression)
            if assignment_expression.left.span() == member_use_span =>
        {
            false
        }
        AstKind::UpdateExpression(update_expression)
            if update_expression.argument.span() == member_use_span =>
        {
            false
        }
        AstKind::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::Delete
                && unary_expression.argument.span() == member_use_span =>
        {
            false
        }
        AstKind::CallExpression(call_expression)
            if call_expression.callee.span() == member_use_span
                && !is_computed
                && property_name.is_some_and(|property_name| {
                    MUTATING_ARRAY_METHODS.contains(&property_name)
                }) =>
        {
            false
        }
        _ => true,
    }
}

fn member_access(kind: AstKind<'_>) -> Option<(Span, bool, Option<&str>)> {
    match kind {
        AstKind::ComputedMemberExpression(member_expression) => {
            Some((member_expression.object.span(), true, None))
        }
        AstKind::StaticMemberExpression(member_expression) => Some((
            member_expression.object.span(),
            false,
            Some(member_expression.property.name.as_str()),
        )),
        AstKind::PrivateFieldExpression(member_expression) => {
            Some((member_expression.object.span(), false, None))
        }
        _ => None,
    }
}
