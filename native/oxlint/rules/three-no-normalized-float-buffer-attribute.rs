use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES: [&str; 3] = [
    "BufferAttribute",
    "Float16BufferAttribute",
    "Float32BufferAttribute",
];
const FLOAT_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES: [&str; 2] =
    ["Float16BufferAttribute", "Float32BufferAttribute"];
const ARRAY_ARGUMENT_INDEX: usize = 0;
const NORMALIZED_ARGUMENT_INDEX: usize = 2;
const MESSAGE: &str = "BufferAttribute normalized only applies to integer data and has no effect on floating-point arrays";

#[derive(Debug, Default, Clone)]
pub struct ThreeNoNormalizedFloatBufferAttribute;

declare_oxc_lint!(
    /// Disallow ignored normalization on Three.js float attributes.
    ThreeNoNormalizedFloatBufferAttribute,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow ignored float attribute normalization.",
);

impl Rule for ThreeNoNormalizedFloatBufferAttribute {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::NewExpression(new_expression) = node.kind() else {
            return;
        };
        let Some(constructor_name) =
            BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES
                .iter()
                .copied()
                .find(|constructor_name| {
                    three_module_api_path_matches(&new_expression.callee, &[*constructor_name], ctx)
                })
        else {
            return;
        };
        let Some(normalized_expression) = new_expression
            .arguments
            .get(NORMALIZED_ARGUMENT_INDEX)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        if !matches!(
            normalized_expression.get_inner_expression(),
            oxc_ast::ast::Expression::BooleanLiteral(boolean_literal) if boolean_literal.value
        ) {
            return;
        }
        let uses_float_data = FLOAT_BUFFER_ATTRIBUTE_CONSTRUCTOR_NAMES.contains(&constructor_name)
            || (constructor_name == "BufferAttribute"
                && new_expression
                    .arguments
                    .get(ARRAY_ARGUMENT_INDEX)
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .is_some_and(|array_expression| is_float_typed_array(array_expression, ctx)));
        if uses_float_data {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(normalized_expression.span()));
        }
    }
}
