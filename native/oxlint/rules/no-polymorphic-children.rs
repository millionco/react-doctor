use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, FunctionType, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Your users hit inconsistent behavior because `typeof children === \"string\"` makes this component switch on what callers pass, so add clear subcomponents like `<Button.Text>` instead.";
const LARGE_TEXT_OPTIMIZATION_THRESHOLD_CHARS: f64 = 1000.0;

#[derive(Debug, Default, Clone)]
pub struct NoPolymorphicChildren;

declare_oxc_lint!(
    /// Disallow components that switch render shape based on whether children is a string.
    NoPolymorphicChildren,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow runtime children-type checks that switch render shape.",
);

impl Rule for NoPolymorphicChildren {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::BinaryExpression(comparison) = node.kind() else {
            return;
        };
        if !matches!(
            comparison.operator,
            BinaryOperator::Equality | BinaryOperator::StrictEquality
        ) || !polymorphic_is_typeof_props_children(&comparison.left, ctx)
            && !polymorphic_is_typeof_props_children(&comparison.right, ctx)
            || !polymorphic_is_string_literal(&comparison.left)
                && !polymorphic_is_string_literal(&comparison.right)
            || !polymorphic_guards_render_shape(node, ctx)
            || polymorphic_is_large_string_optimization_guard(node, ctx)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(comparison.span));
    }
}

fn polymorphic_is_typeof_props_children(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::UnaryExpression(unary)
            if unary.operator == UnaryOperator::Typeof
                && polymorphic_resolves_to_props_children(&unary.argument, ctx)
    )
}

fn polymorphic_is_string_literal(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::StringLiteral(literal) if literal.value == "string"
    )
}

fn polymorphic_resolves_to_props_children(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) if identifier.name == "children" => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            polymorphic_symbol_is_component_parameter(symbol_id, ctx)
                || polymorphic_children_is_destructured_from_props(symbol_id, ctx)
        }
        expression => {
            let Some(MemberExpression::StaticMemberExpression(member)) =
                expression.as_member_expression()
            else {
                return false;
            };
            if member.property.name != "children" {
                return false;
            }
            let Expression::Identifier(props_identifier) = member.object.get_inner_expression()
            else {
                return false;
            };
            ctx.scoping()
                .get_reference(props_identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| polymorphic_symbol_is_component_parameter(symbol_id, ctx))
        }
    }
}

fn polymorphic_children_is_destructured_from_props(
    children_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let declaration = ctx.symbol_declaration(children_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(declarator.id, BindingPattern::ObjectPattern(_)) {
        return false;
    }
    let Some(source) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    match source {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| polymorphic_symbol_is_component_parameter(symbol_id, ctx)),
        Expression::StaticMemberExpression(member) => {
            member.property.name == "props"
                && matches!(
                    member.object.get_inner_expression(),
                    Expression::ThisExpression(_)
                )
        }
        _ => false,
    }
}

fn polymorphic_symbol_is_component_parameter(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let Some(function_node) = ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
    }) else {
        return false;
    };
    let is_parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.span.contains_inclusive(declaration.span()),
        AstKind::ArrowFunctionExpression(function) => {
            function.params.span.contains_inclusive(declaration.span())
        }
        _ => false,
    };
    is_parameter && polymorphic_is_component_function(function_node, ctx)
}

fn polymorphic_is_component_function<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    match node.kind() {
        AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration => {
            function.id.as_ref().is_none_or(|identifier| {
                identifier.name == "default"
                    || polymorphic_is_uppercase_name(identifier.name.as_str())
            }) || matches!(
                ctx.nodes().parent_node(node.id()).kind(),
                AstKind::ExportDefaultDeclaration(_)
            )
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            polymorphic_is_component_expression(node, ctx)
        }
        _ => false,
    }
}

fn polymorphic_is_component_expression<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut expression_root = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        if !matches!(parent.kind(), AstKind::CallExpression(_)) {
            return match parent.kind() {
                AstKind::VariableDeclarator(declarator) => declarator
                    .id
                    .get_binding_identifier()
                    .is_some_and(|identifier| {
                        polymorphic_is_uppercase_name(identifier.name.as_str())
                    }),
                AstKind::ExportDefaultDeclaration(_) => true,
                _ => false,
            };
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
}

