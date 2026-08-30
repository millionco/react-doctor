use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const GESTURE_COMPOSING_CHAIN_METHOD_NAMES: [&str; 3] = [
    "simultaneousWithExternalGesture",
    "requireExternalGestureToFail",
    "blocksExternalGesture",
];
const GESTURE_DETECTOR_MESSAGE: &str =
    "Your users wait longer for the screen when <GestureDetector> handles a simple tap.";

#[derive(Debug, Default, Clone)]
pub struct RnPreferPressableOverGestureDetector;

declare_oxc_lint!(
    /// Warns when GestureDetector handles a plain single tap.
    RnPreferPressableOverGestureDetector,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when GestureDetector handles a plain single tap.",
);

impl Rule for RnPreferPressableOverGestureDetector {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_non_production_file(ctx)
            && is_react_native_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !gesture_detector_has_expected_import(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if resolve_jsx_element_name(opening_element) != Some("GestureDetector") {
                continue;
            }
            let Some(gesture_expression) =
                opening_element.attributes.iter().find_map(|attribute| {
                    let JSXAttributeItem::Attribute(attribute) = attribute else {
                        return None;
                    };
                    if !matches!(
                        &attribute.name,
                        JSXAttributeName::Identifier(identifier) if identifier.name == "gesture"
                    ) {
                        return None;
                    }
                    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                    else {
                        return None;
                    };
                    container.expression.as_expression()
                })
            else {
                continue;
            };
            let gesture_expression = gesture_expression.get_inner_expression();
            let chain_expression = match gesture_expression {
                Expression::Identifier(identifier) => {
                    let Some(initializer) =
                        identifier_direct_or_default_initializer(identifier, ctx)
                    else {
                        continue;
                    };
                    initializer.get_inner_expression()
                }
                expression => expression,
            };
            if !gesture_chain_is_pressable_eligible(chain_expression) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(GESTURE_DETECTOR_MESSAGE).with_label(opening_element.span),
            );
        }
    }
}

fn gesture_detector_has_expected_import(ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.local_name.name() == "GestureDetector"
            && entry.module_request.name() == "react-native-gesture-handler"
    })
}

fn gesture_chain_is_pressable_eligible(expression: &Expression<'_>) -> bool {
    let mut current_expression = expression.get_inner_expression();
    let mut effective_number_of_taps_is_single = None;
    loop {
        let Expression::CallExpression(call_expression) = current_expression else {
            return false;
        };
        let Some(member_expression) = call_expression.callee.as_member_expression() else {
            return false;
        };
        let Some(method_name) = member_expression_identifier_property_name(member_expression)
        else {
            return false;
        };
        let receiver = member_expression.object().get_inner_expression();
        if matches!(receiver, Expression::Identifier(identifier) if identifier.name == "Gesture") {
            return method_name == "Tap" && effective_number_of_taps_is_single.unwrap_or(true);
        }
        if GESTURE_COMPOSING_CHAIN_METHOD_NAMES.contains(&method_name) {
            return false;
        }
        if method_name == "numberOfTaps"
            && effective_number_of_taps_is_single.is_none()
            && call_expression.arguments.len() == 1
        {
            effective_number_of_taps_is_single = Some(matches!(
                call_expression.arguments.first(),
                Some(Argument::NumericLiteral(literal)) if literal.value == 1.0
            ));
        }
        current_expression = receiver;
    }
}
