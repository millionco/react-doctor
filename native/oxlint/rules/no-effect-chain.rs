use oxc_ast::ast::{
    Argument, ArrayExpressionElement, BindingPattern, FunctionBody, FunctionType, Statement,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EFFECT_CHAIN_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const EFFECT_CHAIN_EXTERNAL_DIRECT_CALL_NAMES: [&str; 10] = [
    "fetch",
    "got",
    "ky",
    "ofetch",
    "queueMicrotask",
    "requestAnimationFrame",
    "requestIdleCallback",
    "setInterval",
    "setTimeout",
    "wretch",
];
const EFFECT_CHAIN_EXTERNAL_CONSTRUCTOR_NAMES: [&str; 4] = [
    "IntersectionObserver",
    "MutationObserver",
    "PerformanceObserver",
    "ResizeObserver",
];
const EFFECT_CHAIN_HTTP_MODULE_SOURCES: [&str; 8] = [
    "axios",
    "cross-fetch",
    "got",
    "ky",
    "node-fetch",
    "ofetch",
    "undici",
    "wretch",
];
const EFFECT_CHAIN_FETCH_MODULE_SOURCES: [&str; 3] = ["cross-fetch", "node-fetch", "undici"];
const EFFECT_CHAIN_TIMER_MODULE_SOURCES: [&str; 4] = [
    "node:timers",
    "node:timers/promises",
    "timers",
    "timers/promises",
];
const EFFECT_CHAIN_DEFAULT_DIRECT_MODULE_SOURCES: [&str; 5] =
    ["cross-fetch", "got", "ky", "node-fetch", "wretch"];
const EFFECT_CHAIN_HTTP_METHOD_NAMES: [&str; 9] = [
    "delete", "fetch", "get", "head", "options", "patch", "post", "put", "request",
];
const EFFECT_CHAIN_DOM_METHOD_NAMES: [&str; 19] = [
    "blur",
    "canPlayType",
    "clearRect",
    "drawImage",
    "fillRect",
    "focus",
    "getBoundingClientRect",
    "getClientRects",
    "measure",
    "measureInWindow",
    "measureLayout",
    "scroll",
    "scrollBy",
    "scrollIntoView",
    "scrollTo",
    "select",
    "setRangeText",
    "setSelectionRange",
    "strokeRect",
];
const EFFECT_CHAIN_RESOURCE_METHOD_NAMES: [&str; 15] = [
    "addEventListener",
    "addListener",
    "close",
    "connect",
    "disconnect",
    "fetch",
    "listen",
    "on",
    "open",
    "patch",
    "post",
    "put",
    "sub",
    "subscribe",
    "watch",
];

#[derive(Debug, Default, Clone)]
pub struct NoEffectChain;

declare_oxc_lint!(
    /// Warns when one effect writes state that triggers another effect.
    NoEffectChain,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when effects are chained through state updates.",
);

#[derive(Clone)]
struct EffectChainStateBinding {
    state_symbol_id: SymbolId,
    setter_symbol_id: SymbolId,
    setter_name: String,
    state_name: String,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum EffectChainStaticValue {
    Null,
    Undefined,
    Boolean(bool),
    Number(u64),
    String(String),
}

impl EffectChainStaticValue {
    fn number(value: f64) -> Self {
        if value.is_nan() {
            return Self::Number(f64::NAN.to_bits());
        }
        if value == 0.0 {
            return Self::Number(0.0f64.to_bits());
        }
        Self::Number(value.to_bits())
    }

    fn is_truthy(&self) -> bool {
        match self {
            Self::Null | Self::Undefined => false,
            Self::Boolean(value) => *value,
            Self::Number(bits) => {
                let value = f64::from_bits(*bits);
                value != 0.0 && !value.is_nan()
            }
            Self::String(value) => !value.is_empty(),
        }
    }

    fn is_nullish(&self) -> bool {
        matches!(self, Self::Null | Self::Undefined)
    }

    fn is_strictly_equal_to(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Number(left), Self::Number(right)) => {
                let left = f64::from_bits(*left);
                let right = f64::from_bits(*right);
                left == right
            }
            _ => self == other,
        }
    }
}

#[derive(Clone)]
struct EffectChainWrite {
    state_name: String,
    values: FxHashSet<EffectChainStaticValue>,
    has_unknown_value: bool,
    call_ids: Vec<NodeId>,
}

struct EffectChainInfo {
    call_id: NodeId,
    callback_id: NodeId,
    dependency_state_symbol_ids: FxHashSet<SymbolId>,
    writes_by_state_symbol_id: FxHashMap<SymbolId, EffectChainWrite>,
    written_state_symbol_ids: Vec<SymbolId>,
    analysis_function_ids: FxHashSet<NodeId>,
    is_external_sync: bool,
    externally_synchronized_state_symbol_ids: FxHashSet<SymbolId>,
}

impl Rule for NoEffectChain {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let node_index = build_local_callback_nearest_function_node_index(ctx);
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration
                        && function.id.as_ref().is_some_and(|identifier| {
                            effect_chain_is_component_name(identifier.name.as_str())
                        }) =>
                {
                    if let Some(body) = &function.body {
                        effect_chain_check_component(
                            body,
                            function.node_id.get(),
                            &node_index,
                            ctx,
                        );
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !effect_chain_is_component_name(identifier.name.as_str()) {
                        continue;
                    }
                    match &declarator.init {
                        Some(Expression::ArrowFunctionExpression(function)) => {
                            if let Some(body) = function.body.as_function_body() {
                                effect_chain_check_component(
                                    body,
                                    function.node_id.get(),
                                    &node_index,
                                    ctx,
                                );
                            }
                        }
                        Some(Expression::FunctionExpression(function)) => {
                            if let Some(body) = &function.body {
                                effect_chain_check_component(
                                    body,
                                    function.node_id.get(),
                                    &node_index,
                                    ctx,
                                );
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

fn effect_chain_check_component<'a>(
    body: &'a FunctionBody<'a>,
    component_node_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) {
    let state_bindings = effect_chain_collect_state_bindings(body, ctx);
    if state_bindings.is_empty() {
        return;
    }
    let effect_call_ids = effect_chain_top_level_effect_call_ids(body, component_node_id, ctx);
    if effect_call_ids.len() < 2 {
        return;
    }
    let state_symbol_ids = state_bindings
        .iter()
        .map(|binding| binding.state_symbol_id)
        .collect::<FxHashSet<_>>();
    let state_by_setter_symbol_id = state_bindings
        .iter()
        .map(|binding| (binding.setter_symbol_id, binding.clone()))
        .collect::<FxHashMap<_, _>>();
    let state_setter_names = state_bindings
        .iter()
        .map(|binding| binding.setter_name.as_str())
        .collect::<FxHashSet<_>>();
    let storage_setter_names = effect_chain_storage_setter_names(body);
    let mut effect_infos = Vec::new();
    for effect_call_id in effect_call_ids {
        let effect_node = ctx.nodes().get_node(effect_call_id);
        let AstKind::CallExpression(effect_call) = effect_node.kind() else {
            continue;
        };
        let Some(callback_expression) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            continue;
        };
        let Some(callback_id) =
            effect_chain_resolve_function_id(callback_expression, ctx, &mut FxHashSet::default())
        else {
            continue;
        };
        if effect_chain_function_is_async_only(callback_id, ctx) {
            continue;
        }
        let analysis_function_ids =
            effect_chain_synchronously_invoked_function_ids(callback_id, node_index, ctx);
        let state_write_function_ids = effect_chain_state_write_function_ids(
            callback_id,
            &analysis_function_ids,
            &state_by_setter_symbol_id,
            node_index,
            ctx,
        );
        let (writes_by_state_symbol_id, written_state_symbol_ids) =
            effect_chain_collect_state_writes(
                callback_id,
                &state_write_function_ids,
                &state_by_setter_symbol_id,
                node_index,
                ctx,
            );
        let external_sync_anchor_ids = effect_chain_external_sync_anchor_ids(
            callback_id,
            &analysis_function_ids,
            &state_by_setter_symbol_id,
            writes_by_state_symbol_id.is_empty(),
            node_index,
            ctx,
        );
        let does_call_storage_setter = effect_chain_calls_storage_setter(
            &analysis_function_ids,
            &storage_setter_names,
            node_index,
            ctx,
        );
        let does_call_opaque_setter = writes_by_state_symbol_id.is_empty()
            && effect_chain_calls_opaque_setter(
                &analysis_function_ids,
                &state_setter_names,
                node_index,
                ctx,
            );
        let externally_synchronized_state_symbol_ids = if does_call_storage_setter {
            writes_by_state_symbol_id.keys().copied().collect()
        } else {
            effect_chain_externally_synchronized_state_symbol_ids(
                &writes_by_state_symbol_id,
                &external_sync_anchor_ids,
                ctx,
            )
        };
        effect_infos.push(EffectChainInfo {
            call_id: effect_call_id,
            callback_id,
            dependency_state_symbol_ids: effect_chain_dependency_state_symbol_ids(
                effect_call,
                &state_symbol_ids,
                ctx,
            ),
            writes_by_state_symbol_id,
            written_state_symbol_ids,
            analysis_function_ids,
            is_external_sync: !external_sync_anchor_ids.is_empty()
                || does_call_storage_setter
                || does_call_opaque_setter,
            externally_synchronized_state_symbol_ids,
        });
    }
    if effect_infos.len() < 2 {
        return;
    }
    let mut reported_reader_ids = FxHashSet::default();
    for writer in &effect_infos {
        if writer.writes_by_state_symbol_id.is_empty()
            || writer.is_external_sync && writer.externally_synchronized_state_symbol_ids.is_empty()
        {
            continue;
        }
        for reader in &effect_infos {
            if reader.call_id == writer.call_id
                || reader.is_external_sync
                || reader.dependency_state_symbol_ids.is_empty()
                || reported_reader_ids.contains(&reader.call_id)
            {
                continue;
            }
            let chained_write =
                writer
                    .written_state_symbol_ids
                    .iter()
                    .find_map(|state_symbol_id| {
                        let write = writer.writes_by_state_symbol_id.get(state_symbol_id)?;
                        if writer
                            .externally_synchronized_state_symbol_ids
                            .contains(state_symbol_id)
                        {
                            return None;
                        }
                        if !reader.dependency_state_symbol_ids.contains(state_symbol_id) {
                            return None;
                        }
                        if !effect_chain_state_write_can_reach_reader_work(
                            write,
                            *state_symbol_id,
                            reader,
                            node_index,
                            ctx,
                        ) {
                            return None;
                        }
                        Some(write)
                    });
            let Some(chained_write) = chained_write else {
                continue;
            };
            reported_reader_ids.insert(reader.call_id);
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your screen redraws several times from a single action because one useEffect changes \"{}\", which sets off this one.",
                    chained_write.state_name
                ))
                .with_label(ctx.nodes().get_node(reader.call_id).span()),
            );
        }
    }
}

fn effect_chain_collect_state_bindings<'a>(
    body: &'a FunctionBody<'a>,
    ctx: &LintContext<'a>,
) -> Vec<EffectChainStateBinding> {
    let mut bindings = Vec::new();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(state)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(setter)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                continue;
            };
            if !effect_chain_is_setter_name(setter.name.as_str()) {
                continue;
            }
            let Some(Expression::CallExpression(use_state_call)) = &declarator.init else {
                continue;
            };
            if !is_react_hook_call(use_state_call, &["useState"], ctx) {
                continue;
            }
            bindings.push(EffectChainStateBinding {
                state_symbol_id: state.symbol_id(),
                setter_symbol_id: setter.symbol_id(),
                setter_name: setter.name.to_string(),
                state_name: state.name.to_string(),
            });
        }
    }
    bindings
}

