use oxc_ast::{AstKind, ast::JSXAttributeValue};
use oxc_diagnostics::OxcDiagnostic;

use crate::{
    context::LintContext,
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

#[derive(Debug, Default, Clone)]
pub struct R3FNoInlinePrimitiveObject;

impl RuleMeta for R3FNoInlinePrimitiveObject {
    const NAME: &'static str = "r3f-no-inline-primitive-object";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Perf;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow fresh object values passed to R3F primitive elements during render.",
    };
}

impl Rule for R3FNoInlinePrimitiveObject {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) || !has_r3f_runtime_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if !opening_element
                .name
                .get_identifier_name()
                .is_some_and(|name| name == "primitive")
                || !is_render_phase_component_or_hook(node, ctx)
                || is_inside_stable_react_initializer(node, ctx)
            {
                continue;
            }
            let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "object", true)
            else {
                continue;
            };
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
                continue;
            };
            let Some(expression) = container.expression.as_expression() else {
                continue;
            };
            let Some(fresh_kind) = resolve_r3f_fresh_value(expression, ctx) else {
                continue;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This {fresh_kind} creates a different object for <primitive> on every render. Reuse a stable object created outside render or with useMemo"
                ))
                .with_label(expression.span()),
            );
        }
    }
}
