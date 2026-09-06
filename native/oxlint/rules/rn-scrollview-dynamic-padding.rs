use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_syntax::operator::{BinaryOperator, UnaryOperator};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const STATIC_VALUE_RESOLUTION_MAX_DEPTH: usize = 8;
const SCROLL_CONTAINER_NAMES: [&str; 7] = [
    "ScrollView",
    "FlatList",
    "SectionList",
    "VirtualizedList",
    "KeyboardAwareScrollView",
    "FlashList",
    "LegendList",
];

#[derive(Debug, Default, Clone)]
pub struct RnScrollviewDynamicPadding;

declare_oxc_lint!(
    /// Disallow dynamic vertical padding on React Native scroll content containers.
    RnScrollviewDynamicPadding,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow dynamic vertical padding on React Native scroll content containers.",
);

impl Rule for RnScrollviewDynamicPadding {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_test_noise_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let Some(element_name) = resolve_jsx_element_name(opening_element) else {
            return;
        };
        if !SCROLL_CONTAINER_NAMES.contains(&element_name)
            || element_name == "KeyboardAwareScrollView"
        {
            return;
        }
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if attribute_name.name != "contentContainerStyle" {
                continue;
            }
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(Expression::ObjectExpression(style_object)) =
                container.expression.as_expression()
            else {
                continue;
            };
            for property in &style_object.properties {
                let ObjectPropertyKind::ObjectProperty(property) = property else {
                    continue;
                };
                let property_name = match &property.key {
                    PropertyKey::StaticIdentifier(property_name) => property_name.name.as_str(),
                    PropertyKey::Identifier(property_name) => property_name.name.as_str(),
                    _ => continue,
                };
                if !matches!(property_name, "paddingBottom" | "paddingTop")
                    || rn_scroll_padding_is_static_style_value(&property.value, 0, ctx)
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "Your users see rows jump when a changing {property_name} on contentContainerStyle shifts the whole list."
                    ))
                    .with_label(property.span),
                );
                return;
            }
        }
    }
}

fn rn_scroll_padding_is_static_style_value<'a>(
    value: &Expression<'a>,
    resolution_depth: usize,
    ctx: &LintContext<'a>,
) -> bool {
    if resolution_depth > STATIC_VALUE_RESOLUTION_MAX_DEPTH {
        return false;
    }
    if value.is_literal()
        || matches!(value, Expression::TemplateLiteral(template) if template.expressions.is_empty())
    {
        return true;
    }
    if rn_scroll_padding_is_spacing_token_expression(value, resolution_depth, ctx) {
        return true;
    }
    match value {
        Expression::UnaryExpression(unary_expression)
            if unary_expression.operator == UnaryOperator::UnaryNegation =>
        {
            rn_scroll_padding_is_static_style_value(
                &unary_expression.argument,
                resolution_depth + 1,
                ctx,
            )
        }
        Expression::BinaryExpression(binary_expression)
            if matches!(
                binary_expression.operator,
                BinaryOperator::Addition
                    | BinaryOperator::Subtraction
                    | BinaryOperator::Multiplication
                    | BinaryOperator::Division
            ) =>
        {
            rn_scroll_padding_is_static_style_value(
                &binary_expression.left,
                resolution_depth + 1,
                ctx,
            ) && rn_scroll_padding_is_static_style_value(
                &binary_expression.right,
                resolution_depth + 1,
                ctx,
            )
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
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(parent.kind(), AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const())
            {
                return false;
            }
            rn_scroll_padding_binding_initializer(
                &declarator.id,
                declarator.init.as_ref(),
                symbol_id,
            )
            .is_some_and(|initializer| {
                rn_scroll_padding_is_static_style_value(initializer, resolution_depth + 1, ctx)
            })
        }
        _ => false,
    }
}

fn rn_scroll_padding_binding_initializer<'a>(
    pattern: &'a BindingPattern<'a>,
    declarator_initializer: Option<&'a Expression<'a>>,
    symbol_id: oxc_semantic::SymbolId,
) -> Option<&'a Expression<'a>> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) if identifier.symbol_id() == symbol_id => {
            declarator_initializer
        }
        BindingPattern::AssignmentPattern(assignment) => rn_scroll_padding_binding_initializer(
            &assignment.left,
            Some(&assignment.right),
            symbol_id,
        ),
        BindingPattern::ObjectPattern(object) => object.properties.iter().find_map(|property| {
            rn_scroll_padding_binding_initializer(&property.value, None, symbol_id)
        }),
        BindingPattern::ArrayPattern(array) => array
            .elements
            .iter()
            .flatten()
            .find_map(|element| rn_scroll_padding_binding_initializer(element, None, symbol_id)),
        _ => None,
    }
}

fn rn_scroll_padding_is_spacing_token_expression<'a>(
    value: &Expression<'a>,
    resolution_depth: usize,
    ctx: &LintContext<'a>,
) -> bool {
    if let Expression::CallExpression(call_expression) = value {
        let is_spacing_callee = match &call_expression.callee {
            Expression::Identifier(identifier) => identifier.name == "spacing",
            expression => expression.as_member_expression().is_some_and(|member| {
                !member.is_computed() && member.static_property_name() == Some("spacing")
            }),
        };
        return is_spacing_callee
            && call_expression.arguments.iter().all(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    rn_scroll_padding_is_static_style_value(argument, resolution_depth + 1, ctx)
                })
            });
    }
    let Some(member_expression) = value.as_member_expression() else {
        return false;
    };
    if member_expression.is_computed() {
        return false;
    }
    let mut object = member_expression.object();
    while let Some(parent_member) = object.as_member_expression() {
        if parent_member.is_computed() {
            return false;
        }
        if parent_member.static_property_name() == Some("spacing") {
            return true;
        }
        object = parent_member.object();
    }
    matches!(object, Expression::Identifier(identifier) if identifier.name == "spacing")
}
