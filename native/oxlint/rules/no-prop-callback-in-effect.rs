use oxc_ast::{
    AstKind,
    ast::{Argument, ArrayExpressionElement, BindingPattern, Expression, FunctionType},
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

const PROP_CALLBACK_EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const PROP_CALLBACK_NON_STATE_CUSTOM_HOOK_NAMES: [&str; 14] = [
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
const PROP_CALLBACK_BUILTIN_HOOK_NAMES: [&str; 15] = [
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
];
const PROP_CALLBACK_DEFERRING_CALLEE_NAMES: [&str; 17] = [
    "addEventListener",
    "addListener",
    "catch",
    "finally",
    "observe",
    "on",
    "once",
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setImmediate",
    "setInterval",
    "setTimeout",
    "subscribe",
    "then",
    "watch",
    "watchPosition",
];

#[derive(Debug, Default, Clone)]
pub struct NoPropCallbackInEffect;

declare_oxc_lint!(
    /// Warns when an effect mirrors local state to a parent callback.
    NoPropCallbackInEffect,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Parent kept in sync with a callback effect.",
);

impl Rule for NoPropCallbackInEffect {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(effect_call) = node.kind() else {
            return;
        };
        if effect_call.arguments.len() < 2
            || !is_react_hook_call(effect_call, &PROP_CALLBACK_EFFECT_HOOK_NAMES, ctx)
        {
            return;
        }
        let Some(callback_expression) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return;
        };
        let Some(callback_id) = exact_local_function_id_including_generators(
            callback_expression,
            ctx,
            &mut Vec::new(),
            &mut LocalFunctionResolutionCache::default(),
        ) else {
            return;
        };
        if matches!(ctx.nodes().get_node(callback_id).kind(), AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration)
        {
            return;
        }
        let Some(Expression::ArrayExpression(dependencies)) = effect_call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            return;
        };
        if dependencies.elements.is_empty() {
            return;
        }
        let Some(component_id) = prop_callback_nearest_function_id(node.id(), ctx) else {
            return;
        };
        if !prop_callback_is_component(ctx.nodes().get_node(component_id), ctx) {
            return;
        }
        let prop_bindings = prop_callback_component_prop_bindings(component_id, ctx);
        if prop_bindings.names_by_symbol.is_empty() && prop_bindings.whole_props_symbols.is_empty()
        {
            return;
        }

        let mut react_state_dependency_symbols = FxHashSet::default();
        let mut state_dependency_symbols = FxHashSet::default();
        let mut state_like_dependency_symbols = Vec::new();
        for dependency in dependencies
            .elements
            .iter()
            .filter_map(ArrayExpressionElement::as_expression)
        {
            let Expression::Identifier(identifier) = dependency else {
                continue;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                continue;
            };
            if prop_bindings.is_prop_symbol(symbol_id) {
                continue;
            }
            let mut upstream_symbols = FxHashSet::default();
            prop_callback_collect_upstream_symbols(
                symbol_id,
                ctx,
                &mut FxHashSet::default(),
                &mut upstream_symbols,
            );
            if upstream_symbols
                .iter()
                .any(|source_symbol_id| prop_callback_is_react_state_symbol(*source_symbol_id, ctx))
            {
                react_state_dependency_symbols.extend(upstream_symbols.iter().copied());
                state_dependency_symbols.extend(upstream_symbols);
                state_like_dependency_symbols.push(symbol_id);
                continue;
            }
            if upstream_symbols.iter().any(|source_symbol_id| {
                prop_callback_is_custom_hook_state_symbol(
                    *source_symbol_id,
                    component_id,
                    &prop_bindings,
                    ctx,
                )
            }) {
                state_dependency_symbols.extend(upstream_symbols);
                state_like_dependency_symbols.push(symbol_id);
            }
        }
        if state_like_dependency_symbols.is_empty() {
            return;
        }
        if prop_callback_has_ref_latch(callback_id, ctx)
            || prop_callback_has_previous_value_dependency(dependencies, ctx)
        {
            return;
        }
        if state_like_dependency_symbols
            .iter()
            .all(|dependency_symbol_id| {
                prop_callback_state_setter_symbol(*dependency_symbol_id, ctx).is_some_and(
                    |setter_symbol_id| {
                        prop_callback_state_is_externally_driven(
                            setter_symbol_id,
                            component_id,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    },
                )
            })
        {
            return;
        }

        let write_analysis = build_possible_static_property_write_analysis(ctx);
        let cleanup_callback_names = prop_callback_cleanup_names(
            callback_id,
            component_id,
            &prop_bindings,
            None,
            &write_analysis,
            ctx,
        );
        for candidate in ctx.nodes().iter() {
            if prop_callback_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
                continue;
            }
            let AstKind::CallExpression(callback_call) = candidate.kind() else {
                continue;
            };
            let callback_names = prop_callback_resolve_prop_names(
                &callback_call.callee,
                component_id,
                &prop_bindings,
                None,
                &write_analysis,
                ctx,
                &mut FxHashSet::default(),
            );
            let Some(callback_name) = callback_names.iter().next() else {
                continue;
            };
            let does_use_state_dependency = callback_call.arguments.iter().any(|argument| {
                prop_callback_argument_expression(argument).is_some_and(|expression| {
                    !matches!(
                        expression.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) && state_dependency_symbols.iter().any(|dependency_symbol_id| {
                        prop_callback_expression_has_symbol_source(
                            expression,
                            *dependency_symbol_id,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    })
                })
            });
            let does_use_react_state_dependency = callback_call.arguments.iter().any(|argument| {
                prop_callback_argument_expression(argument).is_some_and(|expression| {
                    !matches!(
                        expression.get_inner_expression(),
                        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                    ) && react_state_dependency_symbols
                        .iter()
                        .any(|state_symbol_id| {
                            prop_callback_expression_has_symbol_source(
                                expression,
                                *state_symbol_id,
                                ctx,
                                &mut FxHashSet::default(),
                            )
                        })
                })
            });
            if cleanup_callback_names.contains(callback_name) && !does_use_react_state_dependency {
                continue;
            }
            if !does_use_state_dependency
                && (react_state_dependency_symbols.is_empty()
                    || prop_callback_has_matching_local_state_write(
                        callback_id,
                        callback_call,
                        ctx,
                    ))
            {
                continue;
            }
            let call_root = transparent_expression_root(candidate, ctx);
            let call_parent = ctx.nodes().parent_node(call_root.id());
            let is_direct_effect_return = matches!(call_parent.kind(), AstKind::ReturnStatement(_))
                && matches!(
                    ctx.nodes().parent_node(call_parent.id()).kind(),
                    AstKind::FunctionBody(_)
                );
            if !is_result_discarded_call(candidate, true, ctx) && !is_direct_effect_return {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your parent re-renders on every local state change because this useEffect calls the prop \"{callback_name}\" just to stay in sync."
                ))
                .with_label(callback_call.span),
            );
        }
    }
}

