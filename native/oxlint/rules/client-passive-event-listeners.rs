use rustc_hash::{FxHashMap, FxHashSet};

use oxc_ast::{
    AstKind as PassiveAstKind,
    ast::{
        Argument, AssignmentTarget, BindingPattern, Expression as PassiveExpression,
        ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId as PassiveSymbolId};
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const PASSIVE_EVENT_NAMES: [&str; 4] = ["wheel", "mousewheel", "touchstart", "touchmove"];
const DEFERRED_CALLBACK_NAMES: [&str; 6] = [
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setImmediate",
    "setInterval",
    "setTimeout",
];

#[derive(Debug, Default, Clone)]
pub struct ClientPassiveEventListeners;

declare_oxc_lint!(
    /// Require passive options on scroll-blocking DOM listeners whose handlers are proven safe.
    ClientPassiveEventListeners,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Require passive options on scroll-blocking DOM listeners.",
);

impl Rule for ClientPassiveEventListeners {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if client_passive_is_generated_docs_archive(ctx) {
            return;
        }
        let property_write_analysis = build_possible_static_property_write_analysis(ctx);
        let mut function_resolution_cache = LocalFunctionResolutionCache::default();
        let mut parameter_exposure_cache = FxHashMap::default();
        for node in ctx.nodes().iter() {
            let PassiveAstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                continue;
            };
            if member.static_property_name() != Some("addEventListener")
                || !is_proven_dom_event_target(member.object(), ctx, &mut Vec::new())
                || client_passive_receiver_method_may_be_replaced(
                    member.object(),
                    node,
                    &property_write_analysis,
                    ctx,
                    &mut function_resolution_cache,
                )
            {
                continue;
            }
            let Some(PassiveExpression::StringLiteral(event_name)) = call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .map(PassiveExpression::get_inner_expression)
            else {
                continue;
            };
            if !PASSIVE_EVENT_NAMES.contains(&event_name.value.as_str()) {
                continue;
            }
            let Some(handler) = call.arguments.get(1).and_then(Argument::as_expression) else {
                continue;
            };
            let handler_function_id = client_passive_resolve_handler_function(
                handler,
                node,
                ctx,
                &mut function_resolution_cache,
            );
            if client_passive_assigned_handler_calls_prevent_default(handler, ctx)
                || handler_function_id.is_some_and(|function_id| {
                    client_passive_function_calls_prevent_default(function_id, ctx)
                        || client_passive_function_may_expose_parameter(
                            function_id,
                            0,
                            true,
                            ctx,
                            &mut function_resolution_cache,
                            &mut parameter_exposure_cache,
                            &mut FxHashSet::default(),
                        )
                })
                || handler_function_id.is_none()
                    && client_passive_unresolved_mutable_handler(handler, node, ctx)
            {
                continue;
            }
            if call.arguments.get(2).is_some_and(|options| {
                options
                    .as_expression()
                    .is_none_or(|expression| client_passive_options_are_explicit(expression))
            }) {
                continue;
            }
            let message = format!(
                "\"{}\" listener without {{ passive: true }} makes scrolling janky for your users. Only add it if the handler doesn't call event.preventDefault(), since passive listeners silently ignore preventDefault().",
                event_name.value
            );
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(call.span));
        }
    }
}

fn client_passive_is_generated_docs_archive(ctx: &LintContext<'_>) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    let lowercase = filename.to_ascii_lowercase();
    if !lowercase.ends_with("/docs.js") {
        return false;
    }
    let segments = lowercase.split('/').collect::<Vec<_>>();
    segments.windows(4).any(|window| {
        matches!(window[0], "doc" | "docs" | "documentation")
            && window[1] == "archive"
            && !window[2].is_empty()
            && window[3] == "static"
    })
}

