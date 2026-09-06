use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const INERT_INPUT_HOOK_NAMES: [&str; 2] = ["useInput", "usePaste"];

#[derive(Debug, Default, Clone)]
pub struct InkNoLiveHooksInRenderToString;

declare_oxc_lint!(
    /// Disallow live Ink input hooks in components used only by renderToString.
    InkNoLiveHooksInRenderToString,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow inert Ink input hooks during string rendering.",
);

impl Rule for InkNoLiveHooksInRenderToString {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(hook_call) = node.kind() else {
            return;
        };
        let Some(hook_name) = INERT_INPUT_HOOK_NAMES.iter().find(|hook_name| {
            imported_module_api_matches(&hook_call.callee, hook_name, "ink", ctx)
        }) else {
            return;
        };
        let Some(component_symbol_id) = ink_component_symbol_for_node(node, ctx) else {
            return;
        };
        if ink_component_symbol_is_exported(component_symbol_id, ctx) {
            return;
        }
        let has_snapshot_render = ctx.nodes().iter().any(|candidate| {
            matches!(
                candidate.kind(),
                AstKind::CallExpression(render_call)
                    if ink_render_call_is_related_to_node(
                        render_call,
                        node,
                        "renderToString",
                        ctx,
                    )
            )
        });
        let has_live_render = ctx.nodes().iter().any(|candidate| {
            matches!(
                candidate.kind(),
                AstKind::CallExpression(render_call)
                    if ink_render_call_is_related_to_node(render_call, node, "render", ctx)
            )
        });
        if has_snapshot_render && !has_live_render {
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Ink `{hook_name}` never receives input under `renderToString()`."
                ))
                .with_label(hook_call.span),
            );
        }
    }
}

fn ink_component_symbol_is_exported(
    component_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    if !ctx
        .scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(component_symbol_id))
        .is_top()
    {
        return false;
    }
    let component_name = ctx.scoping().symbol_name(component_symbol_id);
    ctx.module_record()
        .local_export_entries
        .iter()
        .any(|entry| !entry.is_type && entry.local_name.name() == Some(component_name))
}
