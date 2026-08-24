use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeName, ObjectPropertyKind, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NoPermanentWillChange;

declare_oxc_lint!(
    /// Warns when will-change permanently promotes an element.
    NoPermanentWillChange,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when will-change permanently promotes an element.",
);

impl Rule for NoPermanentWillChange {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXAttribute(attribute) = node.kind() else {
            return;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return;
        };
        if matches!(attribute_name.name.as_str(), "className" | "class") {
            let Some(class_name) = get_string_literal_attribute_value(attribute) else {
                return;
            };
            let Some(permanent_utility) = class_name
                .split_whitespace()
                .find(|token| is_permanent_will_change_class(token))
            else {
                return;
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "This keeps {permanent_utility} active permanently, which can waste GPU memory. Apply the hint only immediately before the animation and remove it afterward."
                ))
                .with_label(attribute.span),
            );
            return;
        }
        if attribute_name.name != "style" {
            return;
        }
        let Some(style) = get_inline_style_object_expression(attribute) else {
            return;
        };
        for property in &style.properties {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                continue;
            };
            if !matches!(
                &property.key,
                PropertyKey::StaticIdentifier(identifier) if identifier.name == "willChange"
            ) || matches!(
                &property.value,
                Expression::ConditionalExpression(_) | Expression::LogicalExpression(_)
            ) || matches!(
                &property.value,
                Expression::StringLiteral(value) if value.value.trim() == "scroll-position"
            ) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(
                    "This wastes GPU memory because will-change is left on all the time, so add it right before the animation & remove it when the animation ends",
                )
                .with_label(property.span),
            );
        }
    }
}

fn is_permanent_will_change_class(token: &str) -> bool {
    let utility = token.strip_prefix('!').unwrap_or(token);
    !utility.contains(':')
        && !matches!(
            utility,
            "will-change-auto"
                | "will-change-scroll"
                | "will-change-[auto]"
                | "will-change-[scroll-position]"
        )
        && utility.starts_with("will-change-")
}