fn client_passive_receiver_method_may_be_replaced<'a>(
    receiver: &PassiveExpression<'a>,
    call_node: &AstNode<'a>,
    analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    if let PassiveExpression::Identifier(identifier) = receiver.get_inner_expression()
        && has_possible_static_property_write_before(
            identifier,
            "addEventListener",
            call_node,
            analysis,
            ctx,
        )
    {
        return true;
    }
    if let PassiveExpression::Identifier(identifier) = receiver.get_inner_expression()
        && client_passive_receiver_has_opaque_escape_before(
            identifier,
            call_node,
            ctx,
            function_resolution_cache,
        )
    {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        if candidate.span().start >= call_node.span().start
            || !client_passive_is_unconditional_before(candidate, call_node, ctx)
        {
            return false;
        }
        if let PassiveAstKind::CallExpression(call) = candidate.kind()
            && client_passive_is_reflected_prototype_replacement(call, ctx)
        {
            return true;
        }
        let PassiveAstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        let Some(member) = assignment.left.as_member_expression() else {
            return false;
        };
        if member.static_property_name() != Some("addEventListener") {
            return false;
        }
        let Some(prototype) = member
            .object()
            .get_inner_expression()
            .as_member_expression()
        else {
            return false;
        };
        if prototype.static_property_name() != Some("prototype") {
            return false;
        }
        matches!(
            prototype.object().get_inner_expression(),
            PassiveExpression::Identifier(identifier)
                if ["EventTarget", "Window", "Document", "Element", "HTMLElement"]
                    .contains(&identifier.name.as_str())
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
        )
    })
}

fn client_passive_receiver_has_opaque_escape_before<'a>(
    receiver: &oxc_ast::ast::IdentifierReference<'a>,
    listener_call: &AstNode<'a>,
    ctx: &LintContext<'a>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(receiver.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if reference_node.span().start >= listener_call.span().start {
                return false;
            }
            let Some(escape_call) = client_passive_reference_argument_call(reference_node, ctx)
            else {
                return false;
            };
            let escape_call_node = ctx.nodes().get_node(escape_call.node_id.get());
            if !client_passive_is_unconditional_before(escape_call_node, listener_call, ctx) {
                return false;
            }
            exact_local_function_id(
                &escape_call.callee,
                ctx,
                &mut Vec::new(),
                function_resolution_cache,
            )
            .is_none()
        })
}

fn client_passive_reference_argument_call<'a, 'b>(
    reference: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b oxc_ast::ast::CallExpression<'a>> {
    let mut current = transparent_expression_root(reference, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            PassiveAstKind::CallExpression(call) => {
                return call
                    .arguments
                    .iter()
                    .any(|argument| argument.span() == current.span())
                    .then_some(call);
            }
            PassiveAstKind::ObjectProperty(property) if property.value.span() == current.span() => {
                current = ctx.nodes().parent_node(parent.id());
            }
            PassiveAstKind::ObjectExpression(_)
            | PassiveAstKind::ArrayExpression(_)
            | PassiveAstKind::SpreadElement(_)
            | PassiveAstKind::ParenthesizedExpression(_)
            | PassiveAstKind::TSAsExpression(_)
            | PassiveAstKind::TSSatisfiesExpression(_)
            | PassiveAstKind::TSNonNullExpression(_)
            | PassiveAstKind::TSTypeAssertion(_) => current = parent,
            _ => return None,
        }
    }
}

