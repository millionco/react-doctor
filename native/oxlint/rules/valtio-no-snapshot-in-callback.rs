use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, BindingPattern, Expression, JSXAttributeName, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "This callback reads a Valtio snapshot. Read the original proxy instead so callback-only fields do not become tracked render dependencies.";
const VALTIO_MODULES: [&str; 2] = ["valtio", "valtio/react"];
const DEFERRED_REACT_HOOK_NAMES: [&str; 3] = ["useEffect", "useInsertionEffect", "useLayoutEffect"];
const TIMER_AND_SCHEDULER_NAMES: [&str; 5] = [
    "setTimeout",
    "setInterval",
    "requestAnimationFrame",
    "requestIdleCallback",
    "queueMicrotask",
];
const PROMISE_CONTINUATION_NAMES: [&str; 3] = ["catch", "finally", "then"];
const DEFERRED_CONSTRUCTOR_NAMES: [&str; 4] = [
    "IntersectionObserver",
    "MutationObserver",
    "PerformanceObserver",
    "ResizeObserver",
];
const SUBSCRIPTION_METHOD_NAMES: [&str; 7] = [
    "subscribe",
    "addEventListener",
    "addListener",
    "on",
    "watch",
    "listen",
    "sub",
];

#[derive(Debug, Default, Clone)]
pub struct ValtioNoSnapshotInCallback;

declare_oxc_lint!(
    /// Warns when a deferred callback reads a Valtio snapshot.
    ValtioNoSnapshotInCallback,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a callback reads a Valtio snapshot.",
);

impl Rule for ValtioNoSnapshotInCallback {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !has_capability(ctx, "valtio:1")
            || !ctx
                .module_record()
                .import_entries
                .iter()
                .any(|entry| VALTIO_MODULES.contains(&entry.module_request.name()))
        {
            return;
        }

        for node in ctx.nodes().iter() {
            let AstKind::IdentifierReference(identifier) = node.kind() else {
                continue;
            };
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            if reference.is_write() && !reference.is_read() {
                continue;
            }
            let Some(snapshot_call_id) = valtio_callback_snapshot_origin_identifier(
                identifier,
                ctx,
                &mut FxHashSet::default(),
            ) else {
                continue;
            };
            if valtio_callback_is_direct_snapshot_alias_initializer(node, ctx) {
                continue;
            }
            let Some(snapshot_owner_id) =
                valtio_callback_nearest_function_id(snapshot_call_id, ctx)
            else {
                continue;
            };
            let Some(reference_owner_id) = valtio_callback_nearest_function_id(node.id(), ctx)
            else {
                continue;
            };
            if reference_owner_id == snapshot_owner_id
                || !valtio_callback_function_is_deferred(
                    reference_owner_id,
                    snapshot_owner_id,
                    ctx,
                    &mut FxHashSet::default(),
                )
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(identifier.span));
        }
    }
}

fn valtio_callback_snapshot_origin_identifier<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbols.insert(symbol_id) {
        return None;
    }
    let initializer = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?;
    valtio_callback_snapshot_origin_call(initializer, ctx, visited_symbols)
}

fn valtio_callback_snapshot_origin_call<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            valtio_callback_is_use_snapshot_callee(&call.callee, ctx, &mut FxHashSet::default())
                .then(|| call.node_id.get())
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let initializer = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)?;
            valtio_callback_snapshot_origin_call(initializer, ctx, visited_symbols)
        }
        _ => None,
    }
}

fn valtio_callback_is_use_snapshot_callee<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbols.insert(symbol_id) {
                return false;
            }
            if valtio_callback_is_named_snapshot_import(symbol_id, ctx) {
                return true;
            }
            resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx).is_some_and(
                |initializer| {
                    valtio_callback_is_use_snapshot_callee(initializer, ctx, visited_symbols)
                },
            )
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            member.static_property_name() == Some("useSnapshot")
                && valtio_callback_resolves_to_namespace(member.object(), ctx, visited_symbols)
        }
    }
}

fn valtio_callback_resolves_to_namespace<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    if valtio_callback_is_namespace_import(symbol_id, ctx) {
        return true;
    }
    resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx).is_some_and(|initializer| {
        valtio_callback_resolves_to_namespace(initializer, ctx, visited_symbols)
    })
}

fn valtio_callback_is_named_snapshot_import(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        VALTIO_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(name)
                if name.name() == "useSnapshot")
    })
}

