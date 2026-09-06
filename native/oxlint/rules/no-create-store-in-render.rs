use oxc_ast::{AstKind, ast::Expression};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const STORE_FACTORIES: [(&str, &str, &str); 18] = [
    ("zustand", "create", "zustand.create"),
    ("zustand", "createStore", "zustand.createStore"),
    ("zustand/vanilla", "createStore", "zustand.createStore"),
    ("zustand/vanilla", "create", "zustand.create"),
    ("redux", "createStore", "redux.createStore"),
    (
        "@reduxjs/toolkit",
        "configureStore",
        "@reduxjs/toolkit.configureStore",
    ),
    ("@reduxjs/toolkit", "createSlice", "createSlice"),
    ("jotai", "atom", "jotai.atom"),
    ("jotai/vanilla", "atom", "jotai.atom"),
    ("jotai", "createStore", "jotai.createStore"),
    ("valtio", "proxy", "valtio.proxy"),
    ("valtio/vanilla", "proxy", "valtio.proxy"),
    ("mobx", "observable", "mobx.observable"),
    ("mobx", "makeAutoObservable", "mobx.makeAutoObservable"),
    ("mobx", "makeObservable", "mobx.makeObservable"),
    ("nanostores", "atom", "nanostores.atom"),
    ("nanostores", "map", "nanostores.map"),
    ("@xstate/store", "createStore", "@xstate/store.createStore"),
];

#[derive(Debug, Default, Clone)]
pub struct NoCreateStoreInRender;

declare_oxc_lint!(
    /// Disallows allocating external stores inside components and hooks.
    NoCreateStoreInRender,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallows allocating external stores during render.",
);

impl Rule for NoCreateStoreInRender {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Some(factory_label) = resolve_store_factory(&call_expression.callee, ctx) else {
            return;
        };
        let Some(enclosing_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        if component_or_hook_function_name(enclosing_function, ctx).is_none() {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "`{factory_label}(...)` builds a new store every render, so subscribers get cut off & saved state resets."
            ))
            .with_label(call_expression.span),
        );
    }
}

fn resolve_store_factory<'a>(
    callee: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let import_entry = resolve_identifier_import(identifier, ctx)?;
            let crate::module_record::ImportImportName::Name(imported_name) =
                &import_entry.import_name
            else {
                return None;
            };
            store_factory_label(import_entry.module_request.name(), imported_name.name())
        }
        Expression::StaticMemberExpression(member_expression) => {
            let Expression::Identifier(receiver) = member_expression.object.get_inner_expression()
            else {
                return None;
            };
            let import_entry = resolve_identifier_import(receiver, ctx)?;
            store_factory_label(
                import_entry.module_request.name(),
                member_expression.property.name.as_str(),
            )
        }
        _ => None,
    }
}

fn store_factory_label(module_source: &str, exported_name: &str) -> Option<&'static str> {
    STORE_FACTORIES
        .iter()
        .find(|(candidate_module, candidate_export, _)| {
            *candidate_module == module_source && *candidate_export == exported_name
        })
        .map(|(_, _, human_label)| *human_label)
}