fn client_passive_is_reflected_prototype_replacement(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(callee) = call.callee.get_inner_expression().as_member_expression() else {
        return false;
    };
    if callee.static_property_name() != Some("defineProperty")
        || !matches!(callee.object().get_inner_expression(), PassiveExpression::Identifier(identifier)
            if identifier.name == "Reflect"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
    {
        return false;
    }
    let Some(target) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    let Some(prototype) = target.get_inner_expression().as_member_expression() else {
        return false;
    };
    prototype.static_property_name() == Some("prototype")
        && matches!(prototype.object().get_inner_expression(), PassiveExpression::Identifier(identifier)
            if identifier.name == "EventTarget"
                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        && call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
            .is_some_and(|property| matches!(
                property.get_inner_expression(),
                PassiveExpression::StringLiteral(property) if property.value == "addEventListener"
            ))
}

fn client_passive_is_unconditional_before(
    candidate: &AstNode<'_>,
    reference: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let candidate_function = client_passive_nearest_function_id(candidate.id(), ctx);
    let reference_function = client_passive_nearest_function_id(reference.id(), ctx);
    if candidate_function != reference_function {
        return candidate_function.is_none();
    }
    for ancestor in ctx.nodes().ancestors(candidate.id()) {
        if Some(ancestor.id()) == candidate_function {
            break;
        }
        if matches!(
            ancestor.kind(),
            PassiveAstKind::ConditionalExpression(_)
                | PassiveAstKind::IfStatement(_)
                | PassiveAstKind::LogicalExpression(_)
                | PassiveAstKind::SwitchCase(_)
                | PassiveAstKind::SwitchStatement(_)
        ) {
            return false;
        }
    }
    true
}

fn client_passive_resolve_handler_function<'a>(
    handler: &PassiveExpression<'a>,
    call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    cache: &mut LocalFunctionResolutionCache,
) -> Option<NodeId> {
    if let Some(function_id) = exact_local_function_id(handler, ctx, &mut Vec::new(), cache) {
        return Some(function_id);
    }
    match handler.get_inner_expression() {
        PassiveExpression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            client_passive_latest_assigned_function(symbol_id, call_node.span().start, ctx)
        }
        expression => {
            let member = expression.as_member_expression()?;
            if !matches!(
                member.object().get_inner_expression(),
                PassiveExpression::ThisExpression(_)
            ) {
                return None;
            }
            let property_name = member.static_property_name()?;
            client_passive_this_member_function(property_name, call_node, ctx)
        }
    }
}

fn client_passive_latest_assigned_function(
    symbol_id: PassiveSymbolId,
    before_offset: u32,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    let mut assignments = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .filter_map(|reference| {
            let target_node = ctx.nodes().get_node(reference.node_id());
            let target_root = transparent_expression_root(target_node, ctx);
            let parent = ctx.nodes().parent_node(target_root.id());
            let PassiveAstKind::AssignmentExpression(assignment) = parent.kind() else {
                return None;
            };
            (assignment.left.span() == target_root.span() && assignment.span.start < before_offset)
                .then_some((assignment.span.start, &assignment.right))
        })
        .collect::<Vec<_>>();
    assignments.sort_by_key(|(offset, _)| *offset);
    let (_, assigned_value) = assignments.last()?;
    match assigned_value.get_inner_expression() {
        PassiveExpression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        PassiveExpression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn client_passive_this_member_function(
    property_name: &str,
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    for ancestor in ctx.nodes().ancestors(call_node.id()) {
        match ancestor.kind() {
            PassiveAstKind::Class(class) => {
                return class.body.body.iter().find_map(|element| match element {
                    oxc_ast::ast::ClassElement::MethodDefinition(method)
                        if method.key.static_name().as_deref() == Some(property_name) =>
                    {
                        Some(method.value.node_id.get())
                    }
                    oxc_ast::ast::ClassElement::PropertyDefinition(property)
                        if property.key.static_name().as_deref() == Some(property_name) =>
                    {
                        match property.value.as_ref()?.get_inner_expression() {
                            PassiveExpression::ArrowFunctionExpression(function) => {
                                Some(function.node_id.get())
                            }
                            PassiveExpression::FunctionExpression(function) => {
                                Some(function.node_id.get())
                            }
                            _ => None,
                        }
                    }
                    _ => None,
                });
            }
            PassiveAstKind::ObjectExpression(object) => {
                return object.properties.iter().find_map(|candidate| {
                    let ObjectPropertyKind::ObjectProperty(property) = candidate else {
                        return None;
                    };
                    if property.key.static_name().as_deref() != Some(property_name) {
                        return None;
                    }
                    match property.value.get_inner_expression() {
                        PassiveExpression::FunctionExpression(function) => {
                            Some(function.node_id.get())
                        }
                        PassiveExpression::ArrowFunctionExpression(function) => {
                            Some(function.node_id.get())
                        }
                        _ => None,
                    }
                });
            }
            _ => {}
        }
    }
    None
}

fn client_passive_function_calls_prevent_default(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        client_passive_nearest_function_id(candidate.id(), ctx) == Some(function_id)
            && matches!(candidate.kind(), PassiveAstKind::CallExpression(call)
                if call.callee.get_inner_expression().as_member_expression()
                    .is_some_and(|member| member.static_property_name() == Some("preventDefault")))
    })
}