#[derive(Default)]
struct PropCallbackBindings {
    names_by_symbol: FxHashMap<SymbolId, String>,
    whole_props_symbols: FxHashSet<SymbolId>,
}

impl PropCallbackBindings {
    fn is_prop_symbol(&self, symbol_id: SymbolId) -> bool {
        self.names_by_symbol.contains_key(&symbol_id)
            || self.whole_props_symbols.contains(&symbol_id)
    }
}

fn prop_callback_nearest_function_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn prop_callback_is_component<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    match node.kind() {
        AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration => {
            function.id.as_ref().is_none_or(|identifier| {
                identifier.name == "default"
                    || identifier
                        .name
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_uppercase)
            })
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let mut root = transparent_expression_root(node, ctx);
            loop {
                let parent = ctx.nodes().parent_node(root.id());
                if matches!(parent.kind(), AstKind::CallExpression(call)
                    if call.arguments.iter().any(|argument| argument.span() == root.span()))
                {
                    root = transparent_expression_root(parent, ctx);
                    continue;
                }
                return match parent.kind() {
                    AstKind::VariableDeclarator(declarator) => declarator
                        .id
                        .get_binding_identifier()
                        .is_some_and(|identifier| {
                            identifier
                                .name
                                .as_bytes()
                                .first()
                                .is_some_and(u8::is_ascii_uppercase)
                        }),
                    AstKind::ExportDefaultDeclaration(_) => true,
                    _ => false,
                };
            }
        }
        _ => false,
    }
}

fn prop_callback_component_prop_bindings(
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> PropCallbackBindings {
    let component = ctx.nodes().get_node(component_id);
    let parameter_span = match component.kind() {
        AstKind::Function(function) => function.params.span,
        AstKind::ArrowFunctionExpression(function) => function.params.span,
        _ => return PropCallbackBindings::default(),
    };
    let mut bindings = PropCallbackBindings::default();
    for candidate in ctx.nodes().iter() {
        if !parameter_span.contains_inclusive(candidate.span()) {
            continue;
        }
        let AstKind::BindingIdentifier(identifier) = candidate.kind() else {
            continue;
        };
        let symbol_id = identifier.symbol_id();
        let declaration = ctx.symbol_declaration(symbol_id);
        let formal_parameter = if matches!(declaration.kind(), AstKind::FormalParameter(_)) {
            Some(declaration)
        } else {
            ctx.nodes()
                .ancestors(declaration.id())
                .take_while(|ancestor| ancestor.id() != component_id)
                .find(|ancestor| matches!(ancestor.kind(), AstKind::FormalParameter(_)))
        };
        let Some(formal_parameter) = formal_parameter else {
            continue;
        };
        let AstKind::FormalParameter(parameter) = formal_parameter.kind() else {
            continue;
        };
        match &parameter.pattern {
            BindingPattern::BindingIdentifier(binding) if binding.symbol_id() == symbol_id => {
                bindings.whole_props_symbols.insert(symbol_id);
            }
            pattern => {
                let property_name = binding_property_name_for_symbol(pattern, symbol_id)
                    .unwrap_or_else(|| identifier.name.to_string());
                bindings.names_by_symbol.insert(symbol_id, property_name);
            }
        }
    }
    bindings
}

fn prop_callback_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn prop_callback_is_const_declarator(declaration_id: NodeId, ctx: &LintContext<'_>) -> bool {
    matches!(
        ctx.nodes().parent_node(declaration_id).kind(),
        AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
    )
}

fn prop_callback_symbol_has_write(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .any(|reference| reference.is_write())
}

fn prop_callback_definition_source_symbols(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Vec<SymbolId> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let (source_span, initializer) = match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => {
            let Some(initializer) = &declarator.init else {
                return Vec::new();
            };
            (initializer.span(), Some(initializer))
        }
        AstKind::Function(function) => {
            let Some(body) = &function.body else {
                return Vec::new();
            };
            (body.span, None)
        }
        _ => return Vec::new(),
    };
    let mut source_symbols = Vec::new();
    for candidate in ctx.nodes().iter() {
        if !source_span.contains_inclusive(candidate.span())
            || initializer.is_some_and(|initializer| {
                prop_callback_is_deferred_initializer_callback_reference(candidate, initializer)
            })
        {
            continue;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            continue;
        };
        if let Some(source_symbol_id) = prop_callback_symbol_id(identifier, ctx) {
            source_symbols.push(source_symbol_id);
        }
    }
    source_symbols
}

