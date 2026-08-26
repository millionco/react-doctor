use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const SHADOW_CASTING_LIGHT_NAMES: [&str; 3] = ["directionalLight", "pointLight", "spotLight"];

#[derive(Debug, Default, Clone)]
pub struct R3FValidShadowMapSize;

impl RuleMeta for R3FValidShadowMapSize {
    const NAME: &'static str = "r3f-valid-shadow-map-size";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber shadow map sizes.",
    };
}

impl Rule for R3FValidShadowMapSize {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !matches!(
                &opening_element.name,
                oxc_ast::ast::JSXElementName::Identifier(identifier)
                    if SHADOW_CASTING_LIGHT_NAMES.contains(&identifier.name.as_str())
            ) || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                continue;
            }
            let Some(cast_shadow_attribute) =
                get_authoritative_jsx_attribute(opening_element, "castShadow", true)
            else {
                continue;
            };
            if read_static_jsx_boolean_attribute(cast_shadow_attribute) != Some(true) {
                continue;
            }
            if let Some(map_size_expression) =
                get_jsx_attribute_expression(opening_element, "shadow-mapSize")
            {
                if let oxc_ast::ast::Expression::ArrayExpression(array_expression) =
                    map_size_expression.get_inner_expression()
                {
                    let values = array_expression
                        .elements
                        .iter()
                        .map(|element| {
                            element
                                .as_expression()
                                .and_then(|expression| resolve_static_number(expression, ctx))
                        })
                        .collect::<Option<Vec<_>>>();
                    if let Some(values) = values {
                        for value in values.into_iter().take(2) {
                            if is_valid_shadow_map_size(value) {
                                continue;
                            }
                            report_invalid_shadow_map_size(value, map_size_expression, ctx);
                        }
                    }
                }
            }
            for attribute_name in ["shadow-mapSize-width", "shadow-mapSize-height"] {
                let Some(expression) =
                    get_jsx_attribute_expression(opening_element, attribute_name)
                else {
                    continue;
                };
                let Some(value) = resolve_static_number(expression, ctx) else {
                    continue;
                };
                if !is_valid_shadow_map_size(value) {
                    report_invalid_shadow_map_size(value, expression, ctx);
                }
            }
        }
    }
}

fn get_jsx_attribute_expression<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
) -> Option<&'a oxc_ast::ast::Expression<'a>> {
    let attribute = get_authoritative_jsx_attribute(opening_element, attribute_name, true)?;
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    container.expression.as_expression()
}

fn is_valid_shadow_map_size(value: f64) -> bool {
    value >= 1.0 && value.fract() == 0.0 && value.log2().fract() == 0.0
}

fn report_invalid_shadow_map_size<'a>(
    value: f64,
    expression: &oxc_ast::ast::Expression<'a>,
    ctx: &LintContext<'a>,
) {
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Shadow map size {value} is invalid; Three.js shadow map dimensions must be positive powers of two"
        ))
        .with_label(expression.span()),
    );
}
