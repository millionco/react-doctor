use oxc_ast::{
    AstKind,
    ast::{Argument, Expression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::FxHashSet;

use crate::{AstNode, context::LintContext, rule::Rule};

const WRAPPER_HOOK_NAMES: [&str; 3] = ["useMemo", "useCallback", "useRef"];
const EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const FACTORY_NAMES: [&str; 2] = ["debounce", "throttle"];
const RELEASE_METHOD_NAMES: [&str; 2] = ["cancel", "flush"];

#[derive(Debug, Default, Clone)]
pub struct DebounceNoCleanup;

declare_oxc_lint!(
    /// Require effect-driven memoized Lodash debounce and throttle callbacks to release timers.
    DebounceNoCleanup,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require memoized debounced callbacks to cancel on unmount.",
);

impl Rule for DebounceNoCleanup {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for hook_node in ctx.nodes().iter() {
            let AstKind::CallExpression(hook_call) = hook_node.kind() else {
                continue;
            };
            if !is_react_hook_call(hook_call, &WRAPPER_HOOK_NAMES, ctx) {
                continue;
            }
            let Some(debounce_call_id) = debounce_call_in_hook_initializer(hook_call, ctx) else {
                continue;
            };
            let debounce_node = ctx.nodes().get_node(debounce_call_id);
            let AstKind::CallExpression(debounce_call) = debounce_node.kind() else {
                continue;
            };
            if debounce_has_trailing_false(debounce_call, hook_node.span().start, ctx) {
                continue;
            }
            let hook_root = transparent_expression_root(hook_node, ctx);
            let declarator_node = ctx.nodes().parent_node(hook_root.id());
            let AstKind::VariableDeclarator(declarator) = declarator_node.kind() else {
                continue;
            };
            if declarator
                .init
                .as_ref()
                .is_none_or(|initializer| initializer.span() != hook_root.span())
            {
                continue;
            }
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            let Some(owner_function_id) = local_callback_nearest_function_id(hook_node.id(), ctx)
            else {
                continue;
            };
            let alias_symbols =
                collect_debounce_alias_symbols(binding.symbol_id(), owner_function_id, ctx);
            if debounce_binding_is_released_or_escaped(&alias_symbols, owner_function_id, ctx)
                || !debounce_binding_is_effect_invoked(&alias_symbols, owner_function_id, ctx)
            {
                continue;
            }
            let Some(wrapped_callback_id) = debounce_wrapped_callback_id(debounce_call, ctx) else {
                continue;
            };
            if !debounce_callback_has_async_or_dom_work(wrapped_callback_id, ctx)
                || debounce_callback_starts_with_null_ref_guard(wrapped_callback_id, ctx)
            {
                continue;
            }
            let message = format!(
                "`{}` keeps a pending debounced/throttled call that fires after unmount because nothing cancels it; return `() => {}.cancel()` from a useEffect so the trailing call is dropped on teardown.",
                binding.name, binding.name
            );
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(debounce_call.span));
        }
    }
}

fn debounce_call_in_hook_initializer(
    hook_call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let argument = hook_call.arguments.first()?.as_expression()?;
    if let Expression::CallExpression(call) = argument.get_inner_expression()
        && is_lodash_debounce_call(call, ctx)
    {
        return Some(call.node_id.get());
    }
    let callback_id = match argument.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => function.node_id.get(),
        Expression::FunctionExpression(function) => function.node_id.get(),
        _ => return None,
    };
    let callback_node = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
        && let Expression::CallExpression(call) = expression.get_inner_expression()
        && is_lodash_debounce_call(call, ctx)
    {
        return Some(call.node_id.get());
    }
    let mut returned_call = None;
    let statements = match callback_node.kind() {
        AstKind::Function(function) => &function.body.as_ref()?.statements,
        AstKind::ArrowFunctionExpression(function) => &function.body.as_function_body()?.statements,
        _ => return None,
    };
    for statement in statements {
        let oxc_ast::ast::Statement::ReturnStatement(statement) = statement else {
            continue;
        };
        let Some(Expression::CallExpression(call)) = statement
            .argument
            .as_ref()
            .map(|argument| argument.get_inner_expression())
        else {
            continue;
        };
        if is_lodash_debounce_call(call, ctx) {
            returned_call = Some(call.node_id.get());
            break;
        }
    }
    returned_call
}