fn effect_chain_top_level_effect_call_ids<'a>(
    body: &'a FunctionBody<'a>,
    component_node_id: NodeId,
    ctx: &LintContext<'a>,
) -> Vec<NodeId> {
    let mut effect_call_ids = Vec::new();
    for statement in &body.statements {
        let Statement::ExpressionStatement(expression_statement) = statement else {
            continue;
        };
        let expression = effect_chain_final_discarded_expression(&expression_statement.expression);
        let Expression::CallExpression(effect_call) = expression.get_inner_expression() else {
            continue;
        };
        if is_react_hook_call(effect_call, &EFFECT_CHAIN_HOOK_NAMES, ctx)
            && effect_chain_nearest_function_node_id(effect_call.node_id.get(), ctx)
                == Some(component_node_id)
        {
            effect_call_ids.push(effect_call.node_id.get());
        }
    }
    effect_call_ids
}

fn effect_chain_final_discarded_expression<'a>(
    expression: &'a Expression<'a>,
) -> &'a Expression<'a> {
    let expression = expression.get_inner_expression();
    if let Expression::SequenceExpression(sequence) = expression {
        return sequence.expressions.last().unwrap_or(expression);
    }
    expression
}

fn effect_chain_dependency_state_symbol_ids<'a>(
    effect_call: &'a oxc_ast::ast::CallExpression<'a>,
    state_symbol_ids: &FxHashSet<SymbolId>,
    ctx: &LintContext<'a>,
) -> FxHashSet<SymbolId> {
    let mut dependencies = FxHashSet::default();
    let Some(Expression::ArrayExpression(array)) = effect_call
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return dependencies;
    };
    for expression in array
        .elements
        .iter()
        .filter_map(ArrayExpressionElement::as_expression)
    {
        let Some(symbol_id) = effect_chain_expression_root_symbol(expression, ctx) else {
            continue;
        };
        if state_symbol_ids.contains(&symbol_id) {
            dependencies.insert(symbol_id);
        }
    }
    dependencies
}

fn effect_chain_synchronously_invoked_function_ids(
    callback_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> FxHashSet<NodeId> {
    let mut function_ids = FxHashSet::default();
    function_ids.insert(callback_id);
    let mut pending = vec![callback_id];
    while let Some(function_id) = pending.pop() {
        for &candidate_id in node_index.node_ids(function_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            let Some(called_function_id) = effect_chain_resolve_function_id(
                &call_expression.callee,
                ctx,
                &mut FxHashSet::default(),
            ) else {
                continue;
            };
            if effect_chain_function_is_async(called_function_id, ctx)
                || !function_ids.insert(called_function_id)
            {
                continue;
            }
            pending.push(called_function_id);
        }
    }
    function_ids
}

fn effect_chain_ordinary_synchronously_invoked_function_ids(
    callback_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> FxHashSet<NodeId> {
    let mut function_ids = FxHashSet::from_iter([callback_id]);
    let mut pending = vec![callback_id];
    while let Some(function_id) = pending.pop() {
        for &candidate_id in node_index.node_ids(function_id) {
            let AstKind::CallExpression(call) = ctx.nodes().get_node(candidate_id).kind() else {
                continue;
            };
            let Some(called_function_id) = effect_chain_resolve_function_id_internal(
                &call.callee,
                false,
                ctx,
                &mut FxHashSet::default(),
            ) else {
                continue;
            };
            if effect_chain_function_is_async(called_function_id, ctx)
                || !function_ids.insert(called_function_id)
            {
                continue;
            }
            pending.push(called_function_id);
        }
    }
    function_ids
}

fn effect_chain_state_write_function_ids<'a>(
    callback_id: NodeId,
    full_function_ids: &FxHashSet<NodeId>,
    state_by_setter_symbol_id: &FxHashMap<SymbolId, EffectChainStateBinding>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> FxHashSet<NodeId> {
    let ordinary_function_ids =
        effect_chain_ordinary_synchronously_invoked_function_ids(callback_id, node_index, ctx);
    let stable_function_ids = full_function_ids
        .difference(&ordinary_function_ids)
        .copied()
        .collect::<FxHashSet<_>>();
    if stable_function_ids.is_empty() {
        return ordinary_function_ids;
    }
    let mut all_written_state_symbol_ids = FxHashSet::default();
    let mut stable_written_state_symbol_ids = FxHashSet::default();
    let mut has_unproven_observable_work = false;
    for &function_id in full_function_ids {
        let parameter_spans = effect_chain_function_parameters(function_id, ctx)
            .map(|parameters| {
                parameters
                    .items
                    .iter()
                    .map(GetSpan::span)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for &candidate_id in node_index.node_ids(function_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            let is_stable_function = stable_function_ids.contains(&function_id);
            if is_stable_function
                && parameter_spans
                    .iter()
                    .any(|span| span.contains_inclusive(candidate.span()))
                && effect_chain_node_has_observable_work(
                    candidate,
                    full_function_ids,
                    state_by_setter_symbol_id,
                    ctx,
                )
            {
                has_unproven_observable_work = true;
            }
            let AstKind::CallExpression(call) = candidate.kind() else {
                if is_stable_function
                    && effect_chain_node_has_observable_work(
                        candidate,
                        full_function_ids,
                        state_by_setter_symbol_id,
                        ctx,
                    )
                {
                    has_unproven_observable_work = true;
                }
                continue;
            };
            if let Some(binding) = effect_chain_setter_symbol_id(&call.callee, ctx)
                .and_then(|setter_symbol_id| state_by_setter_symbol_id.get(&setter_symbol_id))
            {
                all_written_state_symbol_ids.insert(binding.state_symbol_id);
                if is_stable_function {
                    stable_written_state_symbol_ids.insert(binding.state_symbol_id);
                }
                continue;
            }
            if is_stable_function
                && effect_chain_node_has_observable_work(
                    candidate,
                    full_function_ids,
                    state_by_setter_symbol_id,
                    ctx,
                )
            {
                has_unproven_observable_work = true;
            }
        }
    }
    if !has_unproven_observable_work
        && stable_written_state_symbol_ids.len() == 1
        && all_written_state_symbol_ids.len() == 1
    {
        full_function_ids.clone()
    } else {
        ordinary_function_ids
    }
}

fn effect_chain_node_has_observable_work<'a>(
    node: &crate::AstNode<'a>,
    full_function_ids: &FxHashSet<NodeId>,
    state_by_setter_symbol_id: &FxHashMap<SymbolId, EffectChainStateBinding>,
    ctx: &LintContext<'a>,
) -> bool {
    match node.kind() {
        AstKind::CallExpression(call) => {
            if effect_chain_setter_symbol_id(&call.callee, ctx)
                .is_some_and(|symbol_id| state_by_setter_symbol_id.contains_key(&symbol_id))
            {
                return false;
            }
            effect_chain_resolve_function_id(&call.callee, ctx, &mut FxHashSet::default())
                .is_none_or(|function_id| !full_function_ids.contains(&function_id))
        }
        AstKind::AssignmentExpression(_)
        | AstKind::UpdateExpression(_)
        | AstKind::ImportExpression(_)
        | AstKind::NewExpression(_)
        | AstKind::TaggedTemplateExpression(_)
        | AstKind::ThrowStatement(_) => true,
        AstKind::UnaryExpression(unary) => unary.operator == UnaryOperator::Delete,
        _ => false,
    }
}

fn effect_chain_read_static_value(
    expression: &Expression<'_>,
    state_symbol_id: Option<SymbolId>,
    state_value: Option<&EffectChainStaticValue>,
    additional_values: &FxHashMap<SymbolId, EffectChainStaticValue>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    ctx: &LintContext<'_>,
) -> Option<EffectChainStaticValue> {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => Some(EffectChainStaticValue::Null),
        Expression::BooleanLiteral(literal) => Some(EffectChainStaticValue::Boolean(literal.value)),
        Expression::NumericLiteral(literal) => Some(EffectChainStaticValue::number(literal.value)),
        Expression::StringLiteral(literal) => {
            Some(EffectChainStaticValue::String(literal.value.to_string()))
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if state_symbol_id.is_some() && symbol_id == state_symbol_id {
                return state_value.cloned();
            }
            if let Some(value) = symbol_id.and_then(|symbol_id| additional_values.get(&symbol_id)) {
                return Some(value.clone());
            }
            if symbol_id.is_none() && identifier.name == "undefined" {
                return Some(EffectChainStaticValue::Undefined);
            }
            if symbol_id.is_none() && identifier.name == "NaN" {
                return Some(EffectChainStaticValue::number(f64::NAN));
            }
            let symbol_id = symbol_id?;
            if !effect_chain_symbol_is_const_binding(symbol_id, ctx)
                || !visited_symbol_ids.insert(symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let value = effect_chain_read_static_value(
                declarator.init.as_ref()?,
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            );
            visited_symbol_ids.remove(&symbol_id);
            value
        }
        Expression::UnaryExpression(unary) => match unary.operator {
            UnaryOperator::Void => Some(EffectChainStaticValue::Undefined),
            UnaryOperator::LogicalNot => effect_chain_read_static_value(
                &unary.argument,
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            )
            .map(|value| EffectChainStaticValue::Boolean(!value.is_truthy())),
            _ => None,
        },
        Expression::CallExpression(call) => {
            let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                return None;
            };
            if callee.name != "Boolean"
                || ctx
                    .scoping()
                    .get_reference(callee.reference_id())
                    .symbol_id()
                    .is_some()
                || call.arguments.len() != 1
            {
                return None;
            }
            effect_chain_read_static_value(
                call.arguments.first()?.as_expression()?,
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            )
            .map(|value| EffectChainStaticValue::Boolean(value.is_truthy()))
        }
        Expression::LogicalExpression(logical) => {
            let left = effect_chain_read_static_value(
                &logical.left,
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            )?;
            if (logical.operator == LogicalOperator::And && !left.is_truthy())
                || (logical.operator == LogicalOperator::Or && left.is_truthy())
                || (logical.operator == LogicalOperator::Coalesce && !left.is_nullish())
            {
                return Some(left);
            }
            effect_chain_read_static_value(
                &logical.right,
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            )
        }
        Expression::ConditionalExpression(conditional) => {
            let test = effect_chain_read_static_value(
                &conditional.test,
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            )?;
            effect_chain_read_static_value(
                if test.is_truthy() {
                    &conditional.consequent
                } else {
                    &conditional.alternate
                },
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            )
        }
        Expression::ChainExpression(chain) => {
            let member = chain.expression.as_member_expression()?;
            if !member.optional() {
                return None;
            }
            let object = effect_chain_read_static_value(
                member.object(),
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            );
            match object {
                Some(object) if object.is_nullish() => Some(EffectChainStaticValue::Undefined),
                Some(_) => None,
                None => Some(EffectChainStaticValue::Undefined),
            }
        }
        expression
            if expression
                .as_member_expression()
                .is_some_and(|member| member.optional()) =>
        {
            let member = expression.as_member_expression()?;
            let object = effect_chain_read_static_value(
                member.object(),
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            );
            match object {
                Some(object) if object.is_nullish() => Some(EffectChainStaticValue::Undefined),
                Some(_) => None,
                None => Some(EffectChainStaticValue::Undefined),
            }
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            let left = effect_chain_read_static_value(
                &binary.left,
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            )?;
            let right = effect_chain_read_static_value(
                &binary.right,
                state_symbol_id,
                state_value,
                additional_values,
                visited_symbol_ids,
                ctx,
            )?;
            let are_equal = if matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::Inequality
            ) && (left.is_nullish() || right.is_nullish())
            {
                left.is_nullish() && right.is_nullish()
            } else if matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::Inequality
            ) && std::mem::discriminant(&left) != std::mem::discriminant(&right)
            {
                return None;
            } else {
                left.is_strictly_equal_to(&right)
            };
            Some(EffectChainStaticValue::Boolean(
                if matches!(
                    binary.operator,
                    BinaryOperator::Equality | BinaryOperator::StrictEquality
                ) {
                    are_equal
                } else {
                    !are_equal
                },
            ))
        }
        _ => None,
    }
}

