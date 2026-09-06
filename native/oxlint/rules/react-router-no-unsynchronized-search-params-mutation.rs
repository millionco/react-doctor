use oxc_ast::{AstKind, ast::BindingPattern};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];
const SEARCH_PARAM_MUTATOR_NAMES: [&str; 4] = ["append", "delete", "set", "sort"];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterNoUnsynchronizedSearchParamsMutation;

declare_oxc_lint!(
    /// Disallows mutating stable React Router search params without synchronizing the URL.
    ReactRouterNoUnsynchronizedSearchParamsMutation,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unsynchronized search params mutation.",
);

impl Rule for ReactRouterNoUnsynchronizedSearchParamsMutation {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
            return;
        };
        let Some(oxc_ast::ast::Expression::CallExpression(use_search_params_call)) =
            &declarator.init
        else {
            return;
        };
        let oxc_ast::ast::Expression::Identifier(use_search_params_callee) =
            &use_search_params_call.callee
        else {
            return;
        };
        if !direct_named_import_matches(
            use_search_params_callee,
            &["useSearchParams"],
            &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
            ctx,
        ) {
            return;
        }
        let Some(BindingPattern::BindingIdentifier(search_params_binding)) =
            pattern.elements.first().and_then(Option::as_ref)
        else {
            return;
        };

        let search_params_symbols =
            collect_exact_search_params_alias_symbols(search_params_binding.symbol_id(), ctx);
        let setter_calls = pattern
            .elements
            .get(1)
            .and_then(Option::as_ref)
            .and_then(BindingPattern::get_binding_identifier)
            .map_or_else(Vec::new, |setter_binding| {
                direct_identifier_calls(setter_binding.symbol_id(), ctx)
            });
        let serialization_calls = collect_search_params_serialization_calls(
            &search_params_symbols,
            ctx,
        );

        for symbol_id in &search_params_symbols {
            for reference in ctx.scoping().get_resolved_references(*symbol_id) {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let member_node = ctx.nodes().parent_node(reference_node.id());
                let Some(property_name) =
                    referenced_member_property_name(reference_node, member_node)
                else {
                    continue;
                };
                if !SEARCH_PARAM_MUTATOR_NAMES.contains(&property_name.as_str()) {
                    continue;
                }
                let call_node = ctx.nodes().parent_node(member_node.id());
                let AstKind::CallExpression(call_expression) = call_node.kind() else {
                    continue;
                };
                if call_expression.callee.span() != member_node.span() {
                    continue;
                }
                let operation_owner = search_params_operation_owner(call_node, ctx);
                if setter_calls.iter().any(|setter_call_id| {
                    search_params_operation_owner(ctx.nodes().get_node(*setter_call_id), ctx)
                        == operation_owner
                }) || serialization_calls.iter().any(|serialization_call_id| {
                    let serialization_call = ctx.nodes().get_node(*serialization_call_id);
                    search_params_operation_owner(serialization_call, ctx) == operation_owner
                        && (is_returned_before_function_boundary(serialization_call, ctx)
                            || containing_call_before_function_boundary(serialization_call, ctx)
                                .is_some_and(|containing_call| {
                                    is_proven_navigate_call(containing_call, ctx)
                                }))
                }) {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::error(format!(
                        "{}.{property_name}() mutates a stable search params object without synchronizing the URL.",
                        search_params_binding.name
                    ))
                    .with_label(call_node.span()),
                );
            }
        }
    }
}

