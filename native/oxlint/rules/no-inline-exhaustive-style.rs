use oxc_ast::{
    AstKind,
    ast::{Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const INLINE_STYLE_PROPERTY_THRESHOLD: usize = 8;

#[derive(Debug, Default, Clone)]
pub struct NoInlineExhaustiveStyle;

declare_oxc_lint!(
    /// Disallow large static inline style objects rebuilt during render.
    NoInlineExhaustiveStyle,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow large static inline style objects rebuilt during render.",
);

impl Rule for NoInlineExhaustiveStyle {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_generated_image_render_filename(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let generated_opening_element_ids = generated_image_jsx_opening_element_ids(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = node.kind() else {
                continue;
            };
            let Some(style) = get_inline_exhaustive_style_object_expression(attribute) else {
                continue;
            };
            let style_node = ctx.nodes().get_node(style.node_id.get());
            if is_one_shot_module_style_initialization(style_node, ctx) {
                continue;
            }
            let property_count = style
                .properties
                .iter()
                .filter(|property| is_static_style_property(property))
                .count();
            if property_count < INLINE_STYLE_PROPERTY_THRESHOLD {
                continue;
            }
            let opening_element = ctx.nodes().ancestors(node.id()).find(|ancestor| {
                matches!(ancestor.kind(), AstKind::JSXOpeningElement(_))
            });
            if opening_element.is_some_and(|opening_element| {
                generated_opening_element_ids.contains(&opening_element.id())
            }) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This inline style has {property_count} properties, which is hard to read & rebuilds every render. Move it to a CSS class, CSS module, or styled component."
                ))
                .with_label(style.span),
            );
        }
    }
}

fn get_inline_exhaustive_style_object_expression<'a, 'b>(
    attribute: &'b oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'b oxc_ast::ast::ObjectExpression<'a>> {
    let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return None;
    };
    if attribute_name.name != "style" {
        return None;
    }
    let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
    else {
        return None;
    };
    let Expression::ObjectExpression(style) = container
        .expression
        .as_expression()?
        .get_inner_expression()
    else {
        return None;
    };
    Some(style)
}

fn is_static_style_property(property: &ObjectPropertyKind<'_>) -> bool {
    let ObjectPropertyKind::ObjectProperty(property) = property else {
        return false;
    };
    !property.computed && is_static_style_value(&property.value)
}

fn is_static_style_value(value: &Expression<'_>) -> bool {
    value.is_literal()
        || matches!(value, Expression::TemplateLiteral(template) if template.expressions.is_empty())
        || matches!(value, Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::UnaryNegation
                && unary.argument.get_inner_expression().is_literal())
}

fn is_one_shot_module_style_initialization<'a>(
    style_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut enclosing_function = crate::ast_util::get_enclosing_function(style_node, ctx);
    while let Some(function_node) = enclosing_function {
        if !function_executes_during_render(function_node, ctx) {
            return false;
        }
        enclosing_function = ctx.nodes().ancestors(function_node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        });
    }
    !is_inside_instance_style_field(style_node, ctx)
}

fn is_inside_instance_style_field(
    style_node: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut descendant_node = style_node;
    for ancestor in ctx.nodes().ancestors(style_node.id()) {
        let is_instance_field_value = match ancestor.kind() {
            AstKind::PropertyDefinition(property) => !property.r#static
                && property
                    .value
                    .as_ref()
                    .is_some_and(|value| value.span() == descendant_node.span()),
            AstKind::AccessorProperty(property) => !property.r#static
                && property
                    .value
                    .as_ref()
                    .is_some_and(|value| value.span() == descendant_node.span()),
            _ => false,
        };
        if is_instance_field_value {
            return true;
        }
        descendant_node = ancestor;
    }
    false
}
