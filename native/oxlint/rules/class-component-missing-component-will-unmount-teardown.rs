use std::collections::{HashMap, HashSet};

use oxc_ast::{
    AstKind,
    ast::{Argument, CallExpression, Class, ClassElement, Expression, MemberExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};

use crate::{AstNode, context::LintContext, rule::Rule, utils::is_es6_component};

const MESSAGE: &str = "This class registers a listener or timer during mount without a matching teardown on every unmount path, so it can keep firing after the component unmounts; release it in `componentWillUnmount`.";
const REGISTRATION_METHODS: [&str; 7] = [
    "addEventListener",
    "addListener",
    "prependListener",
    "prependOnceListener",
    "on",
    "once",
    "subscribe",
];
const REACT_NATIVE_SUBSCRIPTION_RECEIVERS: [&str; 8] = [
    "AccessibilityInfo",
    "AppState",
    "Appearance",
    "BackHandler",
    "Dimensions",
    "Keyboard",
    "Linking",
    "NetInfo",
];

#[derive(Debug, Default, Clone)]
pub struct ClassComponentMissingComponentWillUnmountTeardown;

#[derive(Debug, Clone)]
struct LifecycleMember {
    name: String,
    span: Span,
    function_node_id: Option<NodeId>,
}

#[derive(Debug, Clone)]
struct MountHazard {
    call_span: Span,
    release_keys: Vec<String>,
    listener_identity: Option<String>,
    registration_count: usize,
    acquired_after_await: bool,
}

declare_oxc_lint!(
    /// Require class component mount resources to have matching unmount cleanup.
    ClassComponentMissingComponentWillUnmountTeardown,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require class mount resources to have matching teardown.",
);

impl Rule for ClassComponentMissingComponentWillUnmountTeardown {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::Class(class) = node.kind() else {
            return;
        };
        if !is_es6_component(node) {
            return;
        }

        let members = lifecycle_members(class, ctx);
        let unmount_member = members
            .iter()
            .find(|member| member.name == "componentWillUnmount");
        let cleanup_calls = unmount_member
            .map(|member| calls_in_member(member, class, node.id(), ctx))
            .unwrap_or_default();
        let cleanup_keys = guaranteed_cleanup_keys(unmount_member, &cleanup_calls, class, ctx);
        let cleanup_counts = guaranteed_cleanup_counts(unmount_member, &cleanup_calls, class, ctx);

        for mount_member in members
            .iter()
            .filter(|member| member.name == "constructor" || member.name == "componentDidMount")
        {
            let mount_calls = calls_in_member(mount_member, class, node.id(), ctx);
            let listener_counts = mounted_listener_counts(&mount_calls, class, ctx);
            let mut hazards = Vec::new();
            for call_node in &mount_calls {
                if let Some(hazard) = mount_hazard(
                    call_node,
                    mount_member,
                    &mount_calls,
                    &listener_counts,
                    class,
                    ctx,
                ) {
                    hazards.push(hazard);
                }
            }

            if let Some(hazard) = hazards.into_iter().find(|hazard| {
                if hazard.acquired_after_await || hazard.release_keys.is_empty() {
                    return true;
                }
                let has_cleanup = hazard
                    .release_keys
                    .iter()
                    .any(|release_key| cleanup_keys.contains(release_key));
                if !has_cleanup {
                    return true;
                }
                let Some(listener_identity) = &hazard.listener_identity else {
                    return false;
                };
                if hazard.registration_count <= 1 {
                    return false;
                }
                let remove_all_prefix = listener_remove_all_prefix(listener_identity);
                if hazard.release_keys.iter().any(|release_key| {
                    release_key.starts_with(&remove_all_prefix) && cleanup_keys.contains(release_key)
                }) {
                    return false;
                }
                let matching_cleanup_count = hazard
                    .release_keys
                    .iter()
                    .map(|release_key| cleanup_counts.get(release_key).copied().unwrap_or(0))
                    .sum::<usize>();
                matching_cleanup_count < hazard.registration_count
            }) {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(hazard.call_span));
                return;
            }
        }
    }
}