fn prop_callback_is_deferred_initializer_callback_reference(
    candidate: &AstNode<'_>,
    initializer: &Expression<'_>,
) -> bool {
    let arguments = match initializer {
        Expression::CallExpression(call) => {
            if matches!(&call.callee, Expression::Identifier(identifier)
                if prop_callback_is_hook_name(identifier.name.as_str()))
            {
                return false;
            }
            &call.arguments
        }
        Expression::NewExpression(call) => &call.arguments,
        _ => return false,
    };
    arguments.iter().any(|argument| {
        argument.as_expression().is_some_and(|argument| {
            matches!(
                argument,
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            ) && argument.span().contains_inclusive(candidate.span())
        })
    })
}

fn prop_callback_is_hook_name(name: &str) -> bool {
    name.as_bytes().starts_with(b"use")
        && name
            .as_bytes()
            .get(3)
            .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
}

fn prop_callback_collect_upstream_symbols<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    upstream_symbols: &mut FxHashSet<SymbolId>,
) {
    if !visited_symbols.insert(symbol_id) {
        return;
    }
    upstream_symbols.insert(symbol_id);
    for source_symbol_id in prop_callback_definition_source_symbols(symbol_id, ctx) {
        prop_callback_collect_upstream_symbols(
            source_symbol_id,
            ctx,
            visited_symbols,
            upstream_symbols,
        );
    }
}

fn prop_callback_is_react_state_symbol(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    if !matches!(pattern.elements.len(), 1 | 2) {
        return false;
    }
    if !matches!(pattern.elements.first().and_then(Option::as_ref), Some(BindingPattern::BindingIdentifier(binding)) if binding.symbol_id() == symbol_id)
    {
        return false;
    }
    declarator.init.as_ref().is_some_and(|initializer| {
        prop_callback_expression_is_state_tuple(initializer, ctx, &mut FxHashSet::default())
    })
}

fn prop_callback_expression_is_state_tuple<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => {
            is_react_hook_call(call, &["useReducer", "useState"], ctx)
        }
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = prop_callback_symbol_id(identifier, ctx) else {
                return false;
            };
            if !visited_symbols.insert(symbol_id) || prop_callback_symbol_has_write(symbol_id, ctx)
            {
                return false;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            prop_callback_is_const_declarator(declaration.id(), ctx)
                && matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| {
                    prop_callback_expression_is_state_tuple(initializer, ctx, visited_symbols)
                }))
        }
        _ => false,
    }
}

fn prop_callback_state_setter_symbol(
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let declaration = ctx.symbol_declaration(state_symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter) =
        pattern.elements.get(1).and_then(Option::as_ref)?
    else {
        return None;
    };
    Some(setter.symbol_id())
}

fn prop_callback_is_custom_hook_state_symbol<'a>(
    symbol_id: SymbolId,
    component_id: NodeId,
    prop_bindings: &PropCallbackBindings,
    ctx: &LintContext<'a>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    if prop_callback_nearest_function_id(declaration.id(), ctx) != Some(component_id) {
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
    let Some(hook_name) = prop_callback_callee_name(&call.callee) else {
        return false;
    };
    if !hook_name.as_bytes().starts_with(b"use")
        || hook_name
            .as_bytes()
            .get(3)
            .is_none_or(|character| !character.is_ascii_uppercase() && !character.is_ascii_digit())
        || PROP_CALLBACK_BUILTIN_HOOK_NAMES.contains(&hook_name)
        || PROP_CALLBACK_NON_STATE_CUSTOM_HOOK_NAMES.contains(&hook_name)
        || prop_callback_is_local_non_state_comparison_memoizer(hook_name, call, ctx)
    {
        return false;
    }
    call.arguments.iter().any(|argument| {
        prop_callback_argument_expression(argument).is_some_and(|expression| {
            prop_callback_expression_has_any_prop_source(expression, prop_bindings, ctx)
        })
    })
}

fn prop_callback_argument_expression<'a>(argument: &'a Argument<'a>) -> Option<&'a Expression<'a>> {
    match argument {
        Argument::SpreadElement(spread) => Some(&spread.argument),
        argument => argument.as_expression(),
    }
}

