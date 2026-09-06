use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

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
const ITEM_SIZE_ARGUMENT_INDEX: usize = 1;
const MINIMUM_ITEM_SIZE: f64 = 1.0;

#[derive(Debug, Default, Clone)]
pub struct ThreeValidBufferAttributeItemSize;

declare_oxc_lint!(
    /// Require positive integer Three.js buffer attribute item sizes.
    ThreeValidBufferAttributeItemSize,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Validate Three.js buffer attribute item sizes.",
);

impl Rule for ThreeValidBufferAttributeItemSize {
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
        let Some(item_size_expression) = new_expression
            .arguments
            .get(ITEM_SIZE_ARGUMENT_INDEX)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Some(item_size) = resolve_static_number(item_size_expression, ctx) else {
            return;
        };
        if item_size.fract() == 0.0 && item_size >= MINIMUM_ITEM_SIZE {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "BufferAttribute itemSize {item_size} is invalid; itemSize must be a positive integer"
            ))
            .with_label(item_size_expression.span()),
        );
    }
}