fn is_lodash_debounce_call(call: &oxc_ast::ast::CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            FACTORY_NAMES.contains(&identifier.name.as_str())
                && identifier_is_lodash_import(identifier, ctx)
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            if !FACTORY_NAMES.contains(&member.static_property_name().unwrap_or_default()) {
                return false;
            }
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return false;
            };
            identifier_is_lodash_import(receiver, ctx)
        }
    }
}

fn identifier_is_lodash_import(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        ctx.scoping()
            .get_root_binding(entry.local_name.name().into())
            == Some(symbol_id)
            && is_lodash_module_source(entry.module_request.name())
    })
}

fn is_lodash_module_source(source: &str) -> bool {
    matches!(
        source,
        "lodash" | "lodash-es" | "lodash.debounce" | "lodash.throttle"
    ) || source.starts_with("lodash/")
        || source.starts_with("lodash-es/")
}

fn debounce_has_trailing_false(
    debounce_call: &oxc_ast::ast::CallExpression<'_>,
    read_offset: u32,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(options) = debounce_call
        .arguments
        .get(2)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    let options = match options.get_inner_expression() {
        Expression::ObjectExpression(_) => options,
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    reference.is_write()
                        && ctx.nodes().get_node(reference.node_id()).span().start < read_offset
                })
            {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let Some(initializer) = &declarator.init else {
                return false;
            };
            initializer
        }
        _ => return false,
    };
    let Expression::ObjectExpression(object) = options.get_inner_expression() else {
        return false;
    };
    object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        property.key.static_name().as_deref() == Some("trailing")
            && matches!(property.value.get_inner_expression(), Expression::BooleanLiteral(value) if !value.value)
    })
}

fn collect_debounce_alias_symbols(
    root_symbol: SymbolId,
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let mut symbols = FxHashSet::from_iter([root_symbol]);
    let mut did_grow = true;
    while did_grow {
        did_grow = false;
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx) != Some(owner_function_id) {
                continue;
            }
            let AstKind::VariableDeclarator(declarator) = candidate.kind() else {
                continue;
            };
            let Some(binding) = declarator.id.get_binding_identifier() else {
                continue;
            };
            if symbols.contains(&binding.symbol_id()) {
                continue;
            }
            let Some(initializer) = &declarator.init else {
                continue;
            };
            let aliases_existing = debounce_expression_base_symbol(initializer, ctx)
                .is_some_and(|symbol| symbols.contains(&symbol))
                || matches!(initializer.get_inner_expression(), Expression::CallExpression(call)
                    if is_react_hook_call(call, &["useRef"], ctx)
                        && call.arguments.first().and_then(Argument::as_expression)
                            .and_then(|argument| debounce_expression_base_symbol(argument, ctx))
                            .is_some_and(|symbol| symbols.contains(&symbol)));
            if aliases_existing {
                symbols.insert(binding.symbol_id());
                did_grow = true;
            }
        }
    }
    symbols
}

fn debounce_expression_base_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let mut expression = expression.get_inner_expression();
    while let Some(member) = expression.as_member_expression() {
        expression = member.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn debounce_binding_is_effect_invoked(
    alias_symbols: &FxHashSet<SymbolId>,
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for effect_node in ctx.nodes().iter() {
        if local_callback_nearest_function_id(effect_node.id(), ctx) != Some(owner_function_id) {
            continue;
        }
        let AstKind::CallExpression(effect_call) = effect_node.kind() else {
            continue;
        };
        if !is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx) {
            continue;
        }
        let Some(callback) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        let mut did_invoke = false;
        for_each_local_callback_execution_node(callback, ctx, |candidate, _, _| {
            if did_invoke {
                return;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                return;
            };
            did_invoke = debounce_expression_base_symbol(&call.callee, ctx)
                .is_some_and(|symbol| alias_symbols.contains(&symbol));
        });
        if did_invoke {
            return true;
        }
    }
    false
}

fn debounce_binding_is_released_or_escaped(
    alias_symbols: &FxHashSet<SymbolId>,
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(owner_function_id) {
            continue;
        }
        if let AstKind::ReturnStatement(statement) = candidate.kind()
            && statement.argument.as_ref().is_some_and(|argument| {
                expression_contains_debounce_alias(argument, alias_symbols, ctx)
            })
        {
            return true;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if is_use_unmount_call(call, ctx)
            && call
                .arguments
                .iter()
                .filter_map(Argument::as_expression)
                .any(|argument| {
                    debounce_release_target_symbol(argument, ctx)
                        .is_some_and(|symbol| alias_symbols.contains(&symbol))
                })
        {
            return true;
        }
        if is_react_hook_call(call, &EFFECT_HOOK_NAMES, ctx)
            && call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|callback| {
                    debounce_effect_releases_alias(callback, alias_symbols, ctx)
                })
        {
            return true;
        }
        if debounce_custom_cleanup_hook_releases_alias(call, alias_symbols, ctx) {
            return true;
        }
    }
    false
}

