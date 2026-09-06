use oxc_ast::AstKind;

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

fn remotion_render_function_has_evidence<'a>(
    node: &crate::AstNode<'a>,
    ctx: &crate::context::LintContext<'a>,
) -> bool {
    let Some(render_function) = ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && component_or_hook_function_name(ancestor, ctx).is_some()
    }) else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if !oxc_span::GetSpan::span(render_function)
            .contains_inclusive(oxc_span::GetSpan::span(candidate))
        {
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