fn prop_callback_is_local_non_state_comparison_memoizer<'a>(
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
    let Some(function_id) = exact_local_function_id_including_generators(
        &call.callee,
        ctx,
        &mut Vec::new(),
        &mut LocalFunctionResolutionCache::default(),
    ) else {
        return false;
    };
    let function_span = ctx.nodes().get_node(function_id).span();
    !ctx.nodes().iter().any(|candidate| {
        candidate.id() != function_id
            && function_span.contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::CallExpression(inner_call)
                if is_react_hook_call(inner_call, &["useReducer", "useState"], ctx))
    })
}

fn prop_callback_expression_has_any_prop_source<'a>(
    expression: &Expression<'a>,
    prop_bindings: &PropCallbackBindings,
    ctx: &LintContext<'a>,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        if !span.contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        prop_callback_symbol_id(identifier, ctx)
            .is_some_and(|symbol_id| prop_bindings.is_prop_symbol(symbol_id))
    })
}

fn prop_callback_expression_has_symbol_source<'a>(
    expression: &Expression<'a>,
    target_symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let span = expression.span();
    ctx.nodes().iter().any(|candidate| {
        if !span.contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        let Some(symbol_id) = prop_callback_symbol_id(identifier, ctx) else {
            return false;
        };
        if symbol_id == target_symbol_id {
            return true;
        }
        if !visited_symbols.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        if matches!(declaration.kind(), AstKind::Function(_)) {
            return false;
        }
        if matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
            if declarator.init.as_ref().is_some_and(prop_callback_expression_resolves_to_function))
        {
            return false;
        }
        prop_callback_symbol_has_upstream_source(symbol_id, target_symbol_id, ctx, visited_symbols)
    })
}

fn prop_callback_symbol_has_upstream_source(
    symbol_id: SymbolId,
    target_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    prop_callback_definition_source_symbols(symbol_id, ctx)
        .into_iter()
        .any(|source_symbol_id| {
            if source_symbol_id == target_symbol_id {
                return true;
            }
            visited_symbols.insert(source_symbol_id)
                && prop_callback_symbol_has_upstream_source(
                    source_symbol_id,
                    target_symbol_id,
                    ctx,
                    visited_symbols,
                )
        })
}

fn prop_callback_expression_resolves_to_function(expression: &Expression<'_>) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return true;
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    prop_callback_callee_name(&call.callee) == Some("useCallback")
        && call.arguments.first().is_some_and(|argument| {
            argument.as_expression().is_some_and(|argument| {
                matches!(
                    argument.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
            })
        })
}

fn prop_callback_has_previous_value_dependency(
    dependencies: &oxc_ast::ast::ArrayExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    dependencies
        .elements
        .iter()
        .filter_map(ArrayExpressionElement::as_expression)
        .any(|dependency| {
            let Expression::Identifier(identifier) = dependency else {
                return false;
            };
            let Some(symbol_id) = prop_callback_symbol_id(identifier, ctx) else {
                return false;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return false;
            };
            let Some(Expression::CallExpression(call)) = declarator.init.as_ref() else {
                return false;
            };
            prop_callback_callee_name(&call.callee)
                .is_some_and(|name| name.to_ascii_lowercase().starts_with("useprev"))
        })
}

fn prop_callback_has_ref_latch(callback_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let mut read_names = FxHashSet::default();
    let mut written_names = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if prop_callback_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            continue;
        }
        match candidate.kind() {
            AstKind::IfStatement(statement) => {
                let test_span = statement.test.span();
                for test_node in ctx.nodes().iter() {
                    if !test_span.contains_inclusive(test_node.span()) {
                        continue;
                    }
                    if let AstKind::StaticMemberExpression(member) = test_node.kind()
                        && member.property.name == "current"
                        && let Expression::Identifier(identifier) =
                            member.object.get_inner_expression()
                    {
                        read_names.insert(identifier.name.to_string());
                    }
                }
            }
            AstKind::AssignmentExpression(assignment) => {
                if let Some(member) = assignment.left.as_member_expression()
                    && member.static_property_name().as_deref() == Some("current")
                    && let Expression::Identifier(identifier) =
                        member.object().get_inner_expression()
                {
                    written_names.insert(identifier.name.to_string());
                }
            }
            _ => {}
        }
    }
    !read_names.is_disjoint(&written_names)
}