fn effect_chain_read_static_setter_value<'a>(
    call: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<EffectChainStaticValue> {
    let Some(argument) = call.arguments.first() else {
        return Some(EffectChainStaticValue::Undefined);
    };
    let expression = argument.as_expression()?;
    if let Some(function_id) =
        effect_chain_resolve_function_id_internal(expression, false, ctx, &mut FxHashSet::default())
    {
        if effect_chain_function_is_async(function_id, ctx) {
            return None;
        }
        let function_node = ctx.nodes().get_node(function_id);
        if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
            && let Some(returned) = function.get_expression()
        {
            return effect_chain_read_static_value(
                returned,
                None,
                None,
                &FxHashMap::default(),
                &mut FxHashSet::default(),
                ctx,
            );
        }
        let statements = match function_node.kind() {
            AstKind::Function(function) => &function.body.as_ref()?.statements,
            AstKind::ArrowFunctionExpression(function) => {
                &function.body.as_function_body()?.statements
            }
            _ => return None,
        };
        if statements.is_empty() {
            return Some(EffectChainStaticValue::Undefined);
        }
        let [Statement::ReturnStatement(return_statement)] = statements.as_slice() else {
            return None;
        };
        let Some(returned) = &return_statement.argument else {
            return Some(EffectChainStaticValue::Undefined);
        };
        return effect_chain_read_static_value(
            returned,
            None,
            None,
            &FxHashMap::default(),
            &mut FxHashSet::default(),
            ctx,
        );
    }
    effect_chain_read_static_value(
        expression,
        None,
        None,
        &FxHashMap::default(),
        &mut FxHashSet::default(),
        ctx,
    )
}

fn effect_chain_collect_state_writes(
    callback_id: NodeId,
    function_ids: &FxHashSet<NodeId>,
    state_by_setter_symbol_id: &FxHashMap<SymbolId, EffectChainStateBinding>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> (FxHashMap<SymbolId, EffectChainWrite>, Vec<SymbolId>) {
    let mut writes = FxHashMap::default();
    let mut written_state_symbol_ids = Vec::new();
    let mut ordered_function_ids = vec![callback_id];
    let mut visited_function_ids = FxHashSet::from_iter([callback_id]);
    let mut pending_function_ids = vec![callback_id];
    while let Some(function_id) = pending_function_ids.pop() {
        for &candidate_id in node_index.node_ids(function_id) {
            let AstKind::CallExpression(call) = ctx.nodes().get_node(candidate_id).kind() else {
                continue;
            };
            let Some(called_function_id) =
                effect_chain_resolve_function_id(&call.callee, ctx, &mut FxHashSet::default())
            else {
                continue;
            };
            if !function_ids.contains(&called_function_id)
                || !visited_function_ids.insert(called_function_id)
            {
                continue;
            }
            ordered_function_ids.push(called_function_id);
            pending_function_ids.push(called_function_id);
        }
    }
    for function_id in ordered_function_ids {
        for &candidate_id in node_index.node_ids(function_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                continue;
            };
            let Some(setter_symbol_id) =
                effect_chain_setter_symbol_id(&call_expression.callee, ctx)
            else {
                continue;
            };
            let Some(binding) = state_by_setter_symbol_id.get(&setter_symbol_id) else {
                continue;
            };
            let static_value = effect_chain_read_static_setter_value(call_expression, ctx);
            if !writes.contains_key(&binding.state_symbol_id) {
                written_state_symbol_ids.push(binding.state_symbol_id);
            }
            writes
                .entry(binding.state_symbol_id)
                .and_modify(|write: &mut EffectChainWrite| {
                    if let Some(static_value) = &static_value {
                        write.values.insert(static_value.clone());
                    } else {
                        write.has_unknown_value = true;
                    }
                    write.call_ids.push(candidate_id);
                })
                .or_insert_with(|| {
                    let has_unknown_value = static_value.is_none();
                    EffectChainWrite {
                        state_name: binding.state_name.clone(),
                        values: static_value.into_iter().collect(),
                        has_unknown_value,
                        call_ids: vec![candidate_id],
                    }
                });
        }
    }
    (writes, written_state_symbol_ids)
}

fn effect_chain_external_sync_anchor_ids(
    callback_id: NodeId,
    function_ids: &FxHashSet<NodeId>,
    state_by_setter_symbol_id: &FxHashMap<SymbolId, EffectChainStateBinding>,
    allow_committed_dom_sync: bool,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    let mut anchor_ids =
        effect_chain_cleanup_anchor_ids(callback_id, state_by_setter_symbol_id, node_index, ctx);
    for function_id in function_ids {
        for candidate_id in node_index.node_ids(*function_id) {
            let candidate = ctx.nodes().get_node(*candidate_id);
            let is_external = match candidate.kind() {
                AstKind::CallExpression(call_expression) => {
                    let root_symbol_id =
                        effect_chain_setter_symbol_id(&call_expression.callee, ctx);
                    if root_symbol_id
                        .is_some_and(|symbol_id| state_by_setter_symbol_id.contains_key(&symbol_id))
                    {
                        false
                    } else {
                        effect_chain_call_is_external_sync(call_expression, ctx)
                            || allow_committed_dom_sync
                                && effect_chain_call_is_committed_dom_sync(call_expression, ctx)
                    }
                }
                AstKind::NewExpression(new_expression) => {
                    effect_chain_new_expression_is_observer(new_expression, ctx)
                }
                AstKind::AssignmentExpression(assignment) => assignment
                    .left
                    .as_simple_assignment_target()
                    .and_then(|target| target.as_member_expression())
                    .is_some_and(|member| {
                        effect_chain_member_is_react_ref_current(member, ctx)
                            || allow_committed_dom_sync
                                && effect_chain_member_is_committed_dom_property(member, ctx)
                    }),
                AstKind::UpdateExpression(update) => update
                    .argument
                    .as_member_expression()
                    .is_some_and(|member| {
                        effect_chain_member_is_react_ref_current(member, ctx)
                            || allow_committed_dom_sync
                                && effect_chain_member_is_committed_dom_property(member, ctx)
                    }),
                _ => false,
            };
            if is_external {
                anchor_ids.push(*candidate_id);
            }
        }
    }
    anchor_ids.sort_unstable_by_key(|node_id| node_id.index());
    anchor_ids.dedup();
    anchor_ids
}

fn effect_chain_cleanup_anchor_ids(
    callback_id: NodeId,
    state_by_setter_symbol_id: &FxHashMap<SymbolId, EffectChainStateBinding>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    let callback_node = ctx.nodes().get_node(callback_id);
    if let AstKind::ArrowFunctionExpression(function) = callback_node.kind()
        && let Some(expression) = function.get_expression()
        && effect_chain_expression_is_function_shaped_return(
            expression,
            false,
            state_by_setter_symbol_id,
            node_index,
            ctx,
        )
    {
        return vec![callback_id];
    }
    node_index
        .node_ids(callback_id)
        .iter()
        .filter_map(|candidate_id| {
            let candidate = ctx.nodes().get_node(*candidate_id);
            let AstKind::ReturnStatement(statement) = candidate.kind() else {
                return None;
            };
            let argument = statement.argument.as_ref()?;
            if !effect_chain_expression_is_function_shaped_return(
                argument,
                true,
                state_by_setter_symbol_id,
                node_index,
                ctx,
            ) {
                return None;
            }
            let cleanup_function_id =
                effect_chain_resolve_function_id(argument, ctx, &mut FxHashSet::default());
            let is_direct_callback_return = matches!(
                ctx.nodes().parent_node(candidate.id()).kind(),
                AstKind::FunctionBody(_)
            );
            (is_direct_callback_return
                || cleanup_function_id.is_none()
                || cleanup_function_id.is_some_and(|function_id| {
                    effect_chain_cleanup_function_has_external_work(
                        function_id,
                        node_index,
                        ctx,
                        &mut FxHashSet::default(),
                    )
                }))
            .then_some(*candidate_id)
        })
        .collect()
}

