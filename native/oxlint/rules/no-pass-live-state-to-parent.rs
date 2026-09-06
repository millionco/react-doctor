use oxc_ast::{
    AstKind,
    ast::{Argument, BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const LIVE_STATE_MESSAGE: &str =
    "Pushing state up to a parent from a useEffect costs your users an extra render.";
const LIVE_STATE_FETCH_CALLBACK_PREFIXES: [&str; 5] =
    ["fetch", "load", "query", "refetch", "request"];
const LIVE_STATE_STRING_READ_METHODS: &[&str] = &[
    "startsWith",
    "endsWith",
    "includes",
    "indexOf",
    "lastIndexOf",
    "match",
    "matchAll",
    "search",
    "localeCompare",
    "test",
];
const LIVE_STATE_DATA_SINK_METHODS: &[&str] = &[
    "forEach",
    "map",
    "filter",
    "reduce",
    "reduceRight",
    "flatMap",
    "some",
    "every",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "subscribe",
    "unsubscribe",
    "addEventListener",
    "addListener",
    "removeEventListener",
    "removeListener",
    "on",
    "once",
    "off",
    "emit",
    "dispatch",
    "publish",
    "notify",
    "trigger",
    "fire",
    "broadcast",
    "send",
    "startsWith",
    "endsWith",
    "includes",
    "indexOf",
    "lastIndexOf",
    "match",
    "matchAll",
    "search",
    "localeCompare",
    "test",
    "then",
    "catch",
    "finally",
    "add",
    "delete",
    "has",
    "get",
    "set",
    "clear",
    "put",
    "push",
    "pop",
    "shift",
    "unshift",
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "trace",
    "track",
    "capture",
    "start",
    "stop",
    "play",
    "pause",
    "resume",
    "cancel",
    "abort",
    "commit",
    "rollback",
    "reset",
    "focus",
    "blur",
    "scroll",
    "scrollTo",
    "scrollIntoView",
    "close",
    "open",
    "show",
    "hide",
    "expand",
    "collapse",
    "toggle",
    "refresh",
    "reload",
    "rerender",
    "refetch",
    "invalidate",
    "select",
    "deselect",
    "click",
    "press",
    "tap",
    "submit",
    "validate",
    "format",
    "parse",
    "serialize",
    "deserialize",
];
const LIVE_STATE_WRAPPER_HOOKS: [&str; 9] = [
    "useCallbackRef",
    "useEvent",
    "useEventCallback",
    "useLatest",
    "useMemoizedFn",
    "useStableCallback",
    "useCallback",
    "useEffectEvent",
    "useMemo",
];
const LIVE_STATE_BUILTIN_HOOKS: [&str; 17] = [
    "use",
    "useState",
    "useRef",
    "useMemo",
    "useCallback",
    "useReducer",
    "useContext",
    "useEffect",
    "useLayoutEffect",
    "useInsertionEffect",
    "useImperativeHandle",
    "useSyncExternalStore",
    "useDeferredValue",
    "useTransition",
    "useId",
    "useDebugValue",
    "useEffectEvent",
];
const LIVE_STATE_NON_STATE_HOOKS: [&str; 14] = [
    "useCallbackRef",
    "useEffectEvent",
    "useEvent",
    "useEventCallback",
    "useIntersectionObserver",
    "useLatest",
    "useMatchMedia",
    "useMediaJobProgress",
    "useMediaQuery",
    "useMemoizedFn",
    "useResizeObserver",
    "useStableCallback",
    "useVisibility",
    "useWindowSize",
];
const LIVE_STATE_NAMESPACED_API_PROPERTIES: &[&str] = &[
    "commands",
    "actions",
    "api",
    "store",
    "service",
    "client",
    "controller",
    "manager",
    "registry",
    "dispatch",
    "queryClient",
    "fetcher",
    "loader",
    "editor",
    "model",
    "context",
    "transport",
    "channel",
    "session",
    "connection",
    "instance",
    "ref",
    "current",
    "value",
    "state",
    "vm",
    "viewModel",
    "logic",
    "selectors",
    "queries",
    "mutations",
    "effects",
    "utils",
    "helpers",
    "lib",
    "fonts",
    "shapes",
    "nodes",
    "layers",
    "users",
    "accounts",
    "events",
    "logs",
    "metrics",
    "telemetry",
    "tracker",
    "tracking",
    "analytics",
    "posthog",
    "sentry",
    "auth",
    "permissions",
    "roles",
    "features",
    "flags",
    "config",
    "settings",
    "preferences",
    "storage",
    "cache",
    "history",
    "navigation",
    "router",
    "navigator",
    "scheduler",
    "queue",
    "pipeline",
    "stream",
    "socket",
    "bridge",
    "io",
    "fs",
    "db",
    "kv",
    "blob",
    "buffer",
    "cells",
    "rows",
    "columns",
    "tabs",
    "panels",
    "windows",
    "elements",
    "selections",
    "selection",
    "clipboard",
    "viewport",
    "camera",
    "scene",
    "world",
    "physics",
    "renderer",
    "renderers",
    "rendering",
    "ports",
    "messages",
    "channels",
    "subscriptions",
    "observers",
    "watchers",
    "listeners",
    "handlers",
];

#[derive(Debug, Default, Clone)]
pub struct NoPassLiveStateToParent;

declare_oxc_lint!(
    /// Warns when live local state is pushed to a parent from an effect.
    NoPassLiveStateToParent,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Live state pushed to parent via effect.",
);

impl Rule for NoPassLiveStateToParent {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let write_analysis = build_possible_static_property_write_analysis(ctx);
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        let mut owner_bindings_by_function = FxHashMap::default();
        for effect_node in ctx.nodes().iter() {
            let AstKind::CallExpression(effect_call) = effect_node.kind() else {
                continue;
            };
            if !is_react_hook_call(effect_call, &["useEffect"], ctx) {
                continue;
            }
            let Some(callback_expression) = effect_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
            else {
                continue;
            };
            let Some(effect_function_id) =
                exact_local_callback_function_id(callback_expression, ctx, &mut Vec::new())
            else {
                continue;
            };
            let Some(owner_function_id) = live_state_nearest_function_id(effect_node.id(), ctx)
            else {
                continue;
            };
            let owner_bindings = owner_bindings_by_function
                .entry(owner_function_id)
                .or_insert_with(|| live_state_owner_bindings(owner_function_id, ctx));
            if owner_bindings.names_by_symbol.is_empty()
                && owner_bindings.whole_props_symbols.is_empty()
            {
                continue;
            }

            for &candidate_id in node_index.node_ids(effect_function_id) {
                let candidate = ctx.nodes().get_node(candidate_id);
                let AstKind::CallExpression(call) = candidate.kind() else {
                    continue;
                };
                if live_state_direct_call_reports(
                    candidate,
                    call,
                    owner_function_id,
                    owner_bindings,
                    &write_analysis,
                    ctx,
                ) || live_state_helper_call_reports(
                    candidate,
                    call,
                    effect_function_id,
                    owner_function_id,
                    owner_bindings,
                    &write_analysis,
                    &node_index,
                    ctx,
                ) {
                    ctx.diagnostic(OxcDiagnostic::warn(LIVE_STATE_MESSAGE).with_label(call.span));
                }
            }
        }
    }
}

#[derive(Default)]
struct LiveStateOwnerBindings {
    names_by_symbol: FxHashMap<SymbolId, String>,
    whole_props_symbols: FxHashSet<SymbolId>,
    is_custom_hook: bool,
}

impl LiveStateOwnerBindings {
    fn parameter_name(&self, symbol_id: SymbolId) -> Option<&str> {
        self.names_by_symbol.get(&symbol_id).map(String::as_str)
    }

    fn is_parameter(&self, symbol_id: SymbolId) -> bool {
        self.names_by_symbol.contains_key(&symbol_id)
            || self.whole_props_symbols.contains(&symbol_id)
    }
}

fn live_state_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn live_state_owner_bindings(
    owner_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> LiveStateOwnerBindings {
    let function_node = ctx.nodes().get_node(owner_function_id);
    let parameter_span = match function_node.kind() {
        AstKind::Function(function) => function.params.span,
        AstKind::ArrowFunctionExpression(function) => function.params.span,
        _ => return LiveStateOwnerBindings::default(),
    };
    let Some(function_name) = component_or_hook_function_name(function_node, ctx) else {
        return LiveStateOwnerBindings::default();
    };
    let is_custom_hook = live_state_is_owner_custom_hook_name(function_name);
    let is_component = function_name
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase);
    let is_unwrapped_component_function_expression = matches!(function_node.kind(), AstKind::Function(function)
            if function.r#type == oxc_ast::ast::FunctionType::FunctionExpression
                && !is_custom_hook
                && !live_state_function_has_component_wrapper(function_node, ctx));
    if (!is_custom_hook && !is_component) || is_unwrapped_component_function_expression {
        return LiveStateOwnerBindings::default();
    }
    if matches!(function_node.kind(), AstKind::Function(function)
        if function.r#type == oxc_ast::ast::FunctionType::FunctionExpression)
        && matches!(
            ctx.nodes()
                .parent_node(transparent_expression_root(function_node, ctx).id())
                .kind(),
            AstKind::ReturnStatement(_)
        )
    {
        return LiveStateOwnerBindings::default();
    }
    let mut bindings = LiveStateOwnerBindings {
        is_custom_hook,
        ..LiveStateOwnerBindings::default()
    };
    for candidate in ctx.nodes().iter() {
        if !parameter_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::BindingIdentifier(identifier) = candidate.kind() else {
            continue;
        };
        let symbol_id = identifier.symbol_id();
        let declaration = ctx.symbol_declaration(symbol_id);
        let parameter = if matches!(declaration.kind(), AstKind::FormalParameter(_)) {
            Some(declaration)
        } else {
            ctx.nodes()
                .ancestors(declaration.id())
                .take_while(|ancestor| ancestor.id() != owner_function_id)
                .find(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_)))
        };
        let Some(parameter) = parameter else {
            continue;
        };
        let AstKind::FormalParameter(parameter) = parameter.kind() else {
            continue;
        };
        match &parameter.pattern {
            BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id => {
                if !bindings.is_custom_hook {
                    bindings.whole_props_symbols.insert(symbol_id);
                }
                bindings
                    .names_by_symbol
                    .insert(symbol_id, identifier.name.to_string());
            }
            pattern => {
                let name = binding_property_name_for_symbol(pattern, symbol_id)
                    .unwrap_or_else(|| identifier.name.to_string());
                bindings.names_by_symbol.insert(symbol_id, name);
            }
        }
    }
    bindings
}