fn lifecycle_members<'a>(class: &Class<'a>, ctx: &LintContext<'a>) -> Vec<LifecycleMember> {
    class
        .body
        .body
        .iter()
        .filter_map(|element| {
            let (name, span) = match element {
                ClassElement::MethodDefinition(method) => {
                    let name = if method.kind.is_constructor() {
                        "constructor".to_string()
                    } else {
                        method.key.static_name()?.to_string()
                    };
                    (name, method.value.span())
                }
                ClassElement::PropertyDefinition(property) => (
                    property.key.static_name()?.to_string(),
                    property.value.as_ref()?.span(),
                ),
                _ => return None,
            };
            let function_node_id = ctx.nodes().iter().find_map(|candidate| {
                (candidate.span() == span
                    && matches!(
                        candidate.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    ))
                .then(|| candidate.id())
            });
            Some(LifecycleMember {
                name,
                span,
                function_node_id,
            })
        })
        .collect()
}

fn calls_in_member<'a, 'ctx>(
    member: &LifecycleMember,
    class: &Class<'a>,
    class_node_id: NodeId,
    ctx: &'ctx LintContext<'a>,
) -> Vec<&'ctx AstNode<'a>> {
    let mut calls = Vec::new();
    collect_reachable_calls(
        member.span,
        class,
        class_node_id,
        ctx,
        &mut HashSet::new(),
        &mut calls,
    );
    calls
}

fn collect_reachable_calls<'a, 'ctx>(
    function_span: Span,
    class: &Class<'a>,
    class_node_id: NodeId,
    ctx: &'ctx LintContext<'a>,
    visited_function_spans: &mut HashSet<(u32, u32)>,
    calls: &mut Vec<&'ctx AstNode<'a>>,
) {
    if !visited_function_spans.insert((function_span.start, function_span.end)) {
        return;
    }
    let mut direct_calls = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            function_span.contains_inclusive(candidate.span())
                && matches!(candidate.kind(), AstKind::CallExpression(_))
                && nearest_class_node_id(candidate, ctx) == Some(class_node_id)
                && call_executes_in_function(candidate, function_span, ctx)
        })
        .collect::<Vec<_>>();
    direct_calls.sort_by_key(|candidate| (candidate.span().start, u32::MAX - candidate.span().end));
    for call_node in direct_calls {
        calls.push(call_node);
        if let Some(helper_span) = invoked_helper_span(call_node, class, ctx) {
            collect_reachable_calls(
                helper_span,
                class,
                class_node_id,
                ctx,
                visited_function_spans,
                calls,
            );
        }
    }
}

fn call_executes_in_function(
    call_node: &AstNode<'_>,
    function_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        if ancestor.span() == function_span
            && matches!(ancestor.kind(), AstKind::Function(_) | AstKind::ArrowFunctionExpression(_))
        {
            return true;
        }
        if matches!(ancestor.kind(), AstKind::Function(_) | AstKind::ArrowFunctionExpression(_))
            && !is_synchronous_callback_function(ancestor, ctx)
        {
            return false;
        }
    }
    false
}

fn is_synchronous_callback_function(function_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let mut current = function_node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if let AstKind::CallExpression(call) = parent.kind() {
            if matches!(
                call.callee.get_inner_expression(),
                Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)
            ) {
                return true;
            }
            let Some(method_name) = call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .and_then(MemberExpression::static_property_name)
            else {
                return false;
            };
            return matches!(
                method_name,
                "every"
                    | "filter"
                    | "find"
                    | "findIndex"
                    | "flatMap"
                    | "forEach"
                    | "map"
                    | "reduce"
                    | "reduceRight"
                    | "some"
                    | "sort"
            );
        }
        if matches!(parent.kind(), AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)) {
            return false;
        }
        current = parent;
    }
}

fn invoked_helper_span(
    call_node: &AstNode<'_>,
    class: &Class<'_>,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    let AstKind::CallExpression(call) = call_node.kind() else {
        return None;
    };
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(function.span),
                AstKind::VariableDeclarator(declarator) => {
                    let initializer = declarator.init.as_ref()?;
                    matches!(initializer.get_inner_expression(), Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_))
                        .then(|| initializer.span())
                }
                _ => None,
            }
        }
        expression => {
            let member = expression.as_member_expression()?;
            if !matches!(member.object().get_inner_expression(), Expression::ThisExpression(_)) {
                return None;
            }
            let method_name = member.static_property_name()?;
            class.body.body.iter().find_map(|element| match element {
                ClassElement::MethodDefinition(method)
                    if method.key.static_name().as_deref() == Some(method_name) =>
                {
                    Some(method.value.span())
                }
                ClassElement::PropertyDefinition(property)
                    if property.key.static_name().as_deref() == Some(method_name) =>
                {
                    property.value.as_ref().and_then(|value| {
                        matches!(value.get_inner_expression(), Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_))
                            .then(|| value.span())
                    })
                }
                _ => None,
            })
        }
    }
}

