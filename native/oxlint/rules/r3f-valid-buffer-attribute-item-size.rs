use oxc_ast::{ast::JSXAttributeValue, AstKind};
use oxc_diagnostics::OxcDiagnostic;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::{Rule, RuleCategory, RuleInfo, RuleMeta},
};

const BUFFER_ATTRIBUTE_NAMES: [&str; 11] = [
    "bufferAttribute",
    "float16BufferAttribute",
    "float32BufferAttribute",
    "instancedBufferAttribute",
    "int16BufferAttribute",
    "int32BufferAttribute",
    "int8BufferAttribute",
    "uint16BufferAttribute",
    "uint32BufferAttribute",
    "uint8BufferAttribute",
    "uint8ClampedBufferAttribute",
];
const ITEM_SIZE_ARGUMENT_INDEX: usize = 1;
const MINIMUM_ITEM_SIZE: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct R3FValidBufferAttributeItemSize;

impl RuleMeta for R3FValidBufferAttributeItemSize {
    const NAME: &'static str = "r3f-valid-buffer-attribute-item-size";
    const PLUGIN: &'static str = "react_doctor_native";
    const CATEGORY: RuleCategory = RuleCategory::Correctness;
    const VERSION: &'static str = "0.1.0";
    const INFO: RuleInfo = RuleInfo {
        short_description: "Validate React Three Fiber buffer attribute item sizes.",
    };
}

impl Rule for R3FValidBufferAttributeItemSize {
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
                    if BUFFER_ATTRIBUTE_NAMES.contains(&identifier.name.as_str())
            ) || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            }) {
                continue;
            }
            let Some(args_attribute) =
                get_authoritative_jsx_attribute(opening_element, "args", true)
            else {
                continue;
            };
            let Some(JSXAttributeValue::ExpressionContainer(container)) = &args_attribute.value
            else {
                continue;
            };
            let Some(oxc_ast::ast::Expression::ArrayExpression(arguments)) = container
                .expression
                .as_expression()
                .map(|expression| expression.get_inner_expression())
            else {
                continue;
            };
            let Some(item_size_expression) = arguments
                .elements
                .get(ITEM_SIZE_ARGUMENT_INDEX)
                .and_then(oxc_ast::ast::ArrayExpressionElement::as_expression)
            else {
                continue;
            };
            let Some(item_size) = resolve_static_number(item_size_expression, ctx) else {
                continue;
            };
            if item_size.fract() == 0.0 && item_size >= MINIMUM_ITEM_SIZE {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "BufferAttribute itemSize {item_size} is invalid; itemSize must be a positive integer"
                ))
                .with_label(item_size_expression.span()),
            );
        }
    }
}
