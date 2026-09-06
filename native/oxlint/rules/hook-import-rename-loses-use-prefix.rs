use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const REACT_HOOK_NAMES_REQUIRING_EXACT_ALIAS: [&str; 6] = [
    "useEffect",
    "useLayoutEffect",
    "useMemo",
    "useCallback",
    "useImperativeHandle",
    "useEffectEvent",
];

#[derive(Debug, Default, Clone)]
pub struct HookImportRenameLosesUsePrefix;

declare_oxc_lint!(
    /// Keep imported hook aliases recognizable to hook lint rules.
    HookImportRenameLosesUsePrefix,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Keep imported hook aliases recognizable to hook lint rules.",
);

impl Rule for HookImportRenameLosesUsePrefix {
    fn should_run(&self, ctx: &crate::context::ContextHost) -> bool {
        !is_test_noise_file(ctx) && !is_non_source_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::ImportDeclaration(import_declaration) = node.kind() else {
            return;
        };
        let source = import_declaration.source.value.as_str();
        if source != "react" && !source.starts_with('.') {
            return;
        }
        for_each_value_import(import_declaration, |import_specifier| {
            let imported_name = import_specifier.imported.name();
            let imported_name = imported_name.as_str();
            if (imported_name == "use" && source != "react")
                || (imported_name != "use" && !crate::utils::is_react_hook_name(imported_name))
            {
                return;
            }
            let local_name = import_specifier.local.name.as_str();
            if local_name == imported_name {
                return;
            }
            let loses_generic_hook_semantics = !crate::utils::is_react_hook_name(local_name)
                || (local_name == "use" && imported_name != "use");
            let loses_react_hook_specific_semantics = source == "react"
                && REACT_HOOK_NAMES_REQUIRING_EXACT_ALIAS.contains(&imported_name);
            if !loses_generic_hook_semantics && !loses_react_hook_specific_semantics {
                return;
            }

            let mut invoked_calls = ctx
                .scoping()
                .get_resolved_references(import_specifier.local.symbol_id())
                .filter_map(|reference| {
                    let reference_node = ctx.nodes().get_node(reference.node_id());
                    let callee = transparent_expression_root(reference_node, ctx);
                    let parent = ctx.nodes().parent_node(callee.id());
                    matches!(parent.kind(), AstKind::CallExpression(call) if call.callee.span() == callee.span())
                        .then_some(parent)
                });
            let should_report = if loses_react_hook_specific_semantics {
                invoked_calls.next().is_some()
            } else {
                let mut has_invoked_call = false;
                let are_all_calls_safe = invoked_calls.all(|call| {
                    has_invoked_call = true;
                    is_safe_hook_wrapper_call(call, ctx)
                });
                has_invoked_call && !are_all_calls_safe
            };
            if !should_report {
                return;
            }

            let message = if loses_react_hook_specific_semantics {
                format!(
                    "Renaming React's \"{imported_name}\" hook to \"{local_name}\" prevents hook-specific lint checks from recognising it, so keep the original import name."
                )
            } else if local_name == "use" {
                format!(
                    "Renaming the \"{imported_name}\" hook to bare \"use\" applies React 19's conditionally-callable use() semantics, so keep the hook's original use-prefixed name."
                )
            } else {
                format!(
                    "Renaming the \"{imported_name}\" hook to \"{local_name}\" turns off Rules of Hooks checks for direct calls, so keep a recognised \"use\" prefix in the alias."
                )
            };
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(import_specifier.span));
        });
    }
}

fn is_safe_hook_wrapper_call<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(function_node) = crate::ast_util::get_enclosing_function(call_node, ctx) else {
        return false;
    };
    if match function_node.kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => true,
    } {
        return false;
    }
    let Some(function_name) = component_or_hook_function_name(function_node, ctx) else {
        return false;
    };
    crate::utils::is_react_hook_name(function_name)
        && do_nodes_cover_every_path_after_node(
            function_node,
            std::slice::from_ref(&call_node),
            function_node,
            ctx,
        )
        && !is_node_conditionally_executed(call_node, function_node.id(), ctx)
        && !is_inside_try_statement(call_node, function_node.id(), ctx)
}

fn is_inside_try_statement(
    node: &AstNode<'_>,
    boundary_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == boundary_node_id {
            return false;
        }
        if matches!(ancestor.kind(), AstKind::TryStatement(_)) {
            return true;
        }
    }
    false
}