fn collect_exact_search_params_alias_symbols(
    source_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Vec<SymbolId> {
    let mut symbol_ids = vec![source_symbol_id];
    let mut seen_symbol_ids = FxHashSet::from_iter([source_symbol_id]);
    let mut symbol_index = 0;
    while symbol_index < symbol_ids.len() {
        let symbol_id = symbol_ids[symbol_index];
        symbol_index += 1;
        let alias_symbol_ids = ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .filter_map(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let reference_root = transparent_expression_root(reference_node, ctx);
                let declarator_node = ctx.nodes().parent_node(reference_root.id());
                let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                    return None;
                };
                if declarator
                    .init
                    .as_ref()
                    .is_none_or(|initializer| initializer.span() != reference_root.span())
                {
                    return None;
                }
                let BindingPattern::BindingIdentifier(alias_binding) = &declarator.id else {
                    return None;
                };
                let alias_symbol_id = alias_binding.symbol_id();
                if seen_symbol_ids.contains(&alias_symbol_id) {
                    return None;
                }
                let initializer =
                    resolve_direct_unreassigned_symbol_initializer(alias_symbol_id, ctx)?;
                let oxc_ast::ast::Expression::Identifier(initializer_identifier) =
                    initializer.get_inner_expression()
                else {
                    return None;
                };
                (ctx
                    .scoping()
                    .get_reference(initializer_identifier.reference_id())
                    .symbol_id()
                    == Some(symbol_id))
                .then_some(alias_symbol_id)
            })
            .collect::<Vec<_>>();
        for alias_symbol_id in alias_symbol_ids {
            if seen_symbol_ids.insert(alias_symbol_id) {
                symbol_ids.push(alias_symbol_id);
            }
        }
    }
    symbol_ids
}

fn direct_identifier_calls(symbol_id: SymbolId, ctx: &LintContext<'_>) -> Vec<NodeId> {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter_map(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let call_node = ctx.nodes().parent_node(reference_node.id());
            let AstKind::CallExpression(call_expression) = call_node.kind() else {
                return None;
            };
            (call_expression.callee.span() == reference_node.span()).then_some(call_node.id())
        })
        .collect()
}

fn collect_search_params_serialization_calls(
    symbol_ids: &[SymbolId],
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    symbol_ids
        .iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(*symbol_id))
        .filter_map(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let member_node = ctx.nodes().parent_node(reference_node.id());
            if referenced_member_property_name(reference_node, member_node).as_deref()
                != Some("toString")
            {
                return None;
            }
            let call_node = ctx.nodes().parent_node(member_node.id());
            let AstKind::CallExpression(call_expression) = call_node.kind() else {
                return None;
            };
            (call_expression.callee.span() == member_node.span()).then_some(call_node.id())
        })
        .collect()
}

fn referenced_member_property_name(
    reference_node: &AstNode<'_>,
    member_node: &AstNode<'_>,
) -> Option<String> {
    match member_node.kind() {
        AstKind::StaticMemberExpression(member_expression)
            if member_expression.object.span() == reference_node.span() =>
        {
            Some(member_expression.property.name.to_string())
        }
        AstKind::ComputedMemberExpression(member_expression)
            if member_expression.object.span() == reference_node.span() =>
        {
            member_expression
                .static_property_name()
                .map(|property_name| property_name.to_string())
        }
        _ => None,
    }
}

fn search_params_operation_owner<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let mut owner = crate::ast_util::get_enclosing_function(node, ctx);
    while let Some(function_node) = owner {
        if !is_inline_call_callback(function_node, ctx) {
            return Some(function_node.id());
        }
        owner = ctx
            .nodes()
            .ancestors(function_node.id())
            .skip(1)
            .find(|ancestor| {
                matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            });
    }
    None
}

fn is_inline_call_callback(function_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    call_expression.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|expression| expression.span() == function_node.span())
    })
}

fn is_returned_before_function_boundary(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::ReturnStatement(_) => return true,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
    }
    false
}

fn containing_call_before_function_boundary<'a, 'ctx>(
    node: &AstNode<'a>,
    ctx: &'ctx LintContext<'a>,
) -> Option<&'ctx AstNode<'a>> {
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::CallExpression(_) => return Some(ancestor),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return None,
            _ => {}
        }
    }
    None
}

fn is_proven_navigate_call<'a>(call_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(callee) = &call_expression.callee else {
        return false;
    };
    let Some(initializer) = resolve_direct_unreassigned_initializer(callee, ctx) else {
        return false;
    };
    let oxc_ast::ast::Expression::CallExpression(use_navigate_call) = initializer else {
        return false;
    };
    let oxc_ast::ast::Expression::Identifier(use_navigate_callee) = &use_navigate_call.callee else {
        return false;
    };
    direct_named_import_matches(
        use_navigate_callee,
        &["useNavigate"],
        &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
        ctx,
    )
}
