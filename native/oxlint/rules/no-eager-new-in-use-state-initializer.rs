use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, ChainElement, Expression, MemberExpression,
        NewExpression, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CHEAP_VALUE_CONSTRUCTOR_NAMES: [&str; 18] = [
    "Array",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Date",
    "RegExp",
    "URL",
    "URLSearchParams",
    "Headers",
    "DOMRect",
    "DOMRectReadOnly",
    "DOMPoint",
    "DOMPointReadOnly",
    "DOMMatrix",
    "DOMMatrixReadOnly",
    "DOMQuad",
    "Path2D",
];
const TRIVIAL_EAGER_CONSTRUCTOR_NAMES: [&str; 4] = ["Boolean", "Number", "Object", "String"];

#[derive(Debug, Default, Clone)]
pub struct NoEagerNewInUseStateInitializer;

declare_oxc_lint!(
    /// Warns when useState eagerly constructs a nontrivial value on every render.
    NoEagerNewInUseStateInitializer,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when useState eagerly constructs a nontrivial value on every render.",
);

impl Rule for NoEagerNewInUseStateInitializer {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(state_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(state_call, &["useState"], ctx) {
            return;
        }
        let Some(initializer) = state_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(eager_new_expression) = find_reportable_eager_new_expression(initializer, ctx)
        else {
            return;
        };
        let constructor_description = constructor_description_for_eager_new(eager_new_expression);
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "{constructor_description} inside useState constructs a fresh instance on every render and discards it. Wrap the construction in a lazy initializer so it only runs once."
            ))
            .with_label(eager_new_expression.span),
        );
    }
}

fn find_reportable_eager_new_expression<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a NewExpression<'a>> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::NewExpression(new_expression) => {
            (!is_exempt_eager_new_expression(new_expression, ctx)).then_some(new_expression)
        }
        Expression::CallExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_) => None,
        Expression::ConditionalExpression(conditional_expression) => {
            find_reportable_eager_new_expression(&conditional_expression.test, ctx)
                .or_else(|| {
                    find_reportable_eager_new_expression(&conditional_expression.consequent, ctx)
                })
                .or_else(|| {
                    find_reportable_eager_new_expression(&conditional_expression.alternate, ctx)
                })
        }
        Expression::LogicalExpression(logical_expression) => {
            find_reportable_eager_new_expression(&logical_expression.left, ctx)
                .or_else(|| find_reportable_eager_new_expression(&logical_expression.right, ctx))
        }
        Expression::BinaryExpression(binary_expression) => {
            find_reportable_eager_new_expression(&binary_expression.left, ctx)
                .or_else(|| find_reportable_eager_new_expression(&binary_expression.right, ctx))
        }
        Expression::SequenceExpression(sequence_expression) => sequence_expression
            .expressions
            .iter()
            .find_map(|expression| find_reportable_eager_new_expression(expression, ctx)),
        Expression::ArrayExpression(array_expression) => {
            array_expression
                .elements
                .iter()
                .find_map(|element| match element {
                    ArrayExpressionElement::SpreadElement(spread_element) => {
                        find_reportable_eager_new_expression(&spread_element.argument, ctx)
                    }
                    ArrayExpressionElement::Elision(_) => None,
                    element => element.as_expression().and_then(|expression| {
                        find_reportable_eager_new_expression(expression, ctx)
                    }),
                })
        }
        Expression::ObjectExpression(object_expression) => object_expression
            .properties
            .iter()
            .find_map(|property| match property {
                ObjectPropertyKind::SpreadProperty(spread_property) => {
                    find_reportable_eager_new_expression(&spread_property.argument, ctx)
                }
                ObjectPropertyKind::ObjectProperty(property) => property
                    .computed
                    .then(|| property.key.as_expression())
                    .flatten()
                    .and_then(|key| find_reportable_eager_new_expression(key, ctx))
                    .or_else(|| find_reportable_eager_new_expression(&property.value, ctx)),
            }),
        Expression::TemplateLiteral(template_literal) => template_literal
            .expressions
            .iter()
            .find_map(|expression| find_reportable_eager_new_expression(expression, ctx)),
        Expression::UnaryExpression(unary_expression) => {
            find_reportable_eager_new_expression(&unary_expression.argument, ctx)
        }
        Expression::AwaitExpression(await_expression) => {
            find_reportable_eager_new_expression(&await_expression.argument, ctx)
        }
        Expression::YieldExpression(yield_expression) => yield_expression
            .argument
            .as_ref()
            .and_then(|argument| find_reportable_eager_new_expression(argument, ctx)),
        Expression::AssignmentExpression(assignment_expression) => assignment_expression
            .left
            .as_member_expression()
            .and_then(|member_expression| {
                find_reportable_new_in_member_expression(member_expression, ctx)
            })
            .or_else(|| find_reportable_eager_new_expression(&assignment_expression.right, ctx)),
        Expression::ChainExpression(chain_expression) => match &chain_expression.expression {
            ChainElement::CallExpression(_) | ChainElement::TSNonNullExpression(_) => None,
            chain_element => chain_element
                .as_member_expression()
                .and_then(|member_expression| {
                    find_reportable_new_in_member_expression(member_expression, ctx)
                }),
        },
        expression => expression
            .as_member_expression()
            .and_then(|member_expression| {
                find_reportable_new_in_member_expression(member_expression, ctx)
            }),
    }
}

