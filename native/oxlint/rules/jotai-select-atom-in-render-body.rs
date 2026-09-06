use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "`selectAtom(...)` runs in a component or hook without `useMemo`, so every render makes a new atom & re-subscribes forever, freezing the page for your users. Lift it to module scope, or wrap it in `useMemo(() => selectAtom(...), [deps])`.";

#[derive(Debug, Default, Clone)]
pub struct JotaiSelectAtomInRenderBody;

declare_oxc_lint!(
    /// Disallow creating a Jotai selectAtom during render.
    JotaiSelectAtomInRenderBody,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "selectAtom called during render.",
);

impl Rule for JotaiSelectAtomInRenderBody {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = &call.callee else {
            return;
        };
        let Some(import_entry) = resolve_identifier_import(callee, ctx) else {
            return;
        };
        if !matches!(import_entry.module_request.name(), "jotai" | "jotai/utils")
            || !matches!(
                &import_entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "selectAtom"
            )
        {
            return;
        }
        let mut enclosing_functions = ctx
            .nodes()
            .ancestors(node.id())
            .filter(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .peekable();
        let Some(nearest_function) = enclosing_functions.peek() else {
            return;
        };
        if jotai_select_atom_is_deferred(nearest_function, ctx)
            || !enclosing_functions
                .any(|function| component_or_hook_function_name(function, ctx).is_some())
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call.span));
    }
}

fn jotai_select_atom_is_deferred<'a>(function: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let function_root = transparent_expression_root(function, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    if let AstKind::CallExpression(call) = parent.kind()
        && call.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == function_root.span())
        })
        && call.callee_name().is_some_and(|name| {
            matches!(name, "useMemo" | "useCallback")
                || (matches!(name, "useEffect" | "useLayoutEffect" | "useInsertionEffect")
                    && call.arguments.get(1).is_some())
        })
    {
        return true;
    }
    let handler_binding = match function.kind() {
        AstKind::Function(function) => function.id.as_ref().or_else(|| match parent.kind() {
            AstKind::VariableDeclarator(declarator) => declarator.id.get_binding_identifier(),
            _ => None,
        }),
        AstKind::ArrowFunctionExpression(_) => match parent.kind() {
            AstKind::VariableDeclarator(declarator) => declarator.id.get_binding_identifier(),
            _ => None,
        },
        _ => None,
    };
    if let Some(binding) = handler_binding
        && (jotai_handler_name(binding.name.as_str())
            || jotai_binding_is_used_as_handler(binding.symbol_id(), ctx))
        && !jotai_binding_is_invoked_during_render(binding.symbol_id(), ctx)
    {
        return true;
    }
    ctx.nodes()
        .ancestors(function.id())
        .take(4)
        .any(|ancestor| {
            matches!(ancestor.kind(), AstKind::JSXAttribute(attribute)
            if matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                if jotai_handler_name(identifier.name.as_str())))
                || matches!(ancestor.kind(), AstKind::ObjectProperty(property)
                if property.key.static_name().is_some_and(|name| jotai_handler_name(&name)))
        })
}

fn jotai_binding_is_used_as_handler(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            ctx.nodes()
                .ancestors(reference_node.id())
                .take(4)
                .any(|ancestor| {
                    matches!(ancestor.kind(), AstKind::JSXAttribute(attribute)
                        if matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                            if jotai_handler_name(identifier.name.as_str())))
                        || matches!(ancestor.kind(), AstKind::ObjectProperty(property)
                            if property.key.static_name().is_some_and(|name| jotai_handler_name(&name)))
                })
        })
}

fn jotai_binding_is_invoked_during_render(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            if !matches!(parent.kind(), AstKind::CallExpression(call)
                if call.callee.span() == reference_root.span())
            {
                return false;
            }
            for ancestor in ctx.nodes().ancestors(parent.id()) {
                if !matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    continue;
                }
                if jotai_select_atom_is_directly_deferred(ancestor, ctx) {
                    return false;
                }
                if component_or_hook_function_name(ancestor, ctx).is_some() {
                    return true;
                }
            }
            false
        })
}

fn jotai_select_atom_is_directly_deferred<'a>(
    function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(function, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    matches!(parent.kind(), AstKind::CallExpression(call)
    if call.arguments.first().is_some_and(|argument| argument.as_expression().is_some_and(|expression| expression.span() == root.span()))
        && call.callee_name().is_some_and(|name| {
            matches!(name, "useMemo" | "useCallback")
                || (matches!(name, "useEffect" | "useLayoutEffect" | "useInsertionEffect")
                    && call.arguments.get(1).is_some())
        }))
        || matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
            if declarator.id.get_binding_identifier().is_some_and(|identifier| jotai_handler_name(identifier.name.as_str())))
        || matches!(function.kind(), AstKind::Function(inner)
            if inner.id.as_ref().is_some_and(|identifier| jotai_handler_name(identifier.name.as_str())))
}

fn jotai_handler_name(name: &str) -> bool {
    name.starts_with("on") && name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase)
        || name.starts_with("handle") && name.as_bytes().get(6).is_some_and(u8::is_ascii_uppercase)
}