fn prop_callback_resolve_prop_names<'a>(
    expression: &Expression<'a>,
    component_id: NodeId,
    prop_bindings: &PropCallbackBindings,
    snapshot_offset: Option<u32>,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Vec<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = prop_callback_symbol_id(identifier, ctx) else {
                return Vec::new();
            };
            if let Some(name) = prop_bindings.names_by_symbol.get(&symbol_id) {
                return vec![name.clone()];
            }
            if !visited_symbols.insert(symbol_id) {
                return Vec::new();
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return Vec::new();
            };
            if !prop_callback_is_const_declarator(declaration.id(), ctx)
                || prop_callback_symbol_has_write(symbol_id, ctx)
            {
                return Vec::new();
            }
            let Some(initializer) = &declarator.init else {
                return Vec::new();
            };
            let nested_snapshot_offset = if initializer
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| member.static_property_name() == Some("current"))
            {
                Some(initializer.span().start)
            } else {
                snapshot_offset
            };
            if let Expression::CallExpression(wrapper_call) = initializer.get_inner_expression()
                && (is_react_hook_call(wrapper_call, &["useCallback"], ctx)
                    || is_react_hook_call(wrapper_call, &["useEffectEvent"], ctx))
                && let Some(argument) = wrapper_call
                    .arguments
                    .first()
                    .and_then(Argument::as_expression)
            {
                if matches!(
                    argument.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) && is_react_hook_call(wrapper_call, &["useEffectEvent"], ctx)
                {
                    let Some(function_id) =
                        exact_local_callback_function_id(argument, ctx, &mut Vec::new())
                    else {
                        return Vec::new();
                    };
                    if prop_callback_function_is_async_or_generator(function_id, ctx) {
                        return Vec::new();
                    }
                    let mut names = Vec::new();
                    for candidate in ctx.nodes().iter() {
                        if prop_callback_nearest_function_id(candidate.id(), ctx)
                            != Some(function_id)
                        {
                            continue;
                        }
                        if let AstKind::CallExpression(call) = candidate.kind() {
                            prop_callback_extend_names(
                                &mut names,
                                prop_callback_resolve_prop_names(
                                    &call.callee,
                                    component_id,
                                    prop_bindings,
                                    nested_snapshot_offset,
                                    write_analysis,
                                    ctx,
                                    visited_symbols,
                                ),
                            );
                        }
                    }
                    return names;
                }
                return prop_callback_resolve_prop_names(
                    argument,
                    component_id,
                    prop_bindings,
                    nested_snapshot_offset,
                    write_analysis,
                    ctx,
                    visited_symbols,
                );
            }
            prop_callback_resolve_prop_names(
                initializer,
                component_id,
                prop_bindings,
                nested_snapshot_offset,
                write_analysis,
                ctx,
                visited_symbols,
            )
        }
        Expression::StaticMemberExpression(member) => {
            if let Expression::Identifier(receiver) = member.object.get_inner_expression()
                && let Some(receiver_symbol_id) = prop_callback_symbol_id(receiver, ctx)
            {
                if prop_bindings
                    .whole_props_symbols
                    .contains(&receiver_symbol_id)
                {
                    return vec![member.property.name.to_string()];
                }
                if member.property.name == "current" {
                    return prop_callback_resolve_ref_current_names(
                        receiver_symbol_id,
                        component_id,
                        prop_bindings,
                        snapshot_offset,
                        write_analysis,
                        ctx,
                        visited_symbols,
                    );
                }
                return prop_callback_resolve_object_property_names(
                    receiver_symbol_id,
                    member.property.name.as_str(),
                    component_id,
                    prop_bindings,
                    snapshot_offset,
                    write_analysis,
                    ctx,
                    visited_symbols,
                );
            }
            Vec::new()
        }
        Expression::ComputedMemberExpression(member) => {
            let Some(property_name) = member.static_property_name() else {
                return Vec::new();
            };
            if let Expression::Identifier(receiver) = member.object.get_inner_expression()
                && let Some(receiver_symbol_id) = prop_callback_symbol_id(receiver, ctx)
            {
                if prop_bindings
                    .whole_props_symbols
                    .contains(&receiver_symbol_id)
                {
                    return vec![property_name.to_string()];
                }
                if property_name == "current" {
                    return prop_callback_resolve_ref_current_names(
                        receiver_symbol_id,
                        component_id,
                        prop_bindings,
                        snapshot_offset,
                        write_analysis,
                        ctx,
                        visited_symbols,
                    );
                }
                return prop_callback_resolve_object_property_names(
                    receiver_symbol_id,
                    property_name.as_ref(),
                    component_id,
                    prop_bindings,
                    snapshot_offset,
                    write_analysis,
                    ctx,
                    visited_symbols,
                );
            }
            Vec::new()
        }
        Expression::ConditionalExpression(conditional) => {
            let mut left = prop_callback_resolve_prop_names(
                &conditional.consequent,
                component_id,
                prop_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            let right = prop_callback_resolve_prop_names(
                &conditional.alternate,
                component_id,
                prop_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            if left.is_empty() || right.is_empty() {
                return Vec::new();
            }
            prop_callback_extend_names(&mut left, right);
            left
        }
        Expression::LogicalExpression(logical) => {
            let mut left = prop_callback_resolve_prop_names(
                &logical.left,
                component_id,
                prop_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            let right = prop_callback_resolve_prop_names(
                &logical.right,
                component_id,
                prop_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            if left.is_empty() || right.is_empty() {
                return Vec::new();
            }
            prop_callback_extend_names(&mut left, right);
            left
        }
        _ => Vec::new(),
    }
}

fn prop_callback_extend_names(names: &mut Vec<String>, additions: Vec<String>) {
    for name in additions {
        if !names.contains(&name) {
            names.push(name);
        }
    }
}

fn prop_callback_resolve_object_property_names<'a>(
    receiver_symbol_id: SymbolId,
    property_name: &str,
    component_id: NodeId,
    prop_bindings: &PropCallbackBindings,
    snapshot_offset: Option<u32>,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Vec<String> {
    if !visited_symbols.insert(receiver_symbol_id) {
        return Vec::new();
    }
    let declaration = ctx.symbol_declaration(receiver_symbol_id);
    if !prop_callback_is_const_declarator(declaration.id(), ctx)
        || prop_callback_symbol_has_write(receiver_symbol_id, ctx)
    {
        return Vec::new();
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Vec::new();
    };
    let Some(Expression::ObjectExpression(object)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return Vec::new();
    };
    for property in &object.properties {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        if property.key.static_name().as_deref() != Some(property_name) {
            continue;
        }
        return prop_callback_resolve_prop_names(
            &property.value,
            component_id,
            prop_bindings,
            snapshot_offset,
            write_analysis,
            ctx,
            visited_symbols,
        );
    }
    Vec::new()
}

fn prop_callback_resolve_ref_current_names<'a>(
    ref_symbol_id: SymbolId,
    component_id: NodeId,
    prop_bindings: &PropCallbackBindings,
    snapshot_offset: Option<u32>,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Vec<String> {
    if !visited_symbols.insert(ref_symbol_id) {
        return Vec::new();
    }
    let declaration = ctx.symbol_declaration(ref_symbol_id);
    if !prop_callback_is_const_declarator(declaration.id(), ctx)
        || prop_callback_symbol_has_write(ref_symbol_id, ctx)
    {
        return Vec::new();
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return Vec::new();
    };
    let Some(initializer) = &declarator.init else {
        return Vec::new();
    };
    if let Expression::Identifier(alias) = initializer.get_inner_expression()
        && let Some(alias_symbol_id) = prop_callback_symbol_id(alias, ctx)
    {
        return prop_callback_resolve_ref_current_names(
            alias_symbol_id,
            component_id,
            prop_bindings,
            snapshot_offset,
            write_analysis,
            ctx,
            visited_symbols,
        );
    }
    let Expression::CallExpression(ref_call) = initializer.get_inner_expression() else {
        return Vec::new();
    };
    if !is_react_hook_call(ref_call, &["useRef"], ctx) {
        return Vec::new();
    }
    let Some(initial_callback) = ref_call.arguments.first().and_then(Argument::as_expression)
    else {
        return Vec::new();
    };
    let mut names = prop_callback_resolve_prop_names(
        initial_callback,
        component_id,
        prop_bindings,
        snapshot_offset,
        write_analysis,
        ctx,
        visited_symbols,
    );
    if names.is_empty() {
        return names;
    }
    let snapshot_node = snapshot_offset.and_then(|snapshot_offset| {
        ctx.nodes()
            .iter()
            .filter(|candidate| candidate.span().start == snapshot_offset)
            .max_by_key(|candidate| candidate.span().end - candidate.span().start)
    });
    if snapshot_offset.is_some() && snapshot_node.is_none() {
        return Vec::new();
    }
    let Some(alias_symbol_ids) =
        prop_callback_ref_alias_symbol_ids(ref_symbol_id, snapshot_node, write_analysis, ctx)
    else {
        return Vec::new();
    };
    for alias_symbol_id in alias_symbol_ids {
        for reference in ctx.scoping().get_resolved_references(alias_symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let root = transparent_expression_root(reference_node, ctx);
            if snapshot_node.is_some_and(|snapshot_node| {
                !can_node_execute_before(reference_node, snapshot_node, write_analysis, ctx)
            }) {
                continue;
            }
            if prop_callback_const_ref_alias_target_symbol(reference_node, ctx).is_some() {
                continue;
            }
            let Some(member) = static_property_write_member(reference_node, ctx) else {
                let parent = ctx.nodes().parent_node(root.id());
                if prop_callback_is_known_hook_dependency(reference_node, ctx)
                    || matches!(
                        parent.kind(),
                        AstKind::StaticMemberExpression(member)
                            if member.object.span() == root.span() && member.property.name == "current"
                    )
                    || matches!(
                        parent.kind(),
                        AstKind::ComputedMemberExpression(member)
                            if member.object.span() == root.span()
                                && member.static_property_name().as_deref() == Some("current")
                    )
                {
                    continue;
                }
                return Vec::new();
            };
            if resolved_static_member_property_name(member, ctx).as_deref() != Some("current") {
                return Vec::new();
            }
            let member_root = transparent_expression_root(member, ctx);
            let assignment = ctx.nodes().parent_node(member_root.id());
            let AstKind::AssignmentExpression(assignment_expression) = assignment.kind() else {
                return Vec::new();
            };
            if assignment_expression.left.span() != member_root.span()
                || assignment_expression.operator
                    != oxc_syntax::operator::AssignmentOperator::Assign
            {
                return Vec::new();
            }
            let assigned_names = prop_callback_resolve_prop_names(
                &assignment_expression.right,
                component_id,
                prop_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut visited_symbols.clone(),
            );
            if assigned_names.is_empty() {
                return Vec::new();
            }
            prop_callback_extend_names(&mut names, assigned_names);
        }
    }
    names
}

fn prop_callback_ref_alias_symbol_ids<'a>(
    root_symbol_id: SymbolId,
    snapshot_node: Option<&AstNode<'a>>,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> Option<Vec<SymbolId>> {
    let mut symbol_ids = vec![root_symbol_id];
    let mut seen_symbol_ids = FxHashSet::from_iter([root_symbol_id]);
    let mut symbol_index = 0;
    while symbol_index < symbol_ids.len() {
        let symbol_id = symbol_ids[symbol_index];
        symbol_index += 1;
        for reference in ctx.scoping().get_resolved_references(symbol_id) {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if snapshot_node.is_some_and(|snapshot_node| {
                !can_node_execute_before(reference_node, snapshot_node, write_analysis, ctx)
            }) {
                continue;
            }
            let Some(alias_symbol_id) =
                prop_callback_const_ref_alias_target_symbol(reference_node, ctx)
            else {
                continue;
            };
            if prop_callback_symbol_has_write(alias_symbol_id, ctx) {
                return None;
            }
            if seen_symbol_ids.insert(alias_symbol_id) {
                symbol_ids.push(alias_symbol_id);
            }
        }
    }
    Some(symbol_ids)
}

fn prop_callback_const_ref_alias_target_symbol<'a>(
    source_identifier: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let source_root = transparent_expression_root(source_identifier, ctx);
    let declaration = ctx.nodes().parent_node(source_root.id());
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if !declarator
        .init
        .as_ref()
        .is_some_and(|initializer| initializer.span() == source_root.span())
        || !prop_callback_is_const_declarator(declaration.id(), ctx)
    {
        return None;
    }
    declarator
        .id
        .get_binding_identifier()
        .map(|binding| binding.symbol_id())
}