fn client_passive_function_may_expose_parameter<'a>(
    function_id: NodeId,
    parameter_index: usize,
    is_root_handler: bool,
    ctx: &LintContext<'a>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
    exposure_cache: &mut FxHashMap<(NodeId, usize, bool), bool>,
    visited_parameters: &mut FxHashSet<(NodeId, usize, bool)>,
) -> bool {
    let cache_key = (function_id, parameter_index, is_root_handler);
    if let Some(&cached) = exposure_cache.get(&cache_key) {
        return cached;
    }
    if !visited_parameters.insert(cache_key) {
        return false;
    }
    let function = ctx.nodes().get_node(function_id);
    let parameter = match function.kind() {
        PassiveAstKind::Function(function) => function
            .params
            .items
            .get(parameter_index)
            .map(|item| &item.pattern),
        PassiveAstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .get(parameter_index)
            .map(|item| &item.pattern),
        _ => None,
    };
    let Some(parameter) = parameter else {
        visited_parameters.remove(&cache_key);
        return !is_root_handler;
    };
    let parameter = match parameter {
        BindingPattern::AssignmentPattern(assignment) => &assignment.left,
        parameter => parameter,
    };
    let BindingPattern::BindingIdentifier(parameter) = parameter else {
        let result = !(is_root_handler && matches!(parameter, BindingPattern::ObjectPattern(_)));
        exposure_cache.insert(cache_key, result);
        visited_parameters.remove(&cache_key);
        return result;
    };
    let mut alias_symbols = FxHashSet::from_iter([parameter.symbol_id()]);
    let mut container_alias_symbols = FxHashSet::default();
    let mut did_add_alias = true;
    while did_add_alias {
        did_add_alias = false;
        for candidate in ctx.nodes().iter() {
            match candidate.kind() {
                PassiveAstKind::VariableDeclarator(declarator) => {
                    let Some(initializer) = declarator.init.as_ref() else {
                        continue;
                    };
                    let previous_count = alias_symbols.len();
                    let previous_container_count = container_alias_symbols.len();
                    client_passive_add_aliases_from_pattern(
                        &declarator.id,
                        initializer,
                        &mut alias_symbols,
                        &mut container_alias_symbols,
                        ctx,
                    );
                    if alias_symbols.len() != previous_count
                        || container_alias_symbols.len() != previous_container_count
                    {
                        did_add_alias = true;
                    }
                }
                PassiveAstKind::AssignmentExpression(assignment) => {
                    let AssignmentTarget::AssignmentTargetIdentifier(target) = &assignment.left
                    else {
                        continue;
                    };
                    let Some(target_symbol_id) = ctx
                        .scoping()
                        .get_reference(target.reference_id())
                        .symbol_id()
                    else {
                        continue;
                    };
                    if client_passive_expression_contains_alias(
                        &assignment.right,
                        &alias_symbols,
                        &container_alias_symbols,
                        ctx,
                    ) && alias_symbols.insert(target_symbol_id)
                    {
                        did_add_alias = true;
                    }
                }
                _ => {}
            }
        }
    }
    let result = alias_symbols.into_iter().any(|symbol_id| {
        ctx.scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                if !client_passive_reference_runs_synchronously(reference_node, function_id, ctx)
                    || client_passive_reference_is_derived_property(reference_node, ctx)
                {
                    return false;
                }
                client_passive_reference_escapes(
                    reference_node,
                    function_id,
                    ctx,
                    function_resolution_cache,
                    exposure_cache,
                    visited_parameters,
                )
            })
    });
    visited_parameters.remove(&cache_key);
    exposure_cache.insert(cache_key, result);
    result
}