fn valtio_callback_is_namespace_import(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        VALTIO_MODULES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
    })
}

fn valtio_callback_is_direct_snapshot_alias_initializer<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    matches!(parent.kind(), AstKind::VariableDeclarator(declarator)
        if declarator.init.as_ref().is_some_and(|initializer| initializer.span() == root.span())
            && matches!(&declarator.id, BindingPattern::BindingIdentifier(_)))
}

fn valtio_callback_function_is_deferred<'a>(
    function_id: NodeId,
    snapshot_owner_id: NodeId,
    ctx: &LintContext<'a>,
    visited_function_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    let function_root = transparent_expression_root(function_node, ctx);
    if valtio_callback_is_deferred_value(function_root, ctx) {
        return true;
    }
    if function_executes_during_render(function_root, ctx) {
        let parent = ctx.nodes().parent_node(function_root.id());
        if matches!(
            parent.kind(),
            AstKind::CallExpression(_) | AstKind::NewExpression(_)
        ) && valtio_callback_node_executes_from_deferred(
            parent,
            snapshot_owner_id,
            ctx,
            visited_function_symbols,
        ) {
            return true;
        }
    }
    let Some(symbol_id) = valtio_callback_function_binding_symbol(function_node, ctx) else {
        return false;
    };
    valtio_callback_symbol_is_deferred(symbol_id, snapshot_owner_id, ctx, visited_function_symbols)
}

fn valtio_callback_symbol_is_deferred<'a>(
    symbol_id: SymbolId,
    snapshot_owner_id: NodeId,
    ctx: &LintContext<'a>,
    visited_function_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_function_symbols.insert(symbol_id) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            if valtio_callback_is_deferred_value(reference_root, ctx) {
                return true;
            }
            if let Some(alias_symbol) = valtio_callback_const_alias_symbol(reference_root, ctx)
                && valtio_callback_symbol_is_deferred(
                    alias_symbol,
                    snapshot_owner_id,
                    ctx,
                    visited_function_symbols,
                )
            {
                return true;
            }
            let parent = ctx.nodes().parent_node(reference_root.id());
            if matches!(parent.kind(), AstKind::CallExpression(call)
                if call.callee.span() == reference_root.span())
                && valtio_callback_node_executes_from_deferred(
                    parent,
                    snapshot_owner_id,
                    ctx,
                    visited_function_symbols,
                )
            {
                return true;
            }
            function_executes_during_render(reference_root, ctx)
                && matches!(
                    parent.kind(),
                    AstKind::CallExpression(_) | AstKind::NewExpression(_)
                )
                && valtio_callback_node_executes_from_deferred(
                    parent,
                    snapshot_owner_id,
                    ctx,
                    visited_function_symbols,
                )
        })
}

fn valtio_callback_node_executes_from_deferred<'a>(
    node: &AstNode<'a>,
    snapshot_owner_id: NodeId,
    ctx: &LintContext<'a>,
    visited_function_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(enclosing_function_id) = valtio_callback_nearest_function_id(node.id(), ctx) else {
        return false;
    };
    enclosing_function_id != snapshot_owner_id
        && valtio_callback_function_is_deferred(
            enclosing_function_id,
            snapshot_owner_id,
            ctx,
            visited_function_symbols,
        )
}

fn valtio_callback_is_deferred_value(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    valtio_callback_is_jsx_handler_value(node, ctx)
        || valtio_callback_is_deferred_argument(node, ctx)
        || valtio_callback_is_effect_cleanup_value(node, ctx)
}

fn valtio_callback_is_jsx_handler_value(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let container = ctx.nodes().parent_node(node.id());
    if !matches!(container.kind(), AstKind::JSXExpressionContainer(_)) {
        return false;
    }
    let attribute_node = ctx.nodes().parent_node(container.id());
    matches!(attribute_node.kind(), AstKind::JSXAttribute(attribute)
        if matches!(&attribute.name, JSXAttributeName::Identifier(name)
            if name.name.starts_with("on")
                && name.name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase)))
}