fn prop_callback_is_known_hook_dependency<'a>(
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let dependency_root = transparent_expression_root(reference_node, ctx);
    let dependency_array = ctx.nodes().parent_node(dependency_root.id());
    let AstKind::ArrayExpression(_) = dependency_array.kind() else {
        return false;
    };
    let hook_node = ctx.nodes().parent_node(dependency_array.id());
    matches!(hook_node.kind(), AstKind::CallExpression(call)
        if call.arguments.get(1).is_some_and(|argument| argument.span() == dependency_array.span())
            && prop_callback_is_known_dependency_hook_call(call, ctx))
}

fn prop_callback_is_known_dependency_hook_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    const HOOK_NAMES: [&str; 4] = ["useEffect", "useLayoutEffect", "useMemo", "useCallback"];
    if HOOK_NAMES
        .iter()
        .any(|hook_name| is_react_api_call(call, hook_name, ctx))
    {
        return true;
    }
    matches!(&call.callee, Expression::Identifier(identifier)
        if HOOK_NAMES.contains(&identifier.name.as_str())
            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn prop_callback_function_is_async_or_generator(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async || function.generator,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn prop_callback_cleanup_names<'a>(
    callback_id: NodeId,
    component_id: NodeId,
    prop_bindings: &PropCallbackBindings,
    snapshot_offset: Option<u32>,
    write_analysis: &PossibleStaticPropertyWriteAnalysis,
    ctx: &LintContext<'a>,
) -> FxHashSet<String> {
    let mut cleanup_function_ids = FxHashSet::default();
    if let AstKind::ArrowFunctionExpression(callback) = ctx.nodes().get_node(callback_id).kind()
        && let Some(returned_expression) = callback.get_expression()
    {
        prop_callback_collect_cleanup_function_ids(
            returned_expression,
            ctx,
            &mut cleanup_function_ids,
        );
    }
    for candidate in ctx.nodes().iter() {
        if prop_callback_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            continue;
        }
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        let Some(returned_expression) = &return_statement.argument else {
            continue;
        };
        prop_callback_collect_cleanup_function_ids(
            returned_expression,
            ctx,
            &mut cleanup_function_ids,
        );
    }
    let mut names = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if !prop_callback_nearest_function_id(candidate.id(), ctx)
            .is_some_and(|function_id| cleanup_function_ids.contains(&function_id))
        {
            continue;
        }
        if let AstKind::CallExpression(call) = candidate.kind() {
            names.extend(prop_callback_resolve_prop_names(
                &call.callee,
                component_id,
                prop_bindings,
                snapshot_offset,
                write_analysis,
                ctx,
                &mut FxHashSet::default(),
            ));
        }
    }
    names
}