fn nearest_class_node_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(ancestor.kind(), AstKind::Class(_)).then(|| ancestor.id())
    })
}

fn mount_hazard<'a>(
    call_node: &AstNode<'a>,
    mount_member: &LifecycleMember,
    mount_calls: &[&AstNode<'a>],
    listener_counts: &HashMap<String, usize>,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> Option<MountHazard> {
    let AstKind::CallExpression(call) = call_node.kind() else {
        return None;
    };
    let acquired_after_await = has_reachable_earlier_await(call_node, mount_member, ctx);
    if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
        let method_name = member.static_property_name()?;
        if REGISTRATION_METHODS.contains(&method_name) {
            if method_name == "once" && call.arguments.len() < 2 {
                return None;
            }
            if is_mount_local_receiver(member.object(), mount_member, call_node, ctx)
                || is_ref_owned_receiver(member.object(), class, call_node, ctx)
            {
                return None;
            }
            let identity = listener_identity(call, method_name, class, ctx);
            let release_keys = listener_release_keys(call_node, call, method_name, class, ctx);
            if synchronously_released(call_node, &release_keys, mount_calls, mount_member, class, ctx)
            {
                return None;
            }
            let registration_count = identity
                .as_ref()
                .and_then(|identity| listener_counts.get(identity))
                .copied()
                .unwrap_or(1);
            return Some(MountHazard {
                call_span: call_node.span(),
                release_keys,
                listener_identity: event_emitter_method(method_name).then_some(identity).flatten(),
                registration_count,
                acquired_after_await,
            });
        }
    }

    let timer_name = timer_callee_name(call, ctx)?;
    if timer_name == "setInterval" {
        let release_keys = stored_call_result_key(call_node, ctx)
            .map(|handle| vec![format!("timer:clearInterval:{handle}")])
            .unwrap_or_default();
        return Some(MountHazard {
            call_span: call_node.span(),
            release_keys,
            listener_identity: None,
            registration_count: 1,
            acquired_after_await,
        });
    }
    if timer_name == "setTimeout" && timeout_callback_mutates_component(call, mount_member, class, ctx)
    {
        let release_keys = stored_call_result_key(call_node, ctx)
            .map(|handle| vec![format!("timer:clearTimeout:{handle}")])
            .unwrap_or_default();
        return Some(MountHazard {
            call_span: call_node.span(),
            release_keys,
            listener_identity: None,
            registration_count: 1,
            acquired_after_await,
        });
    }
    None
}

fn listener_identity<'a>(
    call: &CallExpression<'a>,
    method_name: &str,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let member = call.callee.get_inner_expression().as_member_expression()?;
    let receiver = serialize_reference(member.object(), class, ctx, &mut HashSet::new())?;
    let media_query_signature = matches!(method_name, "addListener" | "removeListener")
        && call.arguments.len() == 1;
    let identity_argument_count = if method_name == "subscribe" || media_query_signature {
        1
    } else {
        2
    };
    let maximum_argument_count = if matches!(method_name, "addEventListener" | "removeEventListener") {
        3
    } else {
        identity_argument_count
    };
    if call.arguments.len() < identity_argument_count || call.arguments.len() > maximum_argument_count {
        return None;
    }
    let mut parts = vec![receiver];
    for (argument_index, argument) in call.arguments.iter().take(identity_argument_count).enumerate() {
        let expression = argument.as_expression()?;
        let key = if argument_index == 0 && identity_argument_count == 2 {
            event_key(expression, class, ctx)?
        } else {
            serialize_reference(expression, class, ctx, &mut HashSet::new())?
        };
        parts.push(key);
    }
    if matches!(method_name, "addEventListener" | "removeEventListener") {
        parts.push(capture_key(call.arguments.get(2), class, ctx)?);
    }
    Some(parts.join("|"))
}

