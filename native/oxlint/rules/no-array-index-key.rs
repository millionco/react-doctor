use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, CallExpression, Expression,
        ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Your users can see & submit the wrong data when this list reorders.";
const SECOND_INDEX_METHODS: [&str; 8] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "some",
];
const THIRD_INDEX_METHODS: [&str; 2] = ["reduce", "reduceRight"];

#[derive(Debug, Default, Clone)]
pub struct NoArrayIndexKey;

enum IteratorIndexParameter {
    NotIterator,
    Missing,
    Name(String),
}

declare_oxc_lint!(
    /// Disallow iterator indexes as React.cloneElement keys.
    NoArrayIndexKey,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow array indexes as cloneElement keys.",
);

impl Rule for NoArrayIndexKey {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        if !is_react_clone_element_call(call_expression)
            || !(2..=3).contains(&call_expression.arguments.len())
        {
            return;
        }
        let Some(Argument::ObjectExpression(properties)) = call_expression.arguments.get(1) else {
            return;
        };
        let Some(index_parameter_name) = find_index_parameter_name(node, ctx) else {
            return;
        };
        for property in &properties.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if property.computed
                || !matches!(
                    &property.key,
                    PropertyKey::StaticIdentifier(identifier) if identifier.name == "key"
                ) && !matches!(
                    &property.key,
                    PropertyKey::StringLiteral(literal) if literal.value == "key"
                )
            {
                continue;
            }
            if expression_uses_index(&property.value, &index_parameter_name) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(property.span));
            }
        }
    }
}

fn is_react_clone_element_call(call_expression: &CallExpression<'_>) -> bool {
    let Expression::StaticMemberExpression(member) = call_expression.callee.get_inner_expression()
    else {
        return false;
    };
    member.property.name == "cloneElement"
        && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == "React")
}

fn find_index_parameter_name(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<String> {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let parameter_count = match ancestor.kind() {
            AstKind::ArrowFunctionExpression(function) => function.params.parameters_count(),
            AstKind::Function(function)
                if function.r#type == oxc_ast::ast::FunctionType::FunctionExpression =>
            {
                function.params.parameters_count()
            }
            _ => continue,
        };
        match read_iterator_index_parameter(ancestor, ctx) {
            IteratorIndexParameter::Name(name) => return Some(name),
            IteratorIndexParameter::Missing => return None,
            IteratorIndexParameter::NotIterator if parameter_count > 0 => return None,
            IteratorIndexParameter::NotIterator => {}
        }
    }
    None
}

fn read_iterator_index_parameter(
    callback_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> IteratorIndexParameter {
    let parent = ctx.nodes().parent_node(callback_node.id());
    let AstKind::CallExpression(parent_call) = parent.kind() else {
        return IteratorIndexParameter::NotIterator;
    };
    if callback_argument_matches(parent_call.arguments.first(), callback_node) {
        let Some((receiver, method_name)) = direct_member_identifier(&parent_call.callee) else {
            return IteratorIndexParameter::NotIterator;
        };
        let parameter_index = if SECOND_INDEX_METHODS.contains(&method_name.as_str()) {
            Some(1)
        } else if THIRD_INDEX_METHODS.contains(&method_name.as_str()) {
            Some(2)
        } else {
            None
        };
        if let Some(parameter_index) = parameter_index {
            if is_positionally_stable_iteration_receiver(receiver) {
                return IteratorIndexParameter::Missing;
            }
            return callback_parameter_name(callback_node, parameter_index).map_or(
                IteratorIndexParameter::Missing,
                IteratorIndexParameter::Name,
            );
        }
    }
    if callback_argument_matches(parent_call.arguments.get(1), callback_node)
        && is_global_method_call(parent_call, "Array", "from")
    {
        let Some(source) = parent_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return IteratorIndexParameter::Missing;
        };
        if is_array_from_source_positionally_stable(source) {
            return IteratorIndexParameter::Missing;
        }
        return callback_parameter_name(callback_node, 1).map_or(
            IteratorIndexParameter::Missing,
            IteratorIndexParameter::Name,
        );
    }
    IteratorIndexParameter::NotIterator
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

fn callback_parameter_name(callback_node: &AstNode<'_>, index: usize) -> Option<String> {
    let parameter = match callback_node.kind() {
        AstKind::ArrowFunctionExpression(function) => function.params.items.get(index),
        AstKind::Function(function)
            if function.r#type == oxc_ast::ast::FunctionType::FunctionExpression =>
        {
            function.params.items.get(index)
        }
        _ => None,
    }?;
    let BindingPattern::BindingIdentifier(identifier) = &parameter.pattern else {
        return None;
    };
    Some(identifier.name.to_string())
}

fn direct_member_identifier<'a, 'b>(
    expression: &'b Expression<'a>,
) -> Option<(&'b Expression<'a>, String)> {
    let member_expression = expression.as_member_expression()?;
    let property_name = member_expression_identifier_property_name(member_expression)?;
    Some((member_expression.object(), property_name.to_string()))
}

fn is_global_method_call(
    call_expression: &CallExpression<'_>,
    object_name: &str,
    method_name: &str,
) -> bool {
    let Expression::StaticMemberExpression(member) = call_expression.callee.get_inner_expression()
    else {
        return false;
    };
    member.property.name == method_name
        && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier) if identifier.name == object_name)
}