fn effect_chain_cleanup_function_has_external_work(
    function_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if effect_chain_function_is_async(function_id, ctx) || !visited_function_ids.insert(function_id)
    {
        return false;
    }
    for candidate_id in node_index.node_ids(function_id) {
        let candidate = ctx.nodes().get_node(*candidate_id);
        match candidate.kind() {
            AstKind::CallExpression(call) => {
                if let Some(name) = effect_chain_call_name(call)
                    && effect_chain_is_setter_name(name)
                    && !EFFECT_CHAIN_EXTERNAL_DIRECT_CALL_NAMES.contains(&name)
                {
                    continue;
                }
                if let Some(called_function_id) =
                    effect_chain_resolve_function_id(&call.callee, ctx, &mut FxHashSet::default())
                {
                    if effect_chain_cleanup_function_has_external_work(
                        called_function_id,
                        node_index,
                        ctx,
                        visited_function_ids,
                    ) {
                        return true;
                    }
                    continue;
                }
                return true;
            }
            AstKind::NewExpression(new_expression)
                if effect_chain_new_expression_is_observer(new_expression, ctx) =>
            {
                return true;
            }
            AstKind::AssignmentExpression(assignment)
                if assignment
                    .left
                    .as_simple_assignment_target()
                    .and_then(|target| target.as_member_expression())
                    .is_some_and(|member| {
                        effect_chain_member_is_react_ref_current(member, ctx)
                            || effect_chain_member_is_committed_dom_property(member, ctx)
                    }) =>
            {
                return true;
            }
            AstKind::UpdateExpression(update)
                if update
                    .argument
                    .as_member_expression()
                    .is_some_and(|member| {
                        effect_chain_member_is_react_ref_current(member, ctx)
                            || effect_chain_member_is_committed_dom_property(member, ctx)
                    }) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn effect_chain_calls_storage_setter(
    function_ids: &FxHashSet<NodeId>,
    storage_setter_names: &FxHashSet<String>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    if storage_setter_names.is_empty() {
        return false;
    }
    function_ids.iter().any(|function_id| {
        node_index
            .node_ids(*function_id)
            .iter()
            .any(|candidate_id| {
                let AstKind::CallExpression(call) = ctx.nodes().get_node(*candidate_id).kind()
                else {
                    return false;
                };
                matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if storage_setter_names.contains(identifier.name.as_str()))
            })
    })
}

fn effect_chain_calls_opaque_setter(
    function_ids: &FxHashSet<NodeId>,
    state_setter_names: &FxHashSet<&str>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    function_ids.iter().any(|function_id| {
        node_index
            .node_ids(*function_id)
            .iter()
            .any(|candidate_id| {
                let AstKind::CallExpression(call) = ctx.nodes().get_node(*candidate_id).kind()
                else {
                    return false;
                };
                let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                    return false;
                };
                let name = identifier.name.as_str();
                effect_chain_is_setter_name(name) && !state_setter_names.contains(name)
            })
    })
}

fn effect_chain_externally_synchronized_state_symbol_ids(
    writes: &FxHashMap<SymbolId, EffectChainWrite>,
    anchor_ids: &[NodeId],
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    if anchor_ids.is_empty() {
        return FxHashSet::default();
    }
    writes
        .iter()
        .filter_map(|(state_symbol_id, write)| {
            write
                .call_ids
                .iter()
                .all(|write_id| {
                    let write_node = ctx.nodes().get_node(*write_id);
                    let Some(write_owner_id) =
                        effect_chain_nearest_function_node_id(*write_id, ctx)
                    else {
                        return false;
                    };
                    let write_block = ctx.nodes().cfg_id(*write_id);
                    anchor_ids.iter().any(|anchor_id| {
                        if effect_chain_nearest_function_node_id(*anchor_id, ctx)
                            != Some(write_owner_id)
                        {
                            return false;
                        }
                        let anchor_node = ctx.nodes().get_node(*anchor_id);
                        if !nodes_can_co_execute(write_node, anchor_node, ctx) {
                            return false;
                        }
                        let anchor_block = ctx.nodes().cfg_id(*anchor_id);
                        let exclusions = FxHashSet::default();
                        cfg_block_can_reach(write_block, anchor_block, &exclusions, ctx)
                            || cfg_block_can_reach(anchor_block, write_block, &exclusions, ctx)
                    })
                })
                .then_some(*state_symbol_id)
        })
        .collect()
}

fn effect_chain_node_is_reachable_for_state_value(
    node: &crate::AstNode<'_>,
    function_id: NodeId,
    state_symbol_id: SymbolId,
    state_value: &EffectChainStaticValue,
    additional_values: &FxHashMap<SymbolId, EffectChainStaticValue>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = node;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if parent.id() == function_id {
            return true;
        }
        let current_span = current.span();
        match parent.kind() {
            AstKind::IfStatement(statement) => {
                let test = effect_chain_read_static_value(
                    &statement.test,
                    Some(state_symbol_id),
                    Some(state_value),
                    additional_values,
                    &mut FxHashSet::default(),
                    ctx,
                );
                if let Some(test) = test {
                    if statement.consequent.span().contains_inclusive(current_span)
                        && !test.is_truthy()
                    {
                        return false;
                    }
                    if statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span().contains_inclusive(current_span))
                        && test.is_truthy()
                    {
                        return false;
                    }
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let test = effect_chain_read_static_value(
                    &expression.test,
                    Some(state_symbol_id),
                    Some(state_value),
                    additional_values,
                    &mut FxHashSet::default(),
                    ctx,
                );
                if let Some(test) = test {
                    if expression
                        .consequent
                        .span()
                        .contains_inclusive(current_span)
                        && !test.is_truthy()
                    {
                        return false;
                    }
                    if expression.alternate.span().contains_inclusive(current_span)
                        && test.is_truthy()
                    {
                        return false;
                    }
                }
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(current_span) =>
            {
                let left = effect_chain_read_static_value(
                    &expression.left,
                    Some(state_symbol_id),
                    Some(state_value),
                    additional_values,
                    &mut FxHashSet::default(),
                    ctx,
                );
                if let Some(left) = left
                    && ((expression.operator == LogicalOperator::And && !left.is_truthy())
                        || (expression.operator == LogicalOperator::Or && left.is_truthy())
                        || (expression.operator == LogicalOperator::Coalesce && !left.is_nullish()))
                {
                    return false;
                }
            }
            AstKind::BlockStatement(block) => {
                if !effect_chain_preceding_guards_allow_node(
                    &block.body,
                    current_span,
                    state_symbol_id,
                    state_value,
                    additional_values,
                    ctx,
                ) {
                    return false;
                }
            }
            AstKind::FunctionBody(body) => {
                if !effect_chain_preceding_guards_allow_node(
                    &body.statements,
                    current_span,
                    state_symbol_id,
                    state_value,
                    additional_values,
                    ctx,
                ) {
                    return false;
                }
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return true,
            _ => {}
        }
        current = parent;
    }
}

fn effect_chain_preceding_guards_allow_node(
    statements: &[Statement<'_>],
    current_span: oxc_span::Span,
    state_symbol_id: SymbolId,
    state_value: &EffectChainStaticValue,
    additional_values: &FxHashMap<SymbolId, EffectChainStaticValue>,
    ctx: &LintContext<'_>,
) -> bool {
    for statement in statements {
        if statement.span().contains_inclusive(current_span) {
            return true;
        }
        let Statement::IfStatement(if_statement) = statement else {
            continue;
        };
        if if_statement.alternate.is_some() || !statement_always_exits(&if_statement.consequent) {
            continue;
        }
        if effect_chain_read_static_value(
            &if_statement.test,
            Some(state_symbol_id),
            Some(state_value),
            additional_values,
            &mut FxHashSet::default(),
            ctx,
        )
        .is_some_and(|value| value.is_truthy())
        {
            return false;
        }
    }
    true
}

fn effect_chain_function_parameters<'a>(
    function_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<&'a oxc_ast::ast::FormalParameters<'a>> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => Some(&function.params),
        AstKind::ArrowFunctionExpression(function) => Some(&function.params),
        _ => None,
    }
}

fn effect_chain_invoked_parameter_values(
    function_id: NodeId,
    call: &oxc_ast::ast::CallExpression<'_>,
    state_symbol_id: SymbolId,
    state_value: &EffectChainStaticValue,
    caller_values: &FxHashMap<SymbolId, EffectChainStaticValue>,
    ctx: &LintContext<'_>,
) -> FxHashMap<SymbolId, EffectChainStaticValue> {
    let mut parameter_values: FxHashMap<SymbolId, EffectChainStaticValue> = FxHashMap::default();
    let Some(parameters) = effect_chain_function_parameters(function_id, ctx) else {
        return parameter_values;
    };
    for (parameter_index, parameter) in parameters.items.iter().enumerate() {
        if matches!(
            call.arguments.get(parameter_index),
            Some(Argument::SpreadElement(_))
        ) {
            break;
        }
        let (binding, default_value) = match &parameter.pattern {
            BindingPattern::BindingIdentifier(binding) => (binding.as_ref(), None),
            BindingPattern::AssignmentPattern(assignment) => {
                let Some(binding) = assignment.left.get_binding_identifier() else {
                    continue;
                };
                (binding, Some(&assignment.right))
            }
            _ => continue,
        };
        let direct_argument_value = call
            .arguments
            .get(parameter_index)
            .and_then(Argument::as_expression)
            .and_then(|argument| {
                effect_chain_read_static_value(
                    argument,
                    Some(state_symbol_id),
                    Some(state_value),
                    caller_values,
                    &mut FxHashSet::default(),
                    ctx,
                )
            });
        let argument_value = if direct_argument_value
            .as_ref()
            .is_some_and(|value| *value == EffectChainStaticValue::Undefined)
            || direct_argument_value.is_none() && call.arguments.get(parameter_index).is_none()
        {
            default_value
                .and_then(|default_value| {
                    let mut known_values = caller_values.clone();
                    known_values.extend(parameter_values.clone());
                    effect_chain_read_static_value(
                        default_value,
                        Some(state_symbol_id),
                        Some(state_value),
                        &known_values,
                        &mut FxHashSet::default(),
                        ctx,
                    )
                })
                .or(direct_argument_value)
                .or_else(|| {
                    (call.arguments.get(parameter_index).is_none())
                        .then_some(EffectChainStaticValue::Undefined)
                })
        } else {
            direct_argument_value.or_else(|| {
                (call.arguments.get(parameter_index).is_none())
                    .then_some(EffectChainStaticValue::Undefined)
            })
        };
        if let Some(argument_value) = argument_value {
            parameter_values.insert(binding.symbol_id(), argument_value);
        }
    }
    parameter_values
}

fn effect_chain_node_is_reader_work<'a>(
    node: &crate::AstNode<'a>,
    analysis_function_ids: &FxHashSet<NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    match node.kind() {
        AstKind::CallExpression(call) => {
            if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if identifier.name == "Boolean"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
            {
                return false;
            }
            effect_chain_resolve_function_id(&call.callee, ctx, &mut FxHashSet::default())
                .is_none_or(|function_id| !analysis_function_ids.contains(&function_id))
        }
        AstKind::AssignmentExpression(_)
        | AstKind::UpdateExpression(_)
        | AstKind::NewExpression(_)
        | AstKind::TaggedTemplateExpression(_)
        | AstKind::ThrowStatement(_) => true,
        AstKind::UnaryExpression(unary) => unary.operator == UnaryOperator::Delete,
        _ => false,
    }
}