fn event_key<'a>(
    expression: &Expression<'a>,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(format!("literal:{}", literal.value)),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => Some(format!(
            "literal:{}",
            template.quasis.first().map_or("", |quasi| quasi.value.cooked.as_deref().unwrap_or(""))
        )),
        expression => serialize_reference(expression, class, ctx, &mut HashSet::new())
            .map(|key| format!("reference:{key}")),
    }
}

fn capture_key<'a>(
    argument: Option<&Argument<'a>>,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let Some(expression) = argument.and_then(Argument::as_expression) else {
        return Some("false".to_string());
    };
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value.to_string()),
        Expression::NullLiteral(_) => Some("false".to_string()),
        Expression::Identifier(identifier) if identifier.name == "undefined" => {
            Some("false".to_string())
        }
        Expression::ObjectExpression(object) => {
            let capture_property = object.properties.iter().find_map(|property| {
                let property = property.as_property()?;
                (property.key.static_name().as_deref() == Some("capture")).then_some(property)
            });
            match capture_property.map(|property| property.value.get_inner_expression()) {
                None => Some("false".to_string()),
                Some(Expression::BooleanLiteral(literal)) => Some(literal.value.to_string()),
                Some(Expression::NullLiteral(_)) => Some("false".to_string()),
                Some(Expression::Identifier(identifier)) if identifier.name == "undefined" => {
                    Some("false".to_string())
                }
                _ => None,
            }
        }
        Expression::Identifier(identifier) => {
            if let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) {
                return capture_key_from_expression(initializer, class, ctx);
            }
            serialize_reference(expression, class, ctx, &mut HashSet::new())
                .map(|key| format!("options:{key}"))
        }
        _ => None,
    }
}

fn capture_key_from_expression<'a>(
    expression: &Expression<'a>,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => {
            let capture_property = object.properties.iter().find_map(|property| {
                let property = property.as_property()?;
                (property.key.static_name().as_deref() == Some("capture")).then_some(property)
            });
            match capture_property.map(|property| property.value.get_inner_expression()) {
                None => Some("false".to_string()),
                Some(Expression::BooleanLiteral(literal)) => Some(literal.value.to_string()),
                Some(Expression::NullLiteral(_)) => Some("false".to_string()),
                _ => None,
            }
        }
        _ => serialize_reference(expression, class, ctx, &mut HashSet::new())
            .map(|key| format!("options:{key}")),
    }
}

fn listener_release_keys<'a>(
    call_node: &AstNode<'a>,
    call: &CallExpression<'a>,
    method_name: &str,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> Vec<String> {
    let mut release_keys = Vec::new();
    if let Some(identity) = listener_identity(call, method_name, class, ctx) {
        let methods: &[&str] = match method_name {
            "addEventListener" => &["removeEventListener"],
            "addListener" | "prependListener" | "prependOnceListener" => {
                &["removeListener", "off"]
            }
            "on" | "once" => &["off", "removeListener"],
            "subscribe" => &["unsubscribe"],
            _ => &[],
        };
        release_keys.extend(methods.iter().map(|method| format!("listener:{method}:{identity}")));
        if event_emitter_method(method_name)
            && let Some(receiver) = call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .and_then(|member| serialize_reference(member.object(), class, ctx, &mut HashSet::new()))
        {
            release_keys.push(format!("listener:removeAllListeners:{receiver}"));
            if let Some(event) = call.arguments.first().and_then(Argument::as_expression)
                && let Some(event) = event_key(event, class, ctx)
            {
                release_keys.push(format!("listener:removeAllListeners:{receiver}|{event}"));
            }
        }
    }
    if method_name == "addEventListener"
        && let Some(signal_key) = abort_signal_key(call, class, ctx)
    {
        release_keys.push(signal_key);
    }
    if let Some(stored_result) = stored_call_result_key(call_node, ctx) {
        if method_name == "subscribe" {
            release_keys.push(format!("returned:unsubscribe:{stored_result}"));
            release_keys.push(format!("returned:call:{stored_result}"));
        }
        if matches!(method_name, "addEventListener" | "addListener")
            && is_react_native_subscription_receiver(call, ctx)
        {
            release_keys.push(format!("returned:remove:{stored_result}"));
        }
    }
    release_keys
}