fn polymorphic_is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn polymorphic_guards_render_shape<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let mut current = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::LogicalExpression(logical) => {
                if logical.left.span() == current.span()
                    && polymorphic_contains_jsx_value(&logical.right)
                {
                    return true;
                }
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::ConditionalExpression(conditional)
                if conditional.test.span() == current.span() =>
            {
                return polymorphic_contains_jsx_value(&conditional.consequent)
                    || polymorphic_contains_jsx_value(&conditional.alternate);
            }
            AstKind::IfStatement(statement) if statement.test.span() == current.span() => {
                return polymorphic_contains_render_output(statement.consequent.span(), ctx)
                    || statement.alternate.as_ref().is_some_and(|alternate| {
                        polymorphic_contains_render_output(alternate.span(), ctx)
                    });
            }
            _ => return false,
        }
    }
}

fn polymorphic_contains_jsx_value(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::ConditionalExpression(conditional) => {
            polymorphic_contains_jsx_value(&conditional.consequent)
                || polymorphic_contains_jsx_value(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            polymorphic_contains_jsx_value(&logical.left)
                || polymorphic_contains_jsx_value(&logical.right)
        }
        Expression::CallExpression(call) => polymorphic_is_jsx_producing_callee(&call.callee),
        _ => false,
    }
}

fn polymorphic_contains_render_output(span: oxc_span::Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        span.contains_inclusive(candidate.span())
            && match candidate.kind() {
                AstKind::JSXElement(_) | AstKind::JSXFragment(_) | AstKind::ReturnStatement(_) => {
                    true
                }
                AstKind::CallExpression(call) => polymorphic_is_jsx_producing_callee(&call.callee),
                _ => false,
            }
    })
}

fn polymorphic_is_jsx_producing_callee(callee: &Expression<'_>) -> bool {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            matches!(identifier.name.as_str(), "createElement" | "cloneElement")
        }
        Expression::StaticMemberExpression(member) => matches!(
            member.property.name.as_str(),
            "createElement" | "cloneElement"
        ),
        _ => false,
    }
}

fn polymorphic_is_large_string_optimization_guard<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = transparent_expression_root(node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        let AstKind::LogicalExpression(logical) = parent.kind() else {
            return false;
        };
        if logical.operator != LogicalOperator::And {
            return false;
        }
        let other_operand = if logical.left.span() == current.span() {
            &logical.right
        } else {
            &logical.left
        };
        if polymorphic_is_large_text_length_comparison(other_operand, ctx) {
            return true;
        }
        current = transparent_expression_root(parent, ctx);
    }
}

fn polymorphic_is_large_text_length_comparison(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::BinaryExpression(comparison) = expression.get_inner_expression() else {
        return false;
    };
    let left_is_length = polymorphic_is_props_children_length(&comparison.left, ctx);
    let right_is_length = polymorphic_is_props_children_length(&comparison.right, ctx);
    if !left_is_length && !right_is_length {
        return false;
    }
    let threshold_expression = if left_is_length {
        &comparison.right
    } else {
        &comparison.left
    };
    if polymorphic_resolve_static_numeric_value(threshold_expression, ctx, &mut Vec::new())
        .is_none_or(|threshold| threshold < LARGE_TEXT_OPTIMIZATION_THRESHOLD_CHARS)
    {
        return false;
    }
    if left_is_length {
        matches!(
            comparison.operator,
            BinaryOperator::GreaterThan | BinaryOperator::GreaterEqualThan
        )
    } else {
        matches!(
            comparison.operator,
            BinaryOperator::LessThan | BinaryOperator::LessEqualThan
        )
    }
}

fn polymorphic_is_props_children_length(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(MemberExpression::StaticMemberExpression(member)) =
        expression.get_inner_expression().as_member_expression()
    else {
        return false;
    };
    member.property.name == "length" && polymorphic_resolves_to_props_children(&member.object, ctx)
}

fn polymorphic_resolve_static_numeric_value(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> Option<f64> {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(literal) => literal.value.is_finite().then_some(literal.value),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id) {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(parent.kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            polymorphic_resolve_static_numeric_value(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}
