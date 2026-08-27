use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const ARRAY_ARGUMENT_INDEX: usize = 0;
const NORMALIZED_ARGUMENT_INDEX: usize = 2;
const MESSAGE: &str = "BufferAttribute normalized only applies to integer data and has no effect on floating-point arrays";

#[derive(Debug, Default, Clone)]
pub struct R3FNoNormalizedFloatBufferAttribute;

impl RuleMeta for R3FNoNormalizedFloatBufferAttribute {
    const NAME: &'static str = "r3f-no-normalized-float-buffer-attribute";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Disallow ignored R3F float attribute normalization.",
    };
}

impl Rule for R3FNoNormalizedFloatBufferAttribute {
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
            let oxc_ast::ast::JSXElementName::Identifier(identifier) = &opening_element.name else {
                continue;
            };
            if opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                continue;
            }
            let Some(arguments) =
                get_authoritative_jsx_attribute(opening_element, "args", true)
                    .and_then(|attribute| jsx_attribute_expression(attribute))
                    .and_then(|expression| {
                        let oxc_ast::ast::Expression::ArrayExpression(arguments) =
                            expression.get_inner_expression()
                        else {
                            return None;
                        };
                        Some(arguments)
                    })
            else {
                continue;
            };
            let Some(normalized_expression) = arguments
                .elements
                .get(NORMALIZED_ARGUMENT_INDEX)
                .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
            else {
                continue;
            };
            if !matches!(
                normalized_expression.get_inner_expression(),
                oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) if boolean_literal.value
            ) {
                continue;
            }
            let uses_float_data = matches!(
                identifier.name.as_str(),
                "float16BufferAttribute" | "float32BufferAttribute"
            ) || (identifier.name == "bufferAttribute"
                && arguments
                    .elements
                    .get(ARRAY_ARGUMENT_INDEX)
                    .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
                    .is_some_and(|array_expression| is_float_typed_array(array_expression, ctx)));
            if uses_float_data {
                ctx.diagnostic(
                    OxcDiagnostic::warn(MESSAGE).with_label(normalized_expression.span()),
                );
            }
        }
    }
}