fn cleanup_keys_for_call<'a>(
    call_node: &AstNode<'a>,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> Vec<String> {
    let AstKind::CallExpression(call) = call_node.kind() else {
        return Vec::new();
    };
    if let Some(member) = call.callee.get_inner_expression().as_member_expression() {
        let Some(method_name) = member.static_property_name() else {
            return Vec::new();
        };
        if matches!(
            method_name,
            "removeEventListener" | "removeListener" | "off" | "unsubscribe"
        ) && let Some(identity) = listener_identity(call, method_name, class, ctx)
        {
            return vec![format!("listener:{method_name}:{identity}")];
        }
        if method_name == "removeAllListeners" && call.arguments.len() <= 1
            && let Some(receiver) = serialize_reference(member.object(), class, ctx, &mut HashSet::new())
        {
            if let Some(event) = call.arguments.first().and_then(Argument::as_expression)
                && let Some(event) = event_key(event, class, ctx)
            {
                return vec![format!("listener:removeAllListeners:{receiver}|{event}")];
            }
            return vec![format!("listener:removeAllListeners:{receiver}")];
        }
        if matches!(method_name, "unsubscribe" | "remove") && call.arguments.is_empty()
            && let Some(receiver) = serialize_reference(member.object(), class, ctx, &mut HashSet::new())
        {
            return vec![format!("returned:{method_name}:{receiver}")];
        }
        if method_name == "abort" && call.arguments.is_empty()
            && let Some(receiver) = serialize_reference(member.object(), class, ctx, &mut HashSet::new())
        {
            return vec![format!("abort:{receiver}")];
        }
        if call.arguments.is_empty()
            && let Some(callable) = serialize_member_reference(member, class, ctx, &mut HashSet::new())
        {
            return vec![format!("returned:call:{callable}")];
        }
    }
    let Some(timer_name) = timer_callee_name(call, ctx) else {
        return Vec::new();
    };
    if matches!(timer_name, "clearInterval" | "clearTimeout")
        && let Some(handle) = call.arguments.first().and_then(Argument::as_expression)
        && let Some(handle) = serialize_reference(handle, class, ctx, &mut HashSet::new())
    {
        return vec![format!("timer:{timer_name}:{handle}")];
    }
    Vec::new()
}

fn guaranteed_cleanup_keys<'a>(
    member: Option<&LifecycleMember>,
    calls: &[&AstNode<'a>],
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> HashSet<String> {
    let Some(member) = member else {
        return HashSet::new();
    };
    let Some(function_node_id) = member.function_node_id else {
        return HashSet::new();
    };
    let mut cleanup_nodes_by_key: HashMap<String, Vec<&AstNode<'_>>> = HashMap::new();
    for call_node in calls {
        if cleanup_after_await(call_node, member, ctx) || has_throwing_prelude(call_node, member, calls, class, ctx) {
            continue;
        }
        for key in cleanup_keys_for_call(call_node, class, ctx) {
            cleanup_nodes_by_key.entry(key).or_default().push(call_node);
        }
    }
    cleanup_nodes_by_key
        .into_iter()
        .filter_map(|(key, nodes)| {
            nodes
                .iter()
                .any(|node| !is_node_conditionally_executed(node, function_node_id, ctx))
                .then_some(key)
        })
        .collect()
}

fn guaranteed_cleanup_counts<'a>(
    member: Option<&LifecycleMember>,
    calls: &[&AstNode<'a>],
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> HashMap<String, usize> {
    let Some(member) = member else {
        return HashMap::new();
    };
    let Some(function_node_id) = member.function_node_id else {
        return HashMap::new();
    };
    let mut counts = HashMap::new();
    for call_node in calls {
        if cleanup_after_await(call_node, member, ctx)
            || is_node_conditionally_executed(call_node, function_node_id, ctx)
            || has_throwing_prelude(call_node, member, calls, class, ctx)
        {
            continue;
        }
        for key in cleanup_keys_for_call(call_node, class, ctx) {
            *counts.entry(key).or_insert(0) += 1;
        }
    }
    counts
}

fn mounted_listener_counts<'a>(
    calls: &[&AstNode<'a>],
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> HashMap<String, usize> {
    let mut groups: HashMap<String, Vec<&AstNode<'_>>> = HashMap::new();
    for call_node in calls {
        let AstKind::CallExpression(call) = call_node.kind() else {
            continue;
        };
        let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
            continue;
        };
        let Some(method_name) = member.static_property_name() else {
            continue;
        };
        if !REGISTRATION_METHODS.contains(&method_name) {
            continue;
        }
        if let Some(identity) = listener_identity(call, method_name, class, ctx) {
            groups.entry(identity).or_default().push(call_node);
        }
    }
    groups
        .into_iter()
        .map(|(identity, calls)| {
            let mut count = 0;
            let mut representatives: Vec<&AstNode<'_>> = Vec::new();
            for call in calls {
                if is_inside_repeating_loop(call, ctx) {
                    count = usize::MAX;
                    break;
                }
                if representatives.iter().any(|representative| {
                    are_nodes_in_mutually_exclusive_branches(call, representative, ctx)
                }) {
                    continue;
                }
                representatives.push(call);
                count += 1;
            }
            (identity, count)
        })
        .collect()
}

fn synchronously_released<'a>(
    acquisition: &AstNode<'a>,
    release_keys: &[String],
    calls: &[&AstNode<'a>],
    member: &LifecycleMember,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(function_node_id) = member.function_node_id else {
        return false;
    };
    let function_node = ctx.nodes().get_node(function_node_id);
    let release_nodes = calls
        .iter()
        .copied()
        .filter(|call| {
            cleanup_keys_for_call(call, class, ctx)
                .iter()
                .any(|key| release_keys.contains(key))
        })
        .collect::<Vec<_>>();
    do_nodes_cover_every_path_after_node(acquisition, &release_nodes, function_node, ctx)
}

fn has_reachable_earlier_await(
    call_node: &AstNode<'_>,
    member: &LifecycleMember,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        member.span.contains_inclusive(candidate.span())
            && candidate.span().start < call_node.span().start
            && matches!(candidate.kind(), AstKind::AwaitExpression(_))
            && member.function_node_id.is_some_and(|function_node_id| {
                can_node_reach_later_node_within_function(
                    candidate,
                    call_node,
                    ctx.nodes().get_node(function_node_id),
                    ctx,
                )
            })
    })
}