fn find_reportable_new_in_member_expression<'a>(
    member_expression: &'a MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a NewExpression<'a>> {
    find_reportable_eager_new_expression(member_expression.object(), ctx).or_else(|| {
        let MemberExpression::ComputedMemberExpression(computed_member) = member_expression else {
            return None;
        };
        find_reportable_eager_new_expression(&computed_member.expression, ctx)
    })
}

fn is_exempt_eager_new_expression<'a>(
    new_expression: &'a NewExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    is_proven_global_eager_constructor(&new_expression.callee, ctx)
        && new_expression
            .arguments
            .iter()
            .all(is_bounded_constructor_argument)
}

fn is_proven_global_eager_constructor<'a>(
    raw_callee: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut callee = raw_callee.get_inner_expression();
    let mut visited_symbol_ids = rustc_hash::FxHashSet::default();
    while let Expression::Identifier(identifier) = callee {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return is_known_eager_constructor_name(identifier.name.as_str());
        };
        if !visited_symbol_ids.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let oxc_ast::AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        let parent = ctx.nodes().parent_node(declaration.id());
        let oxc_ast::AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
            return false;
        };
        if !variable_declaration.kind.is_const()
            || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
        {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        callee = initializer.get_inner_expression();
    }
    let Some(member_expression) = callee.as_member_expression() else {
        return false;
    };
    if !member_expression
        .static_property_name()
        .is_some_and(is_known_eager_constructor_name)
    {
        return false;
    }
    let Expression::Identifier(object_identifier) = member_expression.object() else {
        return false;
    };
    matches!(
        object_identifier.name.as_str(),
        "globalThis" | "self" | "window"
    ) && ctx
        .scoping()
        .get_reference(object_identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn is_known_eager_constructor_name(name: &str) -> bool {
    TRIVIAL_EAGER_CONSTRUCTOR_NAMES.contains(&name) || CHEAP_VALUE_CONSTRUCTOR_NAMES.contains(&name)
}

fn is_bounded_constructor_argument(argument: &Argument) -> bool {
    let Some(expression) = argument.as_expression() else {
        return false;
    };
    let expression = expression.get_inner_expression();
    expression.is_literal()
        || matches!(expression, Expression::TemplateLiteral(template) if template.expressions.is_empty())
        || matches!(expression, Expression::UnaryExpression(unary) if unary.argument.get_inner_expression().is_literal())
        || matches!(
            expression,
            Expression::ArrayExpression(_) | Expression::ObjectExpression(_)
        ) && is_constant_eager_constructor_value(expression)
}

fn is_constant_eager_constructor_value(expression: &Expression) -> bool {
    let expression = expression.get_inner_expression();
    if expression.is_literal() || matches!(expression, Expression::Identifier(_)) {
        return true;
    }
    match expression {
        Expression::TemplateLiteral(template_literal) => template_literal
            .expressions
            .iter()
            .all(is_constant_eager_constructor_value),
        Expression::UnaryExpression(unary_expression) => {
            is_constant_eager_constructor_value(&unary_expression.argument)
        }
        Expression::ArrayExpression(array_expression) => {
            array_expression
                .elements
                .iter()
                .all(|element| match element {
                    ArrayExpressionElement::SpreadElement(_) => false,
                    ArrayExpressionElement::Elision(_) => true,
                    element => element
                        .as_expression()
                        .is_some_and(is_constant_eager_constructor_value),
                })
        }
        Expression::ObjectExpression(object_expression) => {
            object_expression.properties.iter().all(|property| {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    return false;
                };
                !matches!(property.value, Expression::FunctionExpression(_))
                    && (!property.computed
                        || property
                            .key
                            .as_expression()
                            .is_some_and(is_constant_eager_constructor_value))
                    && is_constant_eager_constructor_value(&property.value)
            })
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                is_constant_eager_constructor_value(member_expression.object())
                    && match member_expression {
                        MemberExpression::ComputedMemberExpression(computed_member) => {
                            is_constant_eager_constructor_value(&computed_member.expression)
                        }
                        _ => true,
                    }
            }),
    }
}

fn constructor_description_for_eager_new(new_expression: &NewExpression) -> String {
    let callee = new_expression.callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        return format!("new {}()", identifier.name);
    }
    callee
        .as_member_expression()
        .and_then(MemberExpression::static_property_name)
        .map_or_else(
            || "a computed constructor".to_string(),
            |property_name| format!("new {property_name}()"),
        )
}
