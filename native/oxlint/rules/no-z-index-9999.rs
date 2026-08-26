use oxc_ast::{AstKind, ast::Argument};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const Z_INDEX_ABSURD_THRESHOLD: f64 = 1000.0;

#[derive(Debug, Default, Clone)]
#[allow(non_camel_case_types)]
pub struct NoZIndex_9999;

pub type NoZIndex9999 = NoZIndex_9999;

declare_oxc_lint!(
    /// Disallow excessively high z-index values.
    NoZIndex_9999,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow excessively high z-index values.",
);

impl Rule for NoZIndex_9999 {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXAttribute(attribute) => {
                    let Some(style) = get_inline_style_object_expression(attribute) else {
                        continue;
                    };
                    for property in &style.properties {
                        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property
                        else {
                            continue;
                        };
                        if property.key.static_name().as_deref() != Some("zIndex") {
                            continue;
                        }
                        let Some(value) = get_static_style_property_number_value(property) else {
                            continue;
                        };
                        if value >= Z_INDEX_ABSURD_THRESHOLD {
                            ctx.diagnostic(
                                OxcDiagnostic::warn(format!(
                                    "z-index {} is unusually high and can hide a layering bug instead of fixing it. Use a small set scale, like 1 to 50.",
                                    format_javascript_number(value),
                                ))
                                .with_label(property.span),
                            );
                            return;
                        }
                    }
                }
                AstKind::CallExpression(call_expression) => {
                    let Some(member_expression) = call_expression.callee.as_member_expression()
                    else {
                        continue;
                    };
                    if member_expression_identifier_property_name(member_expression)
                        != Some("create")
                        || !matches!(
                            member_expression.object(),
                            oxc_ast::ast::Expression::Identifier(identifier)
                                if identifier.name == "StyleSheet"
                        )
                    {
                        continue;
                    }
                    let Some(Argument::ObjectExpression(argument)) =
                        call_expression.arguments.first()
                    else {
                        continue;
                    };
                    for candidate in ctx.nodes().iter() {
                        let AstKind::ObjectProperty(property) = candidate.kind() else {
                            continue;
                        };
                        if property.key.static_name().as_deref() != Some("zIndex")
                            || !ctx
                                .nodes()
                                .ancestors(candidate.id())
                                .any(|ancestor| ancestor.id() == argument.node_id.get())
                        {
                            continue;
                        }
                        let oxc_ast::ast::Expression::NumericLiteral(value) = &property.value else {
                            continue;
                        };
                        if value.value >= Z_INDEX_ABSURD_THRESHOLD {
                            ctx.diagnostic(
                                OxcDiagnostic::warn(format!(
                                    "z-index {} is way too high & usually hides a layering bug instead of fixing it, so use a small set scale, like 1 to 50.",
                                    format_javascript_number(value.value),
                                ))
                                .with_label(property.span),
                            );
                            return;
                        }
                    }
                }
                _ => {}
            }
        }
    }
}
