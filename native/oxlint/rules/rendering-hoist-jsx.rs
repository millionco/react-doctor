use oxc_ast::{
    ast::{
        Expression, JSXAttributeItem, JSXAttributeValue, JSXChild, JSXElement, JSXElementName,
        JSXFragment, JSXMemberExpressionObject,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::is_react_component_name,
    AstNode,
};

#[derive(Debug, Default, Clone)]
pub struct RenderingHoistJsx;

declare_oxc_lint!(
    /// Disallow static JSX declarations inside React components.
    RenderingHoistJsx,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow rebuilding static JSX during render.",
);

impl Rule for RenderingHoistJsx {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if has_capability(ctx, "react-compiler") {
            return;
        }
        let AstKind::VariableDeclaration(declaration) = node.kind() else {
            return;
        };
        if !declaration.kind.is_const() || !rendering_hoist_jsx_is_inside_component(node, ctx) {
            return;
        }
        for declarator in &declaration.declarations {
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let initializer = strip_parenthesized_expression(initializer);
            if !matches!(
                initializer,
                Expression::JSXElement(_) | Expression::JSXFragment(_)
            ) || rendering_hoist_jsx_references_local_scope(initializer, ctx)
            {
                continue;
            }
            let name = declarator
                .id
                .get_binding_identifier()
                .map_or("<unnamed>", |identifier| identifier.name.as_str());
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This rebuilds on every render because static JSX \"{name}\" is built inside the component, so move it to the top of the file to make it just once"
                ))
                .with_label(declarator.span),
            );
        }
    }
}

fn rendering_hoist_jsx_is_inside_component<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .any(rendering_hoist_jsx_is_component_like)
}

fn rendering_hoist_jsx_is_component_like(node: &AstNode<'_>) -> bool {
    match node.kind() {
        AstKind::Function(function) if function.is_function_declaration() => function
            .id
            .as_ref()
            .is_some_and(|identifier| is_react_component_name(identifier.name.as_str())),
        AstKind::VariableDeclarator(declarator) => {
            declarator
                .id
                .get_binding_identifier()
                .is_some_and(|identifier| is_react_component_name(identifier.name.as_str()))
                && declarator.init.as_ref().is_some_and(|initializer| {
                    matches!(
                        strip_parenthesized_expression(initializer),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    )
                })
        }
        _ => false,
    }
}

fn rendering_hoist_jsx_references_local_scope<'a>(
    initializer: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match initializer {
        Expression::JSXElement(element) => rendering_hoist_jsx_element_is_dynamic(element, ctx),
        Expression::JSXFragment(fragment) => rendering_hoist_jsx_fragment_is_dynamic(fragment, ctx),
        _ => false,
    }
}

fn rendering_hoist_jsx_element_is_dynamic<'a>(
    element: &JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    rendering_hoist_jsx_element_references_local_scope(&element.opening_element.name, ctx)
        || element
            .opening_element
            .attributes
            .iter()
            .any(|attribute| match attribute {
                JSXAttributeItem::SpreadAttribute(_) => true,
                JSXAttributeItem::Attribute(attribute) => {
                    attribute.value.as_ref().is_some_and(|value| match value {
                        JSXAttributeValue::ExpressionContainer(container) => {
                            container.expression.as_expression().is_some()
                        }
                        JSXAttributeValue::Element(element) => {
                            rendering_hoist_jsx_element_is_dynamic(element, ctx)
                        }
                        JSXAttributeValue::Fragment(fragment) => {
                            rendering_hoist_jsx_fragment_is_dynamic(fragment, ctx)
                        }
                        JSXAttributeValue::StringLiteral(_) => false,
                    })
                }
            })
        || rendering_hoist_jsx_children_are_dynamic(&element.children, ctx)
}

fn rendering_hoist_jsx_fragment_is_dynamic<'a>(
    fragment: &JSXFragment<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    rendering_hoist_jsx_children_are_dynamic(&fragment.children, ctx)
}

fn rendering_hoist_jsx_children_are_dynamic<'a>(
    children: &[JSXChild<'a>],
    ctx: &LintContext<'a>,
) -> bool {
    children.iter().any(|child| match child {
        JSXChild::ExpressionContainer(container) => container.expression.as_expression().is_some(),
        JSXChild::Element(element) => rendering_hoist_jsx_element_is_dynamic(element, ctx),
        JSXChild::Fragment(fragment) => rendering_hoist_jsx_fragment_is_dynamic(fragment, ctx),
        JSXChild::Text(_) | JSXChild::Spread(_) => false,
    })
}

fn rendering_hoist_jsx_element_references_local_scope<'a>(
    name: &JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let identifier = match name {
        JSXElementName::IdentifierReference(identifier) => identifier,
        JSXElementName::MemberExpression(member_expression) => {
            let mut object = &member_expression.object;
            loop {
                match object {
                    JSXMemberExpressionObject::IdentifierReference(identifier) => break identifier,
                    JSXMemberExpressionObject::MemberExpression(member_expression) => {
                        object = &member_expression.object;
                    }
                    JSXMemberExpressionObject::ThisExpression(_) => return false,
                }
            }
        }
        _ => return false,
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if matches!(
        ctx.symbol_declaration(symbol_id).kind(),
        AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
    ) {
        return false;
    }
    !ctx.scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
}