fn expression_contains_debounce_alias(
    expression: &Expression<'_>,
    alias_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        span.contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::IdentifierReference(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                    .is_some_and(|symbol| alias_symbols.contains(&symbol)))
    })
}

fn is_use_unmount_call(call: &oxc_ast::ast::CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    if identifier.name != "useUnmount" {
        return false;
    }
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "react-use"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn debounce_effect_releases_alias<'a>(
    callback: &Expression<'a>,
    alias_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(callback_id) = exact_local_callback_function_id(callback, ctx, &mut Vec::new()) else {
        return false;
    };
    if debounce_effect_returns_release_expression(callback_id, alias_symbols, ctx) {
        return true;
    }
    collect_debounce_cleanup_function_ids(callback_id, ctx)
        .into_iter()
        .any(|cleanup_id| debounce_cleanup_function_releases(cleanup_id, alias_symbols, ctx))
}

fn debounce_effect_returns_release_expression(
    callback_id: NodeId,
    alias_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let callback_node = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
        && debounce_release_target_symbol(expression, ctx)
            .is_some_and(|symbol| alias_symbols.contains(&symbol))
    {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            return false;
        }
        matches!(candidate.kind(), AstKind::ReturnStatement(statement)
            if statement.argument.as_ref().and_then(|argument| {
                debounce_release_target_symbol(argument, ctx)
            }).is_some_and(|symbol| alias_symbols.contains(&symbol)))
    })
}

fn collect_debounce_cleanup_function_ids(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    let mut cleanup_ids = Vec::new();
    let callback_node = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
        && let Some(function_id) =
            exact_local_callback_function_id(expression, ctx, &mut Vec::new())
    {
        cleanup_ids.push(function_id);
    }
    for candidate in ctx.nodes().iter() {
        if local_callback_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            continue;
        }
        let AstKind::ReturnStatement(statement) = candidate.kind() else {
            continue;
        };
        if let Some(function_id) = statement
            .argument
            .as_ref()
            .and_then(|argument| exact_local_callback_function_id(argument, ctx, &mut Vec::new()))
        {
            cleanup_ids.push(function_id);
        }
    }
    cleanup_ids
}

fn debounce_cleanup_function_releases(
    cleanup_function_id: NodeId,
    alias_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut released = false;
    for_each_debounce_execution_node(cleanup_function_id, ctx, |candidate| {
        if released {
            return;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return;
        };
        released = debounce_release_target_symbol(&call.callee, ctx)
            .is_some_and(|symbol| alias_symbols.contains(&symbol));
    });
    released
}

fn for_each_debounce_execution_node<'a>(
    root_function_id: NodeId,
    ctx: &LintContext<'a>,
    mut visitor: impl FnMut(&AstNode<'a>),
) {
    let mut pending_function_ids = vec![root_function_id];
    let mut visited_function_ids = FxHashSet::default();
    while let Some(function_id) = pending_function_ids.pop() {
        if !visited_function_ids.insert(function_id) {
            continue;
        }
        for candidate in ctx.nodes().iter() {
            if local_callback_nearest_function_id(candidate.id(), ctx) != Some(function_id) {
                continue;
            }
            visitor(candidate);
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            if let Some(called_id) =
                exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new())
            {
                pending_function_ids.push(called_id);
            }
        }
    }
}

fn debounce_release_target_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    if let Some(member) = expression.get_inner_expression().as_member_expression() {
        if !RELEASE_METHOD_NAMES.contains(&member.static_property_name().unwrap_or_default()) {
            return None;
        }
        return debounce_expression_base_symbol(member.object(), ctx);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !RELEASE_METHOD_NAMES.contains(
        &binding_property_name_for_symbol(&declarator.id, symbol_id)
            .as_deref()
            .unwrap_or_default(),
    ) {
        return None;
    }
    declarator
        .init
        .as_ref()
        .and_then(|initializer| debounce_expression_base_symbol(initializer, ctx))
}