fn client_passive_expression_contains_alias(
    expression: &PassiveExpression<'_>,
    aliases: &FxHashSet<PassiveSymbolId>,
    container_aliases: &FxHashSet<PassiveSymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        PassiveExpression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| aliases.contains(&symbol_id)),
        PassiveExpression::ObjectExpression(object) => object.properties.iter().any(|property| {
            match property {
                ObjectPropertyKind::ObjectProperty(property) => {
                    client_passive_expression_contains_alias(
                        &property.value,
                        aliases,
                        container_aliases,
                        ctx,
                    )
                }
                ObjectPropertyKind::SpreadProperty(spread) => {
                    client_passive_expression_contains_alias(
                        &spread.argument,
                        aliases,
                        container_aliases,
                        ctx,
                    )
                }
            }
        }),
        PassiveExpression::ArrayExpression(array) => array.elements.iter().any(|element| {
            match element {
                oxc_ast::ast::ArrayExpressionElement::SpreadElement(spread) => {
                    client_passive_expression_contains_alias(
                        &spread.argument,
                        aliases,
                        container_aliases,
                        ctx,
                    )
                }
                oxc_ast::ast::ArrayExpressionElement::Elision(_) => false,
                element => element.as_expression().is_some_and(|expression| {
                    client_passive_expression_contains_alias(
                        expression,
                        aliases,
                        container_aliases,
                        ctx,
                    )
                }),
            }
        }),
        PassiveExpression::ConditionalExpression(conditional) => {
            client_passive_expression_contains_alias(
                &conditional.consequent,
                aliases,
                container_aliases,
                ctx,
            ) || client_passive_expression_contains_alias(
                &conditional.alternate,
                aliases,
                container_aliases,
                ctx,
            )
        }
        PassiveExpression::LogicalExpression(logical) => {
            client_passive_expression_contains_alias(
                &logical.left,
                aliases,
                container_aliases,
                ctx,
            ) || client_passive_expression_contains_alias(
                &logical.right,
                aliases,
                container_aliases,
                ctx,
            )
        }
        PassiveExpression::SequenceExpression(sequence) => sequence.expressions.iter().any(
            |expression| {
                client_passive_expression_contains_alias(
                    expression,
                    aliases,
                    container_aliases,
                    ctx,
                )
            },
        ),
        expression => expression.as_member_expression().is_some_and(|member| {
            matches!(member.object().get_inner_expression(), PassiveExpression::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                    .is_some_and(|symbol_id| container_aliases.contains(&symbol_id)))
        }),
    }
}

fn client_passive_add_aliases_from_pattern(
    pattern: &BindingPattern<'_>,
    source: &PassiveExpression<'_>,
    aliases: &mut FxHashSet<PassiveSymbolId>,
    container_aliases: &mut FxHashSet<PassiveSymbolId>,
    ctx: &LintContext<'_>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(binding) => {
            if client_passive_expression_contains_alias(source, aliases, container_aliases, ctx) {
                aliases.insert(binding.symbol_id());
            }
        }
        BindingPattern::AssignmentPattern(assignment) => client_passive_add_aliases_from_pattern(
            &assignment.left,
            source,
            aliases,
            container_aliases,
            ctx,
        ),
        BindingPattern::ObjectPattern(pattern) => {
            let PassiveExpression::ObjectExpression(source_object) = source.get_inner_expression()
            else {
                return;
            };
            for pattern_property in &pattern.properties {
                let Some(property_name) = pattern_property.key.static_name() else {
                    continue;
                };
                let Some(source_property) = source_object.properties.iter().find_map(|property| {
                    let ObjectPropertyKind::ObjectProperty(property) = property else {
                        return None;
                    };
                    (property.key.static_name().as_deref() == Some(property_name.as_ref()))
                        .then_some(property)
                }) else {
                    continue;
                };
                client_passive_add_aliases_from_pattern(
                    &pattern_property.value,
                    &source_property.value,
                    aliases,
                    container_aliases,
                    ctx,
                );
            }
            if let Some(rest) = &pattern.rest
                && client_passive_expression_contains_alias(source, aliases, container_aliases, ctx)
            {
                client_passive_collect_pattern_symbols(&rest.argument, container_aliases);
            }
        }
        BindingPattern::ArrayPattern(pattern) => {
            let PassiveExpression::ArrayExpression(source_array) = source.get_inner_expression()
            else {
                return;
            };
            for (pattern_element, source_element) in
                pattern.elements.iter().zip(source_array.elements.iter())
            {
                let Some(pattern_element) = pattern_element else {
                    continue;
                };
                let Some(source_expression) = source_element.as_expression() else {
                    continue;
                };
                client_passive_add_aliases_from_pattern(
                    pattern_element,
                    source_expression,
                    aliases,
                    container_aliases,
                    ctx,
                );
            }
            if let Some(rest) = &pattern.rest
                && client_passive_expression_contains_alias(source, aliases, container_aliases, ctx)
            {
                client_passive_collect_pattern_symbols(&rest.argument, container_aliases);
            }
        }
    }
}