fn prop_callback_collect_cleanup_function_ids<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    function_ids: &mut FxHashSet<NodeId>,
) {
    match expression.get_inner_expression() {
        Expression::ConditionalExpression(conditional) => {
            prop_callback_collect_cleanup_function_ids(&conditional.consequent, ctx, function_ids);
            prop_callback_collect_cleanup_function_ids(&conditional.alternate, ctx, function_ids);
        }
        Expression::SequenceExpression(sequence) => {
            if let Some(expression) = sequence.expressions.last() {
                prop_callback_collect_cleanup_function_ids(expression, ctx, function_ids);
            }
        }
        expression => {
            if let Some(function_id) = exact_local_function_id_including_generators(
                expression,
                ctx,
                &mut Vec::new(),
                &mut LocalFunctionResolutionCache::default(),
            ) {
                function_ids.insert(function_id);
            }
        }
    }
}

fn prop_callback_has_matching_local_state_write(
    callback_id: NodeId,
    callback_call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(callback_payload) = callback_call
        .arguments
        .first()
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    ctx.nodes().iter().any(|candidate| {
        if prop_callback_nearest_function_id(candidate.id(), ctx) != Some(callback_id) {
            return false;
        }
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        let Expression::Identifier(setter) = call.callee.get_inner_expression() else {
            return false;
        };
        let Some(setter_symbol_id) = prop_callback_symbol_id(setter, ctx) else {
            return false;
        };
        if !prop_callback_is_state_setter_symbol(setter_symbol_id, ctx) {
            return false;
        }
        let Some(written_value) = call.arguments.first().and_then(Argument::as_expression) else {
            return false;
        };
        prop_callback_equivalent_payload(callback_payload, written_value, ctx)
    })
}