fn live_state_function_has_component_wrapper<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut expression_root = transparent_expression_root(function_node, ctx);
    let mut has_wrapper = false;
    loop {
        let parent = ctx.nodes().parent_node(expression_root.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            return has_wrapper && matches!(parent.kind(), AstKind::VariableDeclarator(_));
        };
        if !call.arguments.first().is_some_and(|argument| {
            argument
                .as_expression()
                .is_some_and(|expression| expression.span() == expression_root.span())
        }) || !matches!(call.callee_name(), Some("memo" | "forwardRef" | "observer"))
        {
            return false;
        }
        has_wrapper = true;
        expression_root = transparent_expression_root(parent, ctx);
    }
}

fn live_state_is_owner_custom_hook_name(name: &str) -> bool {
    name.strip_prefix("use")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn live_state_is_hook_name(name: &str) -> bool {
    name == "use"
        || (name.as_bytes().starts_with(b"use")
            && name.as_bytes().get(3).is_some_and(|character| {
                character.is_ascii_uppercase() || character.is_ascii_digit()
            }))
}

fn live_state_direct_call_reports<'a>(
    call_node: &AstNode<'a>,
    call: &oxc_ast::ast::CallExpression<'a>,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> bool {
    if !live_state_call_is_synchronous(call_node, ctx)
        && live_state_local_helper_function_id(&call.callee, ctx).is_none()
    {
        return false;
    }
    let mut callback_names = live_state_resolve_parent_callback_names(
        &call.callee,
        owner_function_id,
        owner_bindings,
        call.span.start,
        write_analysis,
        ctx,
        &mut FxHashSet::default(),
    );
    if callback_names.is_empty()
        && let Some(callback_name) =
            live_state_prop_member_callback_name(&call.callee, owner_bindings, true, ctx)
    {
        callback_names.insert(callback_name);
    }
    if callback_names.is_empty()
        || call.arguments.is_empty()
        || callback_names
            .iter()
            .any(|name| live_state_is_fetch_callback_name(name))
        || live_state_call_result_is_captured(call_node, ctx, true)
        || live_state_call_result_is_consumed_as_argument(call_node, ctx)
    {
        return false;
    }
    if live_state_is_data_sink_call(call, owner_bindings, ctx)
        && !live_state_callback_names_are_direct_owner_parameters(
            call,
            &callback_names,
            owner_bindings,
            ctx,
        )
    {
        return false;
    }
    live_state_call_arguments_have_state(call, owner_function_id, owner_bindings, ctx)
        || live_state_setter_hook_parameter_receives_data(
            call,
            &callback_names,
            owner_bindings,
            ctx,
        )
}