fn cleanup_after_await(
    call_node: &AstNode<'_>,
    member: &LifecycleMember,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        member.span.contains_inclusive(candidate.span())
            && candidate.span().start < call_node.span().start
            && matches!(candidate.kind(), AstKind::AwaitExpression(_))
    })
}

fn has_throwing_prelude<'a>(
    cleanup_node: &AstNode<'a>,
    member: &LifecycleMember,
    calls: &[&AstNode<'a>],
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !member.span.contains_inclusive(cleanup_node.span()) {
        return false;
    }
    calls.iter().copied().any(|candidate| {
        candidate.span().start < cleanup_node.span().start
            && member.span.contains_inclusive(candidate.span())
            && cleanup_keys_for_call(candidate, class, ctx).is_empty()
            && !is_proven_non_throwing_call(candidate, ctx)
    })
}

fn is_proven_non_throwing_call(call_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let AstKind::CallExpression(call) = call_node.kind() else {
        return false;
    };
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    let is_unbound = ctx
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
        .is_none();
    is_unbound
        && ((receiver.name == "console"
            && matches!(method_name, "debug" | "error" | "info" | "log" | "warn"))
            || (receiver.name == "Object" && matches!(method_name, "freeze" | "keys" | "values")))
}

fn serialize_reference<'a>(
    expression: &Expression<'a>,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HashSet<String>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            let Some(symbol_id) = reference.symbol_id() else {
                return Some(identifier.name.to_string());
            };
            let symbol_key = format!("symbol:{symbol_id:?}");
            if !visited_symbols.insert(symbol_key.clone()) {
                return None;
            }
            if let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx)
                && matches!(initializer.get_inner_expression(), Expression::Identifier(_) | Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_))
            {
                return serialize_reference(initializer, class, ctx, visited_symbols);
            }
            Some(symbol_key)
        }
        Expression::ThisExpression(_) => Some("this".to_string()),
        expression if expression.as_member_expression().is_some() => serialize_member_reference(
            expression.as_member_expression()?,
            class,
            ctx,
            visited_symbols,
        ),
        Expression::StringLiteral(literal) => Some(format!("string:{}", literal.value)),
        Expression::NumericLiteral(literal) => Some(format!("number:{}", literal.value)),
        _ => None,
    }
}