fn debounce_custom_cleanup_hook_releases_alias<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    alias_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    if !callee.name.starts_with("use") {
        return false;
    }
    let Some(helper_id) = exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new())
    else {
        return false;
    };
    let parameter_symbols = debounce_function_parameter_symbols(helper_id, ctx);
    for (index, parameter_symbol) in parameter_symbols.iter().enumerate() {
        let mut parameter_aliases = FxHashSet::from_iter([*parameter_symbol]);
        parameter_aliases.extend(collect_debounce_alias_symbols(
            *parameter_symbol,
            helper_id,
            ctx,
        ));
        let helper_releases = ctx.nodes().iter().any(|candidate| {
            if local_callback_nearest_function_id(candidate.id(), ctx) != Some(helper_id) {
                return false;
            }
            let AstKind::CallExpression(effect_call) = candidate.kind() else {
                return false;
            };
            is_react_hook_call(effect_call, &EFFECT_HOOK_NAMES, ctx)
                && effect_call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|callback| {
                        debounce_effect_releases_alias(callback, &parameter_aliases, ctx)
                    })
        });
        if !helper_releases {
            continue;
        }
        if call
            .arguments
            .get(index)
            .and_then(Argument::as_expression)
            .and_then(|argument| debounce_expression_base_symbol(argument, ctx))
            .is_some_and(|symbol| alias_symbols.contains(&symbol))
        {
            return true;
        }
    }
    false
}

fn debounce_function_parameter_symbols(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<SymbolId> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => &function.params.items,
        AstKind::ArrowFunctionExpression(function) => &function.params.items,
        _ => return Vec::new(),
    };
    parameters
        .iter()
        .filter_map(|parameter| parameter.pattern.get_binding_identifier())
        .map(|binding| binding.symbol_id())
        .collect()
}

fn debounce_wrapped_callback_id<'a>(
    debounce_call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    let callback = debounce_call.arguments.first()?.as_expression()?;
    if let Some(function_id) = exact_local_callback_function_id(callback, ctx, &mut Vec::new()) {
        return Some(function_id);
    }
    let Expression::Identifier(identifier) = callback.get_inner_expression() else {
        return None;
    };
    let initializer = identifier_initializer(identifier, ctx)?;
    let Expression::CallExpression(use_callback) = initializer.get_inner_expression() else {
        return None;
    };
    if !is_react_hook_call(use_callback, &["useCallback"], ctx) {
        return None;
    }
    use_callback
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .and_then(|callback| exact_local_callback_function_id(callback, ctx, &mut Vec::new()))
}

fn debounce_callback_has_async_or_dom_work(callback_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let callback_node = ctx.nodes().get_node(callback_id);
    let is_async = match callback_node.kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    };
    if is_async {
        return true;
    }
    for candidate in ctx.nodes().iter() {
        if !callback_node.span().contains_inclusive(candidate.span()) {
            continue;
        }
        if matches!(candidate.kind(), AstKind::AwaitExpression(_)) {
            return true;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            continue;
        };
        if debounce_is_global_fetch_call(call, ctx)
            || debounce_is_uncaught_promise_chain(call, candidate, ctx)
            || debounce_is_dom_global_call_or_write(candidate, ctx)
        {
            return true;
        }
    }
    ctx.nodes().iter().any(|candidate| {
        callback_node.span().contains_inclusive(candidate.span())
            && debounce_is_dom_global_write(candidate, ctx)
    })
}

fn debounce_is_global_fetch_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "fetch"
            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn debounce_is_uncaught_promise_chain(
    call: &oxc_ast::ast::CallExpression<'_>,
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    let Some(method) = member.static_property_name() else {
        return false;
    };
    if !matches!(method, "then" | "finally") {
        return false;
    }
    let mut root = call_node;
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        let object_span = match parent.kind() {
            AstKind::StaticMemberExpression(member) => member.object.span(),
            AstKind::ComputedMemberExpression(member) => member.object.span(),
            AstKind::PrivateFieldExpression(member) => member.object.span(),
            _ => break,
        };
        if object_span != root.span() {
            break;
        }
        let parent_call = ctx.nodes().parent_node(parent.id());
        let AstKind::CallExpression(_) = parent_call.kind() else {
            break;
        };
        root = parent_call;
    }
    !matches!(root.kind(), AstKind::CallExpression(outer)
        if outer.callee.as_member_expression()
            .is_some_and(|member| member.static_property_name() == Some("catch")))
}