fn prop_callback_equivalent_payload(
    left: &Expression<'_>,
    right: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match (left.get_inner_expression(), right.get_inner_expression()) {
        (Expression::Identifier(left), Expression::Identifier(right)) => {
            prop_callback_symbol_id(left, ctx).is_some()
                && prop_callback_symbol_id(left, ctx) == prop_callback_symbol_id(right, ctx)
        }
        (Expression::StringLiteral(left), Expression::StringLiteral(right)) => {
            left.value == right.value
        }
        (Expression::NumericLiteral(left), Expression::NumericLiteral(right)) => {
            left.value == right.value
        }
        (Expression::BooleanLiteral(left), Expression::BooleanLiteral(right)) => {
            left.value == right.value
        }
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => true,
        _ => false,
    }
}

fn prop_callback_is_state_setter_symbol(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    matches!(pattern.elements.get(1).and_then(Option::as_ref), Some(BindingPattern::BindingIdentifier(binding)) if binding.symbol_id() == symbol_id)
        && matches!(declarator.init.as_ref().map(Expression::get_inner_expression), Some(Expression::CallExpression(call)) if is_react_hook_call(call, &["useReducer", "useState"], ctx))
}

fn prop_callback_state_is_externally_driven<'a>(
    setter_symbol_id: SymbolId,
    component_id: NodeId,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    let mut has_deferred_writer = false;
    for reference in ctx.scoping().get_resolved_references(setter_symbol_id) {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let root = transparent_expression_root(reference_node, ctx);
        if prop_callback_node_is_deferred_position(root, ctx) {
            has_deferred_writer = true;
            continue;
        }
        let parent = ctx.nodes().parent_node(root.id());
        let AstKind::CallExpression(call) = parent.kind() else {
            continue;
        };
        if call.callee.span() != root.span()
            || !prop_callback_writer_is_deferred(
                parent.id(),
                component_id,
                ctx,
                visited_function_ids,
            )
        {
            return false;
        }
        has_deferred_writer = true;
    }
    has_deferred_writer
}

fn prop_callback_writer_is_deferred<'a>(
    node_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == component_id {
            break;
        }
        if !matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        if prop_callback_node_is_deferred_position(ancestor, ctx) {
            return true;
        }
        let Some(function_symbol_id) = prop_callback_function_binding_symbol(ancestor, ctx) else {
            return false;
        };
        if !visited_function_ids.insert(ancestor.id()) {
            return true;
        }
        let mut has_reference = false;
        for reference in ctx.scoping().get_resolved_references(function_symbol_id) {
            has_reference = true;
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            if prop_callback_node_is_deferred_position(reference_root, ctx) {
                continue;
            }
            let parent = ctx.nodes().parent_node(reference_root.id());
            let AstKind::CallExpression(call) = parent.kind() else {
                return false;
            };
            if call.callee.span() != reference_root.span()
                || !prop_callback_writer_is_deferred(
                    parent.id(),
                    component_id,
                    ctx,
                    visited_function_ids,
                )
            {
                return false;
            }
        }
        return has_reference;
    }
    false
}

fn prop_callback_function_binding_symbol<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    if let AstKind::Function(function) = function_node.kind()
        && let Some(identifier) = &function.id
    {
        return Some(identifier.symbol_id());
    }
    let mut root = transparent_expression_root(function_node, ctx);
    loop {
        let parent = ctx.nodes().parent_node(root.id());
        if matches!(parent.kind(), AstKind::CallExpression(_)) {
            root = transparent_expression_root(parent, ctx);
            continue;
        }
        let AstKind::VariableDeclarator(declarator) = parent.kind() else {
            return None;
        };
        return declarator
            .id
            .get_binding_identifier()
            .map(|identifier| identifier.symbol_id());
    }
}

fn prop_callback_node_is_deferred_position(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    match parent.kind() {
        AstKind::CallExpression(call)
            if call
                .arguments
                .iter()
                .any(|argument| argument.span() == node.span()) =>
        {
            prop_callback_callee_name(&call.callee)
                .is_some_and(|name| PROP_CALLBACK_DEFERRING_CALLEE_NAMES.contains(&name))
        }
        AstKind::NewExpression(call)
            if call
                .arguments
                .iter()
                .any(|argument| argument.span() == node.span()) =>
        {
            prop_callback_callee_name(&call.callee)
                .is_some_and(|name| name == "Promise" || name.ends_with("Observer"))
        }
        AstKind::AssignmentExpression(assignment) if assignment.right.span() == node.span() => {
            assignment
                .left
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                .is_some_and(|name| name.starts_with("on"))
        }
        _ => false,
    }
}

fn prop_callback_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression
            .as_member_expression()
            .and_then(|member| member.static_property_name()),
    }
}