fn serialize_member_reference<'a>(
    member: &MemberExpression<'a>,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HashSet<String>,
) -> Option<String> {
    let property_name = member.static_property_name()?;
    let object = member.object().get_inner_expression();
    if matches!(object, Expression::ThisExpression(_)) {
        if matches!(property_name, "props" | "state") {
            return None;
        }
    } else if !matches!(object, Expression::StaticMemberExpression(_) | Expression::ComputedMemberExpression(_)) {
        let Expression::Identifier(receiver) = object else {
            return None;
        };
        let is_global = ctx
            .scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            .is_none();
        if !is_global
            || !matches!(property_name, "body" | "documentElement" | "visualViewport")
        {
            return None;
        }
    }
    let receiver = serialize_reference(object, class, ctx, visited_symbols)?;
    Some(format!("{receiver}.{property_name}"))
}

fn stored_call_result_key(call_node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<String> {
    let parent = ctx.nodes().parent_node(call_node.id());
    match parent.kind() {
        AstKind::AssignmentExpression(assignment) if assignment.right.span() == call_node.span() => {
            Some(normalized_source(assignment.left.span(), ctx))
        }
        AstKind::VariableDeclarator(declarator)
            if declarator.init.as_ref().is_some_and(|initializer| initializer.span() == call_node.span()) =>
        {
            Some(normalized_source(declarator.id.span(), ctx))
        }
        _ => None,
    }
}

fn normalized_source(span: Span, ctx: &LintContext<'_>) -> String {
    ctx.source_text()[span.start as usize..span.end as usize]
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn abort_signal_key<'a>(
    call: &CallExpression<'a>,
    class: &Class<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    let options = call.arguments.get(2)?.as_expression()?;
    let options = match options.get_inner_expression() {
        Expression::Identifier(identifier) => resolve_direct_unreassigned_initializer(identifier, ctx)?,
        expression => expression,
    };
    let Expression::ObjectExpression(object) = options.get_inner_expression() else {
        return None;
    };
    let signal = object.properties.iter().find_map(|property| {
        let property = property.as_property()?;
        (property.key.static_name().as_deref() == Some("signal")).then_some(&property.value)
    })?;
    let member = signal.get_inner_expression().as_member_expression()?;
    if member.static_property_name() != Some("signal") {
        return None;
    }
    serialize_reference(member.object(), class, ctx, &mut HashSet::new())
        .map(|controller| format!("abort:{controller}"))
}

fn timer_callee_name<'a>(call: &'a CallExpression<'a>, ctx: &LintContext<'a>) -> Option<&'a str> {
    match call.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let is_unbound = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none();
            (is_unbound
                && matches!(
                    identifier.name.as_str(),
                    "setInterval" | "setTimeout" | "clearInterval" | "clearTimeout"
                ))
            .then_some(identifier.name.as_str())
        }
        expression => {
            let member = expression.as_member_expression()?;
            let method_name = member.static_property_name()?;
            if !matches!(
                method_name,
                "setInterval" | "setTimeout" | "clearInterval" | "clearTimeout"
            ) {
                return None;
            }
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            let is_unbound = ctx
                .scoping()
                .get_reference(receiver.reference_id())
                .symbol_id()
                .is_none();
            (is_unbound && matches!(receiver.name.as_str(), "window" | "globalThis" | "global" | "self"))
                .then_some(method_name)
        }
    }
}

fn timeout_callback_mutates_component(
    call: &CallExpression<'_>,
    member: &LifecycleMember,
    class: &Class<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(callback) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    let callback_source = normalized_source(callback.span(), ctx);
    if callback_source.contains("this.setState(")
        || callback_source.contains("this.forceUpdate(")
        || callback_source.contains("runInAction(")
    {
        return true;
    }
    let member_source = normalized_source(member.span, ctx);
    if let Expression::Identifier(identifier) = callback.get_inner_expression() {
        return member_source.contains(&format!("{}=", identifier.name))
            && (member_source.contains("this.setState(")
                || member_source.contains("this.forceUpdate(")
                || member_source.contains("runInAction("));
    }
    if let Some(callback_member) = callback.get_inner_expression().as_member_expression()
        && matches!(callback_member.object().get_inner_expression(), Expression::ThisExpression(_))
        && let Some(method_name) = callback_member.static_property_name()
    {
        return class_member_source(method_name, class, ctx).is_some_and(|source| {
            source.contains("this.setState(")
                || source.contains("this.forceUpdate(")
                || source.contains("runInAction(")
        });
    }
    false
}

