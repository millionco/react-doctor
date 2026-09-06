use oxc_ast::{
    AstKind,
    ast::{JSXAttributeValue, JSXElementName, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NoNestedComponentDefinition;

declare_oxc_lint!(
    /// Disallows rendering a component defined inside another component.
    NoNestedComponentDefinition,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallows components defined inside another component.",
);

impl Rule for NoNestedComponentDefinition {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let Some((component_name, report_span)) = component_candidate(node, ctx) else {
                continue;
            };
            let Some((enclosing_name, enclosing_function)) = ctx
                .nodes()
                .ancestors(node.id())
                .filter(|ancestor| ancestor.id() != node.id())
                .find_map(|ancestor| {
                    component_candidate(ancestor, ctx).map(|(name, _)| (name, ancestor))
                })
            else {
                continue;
            };
            if !component_is_rendered_within(component_name, enclosing_function.span(), ctx) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users lose all state in \"{component_name}\" on every render because it's defined inside \"{enclosing_name}\", so move it out to the top of the file."
                ))
                .with_label(report_span),
            );
        }
    }
}

fn component_candidate<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b str, Span)> {
    match node.kind() {
        AstKind::Function(function) if function.is_declaration() => {
            let identifier = function.id.as_ref()?;
            is_component_name(identifier.name.as_str())
                .then_some((identifier.name.as_str(), identifier.span))
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let expression_root = transparent_expression_root(node, ctx);
            let parent = ctx.nodes().parent_node(expression_root.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return None;
            };
            if !declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == expression_root.span())
            {
                return None;
            }
            let identifier = declarator.id.get_binding_identifier()?;
            let identifier_span = declarator.id.span();
            let binding_span = Span::new(
                identifier_span.start,
                declarator
                    .type_annotation
                    .as_ref()
                    .map_or(identifier_span.end, |annotation| annotation.span.end),
            );
            is_component_name(identifier.name.as_str())
                .then_some((identifier.name.as_str(), binding_span))
        }
        _ => None,
    }
}

fn component_is_rendered_within(
    component_name: &str,
    enclosing_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        enclosing_span.contains_inclusive(candidate.span())
            && match candidate.kind() {
                AstKind::JSXOpeningElement(opening_element) => match &opening_element.name {
                    JSXElementName::Identifier(identifier) => identifier.name == component_name,
                    JSXElementName::IdentifierReference(identifier) => {
                        identifier.name == component_name
                    }
                    _ => false,
                },
                AstKind::JSXAttribute(attribute) => matches!(
                    &attribute.value,
                    Some(JSXAttributeValue::ExpressionContainer(container))
                        if matches!(
                            &container.expression,
                            JSXExpression::Identifier(identifier)
                                if identifier.name == component_name
                        )
                ),
                _ => false,
            }
    })
}

fn is_component_name(name: &str) -> bool {
    name.chars().next().is_some_and(char::is_uppercase)
}