fn client_passive_collect_pattern_symbols(
    pattern: &BindingPattern<'_>,
    symbols: &mut FxHashSet<PassiveSymbolId>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(binding) => {
            symbols.insert(binding.symbol_id());
        }
        BindingPattern::AssignmentPattern(assignment) => {
            client_passive_collect_pattern_symbols(&assignment.left, symbols);
        }
        BindingPattern::ObjectPattern(pattern) => {
            for property in &pattern.properties {
                client_passive_collect_pattern_symbols(&property.value, symbols);
            }
            if let Some(rest) = &pattern.rest {
                client_passive_collect_pattern_symbols(&rest.argument, symbols);
            }
        }
        BindingPattern::ArrayPattern(pattern) => {
            for element in pattern.elements.iter().flatten() {
                client_passive_collect_pattern_symbols(element, symbols);
            }
            if let Some(rest) = &pattern.rest {
                client_passive_collect_pattern_symbols(&rest.argument, symbols);
            }
        }
    }
}

fn client_passive_reference_runs_synchronously(
    reference: &AstNode<'_>,
    root_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(nearest_function_id) = client_passive_nearest_function_id(reference.id(), ctx) else {
        return false;
    };
    if nearest_function_id == root_function_id {
        return true;
    }
    let callback = ctx.nodes().get_node(nearest_function_id);
    let parent = ctx.nodes().parent_node(callback.id());
    let PassiveAstKind::CallExpression(call) = parent.kind() else {
        return matches!(parent.kind(), PassiveAstKind::NewExpression(new_expression)
            if matches!(new_expression.callee.get_inner_expression(), PassiveExpression::Identifier(identifier)
                if identifier.name == "Promise"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()));
    };
    if call.callee.span() == callback.span() {
        return true;
    }
    if client_passive_is_deferred_call(call, ctx) {
        return false;
    }
    client_passive_nearest_function_id(parent.id(), ctx) == Some(root_function_id)
}

fn client_passive_is_deferred_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    client_passive_is_deferred_callee(&call.callee, ctx, &mut Vec::new())
}

fn client_passive_is_deferred_callee<'a>(
    callee: &PassiveExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<PassiveSymbolId>,
) -> bool {
    match callee.get_inner_expression() {
        PassiveExpression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if DEFERRED_CALLBACK_NAMES.contains(&identifier.name.as_str()) && symbol_id.is_none() {
                return true;
            }
            let Some(symbol_id) = symbol_id else {
                return false;
            };
            if visited_symbols.contains(&symbol_id) {
                return false;
            }
            let Some(initializer) = resolve_direct_unreassigned_symbol_initializer(symbol_id, ctx)
            else {
                return false;
            };
            visited_symbols.push(symbol_id);
            client_passive_is_deferred_callee(initializer, ctx, visited_symbols)
        }
        expression => expression.as_member_expression().is_some_and(|member| {
            let method_name = member.static_property_name();
            if matches!(method_name, Some("then" | "catch" | "finally")) {
                return client_passive_is_proven_promise_expression(
                    member.object(),
                    ctx,
                    &mut FxHashSet::default(),
                );
            }
            if method_name == Some("addEventListener") {
                return is_proven_dom_event_target(member.object(), ctx, &mut Vec::new());
            }
            DEFERRED_CALLBACK_NAMES.contains(&method_name.unwrap_or_default())
                && matches!(member.object().get_inner_expression(), PassiveExpression::Identifier(identifier)
                    if matches!(identifier.name.as_str(), "window" | "globalThis")
                        && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }),
    }
}