fn class_member_source(name: &str, class: &Class<'_>, ctx: &LintContext<'_>) -> Option<String> {
    class.body.body.iter().find_map(|element| {
        let (member_name, span) = match element {
            ClassElement::MethodDefinition(method) => {
                (method.key.static_name()?, method.value.span())
            }
            ClassElement::PropertyDefinition(property) => {
                (property.key.static_name()?, property.value.as_ref()?.span())
            }
            _ => return None,
        };
        (member_name == name).then(|| normalized_source(span, ctx))
    })
}

fn is_mount_local_receiver<'a>(
    expression: &Expression<'a>,
    member: &LifecycleMember,
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut root = expression.get_inner_expression();
    loop {
        match root {
            Expression::Identifier(identifier) => {
                let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) else {
                    return false;
                };
                if initializer.span().start < member.span.start || initializer.span().end > member.span.end {
                    return false;
                }
                let is_local = matches!(
                    initializer.get_inner_expression(),
                    Expression::NewExpression(_) | Expression::ObjectExpression(_) | Expression::ArrayExpression(_)
                ) || matches!(
                    initializer.get_inner_expression(),
                    Expression::CallExpression(call)
                        if matches!(call.callee.get_inner_expression(), Expression::Identifier(callee) if matches!(callee.name.as_str(), "initPlaces" | "places"))
                );
                if !is_local {
                    root = initializer.get_inner_expression();
                    continue;
                }
                return !local_receiver_escapes(identifier, call_node, member, ctx);
            }
            expression => {
                let Some(member_expression) = expression.as_member_expression() else {
                    return false;
                };
                root = member_expression.object().get_inner_expression();
            }
        }
    }
}

fn local_receiver_escapes(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    registration_node: &AstNode<'_>,
    member: &LifecycleMember,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return true;
    };
    ctx.scoping().get_resolved_references(symbol_id).any(|reference| {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if reference_node.id() == registration_node.id()
            || !member.span.contains_inclusive(reference_node.span())
        {
            return false;
        }
        let parent = ctx.nodes().parent_node(reference_node.id());
        matches!(parent.kind(), AstKind::AssignmentExpression(assignment) if assignment.right.span().contains_inclusive(reference_node.span()))
    })
}

fn is_ref_owned_receiver(
    expression: &Expression<'_>,
    class: &Class<'_>,
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let receiver_source = normalized_source(expression.span(), ctx);
    if !receiver_source.contains(".current") {
        return false;
    }
    let class_source = normalized_source(class.span(), ctx);
    if !class_source.contains("createRef(") {
        return false;
    }
    let ref_name = receiver_source
        .strip_prefix("this.")
        .and_then(|source| source.split(".current").next());
    ref_name.is_some_and(|ref_name| {
        class_source.contains(&format!("{ref_name}=React.createRef("))
            || class_source.contains(&format!("{ref_name}=createRef("))
    }) && !class_source[..(call_node.span().start - class.span.start) as usize]
        .contains(&format!("this.{}=", ref_name.unwrap_or_default()))
}

fn is_react_native_subscription_receiver<'a>(
    call: &CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return false;
    };
    REACT_NATIVE_SUBSCRIPTION_RECEIVERS.contains(&identifier.name.as_str())
        && (ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
            || resolve_identifier_import(identifier, ctx)
                .is_some_and(|import| import.module_request.name() == "react-native"))
}

fn is_inside_repeating_loop(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(ancestor.kind(), AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)) {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::ForStatement(_)
                | AstKind::ForInStatement(_)
                | AstKind::ForOfStatement(_)
                | AstKind::WhileStatement(_)
                | AstKind::DoWhileStatement(_)
        ) {
            return true;
        }
    }
    false
}

fn event_emitter_method(method_name: &str) -> bool {
    matches!(
        method_name,
        "addListener" | "on" | "once" | "prependListener" | "prependOnceListener"
    )
}

fn listener_remove_all_prefix(listener_identity: &str) -> String {
    let receiver = listener_identity.split('|').next().unwrap_or_default();
    format!("listener:removeAllListeners:{receiver}")
}