fn debounce_is_dom_global_call_or_write(call_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let AstKind::CallExpression(call) = call_node.kind() else {
        return false;
    };
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    debounce_member_is_dom_global(member, ctx)
}

fn debounce_is_dom_global_write(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let AstKind::AssignmentExpression(assignment) = node.kind() else {
        return false;
    };
    assignment
        .left
        .as_simple_assignment_target()
        .and_then(|target| target.as_member_expression())
        .is_some_and(|member| debounce_member_is_dom_global(member, ctx))
}

fn debounce_member_is_dom_global(
    member: &oxc_ast::ast::MemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut expression = member.object().get_inner_expression();
    let mut first_property = member.static_property_name();
    while let Some(inner_member) = expression.as_member_expression() {
        first_property = inner_member.static_property_name();
        expression = inner_member.object().get_inner_expression();
    }
    let Expression::Identifier(receiver) = expression else {
        return false;
    };
    matches!(receiver.name.as_str(), "document" | "window")
        && ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            .is_none()
        && !matches!(first_property, Some("localStorage" | "sessionStorage"))
}

fn debounce_callback_starts_with_null_ref_guard(
    callback_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let statements = match ctx.nodes().get_node(callback_id).kind() {
        AstKind::Function(function) => {
            let Some(body) = &function.body else {
                return false;
            };
            &body.statements
        }
        AstKind::ArrowFunctionExpression(function) if function.get_expression().is_none() => {
            let Some(body) = function.body.as_function_body() else {
                return false;
            };
            &body.statements
        }
        _ => return false,
    };
    let mut current_seeded_symbols = FxHashSet::default();
    for statement in statements {
        match statement {
            oxc_ast::ast::Statement::VariableDeclaration(declaration) => {
                let all_seeded = declaration.declarations.iter().all(|declarator| {
                    declarator.init.as_ref().is_some_and(|initializer| {
                        expression_reads_null_ref_or_seeded(
                            initializer,
                            &current_seeded_symbols,
                            ctx,
                        )
                    })
                });
                if !all_seeded {
                    return false;
                }
                for declarator in &declaration.declarations {
                    if let Some(binding) = declarator.id.get_binding_identifier() {
                        current_seeded_symbols.insert(binding.symbol_id());
                    }
                }
            }
            oxc_ast::ast::Statement::IfStatement(statement) => {
                return debounce_statement_starts_with_return(&statement.consequent)
                    && expression_reads_null_ref_or_seeded(
                        &statement.test,
                        &current_seeded_symbols,
                        ctx,
                    );
            }
            _ => return false,
        }
    }
    false
}

fn debounce_statement_starts_with_return(statement: &oxc_ast::ast::Statement<'_>) -> bool {
    match statement {
        oxc_ast::ast::Statement::ReturnStatement(_) => true,
        oxc_ast::ast::Statement::BlockStatement(block) => {
            matches!(
                block.body.first(),
                Some(oxc_ast::ast::Statement::ReturnStatement(_))
            )
        }
        _ => false,
    }
}

fn expression_reads_null_ref_or_seeded(
    expression: &Expression<'_>,
    seeded_symbols: &FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        if !span.contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::IdentifierReference(identifier) => ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol| seeded_symbols.contains(&symbol)),
            AstKind::StaticMemberExpression(member) if member.property.name == "current" => {
                debounce_receiver_is_null_ref(&member.object, ctx)
            }
            AstKind::ComputedMemberExpression(member)
                if member.static_property_name().as_deref() == Some("current") =>
            {
                debounce_receiver_is_null_ref(&member.object, ctx)
            }
            _ => false,
        }
    })
}

fn debounce_receiver_is_null_ref<'a>(object: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::Identifier(receiver) = object.get_inner_expression() else {
        return false;
    };
    if ctx
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
        .is_none()
    {
        return true;
    }
    let Some(initializer) = identifier_initializer(receiver, ctx) else {
        return false;
    };
    let Expression::CallExpression(use_ref) = initializer.get_inner_expression() else {
        return false;
    };
    if !is_react_hook_call(use_ref, &["useRef"], ctx) {
        return false;
    }
    match use_ref.arguments.first().and_then(Argument::as_expression) {
        None => true,
        Some(argument) => match argument.get_inner_expression() {
            Expression::NullLiteral(_) => true,
            Expression::Identifier(identifier) => identifier.name == "undefined",
            Expression::UnaryExpression(unary) => {
                unary.operator == oxc_syntax::operator::UnaryOperator::Void
            }
            _ => false,
        },
    }
}
