use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, globals::VALID_ARIA_ROLES, rule::Rule, utils::has_jsx_prop_ignore_case};

const MESSAGE: &str = "Blind users can't follow this link because screen readers announce nothing, so add visible text, `aria-label`, or `aria-labelledby`.";

#[derive(Debug, Default, Clone)]
pub struct AnchorHasContent;

declare_oxc_lint!(
    /// Require accessible anchor content.
    AnchorHasContent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require accessible anchor content.",
);

impl Rule for AnchorHasContent {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let opening_element = &element.opening_element;
        if get_element_type(ctx, opening_element) != "a" {
            return;
        }
        let curated_behavior = should_use_curated_behavior(ctx);
        if curated_behavior
            && has_jsx_prop_ignore_case(opening_element, "href").is_none()
            && !can_have_link_role(opening_element)
        {
            return;
        }
        if is_hidden_from_screen_reader(opening_element, ctx)
            || object_has_accessible_child(element, ctx)
            || ["title", "aria-label", "aria-labelledby"]
                .iter()
                .any(|attribute_name| {
                    has_jsx_prop_ignore_case(opening_element, attribute_name).is_some()
                })
            || (curated_behavior && is_trans_components_template(node, ctx))
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
    }

    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && (!should_use_curated_behavior_host(ctx) || !is_non_production_file(ctx))
    }
}

fn should_use_curated_behavior(ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("portedRuleMode"))
        .and_then(serde_json::Value::as_str)
        == Some("curated")
}

fn should_use_curated_behavior_host(ctx: &crate::context::ContextHost) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("portedRuleMode"))
        .and_then(serde_json::Value::as_str)
        == Some("curated")
}

fn can_have_link_role(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(JSXAttributeItem::Attribute(role_attribute)) =
        has_jsx_prop_ignore_case(opening_element, "role")
    else {
        return false;
    };
    let Some(value) = &role_attribute.value else {
        return true;
    };
    let static_role = match value {
        JSXAttributeValue::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(string_literal) => Some(string_literal.value.as_str()),
            JSXExpression::TemplateLiteral(template_literal)
                if template_literal.expressions.is_empty()
                    && template_literal.quasis.len() == 1 =>
            {
                Some(template_literal.quasis[0].value.raw.as_str())
            }
            _ => None,
        },
        _ => None,
    };
    static_role.is_none_or(|role| {
        role.split_whitespace()
            .find(|role_name| VALID_ARIA_ROLES.contains(*role_name))
            == Some("link")
    })
}

fn is_trans_components_template<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::JSXAttribute(_) = ancestor.kind() else {
            continue;
        };
        let parent = ctx.nodes().parent_node(ancestor.id());
        let AstKind::JSXOpeningElement(opening_element) = parent.kind() else {
            return false;
        };
        return matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "Trans"
        ) || matches!(
            &opening_element.name,
            JSXElementName::IdentifierReference(identifier) if identifier.name == "Trans"
        );
    }
    false
}