fn effect_chain_reader_work_can_run_for_state_value<'a>(
    reader: &EffectChainInfo,
    state_symbol_id: SymbolId,
    state_value: &EffectChainStaticValue,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    let mut pending_frames: Vec<(NodeId, FxHashMap<SymbolId, EffectChainStaticValue>)> =
        vec![(reader.callback_id, FxHashMap::default())];
    let mut visited_frames = FxHashSet::default();
    while let Some((function_id, parameter_values)) = pending_frames.pop() {
        let mut frame_key = parameter_values
            .iter()
            .map(|(symbol_id, value)| (symbol_id.index(), value.clone()))
            .collect::<Vec<_>>();
        frame_key.sort_unstable_by_key(|(symbol_index, _)| *symbol_index);
        if !visited_frames.insert((function_id, frame_key)) {
            continue;
        }
        for &candidate_id in node_index.node_ids(function_id) {
            let candidate = ctx.nodes().get_node(candidate_id);
            if let AstKind::CallExpression(call) = candidate.kind()
                && let Some(invoked_function_id) =
                    effect_chain_resolve_function_id(&call.callee, ctx, &mut FxHashSet::default())
                && reader.analysis_function_ids.contains(&invoked_function_id)
            {
                if effect_chain_node_is_reachable_for_state_value(
                    candidate,
                    function_id,
                    state_symbol_id,
                    state_value,
                    &parameter_values,
                    ctx,
                ) {
                    pending_frames.push((
                        invoked_function_id,
                        effect_chain_invoked_parameter_values(
                            invoked_function_id,
                            call,
                            state_symbol_id,
                            state_value,
                            &parameter_values,
                            ctx,
                        ),
                    ));
                }
                continue;
            }
            if effect_chain_node_is_reader_work(candidate, &reader.analysis_function_ids, ctx)
                && effect_chain_node_is_reachable_for_state_value(
                    candidate,
                    function_id,
                    state_symbol_id,
                    state_value,
                    &parameter_values,
                    ctx,
                )
            {
                return true;
            }
        }
    }
    false
}

fn effect_chain_state_write_can_reach_reader_work<'a>(
    write: &EffectChainWrite,
    state_symbol_id: SymbolId,
    reader: &EffectChainInfo,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    write.has_unknown_value
        || write.values.iter().any(|value| {
            effect_chain_reader_work_can_run_for_state_value(
                reader,
                state_symbol_id,
                value,
                node_index,
                ctx,
            )
        })
}

fn effect_chain_member_is_react_ref_current<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if member.static_property_name() != Some("current") {
        return false;
    }
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(Expression::CallExpression(call_expression)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    is_react_api_call(call_expression, "useRef", ctx)
        || is_react_api_call(call_expression, "createRef", ctx)
}

fn effect_chain_safe_module_api_path_matches<'a>(
    expression: &Expression<'a>,
    expected_path: &[&str],
    module_sources: &[&str],
    allow_default_namespace: bool,
    ctx: &LintContext<'a>,
) -> bool {
    if !effect_chain_module_api_path_matches(
        expression,
        expected_path,
        module_sources,
        allow_default_namespace,
        ctx,
        &mut FxHashSet::default(),
    ) {
        return false;
    }
    let mut module_object_symbol_ids = FxHashSet::default();
    if !effect_chain_collect_commonjs_module_object_symbols(
        expression,
        ctx,
        &mut FxHashSet::default(),
        &mut module_object_symbol_ids,
    ) {
        return true;
    }
    module_object_symbol_ids
        .into_iter()
        .all(|symbol_id| effect_chain_symbol_has_safe_receiver_aliases(symbol_id, ctx))
}

fn effect_chain_module_api_path_matches<'a>(
    expression: &Expression<'a>,
    expected_path: &[&str],
    module_sources: &[&str],
    allow_default_namespace: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if module_api_path_matches(
        expression,
        expected_path,
        module_sources,
        allow_default_namespace,
        ctx,
    ) {
        return true;
    }
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        let Some((expected_property, expected_receiver_path)) = expected_path.split_last() else {
            return false;
        };
        return member.static_property_name() == Some(*expected_property)
            && effect_chain_module_api_path_matches(
                member.object(),
                expected_receiver_path,
                module_sources,
                allow_default_namespace,
                ctx,
                visited_symbol_ids,
            );
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    effect_chain_direct_unreassigned_initializer(symbol_id, ctx).is_some_and(|initializer| {
        effect_chain_module_api_path_matches(
            initializer,
            expected_path,
            module_sources,
            allow_default_namespace,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn effect_chain_collect_commonjs_module_object_symbols<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
    module_object_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Some(member) = expression.as_member_expression() {
        return effect_chain_collect_commonjs_module_object_symbols(
            member.object(),
            ctx,
            visited_symbol_ids,
            module_object_symbol_ids,
        );
    }
    if global_require_module_source(expression, ctx).is_some() {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::TSImportEqualsDeclaration(_)) {
        module_object_symbol_ids.insert(symbol_id);
        return true;
    }
    let Some(initializer) = effect_chain_direct_unreassigned_initializer(symbol_id, ctx) else {
        return false;
    };
    if !effect_chain_collect_commonjs_module_object_symbols(
        initializer,
        ctx,
        visited_symbol_ids,
        module_object_symbol_ids,
    ) {
        return false;
    }
    if initializer
        .get_inner_expression()
        .as_member_expression()
        .is_none()
    {
        module_object_symbol_ids.insert(symbol_id);
    }
    true
}

fn effect_chain_direct_unreassigned_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    if variable_declaration.kind.is_const() {
        return declarator.init.as_ref();
    }
    let symbol_scope_id = ctx.scoping().symbol_scope_id(symbol_id);
    let symbol_name = ctx.scoping().symbol_name(symbol_id);
    let has_same_scope_sibling = ctx.scoping().symbol_ids().any(|candidate_symbol_id| {
        candidate_symbol_id != symbol_id
            && ctx.scoping().symbol_scope_id(candidate_symbol_id) == symbol_scope_id
            && ctx.scoping().symbol_name(candidate_symbol_id) == symbol_name
    });
    if !matches!(
        variable_declaration.kind,
        oxc_ast::ast::VariableDeclarationKind::Let | oxc_ast::ast::VariableDeclarationKind::Var
    ) || has_same_scope_sibling
        || !ctx.scoping().symbol_redeclarations(symbol_id).is_empty()
        || ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| !reference.is_read() || reference.is_write())
    {
        return None;
    }
    declarator.init.as_ref()
}

fn effect_chain_identifier_has_safe_receiver_aliases<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(root_symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return true;
    };
    effect_chain_symbol_has_safe_receiver_aliases(root_symbol_id, ctx)
}

fn effect_chain_symbol_has_safe_receiver_aliases(
    root_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    potential_alias_symbol_ids(root_symbol_id, ctx)
        .into_iter()
        .flat_map(|symbol_id| ctx.scoping().get_resolved_references(symbol_id))
        .all(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            if let Some(is_mutated) = effect_chain_member_reference_is_mutated(reference_node, ctx)
            {
                return !is_mutated;
            }
            let reference_root = transparent_expression_root(reference_node, ctx);
            if effect_chain_reference_is_safe_const_alias(reference_node, ctx)
                || effect_chain_reference_is_react_dependency(reference_node, ctx)
            {
                return true;
            }
            let parent = ctx.nodes().parent_node(reference_root.id());
            match parent.kind() {
                AstKind::CallExpression(call) => call.callee.span() == reference_root.span(),
                AstKind::VariableDeclarator(declarator) => {
                    declarator
                        .init
                        .as_ref()
                        .is_some_and(|initializer| initializer.span() == reference_root.span())
                        && matches!(declarator.id, BindingPattern::ObjectPattern(_))
                }
                AstKind::AssignmentExpression(assignment) => {
                    assignment.right.span() == reference_root.span()
                        && matches!(
                            assignment.left,
                            oxc_ast::ast::AssignmentTarget::ObjectAssignmentTarget(_)
                        )
                }
                _ => false,
            }
        })
}

fn effect_chain_member_reference_is_mutated<'a>(
    reference_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let reference_root = transparent_expression_root(reference_node, ctx);
    let member_node = ctx.nodes().parent_node(reference_root.id());
    if !member_node
        .kind()
        .as_member_expression_kind()
        .is_some_and(|member| member.object().span() == reference_root.span())
    {
        return None;
    }
    let member_span = member_node.span();
    for ancestor in ctx.nodes().ancestors(member_node.id()) {
        match ancestor.kind() {
            AstKind::AssignmentExpression(assignment)
                if assignment.left.span().contains_inclusive(member_span) =>
            {
                return Some(true);
            }
            AstKind::UpdateExpression(update)
                if update.argument.span().contains_inclusive(member_span) =>
            {
                return Some(true);
            }
            AstKind::UnaryExpression(unary)
                if unary.operator == UnaryOperator::Delete
                    && unary.argument.span().contains_inclusive(member_span) =>
            {
                return Some(true);
            }
            AstKind::ForInStatement(statement)
                if statement.left.span().contains_inclusive(member_span) =>
            {
                return Some(true);
            }
            AstKind::ForOfStatement(statement)
                if statement.left.span().contains_inclusive(member_span) =>
            {
                return Some(true);
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => break,
            _ => {}
        }
    }
    Some(false)
}

fn effect_chain_reference_is_safe_const_alias<'a>(
    reference_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_root = transparent_expression_root(reference_node, ctx);
    let declaration_node = ctx.nodes().parent_node(reference_root.id());
    let AstKind::VariableDeclarator(declarator) = declaration_node.kind() else {
        return false;
    };
    if !declarator
        .init
        .as_ref()
        .is_some_and(|initializer| initializer.span() == reference_root.span())
    {
        return false;
    }
    let Some(binding) = declarator.id.get_binding_identifier() else {
        return false;
    };
    matches!(
        ctx.nodes().parent_node(declaration_node.id()).kind(),
        AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
    ) && ctx
        .scoping()
        .get_resolved_references(binding.symbol_id())
        .all(|reference| !reference.is_write())
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum EffectChainDependencyContainerKind {
    Array,
    Object,
}