fn live_state_call_is_synchronous(call_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        if matches!(ancestor.kind(), AstKind::AwaitExpression(_))
            || matches!(ancestor.kind(), AstKind::UnaryExpression(unary) if unary.operator.is_void())
        {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return true;
        }
    }
    false
}

fn live_state_helper_call_reports<'a>(
    call_node: &AstNode<'a>,
    call: &oxc_ast::ast::CallExpression<'a>,
    effect_function_id: NodeId,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(helper_function_id) = live_state_local_helper_function_id(&call.callee, ctx) else {
        return false;
    };
    if helper_function_id == effect_function_id {
        return false;
    }
    let call_result_is_discarded = !live_state_call_result_is_captured(call_node, ctx, false);
    let helper_function_ids =
        live_state_reachable_helper_functions(helper_function_id, node_index, ctx);
    let outer_call_has_state =
        live_state_call_arguments_have_state(call, owner_function_id, owner_bindings, ctx);
    for &function_id in &helper_function_ids {
        for &candidate_id in node_index.node_ids(function_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::CallExpression(inner_call) = candidate.kind() else {
                continue;
            };
            let mut callback_names = live_state_resolve_parent_callback_names(
                &inner_call.callee,
                owner_function_id,
                owner_bindings,
                inner_call.span.start,
                write_analysis,
                ctx,
                &mut FxHashSet::default(),
            );
            if callback_names.is_empty()
                && let Some(callback_name) = live_state_prop_member_callback_name(
                    &inner_call.callee,
                    owner_bindings,
                    false,
                    ctx,
                )
            {
                callback_names.insert(callback_name);
            }
            if callback_names.is_empty()
                || inner_call.arguments.is_empty()
                || callback_names
                    .iter()
                    .any(|name| live_state_is_fetch_callback_name(name))
                || live_state_is_data_sink_call(inner_call, owner_bindings, ctx)
                || live_state_call_result_is_consumed_as_argument(candidate, ctx)
            {
                continue;
            }
            let result_is_captured =
                live_state_call_result_is_captured(candidate, ctx, call_result_is_discarded);
            if result_is_captured {
                continue;
            }
            if outer_call_has_state
                || live_state_call_arguments_have_state(
                    inner_call,
                    owner_function_id,
                    owner_bindings,
                    ctx,
                )
                || live_state_setter_hook_parameter_receives_data(
                    inner_call,
                    &callback_names,
                    owner_bindings,
                    ctx,
                )
            {
                return true;
            }
        }
    }
    false
}

fn live_state_prop_member_callback_name(
    expression: &Expression<'_>,
    owner_bindings: &LiveStateOwnerBindings,
    reject_mutable_receiver: bool,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let member = expression.get_inner_expression().as_member_expression()?;
    let property_name = member.static_property_name()?;
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return None;
    };
    let receiver_symbol_id = live_state_symbol_id(receiver, ctx)?;
    let is_handler_name = ["handle", "on"].iter().any(|prefix| {
        property_name.strip_prefix(prefix).is_some_and(|suffix| {
            suffix
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_uppercase)
        })
    });
    if is_handler_name
        && (!reject_mutable_receiver
            || !ctx
                .scoping()
                .get_resolved_references(receiver_symbol_id)
                .any(|reference| reference.is_write()))
        && (owner_bindings.is_parameter(receiver_symbol_id)
            || live_state_is_whole_props_rest_binding(receiver_symbol_id, owner_bindings, ctx))
    {
        return Some(property_name.to_string());
    }
    if !owner_bindings.is_custom_hook
        || !(is_handler_name
            || property_name.strip_prefix("set").is_some_and(|suffix| {
                suffix
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase)
            }))
    {
        return None;
    }
    owner_bindings
        .parameter_name(receiver_symbol_id)
        .is_some_and(|name| {
            let lowercase_name = name.to_ascii_lowercase();
            lowercase_name.contains("callback") || lowercase_name.contains("handler")
        })
        .then(|| property_name.to_string())
}

