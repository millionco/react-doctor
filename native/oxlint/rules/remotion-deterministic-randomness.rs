use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "`Math.random()` can return a different value in each parallel Remotion render tab, so the same frame is not deterministic. Use `random(seed)` from `remotion` instead.";
const REMOTION_RENDER_CALL_NAMES: [&str; 8] = [
    "continueRender",
    "delayRender",
    "getInputProps",
    "random",
    "spring",
    "useCurrentFrame",
    "useDelayRender",
    "useVideoConfig",
];
const REMOTION_RENDER_COMPONENT_NAMES: [&str; 7] = [
    "Freeze",
    "IFrame",
    "Img",
    "Loop",
    "OffthreadVideo",
    "Sequence",
    "Series",
];
const REMOTION_MEDIA_RENDER_COMPONENT_NAMES: [&str; 2] = ["Audio", "Video"];

#[derive(Debug, Default, Clone)]
pub struct RemotionDeterministicRandomness;

declare_oxc_lint!(
    /// Disallow nondeterministic randomness in Remotion renders.
    RemotionDeterministicRandomness,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow nondeterministic randomness in Remotion renders.",
);

impl Rule for RemotionDeterministicRandomness {
    fn run_once(&self, ctx: &LintContext<'_>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            let Some(member_expression) = call_expression
                .callee
                .get_inner_expression()
                .as_member_expression()
            else {
                continue;
            };
            if member_expression.static_property_name() != Some("random")
                || !is_global_math_object(member_expression.object(), ctx)
            {
                continue;
            }
            let Some(render_function) = remotion_render_function(node, ctx) else {
                continue;
            };
            if !remotion_render_function_has_evidence_for(render_function, ctx) {
                continue;
            }
            if let Some(display_name) = component_or_hook_function_name(render_function, ctx)
                && !crate::utils::is_react_hook_name(display_name)
                && !function_has_jsx_render_output(render_function, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
        }
    }
}

fn function_has_jsx_render_output<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !function_node.span().contains_inclusive(candidate.span())
            || !matches!(candidate.kind(), AstKind::JSXElement(_) | AstKind::JSXFragment(_))
        {
            return false;
        }
        let return_flow = ctx
            .nodes()
            .ancestors(candidate.id())
            .take_while(|ancestor| ancestor.id() != function_node.id())
            .try_fold(false, |has_return, ancestor| match ancestor.kind() {
                AstKind::ReturnStatement(_) => Some(true),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => None,
                _ => Some(has_return),
            });
        return_flow == Some(true)
            || (return_flow == Some(false)
                && matches!(
                    function_node.kind(),
                    AstKind::ArrowFunctionExpression(function)
                        if function.get_expression().is_some_and(|expression| {
                            expression.span().contains_inclusive(candidate.span())
                        })
                ))
    })
}

fn remotion_render_function<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let enclosing_function = crate::ast_util::get_enclosing_function(node, ctx)?;
    if !is_render_phase_component_or_hook(node, ctx) {
        return Some(enclosing_function);
    }
    ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && component_or_hook_function_name(ancestor, ctx).is_some()
    })
}

fn remotion_render_function_has_evidence_for<'a>(
    render_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !render_function.span().contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::CallExpression(call_expression) => {
                REMOTION_RENDER_CALL_NAMES.iter().any(|api_name| {
                    imported_module_api_matches(&call_expression.callee, api_name, "remotion", ctx)
                })
            }
            AstKind::JSXOpeningElement(opening_element) => {
                resolve_imported_jsx_component_name(opening_element, "remotion", ctx).is_some_and(
                    |component_name| REMOTION_RENDER_COMPONENT_NAMES.contains(&component_name),
                ) || resolve_imported_jsx_component_name(opening_element, "@remotion/media", ctx)
                    .is_some_and(|component_name| {
                        REMOTION_MEDIA_RENDER_COMPONENT_NAMES.contains(&component_name)
                    })
            }
            _ => false,
        }
    })
}

fn is_global_math_object(
    expression: &oxc_ast::ast::Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        oxc_ast::ast::Expression::Identifier(identifier) => {
            identifier.name == "Math"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => expression
            .as_member_expression()
            .is_some_and(|member_expression| {
                member_expression.static_property_name() == Some("Math")
                    && matches!(
                        member_expression.object().get_inner_expression(),
                        oxc_ast::ast::Expression::Identifier(identifier)
                            if identifier.name == "globalThis"
                                && ctx
                                    .scoping()
                                    .get_reference(identifier.reference_id())
                                    .symbol_id()
                                    .is_none()
                    )
            }),
    }
}