fn effect_chain_reference_is_react_dependency<'a>(
    reference_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut pending_paths = vec![(reference_node.id(), None)];
    let mut visited_node_ids = FxHashSet::default();
    let mut did_find_react_dependency_argument = false;

    while let Some((pending_node_id, container_kind)) = pending_paths.pop() {
        let expression = transparent_expression_root(ctx.nodes().get_node(pending_node_id), ctx);
        if !visited_node_ids.insert(expression.id()) {
            continue;
        }

        if container_kind == Some(EffectChainDependencyContainerKind::Array)
            && effect_chain_node_is_react_dependency_argument(expression, ctx)
        {
            did_find_react_dependency_argument = true;
            continue;
        }

        if let Some((container_node_id, next_container_kind)) =
            effect_chain_containing_react_dependency_value(expression, container_kind, ctx)
        {
            pending_paths.push((container_node_id, Some(next_container_kind)));
            continue;
        }

        let declaration = ctx.nodes().parent_node(expression.id());
        if let AstKind::VariableDeclarator(declarator) = declaration.kind()
            && declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == expression.span())
            && let Some(binding) = declarator.id.get_binding_identifier()
        {
            let symbol_id = binding.symbol_id();
            if !effect_chain_symbol_is_const_binding(symbol_id, ctx)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return false;
            }
            let reference_node_ids = ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .map(oxc_semantic::Reference::node_id)
                .collect::<Vec<_>>();
            if reference_node_ids.is_empty() {
                return false;
            }
            pending_paths.extend(
                reference_node_ids
                    .into_iter()
                    .map(|node_id| (node_id, container_kind)),
            );
            continue;
        }

        if container_kind == Some(EffectChainDependencyContainerKind::Array)
            && let Some(rest_copy_symbol_id) =
                effect_chain_full_array_rest_copy_symbol(expression, ctx)
        {
            let reference_node_ids = ctx
                .scoping()
                .get_resolved_references(rest_copy_symbol_id)
                .map(oxc_semantic::Reference::node_id)
                .collect::<Vec<_>>();
            if reference_node_ids.is_empty() {
                return false;
            }
            pending_paths.extend(
                reference_node_ids
                    .into_iter()
                    .map(|node_id| (node_id, Some(EffectChainDependencyContainerKind::Array))),
            );
            continue;
        }

        return false;
    }

    did_find_react_dependency_argument
}

fn effect_chain_node_is_react_dependency_argument<'a>(
    expression: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let parent = ctx.nodes().parent_node(expression.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.arguments
        .get(1)
        .is_some_and(|argument| argument.span() == expression.span())
        && is_react_hook_call(
            call,
            &["useEffect", "useLayoutEffect", "useMemo", "useCallback"],
            ctx,
        )
}

fn effect_chain_containing_react_dependency_value(
    expression: &crate::AstNode<'_>,
    container_kind: Option<EffectChainDependencyContainerKind>,
    ctx: &LintContext<'_>,
) -> Option<(NodeId, EffectChainDependencyContainerKind)> {
    let parent = ctx.nodes().parent_node(expression.id());
    if matches!(parent.kind(), AstKind::ArrayExpression(_)) {
        return Some((parent.id(), EffectChainDependencyContainerKind::Array));
    }
    if container_kind == Some(EffectChainDependencyContainerKind::Array)
        && matches!(parent.kind(), AstKind::SpreadElement(spread) if spread.argument.span() == expression.span())
    {
        let array = ctx.nodes().parent_node(parent.id());
        if matches!(array.kind(), AstKind::ArrayExpression(_)) {
            return Some((array.id(), EffectChainDependencyContainerKind::Array));
        }
    }
    let AstKind::ObjectProperty(property) = parent.kind() else {
        return None;
    };
    if property.value.span() != expression.span()
        && !(property.shorthand && property.key.span() == expression.span())
    {
        return None;
    }
    let object = ctx.nodes().parent_node(parent.id());
    let AstKind::ObjectExpression(object_expression) = object.kind() else {
        return None;
    };
    object_expression
        .properties
        .iter()
        .all(|property| {
            matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                if property.kind == oxc_ast::ast::PropertyKind::Init
                    && !property.computed
                    && !property.method)
        })
        .then_some((object.id(), EffectChainDependencyContainerKind::Object))
}

fn effect_chain_full_array_rest_copy_symbol(
    expression: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let declaration = ctx.nodes().parent_node(expression.id());
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    if declarator
        .init
        .as_ref()
        .is_none_or(|initializer| initializer.span() != expression.span())
    {
        return None;
    }
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    if !pattern.elements.is_empty() {
        return None;
    }
    let binding = pattern.rest.as_ref()?.argument.get_binding_identifier()?;
    let symbol_id = binding.symbol_id();
    matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable) if variable.kind.is_const()
    )
    .then_some(())?;
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .all(|reference| !reference.is_write())
        .then_some(symbol_id)
}

fn effect_chain_global_namespace_is_proven<'a>(
    expression: &Expression<'a>,
    namespace_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current_expression = expression;
    let mut visited_symbol_ids = FxHashSet::default();
    loop {
        let Expression::Identifier(identifier) = current_expression.get_inner_expression() else {
            return current_expression
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| {
                    member.static_property_name() == Some(namespace_name)
                        && effect_chain_is_proven_global_object_reference(member.object(), ctx)
                });
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return identifier.name == namespace_name;
        };
        if !visited_symbol_ids.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        ) {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            current_expression = initializer;
            continue;
        }
        let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
            return false;
        };
        return pattern.properties.iter().any(|property| {
            effect_chain_destructured_property_key_matches(
                &property.key,
                property.computed,
                namespace_name,
            ) && matches!(&property.value, BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == symbol_id)
                && effect_chain_is_proven_global_object_reference(initializer, ctx)
        });
    }
}

fn effect_chain_is_proven_global_object_reference<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current_expression = expression;
    let mut visited_symbol_ids = FxHashSet::default();
    loop {
        let Expression::Identifier(identifier) = current_expression.get_inner_expression() else {
            return false;
        };
        let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        else {
            return matches!(
                identifier.name.as_str(),
                "global" | "globalThis" | "self" | "window"
            );
        };
        if !visited_symbol_ids.insert(symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
            return false;
        };
        if !matches!(
            ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(variable) if variable.kind.is_const()
        ) {
            return false;
        }
        let Some(initializer) = &declarator.init else {
            return false;
        };
        if declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        {
            current_expression = initializer;
            continue;
        }
        let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
            return false;
        };
        let is_direct_global_self_alias = pattern.properties.iter().any(|property| {
            ["global", "globalThis", "self", "window"]
                .iter()
                .any(|name| {
                    effect_chain_destructured_property_key_matches(
                        &property.key,
                        property.computed,
                        name,
                    )
                })
                && matches!(&property.value, BindingPattern::BindingIdentifier(binding)
                    if binding.symbol_id() == symbol_id)
        });
        if !is_direct_global_self_alias {
            return false;
        }
        current_expression = initializer;
    }
}

fn effect_chain_destructured_property_key_matches(
    key: &oxc_ast::ast::PropertyKey<'_>,
    is_computed: bool,
    expected_name: &str,
) -> bool {
    if !is_computed {
        return key.static_name().as_deref() == Some(expected_name);
    }
    match key {
        oxc_ast::ast::PropertyKey::StringLiteral(literal) => literal.value == expected_name,
        oxc_ast::ast::PropertyKey::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().is_some_and(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    == expected_name
            })
        }
        _ => false,
    }
}

fn effect_chain_call_is_external_sync<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if EFFECT_CHAIN_EXTERNAL_DIRECT_CALL_NAMES
        .iter()
        .any(|name| effect_chain_global_namespace_is_proven(&call_expression.callee, name, ctx))
    {
        return true;
    }
    if effect_chain_call_is_direct_module_sync(call_expression, ctx) {
        return true;
    }
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(_) => false,
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Some(method_name) = member.static_property_name() else {
                return false;
            };
            if effect_chain_expression_is_browser_storage(member.object(), ctx) {
                return true;
            }
            if matches!(method_name, "fetchQuery" | "prefetchQuery")
                && effect_chain_expression_is_tanstack_query_client(
                    member.object(),
                    ctx,
                    &mut FxHashSet::default(),
                )
            {
                return true;
            }
            if EFFECT_CHAIN_HTTP_METHOD_NAMES.contains(&method_name)
                && effect_chain_expression_is_http_client(
                    member.object(),
                    ctx,
                    &mut FxHashSet::default(),
                )
            {
                return true;
            }
            EFFECT_CHAIN_RESOURCE_METHOD_NAMES.contains(&method_name)
                && effect_chain_expression_is_external_resource(
                    member.object(),
                    ctx,
                    &mut FxHashSet::default(),
                )
        }
    }
}

fn effect_chain_call_is_direct_module_sync<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    effect_chain_expression_is_known_direct_http_module_binding(&call_expression.callee, ctx)
        || ["setTimeout", "setInterval"].iter().any(|name| {
            effect_chain_safe_module_api_path_matches(
                &call_expression.callee,
                &[*name],
                &EFFECT_CHAIN_TIMER_MODULE_SOURCES,
                false,
                ctx,
            )
        })
}

fn effect_chain_expression_is_known_direct_http_module_binding<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    effect_chain_safe_module_api_path_matches(
        expression,
        &["fetch"],
        &EFFECT_CHAIN_FETCH_MODULE_SOURCES,
        false,
        ctx,
    ) || [
        ("got", "got"),
        ("ky", "ky"),
        ("ofetch", "ofetch"),
        ("wretch", "wretch"),
    ]
    .iter()
    .any(|(name, source)| {
        effect_chain_safe_module_api_path_matches(expression, &[*name], &[*source], false, ctx)
    }) || effect_chain_safe_module_api_path_matches(
        expression,
        &[],
        &EFFECT_CHAIN_DEFAULT_DIRECT_MODULE_SOURCES,
        true,
        ctx,
    ) || effect_chain_safe_module_api_path_matches(
        expression,
        &["default"],
        &EFFECT_CHAIN_DEFAULT_DIRECT_MODULE_SOURCES,
        false,
        ctx,
    )
}

fn effect_chain_call_is_committed_dom_sync<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    member.static_property_name().is_some_and(|method_name| {
        EFFECT_CHAIN_DOM_METHOD_NAMES.contains(&method_name)
            && (effect_chain_expression_is_host_ref_value(member.object(), ctx)
                || effect_chain_expression_is_typed_react_ref_value(member.object(), ctx)
                || is_proven_dom_event_target(member.object(), ctx, &mut Vec::new()))
    })
}

fn effect_chain_member_is_committed_dom_property<'a>(
    member: &'a oxc_ast::ast::MemberExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    matches!(
        member.static_property_name(),
        Some("scrollLeft" | "scrollTop")
    ) && effect_chain_expression_is_host_ref_value(member.object(), ctx)
}

fn effect_chain_new_expression_is_observer<'a>(
    new_expression: &oxc_ast::ast::NewExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    EFFECT_CHAIN_EXTERNAL_CONSTRUCTOR_NAMES
        .iter()
        .any(|name| effect_chain_global_namespace_is_proven(&new_expression.callee, name, ctx))
}

fn effect_chain_expression_is_browser_storage<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    ["localStorage", "sessionStorage"]
        .iter()
        .any(|name| effect_chain_global_namespace_is_proven(expression, name, ctx))
}