fn live_state_is_whole_props_rest_binding(
    symbol_id: SymbolId,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    if !matches!(declarator.id, BindingPattern::ObjectPattern(_))
        || !live_state_pattern_has_object_rest_symbol(&declarator.id, symbol_id)
    {
        return false;
    }
    let Some(Expression::Identifier(initializer)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Some(source_symbol_id) = live_state_symbol_id(initializer, ctx) else {
        return false;
    };
    owner_bindings.is_parameter(source_symbol_id)
        && matches!(ctx.symbol_declaration(source_symbol_id).kind(),
            AstKind::FormalParameter(parameter)
                if parameter.initializer.is_none()
                    && matches!(&parameter.pattern, BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == source_symbol_id))
}

fn live_state_pattern_has_object_rest_symbol(
    pattern: &BindingPattern<'_>,
    symbol_id: SymbolId,
) -> bool {
    match pattern {
        BindingPattern::ObjectPattern(object) => {
            object
                .rest
                .as_ref()
                .is_some_and(|rest| binding_pattern_has_symbol(&rest.argument, symbol_id))
                || object.properties.iter().any(|property| {
                    live_state_pattern_has_object_rest_symbol(&property.value, symbol_id)
                })
        }
        BindingPattern::AssignmentPattern(assignment) => {
            live_state_pattern_has_object_rest_symbol(&assignment.left, symbol_id)
        }
        BindingPattern::ArrayPattern(array) => array
            .elements
            .iter()
            .flatten()
            .any(|element| live_state_pattern_has_object_rest_symbol(element, symbol_id)),
        BindingPattern::BindingIdentifier(_) => false,
    }
}

fn live_state_reachable_helper_functions(
    root_function_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> FxHashSet<NodeId> {
    let mut functions = FxHashSet::from_iter([root_function_id]);
    let mut pending = vec![root_function_id];
    while let Some(function_id) = pending.pop() {
        for &candidate_id in node_index.node_ids(function_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::CallExpression(call) = candidate.kind() else {
                continue;
            };
            let Some(called_function_id) = live_state_local_helper_function_id(&call.callee, ctx)
            else {
                continue;
            };
            if functions.insert(called_function_id) {
                pending.push(called_function_id);
            }
        }
    }
    functions
}

fn live_state_call_arguments_have_state<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'a>,
) -> bool {
    call.arguments.iter().any(|argument| {
        argument.as_expression().is_some_and(|expression| {
            if matches!(
                expression.get_inner_expression(),
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) {
                return false;
            }
            let expression_span = expression.span();
            ctx.nodes().iter().any(|candidate| {
                if !expression_span.contains_inclusive(candidate.span())
                    || live_state_identifier_is_inside_spread(candidate.id(), expression_span, ctx)
                    || live_state_identifier_is_inside_nested_function(
                        candidate.id(),
                        expression_span,
                        ctx,
                    )
                {
                    return false;
                }
                let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                    return false;
                };
                live_state_identifier_has_state_source(
                    identifier,
                    owner_function_id,
                    owner_bindings,
                    ctx,
                    &mut FxHashSet::default(),
                )
            })
        })
    })
}

fn live_state_identifier_is_inside_spread(
    node_id: NodeId,
    expression_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
        .any(|ancestor| matches!(ancestor.kind(), AstKind::SpreadElement(_)))
}

fn live_state_identifier_is_inside_nested_function(
    node_id: NodeId,
    expression_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .take_while(|ancestor| expression_span.contains_inclusive(ancestor.span()))
        .any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
}

fn live_state_identifier_has_state_source<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
        return false;
    };
    live_state_symbol_has_state_source(
        symbol_id,
        owner_function_id,
        owner_bindings,
        ctx,
        visited_symbols,
    )
}

fn live_state_symbol_has_state_source<'a>(
    symbol_id: SymbolId,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    if live_state_is_react_state_symbol(symbol_id, ctx)
        || live_state_is_prop_seeded_custom_hook_state(
            symbol_id,
            owner_function_id,
            owner_bindings,
            ctx,
        )
    {
        return true;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if let Some(default_value) = live_state_parameter_default_value(declaration, symbol_id, ctx)
        && live_state_expression_has_state_source(
            default_value,
            owner_function_id,
            owner_bindings,
            ctx,
            visited_symbols,
        )
    {
        return true;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if declarator.init.is_none() {
        let declaration_parent = ctx.nodes().parent_node(declaration.id());
        let loop_parent = ctx.nodes().parent_node(declaration_parent.id());
        if let AstKind::ForOfStatement(statement) = loop_parent.kind()
            && statement.left.span().contains_inclusive(declarator.span)
            && live_state_expression_has_state_source(
                &statement.right,
                owner_function_id,
                owner_bindings,
                ctx,
                visited_symbols,
            )
        {
            return true;
        }
    }
    if let Some(initializer) = &declarator.init {
        if let Expression::CallExpression(call) = initializer.get_inner_expression() {
            if live_state_wrapper_call_is_transparent(call, ctx)
                && call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
                    .is_some_and(|argument| {
                        live_state_function_has_state_source(
                            argument,
                            owner_function_id,
                            owner_bindings,
                            ctx,
                            visited_symbols,
                        )
                    })
            {
                return true;
            }
            if live_state_callee_name(&call.callee).is_some_and(live_state_is_hook_name)
                && !live_state_callee_name(&call.callee)
                    .is_some_and(|name| LIVE_STATE_WRAPPER_HOOKS.contains(&name))
            {
                return false;
            }
        }
        if live_state_expression_has_state_source(
            initializer,
            owner_function_id,
            owner_bindings,
            ctx,
            visited_symbols,
        ) {
            return true;
        }
    }
    false
}

fn live_state_function_has_state_source<'a>(
    expression: &Expression<'a>,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(function_id) = exact_local_callback_function_id(expression, ctx, &mut Vec::new())
    else {
        return false;
    };
    let function_span = ctx.nodes().get_node(function_id).span();
    ctx.nodes().iter().any(|candidate| {
        if !function_span.contains_inclusive(candidate.span())
            || live_state_nearest_function_id(candidate.id(), ctx) != Some(function_id)
        {
            return false;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
            return false;
        };
        live_state_symbol_has_state_source(
            symbol_id,
            owner_function_id,
            owner_bindings,
            ctx,
            &mut visited_symbols.clone(),
        )
    })
}

fn live_state_parameter_default_value<'a>(
    declaration: &AstNode<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let parameter = if matches!(declaration.kind(), AstKind::FormalParameter(_)) {
        declaration
    } else {
        ctx.nodes().ancestors(declaration.id()).find(|ancestor| {
            matches!(ancestor.kind(), AstKind::FormalParameter(_))
                && live_state_nearest_function_id(ancestor.id(), ctx).is_some()
        })?
    };
    let AstKind::FormalParameter(parameter) = parameter.kind() else {
        return None;
    };
    let BindingPattern::AssignmentPattern(assignment) = &parameter.pattern else {
        return None;
    };
    binding_pattern_has_symbol(&assignment.left, symbol_id).then_some(&assignment.right)
}