fn client_passive_is_proven_promise_expression<'a>(
    expression: &PassiveExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<PassiveSymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        PassiveExpression::Identifier(identifier) => {
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
            let declaration = ctx.symbol_declaration(symbol_id);
            let PassiveAstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            declarator.init.as_ref().is_some_and(|initializer| {
                client_passive_is_proven_promise_expression(initializer, ctx, visited_symbols)
            })
        }
        PassiveExpression::NewExpression(construction) => {
            matches!(construction.callee.get_inner_expression(), PassiveExpression::Identifier(identifier)
                if identifier.name == "Promise"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
        PassiveExpression::CallExpression(call) => {
            match call.callee.get_inner_expression() {
                PassiveExpression::Identifier(identifier) => {
                    client_passive_is_async_function_reference(
                        identifier,
                        ctx,
                        visited_symbols,
                    )
                }
                callee => callee.as_member_expression().is_some_and(|member| {
                    let method_name = member.static_property_name();
                    if matches!(method_name, Some("then" | "catch" | "finally")) {
                        return client_passive_is_proven_promise_expression(
                            member.object(),
                            ctx,
                            visited_symbols,
                        );
                    }
                    matches!(method_name, Some("all" | "allSettled" | "any" | "race" | "reject" | "resolve"))
                        && matches!(member.object().get_inner_expression(), PassiveExpression::Identifier(identifier)
                            if identifier.name == "Promise"
                                && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
                }),
            }
        }
        _ => false,
    }
}

fn client_passive_is_async_function_reference(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<PassiveSymbolId>,
) -> bool {
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
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        PassiveAstKind::Function(function) => function.r#async,
        PassiveAstKind::VariableDeclarator(declarator) => declarator
            .init
            .as_ref()
            .is_some_and(|initializer| match initializer.get_inner_expression() {
                PassiveExpression::ArrowFunctionExpression(function) => function.r#async,
                PassiveExpression::FunctionExpression(function) => function.r#async,
                PassiveExpression::Identifier(alias) => {
                    client_passive_is_async_function_reference(alias, ctx, visited_symbols)
                }
                _ => false,
            }),
        _ => false,
    }
}

fn client_passive_reference_is_derived_property<'a>(
    reference: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(reference, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    match parent.kind() {
        PassiveAstKind::StaticMemberExpression(member) => {
            member.object.span() == root.span()
                && !client_passive_is_return_value_cancellation(parent, ctx)
        }
        PassiveAstKind::ComputedMemberExpression(member) => {
            member.object.span() == root.span()
                && !client_passive_is_return_value_cancellation(parent, ctx)
        }
        _ => false,
    }
}

fn client_passive_is_return_value_cancellation(
    member_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let is_return_value = match member_node.kind() {
        PassiveAstKind::StaticMemberExpression(member) => member.property.name == "returnValue",
        PassiveAstKind::ComputedMemberExpression(member) => {
            member.static_property_name().as_deref() == Some("returnValue")
        }
        _ => false,
    };
    if !is_return_value {
        return false;
    }
    let parent = ctx.nodes().parent_node(member_node.id());
    matches!(parent.kind(), PassiveAstKind::AssignmentExpression(assignment)
        if assignment.left.span() == member_node.span()
            && matches!(assignment.right.get_inner_expression(), PassiveExpression::BooleanLiteral(value) if !value.value))
}

