use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const QUERY_FACTORY_NAMES: [&str; 4] = [
    "atomWithQuery",
    "atomWithSuspenseQuery",
    "atomWithInfiniteQuery",
    "atomWithSuspenseInfiniteQuery",
];
const ENVELOPE_FIELD_NAMES: [&str; 10] = [
    "data",
    "error",
    "status",
    "fetchStatus",
    "isLoading",
    "isError",
    "isPending",
    "isSuccess",
    "isFetching",
    "refetch",
];

#[derive(Debug, Default, Clone)]
pub struct JotaiTqUseRawQueryAtom;

declare_oxc_lint!(
    /// Warn when a component subscribes to an entire Jotai query atom.
    JotaiTqUseRawQueryAtom,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Subscribing to raw query atom.",
);

impl Rule for JotaiTqUseRawQueryAtom {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = &call.callee else {
            return;
        };
        let hook_name = callee.name.as_str();
        if !matches!(hook_name, "useAtomValue" | "useAtom") {
            return;
        }
        let Some(Expression::Identifier(atom_identifier)) = call
            .arguments
            .first()
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let atom_name = atom_identifier.name.as_str();
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(atom_identifier.reference_id())
            .symbol_id()
        else {
            return;
        };
        let declaration = ctx.symbol_declaration(symbol_id);
        let is_file_local_query_atom = jotai_is_query_atom_declaration(declaration, ctx);
        let is_imported_query_atom = atom_name.ends_with("QueryAtom")
            && jotai_query_atom_import_is_user_owned(symbol_id, ctx)
            && jotai_hook_result_consumes_envelope(node, hook_name, ctx);
        if !is_file_local_query_atom && !is_imported_query_atom {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "`{hook_name}({atom_name})` subscribes to the whole query atom, so it re-renders your component on every refetch, focus, or no-op cache hit. Derive the field first: `const dataAtom = atom((get) => get({atom_name}).data)`."
            ))
            .with_label(call.span),
        );
    }
}

fn jotai_is_query_atom_declaration<'a>(declaration: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(factory_call)) = &declarator.init else {
        return false;
    };
    let Expression::Identifier(factory) = &factory_call.callee else {
        return false;
    };
    resolve_identifier_import(factory, ctx).is_some_and(|entry| {
        entry.module_request.name() == "jotai-tanstack-query"
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if QUERY_FACTORY_NAMES.contains(&imported_name.name())
            )
    })
}

fn jotai_query_atom_import_is_user_owned(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::Name(_)
            )
            && !matches!(
                entry.module_request.name(),
                "jotai" | "jotai/react" | "jotai-tanstack-query"
            )
    })
}

fn jotai_hook_result_consumes_envelope<'a>(
    call_node: &AstNode<'a>,
    hook_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(call_node.id());
    if let Some(member) = match parent.kind() {
        AstKind::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        _ => None,
    } {
        return ENVELOPE_FIELD_NAMES.contains(&member);
    }
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    let value_pattern = if hook_name == "useAtom" {
        let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
            return false;
        };
        let Some(Some(element)) = pattern.elements.first() else {
            return false;
        };
        element
    } else {
        &declarator.id
    };
    if jotai_pattern_consumes_envelope(value_pattern) {
        return true;
    }
    let Some(binding) = value_pattern.get_binding_identifier() else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(binding.symbol_id())
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let parent = ctx.nodes().parent_node(reference_node.id());
            match parent.kind() {
                AstKind::StaticMemberExpression(member) => {
                    ENVELOPE_FIELD_NAMES.contains(&member.property.name.as_str())
                }
                AstKind::VariableDeclarator(declarator) => {
                    jotai_pattern_consumes_envelope(&declarator.id)
                }
                _ => false,
            }
        })
}

fn jotai_pattern_consumes_envelope(pattern: &BindingPattern<'_>) -> bool {
    let BindingPattern::ObjectPattern(pattern) = pattern else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        matches!(&property.key, oxc_ast::ast::PropertyKey::StaticIdentifier(identifier)
            if ENVELOPE_FIELD_NAMES.contains(&identifier.name.as_str()))
    })
}