fn live_state_expression_has_state_source<'a>(
    expression: &Expression<'a>,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        if !expression_span.contains_inclusive(candidate.span())
            || live_state_identifier_is_inside_spread(candidate.id(), expression_span, ctx)
            || live_state_identifier_is_inside_nested_function(candidate.id(), expression_span, ctx)
        {
            return false;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        let Some(source_symbol_id) = live_state_symbol_id(identifier, ctx) else {
            return false;
        };
        live_state_symbol_has_state_source(
            source_symbol_id,
            owner_function_id,
            owner_bindings,
            ctx,
            visited_symbols,
        )
    })
}

fn live_state_is_react_state_symbol(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    if !matches!(pattern.elements.len(), 1 | 2)
        || !matches!(pattern.elements.first().and_then(Option::as_ref), Some(BindingPattern::BindingIdentifier(binding)) if binding.symbol_id() == symbol_id)
    {
        return false;
    }
    declarator.init.as_ref().is_some_and(|initializer| {
        live_state_expression_is_use_state_tuple(initializer, ctx, &mut FxHashSet::default())
    })
}

fn live_state_expression_is_use_state_tuple<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => is_react_hook_call(call, &["useState"], ctx),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                return false;
            };
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(&declarator.id, BindingPattern::BindingIdentifier(binding)
                if binding.symbol_id() == symbol_id)
                && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    live_state_expression_is_use_state_tuple(initializer, ctx, visited_symbols)
                })
        }
        _ => false,
    }
}

fn live_state_expression_is_state_tuple<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            is_react_hook_call(call, &["useReducer", "useState"], ctx)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                return false;
            };
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            matches!(&declarator.id, BindingPattern::BindingIdentifier(binding)
                if binding.symbol_id() == symbol_id)
                && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const())
                && declarator.init.as_ref().is_some_and(|initializer| {
                    live_state_expression_is_state_tuple(initializer, ctx, visited_symbols)
                })
        }
        _ => false,
    }
}

fn live_state_is_prop_seeded_custom_hook_state<'a>(
    symbol_id: SymbolId,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'a>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    if live_state_nearest_function_id(declaration.id(), ctx) != Some(owner_function_id) {
        return false;
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let hook_name = match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier.name.as_str(),
        Expression::StaticMemberExpression(member) => member.property.name.as_str(),
        Expression::ComputedMemberExpression(member) => {
            let Expression::Identifier(identifier) = &member.expression else {
                return false;
            };
            identifier.name.as_str()
        }
        _ => return false,
    };
    if !live_state_is_hook_name(hook_name)
        || LIVE_STATE_BUILTIN_HOOKS.contains(&hook_name)
        || LIVE_STATE_NON_STATE_HOOKS.contains(&hook_name)
        || live_state_is_local_non_state_comparison_memoizer(hook_name, call, ctx)
    {
        return false;
    }
    call.arguments.iter().any(|argument| {
        let expression = match argument {
            Argument::SpreadElement(spread) => &spread.argument,
            argument => {
                let Some(expression) = argument.as_expression() else {
                    return false;
                };
                expression
            }
        };
        live_state_expression_has_direct_owner_parameter(expression, owner_bindings, ctx)
    })
}

fn live_state_expression_has_direct_owner_parameter(
    expression: &Expression<'_>,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'_>,
) -> bool {
    let expression_span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        if !expression_span.contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        live_state_symbol_id(identifier, ctx)
            .is_some_and(|symbol_id| owner_bindings.is_parameter(symbol_id))
    })
}

fn live_state_is_local_non_state_comparison_memoizer<'a>(
    hook_name: &str,
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let suffix = hook_name.strip_prefix("use");
    if !matches!(
        suffix,
        Some("CompareMemo" | "CompareMemoize" | "CompareMemoizedValue")
            | Some("DeepCompareMemo" | "DeepCompareMemoize" | "DeepCompareMemoizedValue")
            | Some("ShallowCompareMemo" | "ShallowCompareMemoize" | "ShallowCompareMemoizedValue")
    ) {
        return false;
    }
    let Some(function_id) = exact_local_callback_function_id(&call.callee, ctx, &mut Vec::new())
    else {
        return false;
    };
    !ctx.nodes().iter().any(|candidate| {
        ctx.nodes()
            .get_node(function_id)
            .span()
            .contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::CallExpression(inner_call)
                if is_react_hook_call(inner_call, &["useReducer", "useState"], ctx))
    })
}