fn client_passive_reference_escapes<'a>(
    reference: &AstNode<'a>,
    root_function_id: NodeId,
    ctx: &LintContext<'a>,
    function_resolution_cache: &mut LocalFunctionResolutionCache,
    exposure_cache: &mut FxHashMap<(NodeId, usize, bool), bool>,
    visited_parameters: &mut FxHashSet<(NodeId, usize, bool)>,
) -> bool {
    let mut current = transparent_expression_root(reference, ctx);
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            PassiveAstKind::CallExpression(call) => {
                if call.callee.span() == current.span() {
                    return false;
                }
                let Some(argument_index) = call
                    .arguments
                    .iter()
                    .position(|argument| argument.span().contains_inclusive(reference.span()))
                else {
                    return false;
                };
                if let Some(called_function_id) = exact_local_function_id(
                    &call.callee,
                    ctx,
                    &mut Vec::new(),
                    function_resolution_cache,
                ) {
                    return client_passive_function_may_expose_parameter(
                        called_function_id,
                        argument_index,
                        false,
                        ctx,
                        function_resolution_cache,
                        exposure_cache,
                        visited_parameters,
                    );
                }
                return true;
            }
            PassiveAstKind::NewExpression(construction) => {
                return construction
                    .arguments
                    .iter()
                    .any(|argument| argument.span().contains_inclusive(reference.span()));
            }
            PassiveAstKind::ReturnStatement(_) => return true,
            PassiveAstKind::AssignmentExpression(assignment) => {
                return !matches!(
                    &assignment.left,
                    AssignmentTarget::AssignmentTargetIdentifier(_)
                );
            }
            PassiveAstKind::ObjectExpression(_)
            | PassiveAstKind::ObjectProperty(_)
            | PassiveAstKind::ArrayExpression(_)
            | PassiveAstKind::StaticMemberExpression(_)
            | PassiveAstKind::ComputedMemberExpression(_)
            | PassiveAstKind::SpreadElement(_)
            | PassiveAstKind::ParenthesizedExpression(_)
            | PassiveAstKind::TSAsExpression(_)
            | PassiveAstKind::TSSatisfiesExpression(_)
            | PassiveAstKind::TSNonNullExpression(_)
            | PassiveAstKind::TSTypeAssertion(_) => current = parent,
            _ => return false,
        }
        if current.id() == root_function_id {
            return false;
        }
    }
}

fn client_passive_unresolved_mutable_handler(
    handler: &PassiveExpression<'_>,
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let PassiveExpression::Identifier(identifier) = handler.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let PassiveAstKind::VariableDeclarator(_) = declaration.kind() else {
        return false;
    };
    let PassiveAstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return false;
    };
    if !matches!(
        variable_declaration.kind,
        oxc_ast::ast::VariableDeclarationKind::Let | oxc_ast::ast::VariableDeclarationKind::Var
    ) {
        return false;
    }
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| {
            reference.is_write()
                && ctx.nodes().get_node(reference.node_id()).span().start < call_node.span().start
        })
}

fn client_passive_assigned_handler_calls_prevent_default(
    handler: &PassiveExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let PassiveExpression::Identifier(identifier) = handler.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let handler_name = identifier.name.as_str();
    let binding_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
    ctx.nodes().iter().any(|candidate| {
        if !ctx
            .scoping()
            .scope_ancestors(candidate.scope_id())
            .any(|scope_id| scope_id == binding_scope_id)
        {
            return false;
        }
        let PassiveAstKind::AssignmentExpression(assignment) = candidate.kind() else {
            return false;
        };
        if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign {
            return false;
        }
        let AssignmentTarget::AssignmentTargetIdentifier(target) = &assignment.left else {
            return false;
        };
        if target.name != handler_name {
            return false;
        }
        let function_id = match assignment.right.get_inner_expression() {
            PassiveExpression::ArrowFunctionExpression(function) => function.node_id.get(),
            PassiveExpression::FunctionExpression(function) => function.node_id.get(),
            _ => return false,
        };
        client_passive_function_calls_prevent_default(function_id, ctx)
    })
}

fn client_passive_options_are_explicit(expression: &PassiveExpression<'_>) -> bool {
    let PassiveExpression::ObjectExpression(options) = expression.get_inner_expression() else {
        return true;
    };
    options.properties.iter().any(|candidate| {
        let ObjectPropertyKind::ObjectProperty(property) = candidate else {
            return false;
        };
        matches!(&property.key, PropertyKey::StaticIdentifier(identifier) if identifier.name == "passive")
            && matches!(
                property.value.get_inner_expression(),
                PassiveExpression::BooleanLiteral(_)
            )
    })
}

fn client_passive_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            PassiveAstKind::Function(_) | PassiveAstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}
