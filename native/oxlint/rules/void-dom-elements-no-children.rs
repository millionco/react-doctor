use oxc_ast::{
    AstKind,
    ast::{
        Argument, Expression, JSXAttributeItem, JSXAttributeName, JSXChild, JSXElementName,
        JSXExpression, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;

use crate::{AstNode, context::LintContext, rule::Rule};

const VOID_DOM_ELEMENTS: [&str; 16] = [
    "area", "base", "br", "col", "embed", "hr", "img", "input", "keygen", "link", "menuitem",
    "meta", "param", "source", "track", "wbr",
];

#[derive(Debug, Default, Clone)]
pub struct VoidDomElementsNoChildren;

declare_oxc_lint!(
    /// Disallow children on void DOM elements.
    VoidDomElementsNoChildren,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow children on void DOM elements.",
);

impl Rule for VoidDomElementsNoChildren {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXElement(element) => {
                let Some((tag_name, span)) = resolve_jsx_element_type(element, ctx) else {
                    return;
                };
                if !VOID_DOM_ELEMENTS.contains(&tag_name)
                    || (!element.children.iter().any(is_meaningful_jsx_child)
                        && !has_children_like_attribute(&element.opening_element.attributes))
                {
                    return;
                }
                ctx.diagnostic(diagnostic(tag_name, span));
            }
            AstKind::CallExpression(call_expression) => {
                if !is_create_element_call(call_expression) {
                    return;
                }
                let Some(Argument::StringLiteral(element_name)) = call_expression.arguments.first()
                else {
                    return;
                };
                let tag_name = element_name.value.as_str();
                if !VOID_DOM_ELEMENTS.contains(&tag_name) {
                    return;
                }
                let has_meaningful_child = call_expression
                    .arguments
                    .iter()
                    .skip(2)
                    .any(|argument| !is_nullish_argument(argument));
                let has_children_like_prop =
                    call_expression.arguments.get(1).is_some_and(|argument| {
                        let Some(Expression::ObjectExpression(object_expression)) =
                            argument.as_expression()
                        else {
                            return false;
                        };
                        object_expression.properties.iter().any(|property| {
                            let ObjectPropertyKind::ObjectProperty(property) = property else {
                                return false;
                            };
                            property_key_matches_name(&property.key, "children")
                                || property_key_matches_name(
                                    &property.key,
                                    "dangerouslySetInnerHTML",
                                )
                        })
                    });
                if has_meaningful_child || has_children_like_prop {
                    ctx.diagnostic(diagnostic(tag_name, element_name.span));
                }
            }
            _ => {}
        }
    }
}

fn diagnostic(tag_name: &str, span: Span) -> OxcDiagnostic {
    OxcDiagnostic::warn(format!(
        "React errors when `<{tag_name}>` has children because it's a void element."
    ))
    .with_label(span)
}

fn resolve_jsx_element_type<'a>(
    element: &'a oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'a str, Span)> {
    match &element.opening_element.name {
        JSXElementName::Identifier(identifier) => Some((identifier.name.as_str(), identifier.span)),
        JSXElementName::IdentifierReference(identifier) => {
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            let symbol_id = reference.symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return Some((identifier.name.as_str(), identifier.span));
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
                return Some((identifier.name.as_str(), identifier.span));
            };
            if !variable_declaration.kind.is_const()
                || declarator
                    .id
                    .get_binding_identifier()
                    .is_none_or(|binding_identifier| binding_identifier.symbol_id() != symbol_id)
            {
                return Some((identifier.name.as_str(), identifier.span));
            }
            let Some(Expression::StringLiteral(string_literal)) = declarator
                .init
                .as_ref()
                .map(Expression::get_inner_expression)
            else {
                return Some((identifier.name.as_str(), identifier.span));
            };
            Some((string_literal.value.as_str(), identifier.span))
        }
        _ => None,
    }
}

fn has_children_like_attribute(attributes: &[JSXAttributeItem]) -> bool {
    attributes.iter().any(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier)
                if identifier.name == "children" || identifier.name == "dangerouslySetInnerHTML"
        )
    })
}

fn is_meaningful_jsx_child(child: &JSXChild) -> bool {
    match child {
        JSXChild::Text(text) => {
            !text.value.trim().is_empty() || !text.value.as_str().contains('\n')
        }
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_) => false,
            expression => expression
                .as_expression()
                .is_none_or(|expression| !expression.get_inner_expression().is_null_or_undefined()),
        },
        _ => true,
    }
}

fn is_nullish_argument(argument: &Argument) -> bool {
    argument
        .as_expression()
        .is_some_and(|expression| expression.get_inner_expression().is_null_or_undefined())
}