fn live_state_resolve_parent_callback_names<'a>(
    expression: &Expression<'a>,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    snapshot_offset: u32,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> FxHashSet<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
                return FxHashSet::default();
            };
            if let Some(name) = owner_bindings.parameter_name(symbol_id) {
                return FxHashSet::from_iter([name.to_string()]);
            }
            if !visited_symbols.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(|reference| reference.is_write())
            {
                return FxHashSet::default();
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return FxHashSet::default();
            };
            let Some(initializer) = &declarator.init else {
                return FxHashSet::default();
            };
            let destructured_property_name =
                binding_property_name_for_symbol(&declarator.id, symbol_id);
            if let Expression::CallExpression(wrapper) = initializer.get_inner_expression()
                && live_state_wrapper_call_is_transparent(wrapper, ctx)
                && let Some(argument) = wrapper.arguments.first().and_then(Argument::as_expression)
            {
                if matches!(
                    argument.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) {
                    let Some(wrapper_function_id) =
                        exact_local_callback_function_id(argument, ctx, &mut Vec::new())
                    else {
                        return FxHashSet::default();
                    };
                    let mut names = FxHashSet::default();
                    let mut has_local_state_setter_call = false;
                    let mut has_react_ref_callback_call = false;
                    for candidate in ctx.nodes().iter() {
                        if live_state_nearest_function_id(candidate.id(), ctx)
                            != Some(wrapper_function_id)
                        {
                            continue;
                        }
                        if let AstKind::CallExpression(call) = candidate.kind() {
                            has_local_state_setter_call |=
                                live_state_call_is_local_state_setter(call, ctx);
                            has_react_ref_callback_call |=
                                call.callee.as_member_expression().is_some_and(|member| {
                                    member.static_property_name().as_deref() == Some("current")
                                        && live_state_member_receiver_is_react_ref(
                                            member.object(),
                                            ctx,
                                        )
                                });
                            if call.arguments.is_empty()
                                || live_state_call_result_is_captured(candidate, ctx, false)
                                || live_state_call_result_is_consumed_as_argument(candidate, ctx)
                            {
                                continue;
                            }
                            names.extend(live_state_resolve_parent_callback_names(
                                &call.callee,
                                owner_function_id,
                                owner_bindings,
                                call.span.start,
                                write_analysis,
                                ctx,
                                visited_symbols,
                            ));
                        }
                    }
                    if has_local_state_setter_call && has_react_ref_callback_call {
                        names.clear();
                    }
                    if names.is_empty()
                        && live_state_expression_has_direct_owner_parameter(
                            argument,
                            owner_bindings,
                            ctx,
                        )
                    {
                        names.insert("<direct-prop-wrapper>".to_string());
                    }
                    return names;
                }
                return live_state_resolve_parent_callback_names(
                    argument,
                    owner_function_id,
                    owner_bindings,
                    snapshot_offset,
                    write_analysis,
                    ctx,
                    visited_symbols,
                );
            }
            let next_snapshot_offset = initializer
                .get_inner_expression()
                .as_member_expression()
                .filter(|member| member.static_property_name().as_deref() == Some("current"))
                .map_or(snapshot_offset, |_| initializer.span().start);
            let names = live_state_resolve_parent_callback_names(
                initializer,
                owner_function_id,
                owner_bindings,
                next_snapshot_offset,
                write_analysis,
                ctx,
                visited_symbols,
            );
            if !names.is_empty()
                && let Some(property_name) = destructured_property_name
            {
                return FxHashSet::from_iter([property_name]);
            }
            if names.is_empty()
                && initializer
                    .get_inner_expression()
                    .as_member_expression()
                    .is_some_and(|member| {
                        member.static_property_name().as_deref() == Some("current")
                            && !live_state_member_receiver_is_react_ref(member.object(), ctx)
                    })
            {
                return FxHashSet::from_iter(["<unresolved-current>".to_string()]);
            }
            names
        }
        Expression::StaticMemberExpression(member) => live_state_resolve_member_callback_names(
            &member.object,
            member.property.name.as_str(),
            owner_function_id,
            owner_bindings,
            snapshot_offset,
            write_analysis,
            ctx,
            visited_symbols,
        ),
        Expression::ComputedMemberExpression(member) => {
            let Some(name) = member.static_property_name() else {
                return FxHashSet::default();
            };
            live_state_resolve_member_callback_names(
                &member.object,
                name.as_ref(),
                owner_function_id,
                owner_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                visited_symbols,
            )
        }
        Expression::ConditionalExpression(conditional) => {
            let mut consequent = live_state_resolve_parent_callback_names(
                &conditional.consequent,
                owner_function_id,
                owner_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            let alternate = live_state_resolve_parent_callback_names(
                &conditional.alternate,
                owner_function_id,
                owner_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            if consequent.is_empty() || alternate.is_empty() {
                return FxHashSet::default();
            }
            consequent.extend(alternate);
            consequent
        }
        Expression::LogicalExpression(logical) => {
            let mut left = live_state_resolve_parent_callback_names(
                &logical.left,
                owner_function_id,
                owner_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            let right = live_state_resolve_parent_callback_names(
                &logical.right,
                owner_function_id,
                owner_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            if left.is_empty() || right.is_empty() {
                return FxHashSet::default();
            }
            left.extend(right);
            left
        }
        _ => FxHashSet::default(),
    }
}

fn live_state_call_is_local_state_setter(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
        return false;
    };
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    matches!(pattern.elements.get(1).and_then(Option::as_ref),
        Some(BindingPattern::BindingIdentifier(binding)) if binding.symbol_id() == symbol_id)
        && declarator.init.as_ref().is_some_and(|initializer| {
            live_state_expression_is_use_state_tuple(initializer, ctx, &mut FxHashSet::default())
        })
}

fn live_state_resolve_member_callback_names<'a>(
    object: &Expression<'a>,
    property_name: &str,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    snapshot_offset: u32,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> FxHashSet<String> {
    let Expression::Identifier(receiver) = object.get_inner_expression() else {
        return FxHashSet::default();
    };
    let Some(receiver_symbol_id) = live_state_symbol_id(receiver, ctx) else {
        return FxHashSet::default();
    };
    if owner_bindings
        .whole_props_symbols
        .contains(&receiver_symbol_id)
    {
        return FxHashSet::from_iter([property_name.to_string()]);
    }
    if property_name == "current" {
        return live_state_resolve_ref_callback_names(
            receiver_symbol_id,
            owner_function_id,
            owner_bindings,
            snapshot_offset,
            write_analysis,
            ctx,
            visited_symbols,
        );
    }
    if !visited_symbols.insert(receiver_symbol_id) {
        return FxHashSet::default();
    }
    let declaration = ctx.symbol_declaration(receiver_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return FxHashSet::default();
    };
    let Some(initializer) = &declarator.init else {
        return FxHashSet::default();
    };
    live_state_resolve_object_member_callback_names(
        initializer,
        property_name,
        owner_function_id,
        owner_bindings,
        snapshot_offset,
        write_analysis,
        ctx,
        visited_symbols,
    )
}

fn live_state_resolve_object_member_callback_names<'a>(
    expression: &Expression<'a>,
    property_name: &str,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    snapshot_offset: u32,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> FxHashSet<String> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => {
            for property in object.properties.iter().rev() {
                let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                    return FxHashSet::default();
                };
                if property.key.static_name().as_deref() == Some(property_name) {
                    return live_state_resolve_parent_callback_names(
                        &property.value,
                        owner_function_id,
                        owner_bindings,
                        snapshot_offset,
                        write_analysis,
                        ctx,
                        visited_symbols,
                    );
                }
            }
            FxHashSet::default()
        }
        _ => FxHashSet::default(),
    }
}

fn live_state_member_receiver_is_react_ref<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = live_state_symbol_id(identifier, ctx) else {
        return false;
    };
    let root_symbol_id = live_state_const_root_symbol(symbol_id, ctx);
    let declaration = ctx.symbol_declaration(root_symbol_id);
    matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
        if matches!(declarator.init.as_ref().map(Expression::get_inner_expression), Some(Expression::CallExpression(call))
            if is_react_hook_call(call, &["useRef"], ctx)))
}

