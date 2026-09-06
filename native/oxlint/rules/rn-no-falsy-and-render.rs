use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXAttributeName, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const NUMERIC_NAME_HINTS: [&str; 32] = [
    "count",
    "length",
    "total",
    "size",
    "num",
    "index",
    "amount",
    "quantity",
    "offset",
    "width",
    "height",
    "duration",
    "progress",
    "score",
    "rank",
    "level",
    "step",
    "max",
    "min",
    "sum",
    "avg",
    "depth",
    "balance",
    "age",
    "weight",
    "volume",
    "distance",
    "speed",
    "rate",
    "ratio",
    "percent",
    "percentage",
];
const BOOLEAN_PREFIXES: [&str; 10] = [
    "is", "has", "can", "should", "did", "will", "show", "hide", "enable", "disable",
];
const MESSAGE: &str = "Your users hit a crash when this value is 0 & renders a bare `0` as text.";

#[derive(Debug, Default, Clone)]
pub struct RnNoFalsyAndRender;

declare_oxc_lint!(
    /// Disallow numeric logical-and gates that render a bare zero on React Native.
    RnNoFalsyAndRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Numeric && renders bare zero.",
);

impl Rule for RnNoFalsyAndRender {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        is_react_native_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if ctx.nodes().iter().any(|node| {
            matches!(node.kind(), AstKind::Program(program)
                if program.directives.iter().any(|directive| directive.expression.value == "use dom"))
        }) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::LogicalExpression(logical) = node.kind() else {
                continue;
            };
            if logical.operator != oxc_syntax::operator::LogicalOperator::And
                || !matches!(
                    &logical.right,
                    Expression::JSXElement(_) | Expression::JSXFragment(_)
                )
            {
                continue;
            }
            let parent = ctx.nodes().parent_node(node.id());
            if !matches!(parent.kind(), AstKind::JSXExpressionContainer(_))
                && !matches!(parent.kind(), AstKind::LogicalExpression(parent_logical)
                    if parent_logical.operator == oxc_syntax::operator::LogicalOperator::And)
            {
                continue;
            }
            if rn_falsy_is_rendered_inside_dom_host(node, ctx)
                || !rn_falsy_is_likely_numeric(&logical.left)
            {
                continue;
            }
            if let Expression::Identifier(identifier) = &logical.left
                && rn_falsy_identifier_is_provably_safe(identifier, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(logical.left.span()));
        }
    }
}

fn rn_falsy_is_likely_numeric(expression: &Expression<'_>) -> bool {
    if let Expression::Identifier(identifier) = expression {
        return rn_falsy_is_numeric_name(identifier.name.as_str());
    }
    expression.as_member_expression().is_some_and(|member| {
        member_expression_identifier_property_name(member)
            .is_some_and(|name| name == "length" || rn_falsy_is_numeric_name(name))
    })
}

fn rn_falsy_is_numeric_name(name: &str) -> bool {
    let lowercase = name.to_ascii_lowercase();
    if BOOLEAN_PREFIXES.iter().any(|prefix| {
        lowercase.starts_with(prefix)
            && name
                .get(prefix.len()..)
                .and_then(|name| name.chars().next())
                .is_some_and(|character| character.to_uppercase().eq(std::iter::once(character)))
    }) {
        return false;
    }
    NUMERIC_NAME_HINTS.iter().any(|hint| {
        lowercase == *hint
            || lowercase.ends_with(&format!("_{hint}"))
            || name.ends_with(&format!("{}{}", hint[..1].to_ascii_uppercase(), &hint[1..]))
    })
}

fn rn_falsy_identifier_is_provably_safe<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
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
    let parent = ctx.nodes().parent_node(declaration.id());
    if matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        && declarator
            .init
            .as_ref()
            .is_some_and(rn_falsy_is_safe_initializer)
    {
        return true;
    }
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    if pattern
        .elements
        .first()
        .and_then(Option::as_ref)
        .and_then(BindingPattern::get_binding_identifier)
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(Expression::CallExpression(call)) = &declarator.init else {
        return false;
    };
    call.callee_name() == Some("useState")
        && call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(rn_falsy_is_boolean_expression)
}

fn rn_falsy_is_safe_initializer(expression: &Expression<'_>) -> bool {
    if rn_falsy_is_boolean_expression(expression) {
        return true;
    }
    match expression {
        Expression::NumericLiteral(literal) => literal.value != 0.0,
        Expression::StringLiteral(literal) => !literal.value.is_empty(),
        _ => false,
    }
}

fn rn_falsy_is_boolean_expression(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::BooleanLiteral(_) => true,
        Expression::UnaryExpression(unary) => {
            unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
        }
        Expression::BinaryExpression(binary) => matches!(
            binary.operator,
            oxc_syntax::operator::BinaryOperator::Equality
                | oxc_syntax::operator::BinaryOperator::Inequality
                | oxc_syntax::operator::BinaryOperator::StrictEquality
                | oxc_syntax::operator::BinaryOperator::StrictInequality
                | oxc_syntax::operator::BinaryOperator::LessThan
                | oxc_syntax::operator::BinaryOperator::LessEqualThan
                | oxc_syntax::operator::BinaryOperator::GreaterThan
                | oxc_syntax::operator::BinaryOperator::GreaterEqualThan
        ),
        Expression::CallExpression(call) => call.callee_name() == Some("Boolean"),
        _ => false,
    }
}

fn rn_falsy_is_rendered_inside_dom_host<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                if !matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                    if identifier.name == "children")
                {
                    return false;
                }
            }
            AstKind::JSXElement(element) => {
                if is_scoped_react_fragment_element(&element.opening_element.name, ctx) {
                    continue;
                }
                let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
                    return false;
                };
                return crate::globals::HTML_TAG.contains(identifier.name.as_str())
                    || is_svg_tag_name(identifier.name.as_str());
            }
            AstKind::CallExpression(_)
            | AstKind::NewExpression(_)
            | AstKind::VariableDeclarator(_)
            | AstKind::AssignmentExpression(_)
            | AstKind::ObjectProperty(_)
            | AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_)
            | AstKind::Program(_) => return false,
            _ => {}
        }
    }
    false
}
