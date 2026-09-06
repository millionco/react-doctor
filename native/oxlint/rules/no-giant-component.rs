use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const GIANT_COMPONENT_LINE_THRESHOLD: usize = 300;

#[derive(Debug, Default, Clone)]
pub struct NoGiantComponent;

declare_oxc_lint!(
    /// Reports React components whose implementation exceeds 300 lines.
    NoGiantComponent,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Reports React components that are difficult to read and change.",
);

impl Rule for NoGiantComponent {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            if !matches!(
                node.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            ) {
                continue;
            }
            let Some((component_name, name_span)) = component_binding_name_and_span(node, ctx)
            else {
                continue;
            };
            if !component_name
                .chars()
                .next()
                .is_some_and(char::is_uppercase)
                || source_line_count(node.span(), ctx.source_text())
                    <= GIANT_COMPONENT_LINE_THRESHOLD
                || !function_contains_react_render_output(node, ctx)
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Component \"{component_name}\" is over {GIANT_COMPONENT_LINE_THRESHOLD} lines long, which is hard to read & change. Split it into a few smaller components."
                ))
                .with_label(name_span),
            );
        }
    }
}

fn component_binding_name_and_span<'a, 'b>(
    function_node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<(&'b str, Span)> {
    if let AstKind::Function(function) = function_node.kind()
        && function.is_declaration()
        && let Some(identifier) = &function.id
    {
        return Some((identifier.name.as_str(), identifier.span));
    }
    let mut expression_root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let AstKind::CallExpression(call_expression) = parent.kind() else {
            break;
        };
        if !call_expression
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
            .is_some_and(|argument| argument.span() == expression_root.span())
            || !matches!(call_expression.callee_name(), Some("memo" | "forwardRef"))
        {
            break;
        }
        expression_root = transparent_expression_root(parent, ctx);
    }
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    let identifier = declarator.id.get_binding_identifier()?;
    let identifier_span = declarator.id.span();
    let binding_span = Span::new(
        identifier_span.start,
        declarator
            .type_annotation
            .as_ref()
            .map_or(identifier_span.end, |annotation| annotation.span.end),
    );
    Some((identifier.name.as_str(), binding_span))
}

fn source_line_count(span: Span, source_text: &str) -> usize {
    source_text[span.start as usize..span.end as usize]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1
}