fn live_state_resolve_ref_callback_names<'a>(
    ref_symbol_id: SymbolId,
    owner_function_id: NodeId,
    owner_bindings: &LiveStateOwnerBindings,
    snapshot_offset: u32,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> FxHashSet<String> {
    let root_symbol_id = live_state_const_root_symbol(ref_symbol_id, ctx);
    if !visited_symbols.insert(root_symbol_id) {
        return FxHashSet::default();
    }
    let declaration = ctx.symbol_declaration(root_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return FxHashSet::default();
    };
    let Some(Expression::CallExpression(ref_call)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return FxHashSet::default();
    };
    if !is_react_hook_call(ref_call, &["useRef"], ctx) {
        return FxHashSet::default();
    }
    let Some(argument) = ref_call.arguments.first().and_then(Argument::as_expression) else {
        return FxHashSet::default();
    };
    let mut names = live_state_resolve_parent_callback_names(
        argument,
        owner_function_id,
        owner_bindings,
        snapshot_offset,
        write_analysis,
        ctx,
        &mut visited_symbols.clone(),
    );
    if names.is_empty() {
        return names;
    }
    if live_state_expression_has_direct_owner_parameter(argument, owner_bindings, ctx) {
        for alias_symbol_id in potential_alias_symbol_ids(root_symbol_id, ctx) {
            for reference in ctx.scoping().get_resolved_references(alias_symbol_id) {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let Some(member) = static_property_write_member(reference_node, ctx) else {
                    continue;
                };
                if member.span().start >= snapshot_offset {
                    continue;
                }
                if resolved_static_member_property_name(member, ctx).as_deref() != Some("current") {
                    return FxHashSet::default();
                }
                let member_root = transparent_expression_root(member, ctx);
                let assignment = ctx.nodes().parent_node(member_root.id());
                let AstKind::AssignmentExpression(assignment) = assignment.kind() else {
                    return FxHashSet::default();
                };
                let assigned_names = live_state_resolve_parent_callback_names(
                    &assignment.right,
                    owner_function_id,
                    owner_bindings,
                    member.span().start,
                    write_analysis,
                    ctx,
                    &mut visited_symbols.clone(),
                );
                if assigned_names.is_empty() {
                    return FxHashSet::default();
                }
                names.extend(assigned_names);
            }
        }
        return names;
    }
    let Some(snapshot_node) = ctx
        .nodes()
        .iter()
        .filter(|candidate| candidate.span().start == snapshot_offset)
        .filter(|candidate| {
            matches!(candidate.kind(), AstKind::CallExpression(_))
                || candidate
                    .kind()
                    .as_member_expression_kind()
                    .is_some_and(|member| {
                        member.static_property_name().as_deref() == Some("current")
                    })
        })
        .min_by_key(|candidate| candidate.span().end - candidate.span().start)
    else {
        return FxHashSet::default();
    };
    for alias_symbol_id in potential_alias_symbol_ids(root_symbol_id, ctx) {
        for reference in ctx.scoping().get_resolved_references(alias_symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let root = transparent_expression_root(reference_node, ctx);
            if direct_alias_target_symbol_id(reference_node, ctx).is_some() {
                continue;
            }
            let Some(member) = static_property_write_member(reference_node, ctx) else {
                let parent = ctx.nodes().parent_node(root.id());
                if matches!(parent.kind(), AstKind::ArrayExpression(_))
                    || matches!(
                        parent.kind(),
                        AstKind::StaticMemberExpression(member)
                            if member.object.span() == root.span()
                                && member.property.name == "current"
                    )
                    || matches!(
                        parent.kind(),
                        AstKind::ComputedMemberExpression(member)
                            if member.object.span() == root.span()
                                && member.static_property_name().as_deref() == Some("current")
                    )
                    || !can_node_execute_before(root, snapshot_node, write_analysis, ctx)
                {
                    continue;
                }
                return FxHashSet::default();
            };
            if !can_node_execute_before(member, snapshot_node, write_analysis, ctx) {
                continue;
            }
            if resolved_static_member_property_name(member, ctx).as_deref() != Some("current") {
                return FxHashSet::default();
            }
            let member_root = transparent_expression_root(member, ctx);
            let assignment = ctx.nodes().parent_node(member_root.id());
            let AstKind::AssignmentExpression(assignment) = assignment.kind() else {
                return FxHashSet::default();
            };
            if assignment.left.span() != member_root.span() {
                continue;
            }
            let assigned_names = live_state_resolve_parent_callback_names(
                &assignment.right,
                owner_function_id,
                owner_bindings,
                member.span().start,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            if assigned_names.is_empty() {
                return FxHashSet::default();
            }
            names.extend(assigned_names);
        }
    }
    names
}

fn live_state_const_root_symbol(mut symbol_id: SymbolId, ctx: &LintContext<'_>) -> SymbolId {
    let mut visited_symbols = FxHashSet::default();
    while visited_symbols.insert(symbol_id) {
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            break;
        };
        if ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
        {
            break;
        }
        let Some(Expression::Identifier(identifier)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            break;
        };
        let Some(next_symbol_id) = live_state_symbol_id(identifier, ctx) else {
            break;
        };
        symbol_id = next_symbol_id;
    }
    symbol_id
}

fn live_state_wrapper_call_is_transparent<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_react_hook_call(call, &["useCallback", "useEffectEvent", "useMemo"], ctx) {
        return true;
    }
    live_state_callee_name(&call.callee)
        .is_some_and(|name| name != "useEffectEvent" && LIVE_STATE_WRAPPER_HOOKS.contains(&name))
}

fn live_state_local_helper_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    if matches!(
        expression.get_inner_expression(),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return None;
    }
    if let Some(function_id) = exact_local_callback_function_id(expression, ctx, &mut Vec::new()) {
        return Some(function_id);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = live_state_symbol_id(identifier, ctx)?;
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
    {
        return None;
    }
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    let Expression::CallExpression(wrapper) = declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    if !live_state_wrapper_call_is_transparent(wrapper, ctx) {
        return None;
    }
    live_state_wrapped_function_id(wrapper.arguments.first()?.as_expression()?, ctx)
}

