use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule, AstNode};

const BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES: [&str; 11] = [
    "BufferAttribute",
    "Float16BufferAttribute",
    "Float32BufferAttribute",
    "InstancedBufferAttribute",
    "Int16BufferAttribute",
    "Int32BufferAttribute",
    "Int8BufferAttribute",
    "Uint16BufferAttribute",
    "Uint32BufferAttribute",
    "Uint8BufferAttribute",
    "Uint8ClampedBufferAttribute",
];
const ARRAY_ARGUMENT_INDEX: usize = 0;
const ITEM_SIZE_ARGUMENT_INDEX: usize = 1;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidBufferAttributeArrayLength;

declare_oxc_lint!(
    /// Require complete Three.js buffer attribute items.
    ThreeValidBufferAttributeArrayLength,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js buffer attribute array lengths.",
);

impl Rule for ThreeValidBufferAttributeArrayLength {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        if !BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES
            .iter()
            .any(|constructor_name| {
                three_module_api_path_matches(&new_expression.callee, &[*constructor_name], ctx)
            })
        {
            return;
        }
        let Some(array_expression) = new_expression
            .arguments
            .get(ARRAY_ARGUMENT_INDEX)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(item_size_expression) = new_expression
            .arguments
            .get(ITEM_SIZE_ARGUMENT_INDEX)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(array_length) = resolve_static_array_like_length(array_expression, ctx) else {
            return;
        };
        let Some(item_size) = resolve_static_number(item_size_expression, ctx) else {
            return;
        };
        if item_size.fract() != 0.0 || item_size <= 0.0 || array_length % item_size == 0.0 {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "BufferAttribute array length {array_length} is not divisible by itemSize {item_size}, so the final attribute item is incomplete"
            ))
            .with_label(array_expression.span()),
        );
    }
}