fn effect_chain_expression_is_http_client<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && !effect_chain_identifier_has_safe_receiver_aliases(identifier, ctx)
    {
        return false;
    }
    if effect_chain_safe_module_api_path_matches(
        expression,
        &[],
        &EFFECT_CHAIN_HTTP_MODULE_SOURCES,
        false,
        ctx,
    ) || effect_chain_expression_is_known_direct_http_module_binding(expression, ctx)
        || effect_chain_safe_module_api_path_matches(expression, &[], &["axios"], true, ctx)
        || effect_chain_safe_module_api_path_matches(
            expression,
            &["default"],
            &["axios"],
            false,
            ctx,
        )
    {
        return true;
    }
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if ["axios", "got", "ky", "ofetch", "wretch"]
                .iter()
                .any(|name| effect_chain_global_namespace_is_proven(expression, name, ctx))
            {
                return true;
            }
            let Some(symbol_id) = symbol_id else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            effect_chain_direct_unreassigned_initializer(symbol_id, ctx).is_some_and(
                |initializer| {
                    effect_chain_expression_is_http_client(initializer, ctx, visited_symbol_ids)
                },
            )
        }
        Expression::CallExpression(call) => {
            let Some(member) = call.callee.get_inner_expression().as_member_expression() else {
                return false;
            };
            member.static_property_name() == Some("create")
                && effect_chain_expression_is_http_client(member.object(), ctx, visited_symbol_ids)
        }
        _ => false,
    }
}

fn effect_chain_expression_is_tanstack_query_client<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && !effect_chain_identifier_has_safe_receiver_aliases(identifier, ctx)
    {
        return false;
    }
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => effect_chain_safe_module_api_path_matches(
            &call.callee,
            &["useQueryClient"],
            &["@tanstack/react-query"],
            false,
            ctx,
        ),
        Expression::NewExpression(new_expression) => effect_chain_safe_module_api_path_matches(
            &new_expression.callee,
            &["QueryClient"],
            &["@tanstack/query-core", "@tanstack/react-query"],
            false,
            ctx,
        ),
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            effect_chain_direct_unreassigned_initializer(symbol_id, ctx).is_some_and(
                |initializer| {
                    effect_chain_expression_is_tanstack_query_client(
                        initializer,
                        ctx,
                        visited_symbol_ids,
                    )
                },
            )
        }
        _ => false,
    }
}

fn effect_chain_expression_is_external_resource<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if effect_chain_expression_is_host_ref_value(expression, ctx)
        || effect_chain_expression_is_typed_react_ref_value(expression, ctx)
        || is_proven_dom_event_target(expression, ctx, &mut Vec::new())
        || effect_chain_expression_is_http_client(expression, ctx, &mut FxHashSet::default())
    {
        return true;
    }
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if matches!(identifier.name.as_str(), "window" | "document")
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
            {
                return true;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbol_ids.insert(symbol_id) {
                return false;
            }
            effect_chain_direct_unreassigned_initializer(symbol_id, ctx).is_some_and(
                |initializer| {
                    effect_chain_expression_is_external_resource(
                        initializer,
                        ctx,
                        visited_symbol_ids,
                    )
                },
            )
        }
        Expression::NewExpression(new_expression) => [
            "BroadcastChannel",
            "EventSource",
            "EventTarget",
            "IntersectionObserver",
            "MutationObserver",
            "PerformanceObserver",
            "ResizeObserver",
            "RTCPeerConnection",
            "WebSocket",
            "XMLHttpRequest",
        ]
        .iter()
        .any(|name| effect_chain_global_namespace_is_proven(&new_expression.callee, name, ctx)),
        _ => false,
    }
}

fn effect_chain_expression_is_host_ref_value<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    effect_chain_expression_is_host_ref_value_inner(expression, ctx, &mut FxHashSet::default())
}

fn effect_chain_expression_is_host_ref_value_inner<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
    {
        if !visited_symbol_ids.insert(symbol_id)
            || !effect_chain_symbol_is_const_binding(symbol_id, ctx)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
        {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        return matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
        if declarator.init.as_ref().is_some_and(|initializer| {
            effect_chain_expression_is_host_ref_value_inner(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        }));
    }
    let mut current = expression.get_inner_expression();
    while let Some(member) = current.as_member_expression() {
        if member.static_property_name() == Some("current")
            && let Expression::Identifier(identifier) = member.object().get_inner_expression()
            && let Some(symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx)
        {
            return effect_chain_ref_symbol_is_host(symbol_id, ctx);
        }
        current = member.object().get_inner_expression();
    }
    false
}

fn effect_chain_expression_is_typed_react_ref_value<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    effect_chain_expression_is_typed_react_ref_value_inner(
        expression,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn effect_chain_expression_is_typed_react_ref_value_inner<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if let Expression::Identifier(identifier) = expression.get_inner_expression()
        && let Some(symbol_id) = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
    {
        if !visited_symbol_ids.insert(symbol_id)
            || !effect_chain_symbol_is_const_binding(symbol_id, ctx)
            || ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(oxc_semantic::Reference::is_write)
        {
            return false;
        }
        let declaration = ctx.symbol_declaration(symbol_id);
        return matches!(declaration.kind(), AstKind::VariableDeclarator(declarator)
        if declarator.init.as_ref().is_some_and(|initializer| {
            effect_chain_expression_is_typed_react_ref_value_inner(
                initializer,
                ctx,
                visited_symbol_ids,
            )
        }));
    }
    let Some(member) = expression.get_inner_expression().as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("current") {
        return false;
    }
    let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = resolve_const_identifier_root_symbol(identifier, ctx) else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
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
    if !is_react_api_call(call, "useRef", ctx) && !is_react_api_call(call, "createRef", ctx) {
        return false;
    }
    call.type_arguments
        .as_ref()
        .and_then(|arguments| arguments.params.first())
        .is_some_and(|argument| is_dom_event_target_type(argument, ctx))
}

fn effect_chain_ref_symbol_is_host(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !declarator.init.as_ref().is_some_and(|initializer| {
        matches!(initializer.get_inner_expression(), Expression::CallExpression(call)
            if is_react_api_call(call, "useRef", ctx) || is_react_api_call(call, "createRef", ctx))
    }) {
        return false;
    }
    effect_chain_ref_symbol_references_are_host(symbol_id, ctx, &mut FxHashSet::default())
}

fn effect_chain_ref_symbol_references_are_host(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let mut did_find_host_ref = false;
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        let identifier = ctx.nodes().get_node(reference.node_id());
        let container = ctx.nodes().parent_node(identifier.id());
        if container
            .kind()
            .as_member_expression_kind()
            .is_some_and(|member| {
                member.object().span() == identifier.span()
                    && member
                        .static_property_name()
                        .is_some_and(|name| name == "current")
            })
        {
            continue;
        }
        if let AstKind::VariableDeclarator(declarator) = container.kind()
            && declarator
                .init
                .as_ref()
                .is_some_and(|initializer| initializer.span() == identifier.span())
            && let Some(alias) = declarator.id.get_binding_identifier()
            && effect_chain_symbol_is_const_binding(alias.symbol_id(), ctx)
            && !ctx
                .scoping()
                .get_resolved_references(alias.symbol_id())
                .any(oxc_semantic::Reference::is_write)
        {
            if !effect_chain_ref_symbol_references_are_host(
                alias.symbol_id(),
                ctx,
                visited_symbol_ids,
            ) {
                return false;
            }
            did_find_host_ref = true;
            continue;
        }
        if !matches!(container.kind(), AstKind::JSXExpressionContainer(_)) {
            return false;
        }
        let attribute_node = ctx.nodes().parent_node(container.id());
        let AstKind::JSXAttribute(attribute) = attribute_node.kind() else {
            return false;
        };
        if !matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(name) if name.name == "ref")
        {
            return false;
        }
        let opening_node = ctx.nodes().parent_node(attribute_node.id());
        if !matches!(opening_node.kind(), AstKind::JSXOpeningElement(opening)
            if is_proven_intrinsic_jsx_element(opening, ctx)
                || effect_chain_is_react_native_jsx_element(opening, ctx))
        {
            return false;
        }
        did_find_host_ref = true;
    }
    did_find_host_ref
}

fn effect_chain_is_react_native_jsx_element(
    opening: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let oxc_ast::ast::JSXElementName::IdentifierReference(identifier) = &opening.name else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == "react-native"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn effect_chain_storage_setter_names(body: &FunctionBody<'_>) -> FxHashSet<String> {
    let mut setter_names = FxHashSet::default();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(call_expression)) = &declarator.init else {
                continue;
            };
            if !effect_chain_call_name(call_expression)
                .is_some_and(effect_chain_is_storage_hook_name)
            {
                continue;
            }
            for element in pattern.elements.iter().flatten() {
                let BindingPattern::BindingIdentifier(binding) = element else {
                    continue;
                };
                if effect_chain_is_setter_name(binding.name.as_str()) {
                    setter_names.insert(binding.name.to_string());
                }
            }
        }
    }
    setter_names
}

#[derive(Clone, Copy)]
struct EffectChainCleanupReturnProof {
    has_cleanup: bool,
    is_valid: bool,
}

fn effect_chain_expression_is_function_shaped_return<'a>(
    expression: &'a Expression<'a>,
    is_explicit_return: bool,
    state_by_setter_symbol_id: &FxHashMap<SymbolId, EffectChainStateBinding>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => true,
        Expression::Identifier(identifier) => {
            identifier.name != "undefined"
                || ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_some()
        }
        Expression::CallExpression(call) => {
            if effect_chain_setter_symbol_id(&call.callee, ctx)
                .is_some_and(|symbol_id| state_by_setter_symbol_id.contains_key(&symbol_id))
            {
                return false;
            }
            let invoked_function_id =
                effect_chain_resolve_function_id(&call.callee, ctx, &mut FxHashSet::default());
            if let Some(invoked_function_id) = invoked_function_id {
                if effect_chain_function_returns_only_non_cleanup_values(
                    invoked_function_id,
                    state_by_setter_symbol_id,
                    node_index,
                    ctx,
                    &mut FxHashSet::default(),
                ) {
                    return false;
                }
                let proof = effect_chain_resolved_function_cleanup_return_proof(
                    invoked_function_id,
                    node_index,
                    ctx,
                    &mut FxHashSet::default(),
                );
                if proof.is_valid {
                    return proof.has_cleanup;
                }
            } else if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if effect_chain_is_setter_name(identifier.name.as_str()))
            {
                return true;
            }
            is_explicit_return
        }
        _ => false,
    }
}

fn effect_chain_function_returns_only_non_cleanup_values(
    function_id: NodeId,
    state_by_setter_symbol_id: &FxHashMap<SymbolId, EffectChainStateBinding>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if effect_chain_function_is_async(function_id, ctx) || !visited_function_ids.insert(function_id)
    {
        return false;
    }
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        let mut expression_visited_function_ids = visited_function_ids.clone();
        return effect_chain_expression_is_non_cleanup_value(
            expression,
            state_by_setter_symbol_id,
            node_index,
            ctx,
            &mut expression_visited_function_ids,
        );
    }
    for candidate_id in node_index.node_ids(function_id) {
        let AstKind::ReturnStatement(statement) = ctx.nodes().get_node(*candidate_id).kind() else {
            continue;
        };
        let mut return_visited_function_ids = visited_function_ids.clone();
        if statement.argument.as_ref().is_some_and(|argument| {
            !effect_chain_expression_is_non_cleanup_value(
                argument,
                state_by_setter_symbol_id,
                node_index,
                ctx,
                &mut return_visited_function_ids,
            )
        }) {
            return false;
        }
    }
    true
}