fn valtio_callback_is_deferred_argument(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    match parent.kind() {
        AstKind::NewExpression(new_expression) => {
            expression_is_argument_at(&new_expression.arguments, 0, node.span())
                && matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                    if DEFERRED_CONSTRUCTOR_NAMES.contains(&identifier.name.as_str())
                        && valtio_callback_is_global_identifier(identifier, ctx))
        }
        AstKind::CallExpression(call) => {
            if !call.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|argument| argument.span() == node.span())
            }) {
                return false;
            }
            if expression_is_argument_at(&call.arguments, 0, node.span()) {
                if DEFERRED_REACT_HOOK_NAMES
                    .iter()
                    .any(|hook_name| is_react_api_call(call, hook_name, ctx))
                    || valtio_callback_is_global_deferred_call(call, ctx)
                {
                    return true;
                }
            }
            call.callee
                .get_inner_expression()
                .as_member_expression()
                .and_then(MemberExpression::static_property_name)
                .is_some_and(|method_name| {
                    SUBSCRIPTION_METHOD_NAMES.contains(&method_name)
                        || PROMISE_CONTINUATION_NAMES.contains(&method_name)
                })
        }
        _ => false,
    }
}

fn valtio_callback_is_global_deferred_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            TIMER_AND_SCHEDULER_NAMES.contains(&identifier.name.as_str())
                && valtio_callback_is_global_identifier(identifier, ctx)
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if !TIMER_AND_SCHEDULER_NAMES.contains(&method_name) {
                return false;
            }
            matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "globalThis" | "window")
                    && valtio_callback_is_global_identifier(identifier, ctx))
        }
    }
}

fn valtio_callback_is_global_identifier(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn valtio_callback_is_effect_cleanup_value(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    if matches!(parent.kind(), AstKind::ArrowFunctionExpression(function)
        if function.get_expression().is_some_and(|body| body.span() == node.span()))
    {
        return valtio_callback_function_is_effect_callback(
            parent.id(),
            ctx,
            &mut FxHashSet::default(),
        );
    }
    if !matches!(parent.kind(), AstKind::ReturnStatement(statement)
        if statement.argument.as_ref().is_some_and(|argument| argument.span() == node.span()))
    {
        return false;
    }
    let Some(effect_function_id) = valtio_callback_nearest_function_id(parent.id(), ctx) else {
        return false;
    };
    valtio_callback_function_is_effect_callback(effect_function_id, ctx, &mut FxHashSet::default())
}

fn valtio_callback_function_is_effect_callback(
    function_id: NodeId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    let root = transparent_expression_root(function_node, ctx);
    if valtio_callback_is_effect_callback_value(root, ctx) {
        return true;
    }
    let Some(symbol_id) = valtio_callback_function_binding_symbol(function_node, ctx) else {
        return false;
    };
    valtio_callback_symbol_is_effect_callback(symbol_id, ctx, visited_symbols)
}

fn valtio_callback_symbol_is_effect_callback(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let root = transparent_expression_root(reference_node, ctx);
            valtio_callback_is_effect_callback_value(root, ctx)
                || valtio_callback_const_alias_symbol(root, ctx).is_some_and(|alias_symbol| {
                    valtio_callback_symbol_is_effect_callback(alias_symbol, ctx, visited_symbols)
                })
        })
}

fn valtio_callback_is_effect_callback_value(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    expression_is_argument_at(&call.arguments, 0, node.span())
        && DEFERRED_REACT_HOOK_NAMES
            .iter()
            .any(|hook_name| is_react_api_call(call, hook_name, ctx))
}

fn valtio_callback_const_alias_symbol(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != node.span())
    {
        return None;
    }
    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
        return None;
    };
    let declaration = ctx.nodes().parent_node(parent.id());
    matches!(declaration.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        .then(|| identifier.symbol_id())
}

fn valtio_callback_function_binding_symbol<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && function.is_function_declaration()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    if let AstKind::VariableDeclarator(declarator) = parent.kind()
        && let BindingPattern::BindingIdentifier(identifier) = &declarator.id
    {
        return Some(identifier.symbol_id());
    }
    if let AstKind::AssignmentExpression(assignment) = parent.kind()
        && assignment.right.span() == root.span()
        && let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left
    {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id();
    }
    let AstKind::CallExpression(_) = parent.kind() else {
        return None;
    };
    let call_parent = ctx.nodes().parent_node(parent.id());
    let AstKind::VariableDeclarator(declarator) = call_parent.kind() else {
        return None;
    };
    declarator
        .id
        .get_binding_identifier()
        .map(oxc_ast::ast::BindingIdentifier::symbol_id)
}

fn valtio_callback_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
