use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, JSXAttributeItem, JSXChild, JSXExpression, ObjectPropertyKind,
        PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule, utils::has_jsx_prop_ignore_case};

const MESSAGE: &str =
    "React throws an error when you set both children & `dangerouslySetInnerHTML`.";

#[derive(Debug, Default, Clone)]
pub struct NoDangerWithChildren;

#[derive(Debug, Default)]
struct PropsShape {
    has_dangerously: bool,
    has_children: bool,
}

declare_oxc_lint!(
    /// Disallow dangerouslySetInnerHTML with children.
    NoDangerWithChildren,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow dangerouslySetInnerHTML with children.",
);

impl Rule for NoDangerWithChildren {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXElement(element) => {
                let opening_element = &element.opening_element;
                let spread_shape = resolve_jsx_spread_props_shape(opening_element, ctx);
                let has_children_prop = has_jsx_prop_ignore_case(opening_element, "children")
                    .is_some()
                    || spread_shape.has_children;
                let runtime_children_count = element
                    .children
                    .iter()
                    .filter(|child| is_runtime_jsx_child(child))
                    .count();
                let has_nested_children = runtime_children_count > 1
                    || element
                        .children
                        .iter()
                        .filter(|child| is_runtime_jsx_child(child))
                        .any(is_meaningful_jsx_child);
                if (has_children_prop || has_nested_children)
                    && (has_jsx_prop_ignore_case(opening_element, "dangerouslySetInnerHTML")
                        .is_some()
                        || spread_shape.has_dangerously)
                {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
                }
            }
            AstKind::CallExpression(call_expression) => {
                if call_expression.arguments.len() <= 1 || !is_create_element_call(call_expression)
                {
                    return;
                }
                let Some(props_expression) = call_expression
                    .arguments
                    .get(1)
                    .and_then(Argument::as_expression)
                else {
                    return;
                };
                let props_shape =
                    resolve_props_shape(props_expression, ctx, &mut FxHashSet::default());
                if !props_shape.has_dangerously {
                    return;
                }
                let positional_children = &call_expression.arguments[2..];
                let has_positional_children = positional_children.len() > 1
                    || positional_children
                        .iter()
                        .any(|argument| !is_nullish_argument(argument));
                if has_positional_children || props_shape.has_children {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
                }
            }
            _ => {}
        }
    }
}

fn resolve_jsx_spread_props_shape<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> PropsShape {
    let mut shape = PropsShape::default();
    for attribute in &opening_element.attributes {
        let JSXAttributeItem::SpreadAttribute(spread_attribute) = attribute else {
            continue;
        };
        merge_props_shape(
            &mut shape,
            resolve_props_shape(&spread_attribute.argument, ctx, &mut FxHashSet::default()),
        );
    }
    shape
}

fn resolve_props_shape<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> PropsShape {
    if let Expression::Identifier(identifier) = expression {
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return PropsShape::default();
        };
        if !visited_symbol_ids.insert(symbol_id) {
            return PropsShape::default();
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return PropsShape::default();
        };
        let Some(initializer) = &declarator.init else {
            return PropsShape::default();
        };
        return resolve_props_shape(initializer, ctx, visited_symbol_ids);
    }
    let Expression::ObjectExpression(object_expression) = expression else {
        return PropsShape::default();
    };
    let mut shape = PropsShape::default();
    for property in &object_expression.properties {
        match property {
            ObjectPropertyKind::SpreadProperty(spread_property) => merge_props_shape(
                &mut shape,
                resolve_props_shape(&spread_property.argument, ctx, visited_symbol_ids),
            ),
            ObjectPropertyKind::ObjectProperty(property) if !property.computed => {
                let property_name = match &property.key {
                    PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
                    PropertyKey::StringLiteral(string_literal) => {
                        Some(string_literal.value.as_str())
                    }
                    _ => None,
                };
                if property_name == Some("dangerouslySetInnerHTML") {
                    shape.has_dangerously = true;
                }
                if property_name == Some("children") {
                    shape.has_children = true;
                }
            }
            _ => {}
        }
    }
    shape
}

fn merge_props_shape(target: &mut PropsShape, source: PropsShape) {
    target.has_dangerously |= source.has_dangerously;
    target.has_children |= source.has_children;
}

fn is_runtime_jsx_child(child: &JSXChild) -> bool {
    match child {
        JSXChild::Text(text) => !text.value.trim().is_empty() || !text.value.contains('\n'),
        JSXChild::ExpressionContainer(container) => {
            !matches!(container.expression, JSXExpression::EmptyExpression(_))
        }
        _ => true,
    }
}

fn is_meaningful_jsx_child(child: &JSXChild) -> bool {
    match child {
        JSXChild::Text(text) => !text.value.trim().is_empty() || !text.value.contains('\n'),
        JSXChild::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            !is_nullish_expression(expression)
        }
        _ => true,
    }
}

fn is_nullish_argument(argument: &Argument) -> bool {
    argument.as_expression().is_some_and(is_nullish_expression)
}
