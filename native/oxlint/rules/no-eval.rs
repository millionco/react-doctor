use oxc_ast::{
    AstKind,
    ast::{Argument, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EVAL_MESSAGE: &str = "eval() is a code-injection vulnerability: it runs any string as code.";
const FUNCTION_MESSAGE: &str =
    "new Function() is a code-injection vulnerability: it builds & runs code from a string.";

#[derive(Debug, Default, Clone)]
pub struct NoEval;

declare_oxc_lint!(
    /// Disallow dynamic evaluation in production code.
    NoEval,
    react_doctor_native,
    suspicious,
    version = "0.1.0",
    short_description = "Disallow dynamic evaluation in production code.",
);

impl Rule for NoEval {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && !is_sandbox_evaluation_surface(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::CallExpression(call_expression) => {
                if executable_global_name_matches(&call_expression.callee, "eval", ctx) {
                    ctx.diagnostic(
                        OxcDiagnostic::error(EVAL_MESSAGE).with_label(call_expression.span),
                    );
                    return;
                }
                let timer_name =
                    if executable_global_name_matches(&call_expression.callee, "setTimeout", ctx) {
                        Some("setTimeout")
                    } else if executable_global_name_matches(
                        &call_expression.callee,
                        "setInterval",
                        ctx,
                    ) {
                        Some("setInterval")
                    } else {
                        None
                    };
                if let Some(timer_name) = timer_name
                    && matches!(
                        call_expression.arguments.first(),
                        Some(Argument::StringLiteral(_))
                    )
                {
                    ctx.diagnostic(
                        OxcDiagnostic::error(format!(
                            "Passing a string to {timer_name}() is a code-injection vulnerability, since it runs that string as code."
                        ))
                        .with_label(call_expression.span),
                    );
                }
            }
            AstKind::NewExpression(new_expression) => {
                if !executable_global_name_matches(&new_expression.callee, "Function", ctx)
                    || is_global_this_polyfill(new_expression.arguments.as_slice())
                {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::error(FUNCTION_MESSAGE).with_label(new_expression.span),
                );
            }
            _ => {}
        }
    }
}

fn executable_global_name_matches(
    expression: &Expression<'_>,
    expected_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return identifier.name == expected_name && is_unresolved_reference(identifier, ctx);
    }
    let Some(member_expression) = expression.get_member_expr() else {
        return false;
    };
    let Expression::Identifier(receiver) = member_expression.object().get_inner_expression() else {
        return false;
    };
    receiver.name == "globalThis"
        && is_unresolved_reference(receiver, ctx)
        && member_expression.static_property_name() == Some(expected_name)
}

fn is_unresolved_reference(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn is_global_this_polyfill(arguments: &[Argument<'_>]) -> bool {
    matches!(
        arguments,
        [Argument::StringLiteral(literal)] if literal.value.trim() == "return this"
    )
}

fn is_sandbox_evaluation_surface(ctx: &ContextHost) -> bool {
    let filename = ctx
        .file_path()
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    has_hyphen_delimited_sandbox_segment(&filename) || has_sandbox_file_suffix(&filename)
}

fn has_hyphen_delimited_sandbox_segment(filename: &str) -> bool {
    filename.match_indices("sandbox").any(|(index, segment)| {
        let previous = index
            .checked_sub(1)
            .and_then(|offset| filename.as_bytes().get(offset));
        let next = filename.as_bytes().get(index + segment.len());
        previous.is_none_or(|byte| matches!(byte, b'/' | b'-'))
            && next.is_none_or(|byte| matches!(byte, b'/' | b'-'))
    })
}

fn has_sandbox_file_suffix(filename: &str) -> bool {
    let basename = filename.rsplit('/').next().unwrap_or(filename);
    [
        ".js", ".jsx", ".ts", ".tsx", ".cjs", ".cjsx", ".cts", ".ctsx", ".mjs", ".mjsx", ".mts",
        ".mtsx",
    ]
    .iter()
    .filter_map(|extension| basename.strip_suffix(extension))
    .filter_map(|stem| stem.strip_suffix("-sandbox"))
    .any(|prefix| {
        !prefix.is_empty()
            && prefix
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.'))
    })
}
