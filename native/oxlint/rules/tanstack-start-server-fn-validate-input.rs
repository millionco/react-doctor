use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This server function reads network data with no validator(), so anyone can send unvalidated input.";

#[derive(Debug, Default, Clone)]
pub struct TanstackStartServerFnValidateInput;

declare_oxc_lint!(
    /// Require validation when a TanStack Start server function reads network data.
    TanstackStartServerFnValidateInput,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require validation for TanStack Start server-function input.",
);

impl Rule for TanstackStartServerFnValidateInput {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(handler_call) = node.kind() else {
            return;
        };
        let Some(handler_member) = handler_call.callee.as_member_expression() else {
            return;
        };
        if handler_member.static_property_name() != Some("handler") {
            return;
        }
        let chain_info = walk_tanstack_server_fn_chain(handler_call);
        if !chain_info.is_server_fn_chain || chain_info.has_input_validation {
            return;
        }
        let Some(handler_expression) = handler_call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .map(Expression::get_inner_expression)
        else {
            return;
        };
        let (parameters, handler_span) = match handler_expression {
            Expression::ArrowFunctionExpression(function) => {
                (function.params.as_ref(), function.span)
            }
            Expression::FunctionExpression(function) => (function.params.as_ref(), function.span),
            _ => return,
        };
        let Some(first_parameter) = parameters.items.first() else {
            return;
        };

        let accesses_data = match &first_parameter.pattern {
            BindingPattern::ObjectPattern(pattern) => object_pattern_has_data_property(pattern),
            BindingPattern::BindingIdentifier(identifier) => {
                handler_uses_parameter_data(identifier.name.as_str(), handler_span, ctx)
            }
            _ => false,
        };
        if accesses_data {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(handler_call.span));
        }
    }
}

fn object_pattern_has_data_property(pattern: &oxc_ast::ast::ObjectPattern<'_>) -> bool {
    pattern.properties.iter().any(|property| {
        matches!(
            &property.key,
            oxc_ast::ast::PropertyKey::StaticIdentifier(identifier)
                if identifier.name == "data"
        )
    })
}

fn handler_uses_parameter_data(
    parameter_name: &str,
    handler_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !handler_span.contains_inclusive(candidate.kind().span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::StaticMemberExpression(member) => {
                member.property.name == "data"
                    && matches!(
                        member.object.get_inner_expression(),
                        Expression::Identifier(identifier) if identifier.name == parameter_name
                    )
            }
            AstKind::VariableDeclarator(declarator) => {
                matches!(
                    declarator.init.as_ref().map(Expression::get_inner_expression),
                    Some(Expression::Identifier(identifier)) if identifier.name == parameter_name
                ) && matches!(
                    &declarator.id,
                    BindingPattern::ObjectPattern(pattern) if object_pattern_has_data_property(pattern)
                )
            }
            _ => false,
        }
    })
}