fn is_array_from_source_positionally_stable(source: &Expression<'_>) -> bool {
    if let Expression::ObjectExpression(object) = source {
        return object.properties.iter().any(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return false;
            };
            matches!(&property.key, PropertyKey::StaticIdentifier(identifier) if identifier.name == "length")
                || matches!(&property.key, PropertyKey::Identifier(identifier) if identifier.name == "length")
                || matches!(&property.key, PropertyKey::StringLiteral(literal) if literal.value == "length")
        });
    }
    is_positionally_stable_iteration_receiver(source)
}

fn is_positionally_stable_iteration_receiver(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::ArrayExpression(array) = expression {
        if is_all_primitive_literal_array(array) {
            return true;
        }
        if let [ArrayExpressionElement::SpreadElement(spread)] = array.elements.as_slice() {
            return is_positionally_stable_iteration_receiver(&spread.argument);
        }
        return false;
    }
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    if is_global_method_call(call_expression, "Array", "from")
        && matches!(
            call_expression.arguments.first(),
            Some(Argument::ObjectExpression(_))
        )
    {
        return true;
    }
    if matches!(&call_expression.callee, Expression::Identifier(identifier) if identifier.name == "Array")
    {
        return true;
    }
    let Some((receiver, method_name)) = direct_member_identifier(&call_expression.callee) else {
        return false;
    };
    if method_name == "split" {
        return true;
    }
    matches!(method_name.as_str(), "fill" | "flat")
        && is_positionally_stable_iteration_receiver(receiver)
}

fn is_all_primitive_literal_array(array: &oxc_ast::ast::ArrayExpression<'_>) -> bool {
    !array.elements.is_empty()
        && array.elements.iter().all(|element| {
            matches!(
                element.as_expression(),
                Some(
                    Expression::StringLiteral(_)
                        | Expression::NumericLiteral(_)
                        | Expression::BooleanLiteral(_)
                )
            )
        })
}

fn expression_uses_index(expression: &Expression<'_>, parameter_name: &str) -> bool {
    if is_index_reference(expression, parameter_name) {
        return true;
    }
    match expression {
        Expression::TemplateLiteral(template) => template
            .expressions
            .iter()
            .any(|expression| is_index_reference(expression, parameter_name)),
        Expression::BinaryExpression(binary) => {
            is_index_reference(&binary.left, parameter_name)
                || is_index_reference(&binary.right, parameter_name)
                || matches!(&binary.left, Expression::BinaryExpression(left) if binary_expression_uses_index(left, parameter_name))
                || matches!(&binary.right, Expression::BinaryExpression(right) if binary_expression_uses_index(right, parameter_name))
        }
        Expression::CallExpression(call_expression) => {
            if direct_member_identifier(&call_expression.callee).is_some_and(
                |(receiver, method_name)| {
                    method_name == "toString"
                        && is_index_reference(receiver.get_inner_expression(), parameter_name)
                },
            ) {
                return true;
            }
            matches!(&call_expression.callee, Expression::Identifier(identifier) if identifier.name == "String")
                && call_expression
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| is_index_reference(argument, parameter_name))
        }
        _ => false,
    }
}

fn binary_expression_uses_index(
    binary: &oxc_ast::ast::BinaryExpression<'_>,
    parameter_name: &str,
) -> bool {
    is_index_reference(&binary.left, parameter_name)
        || is_index_reference(&binary.right, parameter_name)
        || matches!(&binary.left, Expression::BinaryExpression(left) if binary_expression_uses_index(left, parameter_name))
        || matches!(&binary.right, Expression::BinaryExpression(right) if binary_expression_uses_index(right, parameter_name))
}

fn is_index_reference(expression: &Expression<'_>, parameter_name: &str) -> bool {
    matches!(expression, Expression::Identifier(identifier) if identifier.name == parameter_name)
}
