use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const GPU_LINE_MATERIAL_NAMES: [&str; 2] = ["lineBasicMaterial", "lineDashedMaterial"];
const GPU_LINE_WIDTH_PX: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct R3FNoIgnoredLinewidth;

impl RuleMeta for R3FNoIgnoredLinewidth {
    const NAME: &'static str = "r3f-no-ignored-linewidth";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow ignored React Three Fiber line widths.",
    };
}

impl Rule for R3FNoIgnoredLinewidth {
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
                    if GPU_LINE_MATERIAL_NAMES.contains(&identifier.name.as_str())
            ) || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                continue;
            }
            let Some(attribute) =
                get_authoritative_jsx_attribute(opening_element, "linewidth", true)
            else {
                continue;
            };
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            let Some(line_width) = resolve_static_number(expression, ctx) else {
                continue;
            };
            if line_width == GPU_LINE_WIDTH_PX {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "linewidth {line_width} is ignored by Three.js WebGL and WebGPU renderers, which render line primitives one pixel wide"
                ))
                .with_label(attribute.span),
            );
        }
    }
}
