use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElementName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const SHOPIFY_FLASH_LIST_MODULE_SOURCE: &str = "@shopify/flash-list";
const LEGEND_LIST_MODULE_SOURCE: &str = "@legendapp/list";
const SHOPIFY_FLASH_LIST_COMPONENT_NAMES: [&str; 2] = ["FlashList", "AnimatedFlashList"];
const SIZING_HINT_ATTRIBUTE_NAMES: [&str; 2] = ["estimatedItemSize", "estimatedListSize"];

#[derive(Debug, Default, Clone)]
pub struct RnListMissingEstimatedItemSize;

declare_oxc_lint!(
    /// Require an estimated item size on legacy recycling lists.
    RnListMissingEstimatedItemSize,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require an estimated item size on legacy recycling lists.",
);

impl Rule for RnListMissingEstimatedItemSize {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_test_noise_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let JSXElementName::IdentifierReference(local_identifier) = &opening_element.name else {
            return;
        };
        let canonical_component_name = resolve_reportable_recycler_name(opening_element, ctx);
        let Some(canonical_component_name) = canonical_component_name else {
            return;
        };
        if SHOPIFY_FLASH_LIST_COMPONENT_NAMES.contains(&canonical_component_name)
            && is_shopify_flash_list_v2_or_newer(ctx)
        {
            return;
        }

        let mut has_sizing_hint = false;
        let mut has_data_attribute = false;
        let mut data_is_empty_array_literal = false;
        for attribute in &opening_element.attributes {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                continue;
            };
            let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                continue;
            };
            if SIZING_HINT_ATTRIBUTE_NAMES.contains(&attribute_name.name.as_str()) {
                has_sizing_hint = true;
            }
            if attribute_name.name != "data" {
                continue;
            }
            has_data_attribute = true;
            data_is_empty_array_literal |= matches!(
                &attribute.value,
                Some(JSXAttributeValue::ExpressionContainer(container))
                    if matches!(container.expression.as_expression(), Some(Expression::ArrayExpression(array)) if array.elements.is_empty())
            );
        }
        if has_sizing_hint || !has_data_attribute || data_is_empty_array_literal {
            return;
        }

        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users see blank cells flash on fast scroll when <{}> has no `estimatedItemSize`.",
                local_identifier.name
            ))
            .with_label(opening_element.span),
        );
    }
}

fn resolve_reportable_recycler_name<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b str> {
    let shopify_component_name =
        resolve_imported_jsx_component_name(opening_element, SHOPIFY_FLASH_LIST_MODULE_SOURCE, ctx);
    if shopify_component_name
        .is_some_and(|component_name| SHOPIFY_FLASH_LIST_COMPONENT_NAMES.contains(&component_name))
    {
        return shopify_component_name;
    }
    (resolve_imported_jsx_component_name(opening_element, LEGEND_LIST_MODULE_SOURCE, ctx)
        == Some("LegendList"))
    .then_some("LegendList")
}

fn is_shopify_flash_list_v2_or_newer(ctx: &LintContext<'_>) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("shopifyFlashListMajorVersion"))
        .and_then(serde_json::Value::as_f64)
        .is_some_and(|major_version| major_version >= 2.0)
}