fn live_state_wrapped_function_id<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<NodeId> {
    if let Some(function_id) = exact_local_callback_function_id(expression, ctx, &mut Vec::new()) {
        return Some(function_id);
    }
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return None;
    };
    if live_state_callee_name(&call.callee) == Some("debounce")
        && !call.arguments.get(2).is_some_and(|argument| {
            matches!(argument.as_expression().map(Expression::get_inner_expression),
                Some(Expression::ObjectExpression(options)) if options.properties.iter().any(|property| {
                    matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                        if property.key.static_name().as_deref() == Some("leading")
                            && matches!(property.value.get_inner_expression(), Expression::BooleanLiteral(value) if value.value))
                }))
        })
    {
        return None;
    }
    live_state_wrapped_function_id(call.arguments.first()?.as_expression()?, ctx)
}

fn live_state_setter_hook_parameter_receives_data(
    call: &oxc_ast::ast::CallExpression<'_>,
    callback_names: &FxHashSet<String>,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'_>,
) -> bool {
    if !owner_bindings.is_custom_hook
        || !live_state_callee_is_custom_hook_parameter(call, owner_bindings, ctx)
        || !callback_names.iter().any(|name| {
            name.strip_prefix("set")
                .and_then(|suffix| suffix.as_bytes().first())
                .is_some_and(u8::is_ascii_uppercase)
        })
    {
        return false;
    }
    let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    !matches!(
        argument.get_inner_expression(),
        Expression::StringLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::BooleanLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
    )
}

fn live_state_callee_is_custom_hook_parameter(
    call: &oxc_ast::ast::CallExpression<'_>,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'_>,
) -> bool {
    let receiver = match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => identifier,
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
                return false;
            };
            identifier
        }
    };
    live_state_symbol_id(receiver, ctx)
        .is_some_and(|symbol_id| owner_bindings.is_parameter(symbol_id))
}

fn live_state_call_result_is_consumed_as_argument<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(call_node, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    matches!(parent.kind(), AstKind::CallExpression(call)
        if call.arguments.iter().any(|argument| argument.span() == root.span()))
}

fn live_state_call_result_is_captured<'a>(
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    discarded_helper_return: bool,
) -> bool {
    let mut current = transparent_expression_root(call_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::AwaitExpression(_)
            | AstKind::ParenthesizedExpression(_)
            | AstKind::ChainExpression(_)
            | AstKind::TSAsExpression(_)
            | AstKind::TSNonNullExpression(_)
            | AstKind::LogicalExpression(_) => current = transparent_expression_root(parent, ctx),
            AstKind::ConditionalExpression(conditional)
                if conditional.test.span() != current.span() =>
            {
                current = transparent_expression_root(parent, ctx);
            }
            AstKind::VariableDeclarator(declarator)
                if declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == current.span()) =>
            {
                return true;
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.right.span() == current.span() =>
            {
                return true;
            }
            AstKind::ReturnStatement(_) => return !discarded_helper_return,
            _ => return false,
        }
    }
}

fn live_state_is_data_sink_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'_>,
) -> bool {
    if live_state_is_namespaced_api_call(call, owner_bindings, ctx) {
        return true;
    }
    let Expression::StaticMemberExpression(member) = call.callee.get_inner_expression() else {
        return false;
    };
    let method_name = member.property.name.as_str();
    if !LIVE_STATE_DATA_SINK_METHODS.contains(&method_name) {
        return false;
    }
    let Expression::Identifier(receiver) = member.object.get_inner_expression() else {
        return true;
    };
    let Some(receiver_symbol_id) = live_state_symbol_id(receiver, ctx) else {
        return true;
    };
    !(owner_bindings
        .whole_props_symbols
        .contains(&receiver_symbol_id)
        && LIVE_STATE_STRING_READ_METHODS.contains(&method_name))
}

fn live_state_callback_names_are_direct_owner_parameters(
    call: &oxc_ast::ast::CallExpression<'_>,
    callback_names: &FxHashSet<String>,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(member) = call.callee.get_inner_expression().as_member_expression()
        && let Expression::Identifier(receiver) = member.object().get_inner_expression()
        && live_state_symbol_id(receiver, ctx)
            .is_some_and(|symbol_id| owner_bindings.whole_props_symbols.contains(&symbol_id))
    {
        return true;
    }
    callback_names.iter().all(|callback_name| {
        owner_bindings
            .names_by_symbol
            .values()
            .any(|parameter_name| parameter_name == callback_name)
    })
}

fn live_state_is_namespaced_api_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    owner_bindings: &LiveStateOwnerBindings,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(member) = call.callee.get_inner_expression().as_member_expression()
        && let Expression::Identifier(receiver) = member.object().get_inner_expression()
        && live_state_symbol_id(receiver, ctx)
            .is_some_and(|symbol_id| owner_bindings.whole_props_symbols.contains(&symbol_id))
    {
        return false;
    }

    let mut expression = &call.callee;
    for hop_count in 0..16 {
        match expression {
            Expression::Identifier(identifier) => {
                return hop_count > 0
                    && LIVE_STATE_NAMESPACED_API_PROPERTIES.contains(&identifier.name.as_str());
            }
            Expression::StaticMemberExpression(member) => {
                if LIVE_STATE_NAMESPACED_API_PROPERTIES.contains(&member.property.name.as_str()) {
                    return true;
                }
                expression = &member.object;
            }
            other_expression => {
                let Some(member) = other_expression.as_member_expression() else {
                    return false;
                };
                expression = member.object();
            }
        }
    }
    false
}

fn live_state_is_fetch_callback_name(name: &str) -> bool {
    LIVE_STATE_FETCH_CALLBACK_PREFIXES.iter().any(|prefix| {
        name.strip_prefix(prefix).is_some_and(|suffix| {
            suffix.is_empty()
                || suffix.starts_with('_')
                || suffix
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase)
        })
    })
}

fn live_state_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn live_state_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name()),
    }
}