fn effect_chain_expression_is_non_cleanup_value<'a>(
    expression: &'a Expression<'a>,
    state_by_setter_symbol_id: &FxHashMap<SymbolId, EffectChainStateBinding>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::JSXElement(_)
        | Expression::JSXFragment(_)
        | Expression::TemplateLiteral(_) => true,
        Expression::UnaryExpression(unary) => unary.operator == UnaryOperator::Void,
        Expression::ConditionalExpression(conditional) => {
            let mut consequent_visited_function_ids = visited_function_ids.clone();
            let mut alternate_visited_function_ids = visited_function_ids.clone();
            effect_chain_expression_is_non_cleanup_value(
                &conditional.consequent,
                state_by_setter_symbol_id,
                node_index,
                ctx,
                &mut consequent_visited_function_ids,
            ) && effect_chain_expression_is_non_cleanup_value(
                &conditional.alternate,
                state_by_setter_symbol_id,
                node_index,
                ctx,
                &mut alternate_visited_function_ids,
            )
        }
        Expression::LogicalExpression(logical) => {
            let mut left_visited_function_ids = visited_function_ids.clone();
            let mut right_visited_function_ids = visited_function_ids.clone();
            effect_chain_expression_is_non_cleanup_value(
                &logical.left,
                state_by_setter_symbol_id,
                node_index,
                ctx,
                &mut left_visited_function_ids,
            ) && effect_chain_expression_is_non_cleanup_value(
                &logical.right,
                state_by_setter_symbol_id,
                node_index,
                ctx,
                &mut right_visited_function_ids,
            )
        }
        Expression::SequenceExpression(sequence) => {
            let mut expression_visited_function_ids = visited_function_ids.clone();
            sequence.expressions.last().is_some_and(|expression| {
                effect_chain_expression_is_non_cleanup_value(
                    expression,
                    state_by_setter_symbol_id,
                    node_index,
                    ctx,
                    &mut expression_visited_function_ids,
                )
            })
        }
        Expression::NewExpression(new_expression) => {
            const NON_FUNCTION_CONSTRUCTORS: [&str; 13] = [
                "Array",
                "Boolean",
                "Date",
                "Map",
                "Number",
                "Promise",
                "RegExp",
                "Set",
                "String",
                "URL",
                "URLSearchParams",
                "WeakMap",
                "WeakSet",
            ];
            matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
                if NON_FUNCTION_CONSTRUCTORS.contains(&identifier.name.as_str())
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
        Expression::CallExpression(call) => {
            const NON_FUNCTION_CALLS: [&str; 7] = [
                "Array", "BigInt", "Boolean", "Date", "Number", "String", "Symbol",
            ];
            if matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                if NON_FUNCTION_CALLS.contains(&identifier.name.as_str())
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
            {
                return true;
            }
            if call
                .callee
                .get_inner_expression()
                .as_member_expression()
                .is_some_and(|member| {
                    matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                        if identifier.name == "Promise"
                            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
                        && matches!(member.static_property_name(), Some(
                            "all" | "allSettled" | "any" | "race" | "reject" | "resolve" | "withResolvers"
                        ))
                })
            {
                return true;
            }
            if effect_chain_setter_symbol_id(&call.callee, ctx)
                .is_some_and(|symbol_id| state_by_setter_symbol_id.contains_key(&symbol_id))
            {
                return true;
            }
            let Some(invoked_function_id) =
                effect_chain_resolve_function_id(&call.callee, ctx, &mut FxHashSet::default())
            else {
                return false;
            };
            let mut invoked_visited_function_ids = visited_function_ids.clone();
            effect_chain_function_returns_only_non_cleanup_values(
                invoked_function_id,
                state_by_setter_symbol_id,
                node_index,
                ctx,
                &mut invoked_visited_function_ids,
            )
        }
        _ => false,
    }
}

fn effect_chain_resolved_function_cleanup_return_proof(
    function_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> EffectChainCleanupReturnProof {
    if effect_chain_function_is_async(function_id, ctx) || !visited_function_ids.insert(function_id)
    {
        return EffectChainCleanupReturnProof {
            has_cleanup: false,
            is_valid: false,
        };
    }
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        let mut expression_visited_function_ids = visited_function_ids.clone();
        return effect_chain_cleanup_return_proof_for_expression(
            expression,
            node_index,
            ctx,
            &mut expression_visited_function_ids,
        );
    }
    let mut proof = EffectChainCleanupReturnProof {
        has_cleanup: false,
        is_valid: true,
    };
    for candidate_id in node_index.node_ids(function_id) {
        let AstKind::ReturnStatement(statement) = ctx.nodes().get_node(*candidate_id).kind() else {
            continue;
        };
        let Some(argument) = &statement.argument else {
            continue;
        };
        let mut return_visited_function_ids = visited_function_ids.clone();
        let return_proof = effect_chain_cleanup_return_proof_for_expression(
            argument,
            node_index,
            ctx,
            &mut return_visited_function_ids,
        );
        if !return_proof.is_valid {
            return EffectChainCleanupReturnProof {
                has_cleanup: false,
                is_valid: false,
            };
        }
        proof.has_cleanup |= return_proof.has_cleanup;
    }
    proof
}

fn effect_chain_cleanup_return_proof_for_expression<'a>(
    expression: &'a Expression<'a>,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> EffectChainCleanupReturnProof {
    let valid = |has_cleanup| EffectChainCleanupReturnProof {
        has_cleanup,
        is_valid: true,
    };
    let invalid = || EffectChainCleanupReturnProof {
        has_cleanup: false,
        is_valid: false,
    };
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => valid(true),
        Expression::Identifier(identifier) => {
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
            {
                return valid(false);
            }
            effect_chain_resolve_function_id_internal(
                expression,
                false,
                ctx,
                &mut FxHashSet::default(),
            )
            .map_or_else(invalid, |_| valid(true))
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::Void => valid(false),
        Expression::ConditionalExpression(conditional) => {
            let mut consequent_visited_function_ids = visited_function_ids.clone();
            let mut alternate_visited_function_ids = visited_function_ids.clone();
            let consequent = effect_chain_cleanup_return_proof_for_expression(
                &conditional.consequent,
                node_index,
                ctx,
                &mut consequent_visited_function_ids,
            );
            let alternate = effect_chain_cleanup_return_proof_for_expression(
                &conditional.alternate,
                node_index,
                ctx,
                &mut alternate_visited_function_ids,
            );
            EffectChainCleanupReturnProof {
                has_cleanup: consequent.has_cleanup || alternate.has_cleanup,
                is_valid: consequent.is_valid && alternate.is_valid,
            }
        }
        Expression::LogicalExpression(logical) => {
            let mut left_visited_function_ids = visited_function_ids.clone();
            let mut right_visited_function_ids = visited_function_ids.clone();
            let left = effect_chain_cleanup_return_proof_for_expression(
                &logical.left,
                node_index,
                ctx,
                &mut left_visited_function_ids,
            );
            let right = effect_chain_cleanup_return_proof_for_expression(
                &logical.right,
                node_index,
                ctx,
                &mut right_visited_function_ids,
            );
            EffectChainCleanupReturnProof {
                has_cleanup: left.has_cleanup || right.has_cleanup,
                is_valid: left.is_valid && right.is_valid,
            }
        }
        Expression::SequenceExpression(sequence) => {
            let mut expression_visited_function_ids = visited_function_ids.clone();
            sequence
                .expressions
                .last()
                .map_or_else(invalid, |expression| {
                    effect_chain_cleanup_return_proof_for_expression(
                        expression,
                        node_index,
                        ctx,
                        &mut expression_visited_function_ids,
                    )
                })
        }
        Expression::CallExpression(call) => {
            let Some(invoked_function_id) =
                effect_chain_resolve_function_id(&call.callee, ctx, &mut FxHashSet::default())
            else {
                return invalid();
            };
            let mut invoked_visited_function_ids = visited_function_ids.clone();
            effect_chain_resolved_function_cleanup_return_proof(
                invoked_function_id,
                node_index,
                ctx,
                &mut invoked_visited_function_ids,
            )
        }
        _ => invalid(),
    }
}

fn effect_chain_resolve_function_id<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    effect_chain_resolve_function_id_internal(expression, true, ctx, visited_symbol_ids)
}

fn effect_chain_resolve_function_id_internal<'a>(
    expression: &'a Expression<'a>,
    include_stable_callbacks: bool,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbol_ids.insert(symbol_id) {
                return None;
            }
            if ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
            {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            match declaration.kind() {
                AstKind::Function(function) => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator)
                    if effect_chain_symbol_is_const_binding(symbol_id, ctx) =>
                {
                    effect_chain_resolve_function_id_internal(
                        declarator.init.as_ref()?,
                        include_stable_callbacks,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                _ => None,
            }
        }
        Expression::CallExpression(call_expression)
            if include_stable_callbacks
                && is_react_hook_call(call_expression, &["useCallback"], ctx) =>
        {
            effect_chain_resolve_function_id_internal(
                call_expression.arguments.first()?.as_expression()?,
                true,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn effect_chain_expression_root_symbol<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let mut expression = expression.get_inner_expression();
    if let Expression::ChainExpression(chain) = expression {
        expression = chain
            .expression
            .as_member_expression()?
            .object()
            .get_inner_expression();
    }
    while let Some(member) = expression.as_member_expression() {
        expression = member.object().get_inner_expression();
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    resolve_const_identifier_root_symbol(identifier, ctx)
}

fn effect_chain_setter_symbol_id<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    resolve_const_identifier_root_symbol(identifier, ctx)
}

fn effect_chain_symbol_is_const_binding(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    declarator
        .id
        .get_binding_identifier()
        .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
        && matches!(ctx.nodes().parent_node(declaration.id()).kind(),
            AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
}

fn effect_chain_function_is_async(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async || function.generator,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => true,
    }
}

fn effect_chain_function_is_async_only(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => true,
    }
}

fn effect_chain_nearest_function_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .find_map(|ancestor| match ancestor.kind() {
            AstKind::Function(function) => Some(function.node_id.get()),
            AstKind::ArrowFunctionExpression(function) => Some(function.node_id.get()),
            _ => None,
        })
}

fn effect_chain_call_name<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
) -> Option<&'a str> {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => expression.as_member_expression()?.static_property_name(),
    }
}

fn effect_chain_is_setter_name(name: &str) -> bool {
    name.strip_prefix("set")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn effect_chain_is_storage_hook_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    let Some(after_use) = lowercase_name.strip_prefix("use") else {
        return false;
    };
    let Some(storage_index) = after_use.find("storage") else {
        return false;
    };
    after_use[..storage_index]
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn effect_chain_is_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
