use oxc_ast::{
    AstKind,
    ast::{JSXAttributeValue, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct ShadcnCommandItemStateVariantRequiresValue;

declare_oxc_lint!(
    /// Require value-aware state variants on shadcn command items.
    ShadcnCommandItemStateVariantRequiresValue,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require value-aware state variants on shadcn command items.",
);

impl Rule for ShadcnCommandItemStateVariantRequiresValue {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability_or_unspecified(ctx, "shadcn") {
            return;
        }
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !is_command_item_element(&opening_element.name, ctx) {
            return;
        }
        let Some(class_name_attribute) = find_jsx_attribute(opening_element, "className") else {
            return;
        };
        let Some((literal_span, state, token)) =
            find_presence_variant_use_in_class_name(class_name_attribute, ctx)
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "cmdk renders data-{state} on every command item as \"true\" or \"false\", so \"{token}\" matches both values and styles every item. Use data-[{state}=true]: instead."
            ))
            .with_label(literal_span),
        );
    }
}

fn is_command_item_element<'a>(
    element_name: &JSXElementName<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if resolve_shadcn_component_name(element_name, "command", ctx).as_deref()
        == Some("CommandItem")
    {
        return true;
    }
    resolve_jsx_import_api_path(element_name, |module_source| module_source == "cmdk", ctx)
        .is_some_and(|api_path| {
            matches!(
                api_path.as_slice(),
                [component_name] if component_name == "CommandItem"
            ) || matches!(
                api_path.as_slice(),
                [command_name, item_name] if command_name == "Command" && item_name == "Item"
            )
        })
}

fn find_presence_variant_use_in_class_name<'a>(
    attribute: &oxc_ast::ast::JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) -> Option<(Span, &'static str, String)> {
    let value = attribute.value.as_ref()?;
    if let JSXAttributeValue::StringLiteral(string_literal) = value {
        return find_presence_variant_use(string_literal.value.as_str())
            .map(|(state, token)| (string_literal.span, state, token));
    }
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return None;
    };
    let expression = container.expression.as_expression()?;
    let expression_span = expression.span();
    for candidate in ctx.nodes().iter() {
        if !expression_span.contains_inclusive(candidate.span()) {
            continue;
        }
        match candidate.kind() {
            AstKind::StringLiteral(string_literal) => {
                if let Some((state, token)) =
                    find_presence_variant_use(string_literal.value.as_str())
                {
                    return Some((string_literal.span, state, token));
                }
            }
            AstKind::TemplateLiteral(template_literal) => {
                for quasi in &template_literal.quasis {
                    let text = quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str());
                    if let Some((state, token)) = find_presence_variant_use(text) {
                        return Some((template_literal.span, state, token));
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn find_presence_variant_use(text: &str) -> Option<(&'static str, String)> {
    for token in tailwind_class_name_tokens(text) {
        let Some(state) = token.variants.iter().find_map(|variant| match *variant {
            "data-[selected]" => Some("selected"),
            "data-[disabled]" => Some("disabled"),
            _ => None,
        }) else {
            continue;
        };
        return Some((state, token.raw_token.to_string()));
    }
    None
}
