use oxc_ast::{
    AstKind,
    ast::{Argument, AssignmentTarget, BindingPattern, Expression, JSXAttributeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ASYNC_DATA_CALLEE_NAMES: [&str; 9] = [
    "useApolloClient",
    "useMutation",
    "useQuery",
    "useLazyQuery",
    "useSubscription",
    "useSWR",
    "useSWRMutation",
    "useSWRInfinite",
    "fetch",
];
const FILE_READER_METHOD_NAMES: [&str; 4] = [
    "readAsArrayBuffer",
    "readAsBinaryString",
    "readAsDataURL",
    "readAsText",
];

#[derive(Debug, Default, Clone)]
pub struct RenderingUsetransitionLoading;

declare_oxc_lint!(
    /// Warns when a synchronous loading flag should use a transition.
    RenderingUsetransitionLoading,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Synchronous loading flag forces an urgent render.",
);

impl Rule for RenderingUsetransitionLoading {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::VariableDeclarator(declarator) = node.kind() else {
            return;
        };
        let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
            return;
        };
        let Some(BindingPattern::BindingIdentifier(state_binding)) =
            pattern.elements.first().and_then(Option::as_ref)
        else {
            return;
        };
        if !matches!(state_binding.name.as_str(), "isLoading" | "isPending") {
            return;
        }
        let Some(Expression::CallExpression(state_call)) = declarator
            .init
            .as_ref()
            .map(Expression::get_inner_expression)
        else {
            return;
        };
        if state_call.callee_name() != Some("useState")
            || !matches!(state_call.arguments.first(), Some(Argument::BooleanLiteral(value)) if !value.value)
        {
            return;
        }
        let setter_binding = pattern
            .elements
            .get(1)
            .and_then(Option::as_ref)
            .and_then(|binding| match binding {
                BindingPattern::BindingIdentifier(binding) => Some(binding),
                _ => None,
            });
        let Some(component_id) = transition_loading_nearest_function(node.id(), ctx) else {
            transition_loading_report(state_call, &state_binding.name, ctx);
            return;
        };
        let component_span = ctx.nodes().get_node(component_id).span();
        let setter_symbol_id = setter_binding.map(|binding| binding.symbol_id());
        if transition_loading_has_async_work(component_id, setter_symbol_id, ctx) {
            return;
        }
        if let Some(setter_symbol_id) = setter_symbol_id {
            if transition_loading_tracks_file_reader(component_id, setter_symbol_id, ctx)
                || transition_loading_setter_escapes(
                    component_span,
                    node.id(),
                    setter_symbol_id,
                    ctx,
                )
                || transition_loading_setter_alongside_async_signal(
                    component_id,
                    setter_symbol_id,
                    ctx,
                )
                || transition_loading_setter_in_event_listener(
                    component_span,
                    setter_symbol_id,
                    ctx,
                )
            {
                return;
            }
            let setter_calls =
                transition_loading_setter_calls(component_span, setter_symbol_id, ctx);
            if !setter_calls.is_empty()
                && (setter_calls.iter().any(|call_id| {
                    transition_loading_resource_event_attribute(*call_id, component_id, ctx)
                }) || setter_calls.iter().all(|call_id| {
                    transition_loading_is_bare_inline_handler(*call_id, component_id, ctx)
                }))
            {
                return;
            }
        }
        transition_loading_report(state_call, &state_binding.name, ctx);
    }
}

fn transition_loading_report(
    state_call: &oxc_ast::ast::CallExpression<'_>,
    state_name: &str,
    ctx: &LintContext<'_>,
) {
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "This makes the \"{state_name}\" update urgent and blocking because it's a plain useState flag, so if it's a state change & not a data fetch, use useTransition to keep the UI responsive while it runs"
        ))
        .with_label(state_call.span),
    );
}

fn transition_loading_nearest_function(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node_id).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn transition_loading_setter_calls(
    component_span: Span,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> Vec<NodeId> {
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::CallExpression(call) = candidate.kind() else {
                return None;
            };
            (component_span.contains_inclusive(call.span)
                && transition_loading_call_symbol(call, ctx) == Some(setter_symbol_id))
            .then_some(candidate.id())
        })
        .collect()
}

fn transition_loading_call_symbol(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
}

fn transition_loading_has_async_work(
    component_id: NodeId,
    setter_symbol_id: Option<SymbolId>,
    ctx: &LintContext<'_>,
) -> bool {
    let component_span = ctx.nodes().get_node(component_id).span();
    for candidate in ctx.nodes().iter() {
        if !component_span.contains_inclusive(candidate.span()) {
            continue;
        }
        if let AstKind::CallExpression(call) = candidate.kind() {
            if call
                .callee_name()
                .is_some_and(|name| ASYNC_DATA_CALLEE_NAMES.contains(&name) || name == "axios")
            {
                return true;
            }
            if let Some(member) = call.callee.as_member_expression() {
                let Some(method) = member.static_property_name() else {
                    continue;
                };
                if ASYNC_DATA_CALLEE_NAMES.contains(&method) || method == "axios" {
                    return true;
                }
                if setter_symbol_id.is_some()
                    && matches!(method, "then" | "catch" | "finally")
                    && call
                        .arguments
                        .iter()
                        .filter_map(Argument::as_expression)
                        .any(|argument| {
                            transition_loading_expression_calls_symbol(
                                argument.span(),
                                setter_symbol_id.unwrap(),
                                ctx,
                            )
                        })
                {
                    return true;
                }
            }
        }
        if let Some(setter_symbol_id) = setter_symbol_id
            && (matches!(candidate.kind(), AstKind::Function(function) if function.r#async)
                || matches!(candidate.kind(), AstKind::ArrowFunctionExpression(function) if function.r#async))
        {
            let function_span = candidate.span();
            if transition_loading_expression_calls_symbol(function_span, setter_symbol_id, ctx) {
                return true;
            }
        }
        if let Some(setter_symbol_id) = setter_symbol_id
            && matches!(candidate.kind(), AstKind::AwaitExpression(_))
            && let Some(owner_id) = transition_loading_nearest_function(candidate.id(), ctx)
            && transition_loading_expression_calls_symbol(
                ctx.nodes().get_node(owner_id).span(),
                setter_symbol_id,
                ctx,
            )
        {
            return true;
        }
    }
    false
}

fn transition_loading_expression_calls_symbol(
    span: Span,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        matches!(candidate.kind(), AstKind::CallExpression(call)
            if span.contains_inclusive(call.span)
                && transition_loading_call_symbol(call, ctx) == Some(symbol_id))
    })
}

fn transition_loading_setter_escapes(
    component_span: Span,
    declarator_id: NodeId,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .any(|reference| {
            let node = ctx.nodes().get_node(reference.node_id());
            if !component_span.contains_inclusive(node.span()) {
                return true;
            }
            for ancestor in ctx.nodes().ancestors(node.id()) {
                if ancestor.id() == declarator_id {
                    return false;
                }
                if let AstKind::CallExpression(call) = ancestor.kind()
                    && call.callee.span() == node.span()
                {
                    return false;
                }
                if let AstKind::ArrayExpression(array) = ancestor.kind()
                    && transition_loading_is_hook_dependency_array(ancestor.id(), array.span, ctx)
                {
                    return false;
                }
                if matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                ) {
                    break;
                }
            }
            true
        })
}

fn transition_loading_is_hook_dependency_array(
    array_id: NodeId,
    array_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(array_id);
    matches!(parent.kind(), AstKind::CallExpression(call)
        if call.arguments.iter().any(|argument| argument.span() == array_span)
            && call.callee_name().is_some_and(transition_loading_is_hook_name))
}

fn transition_loading_is_hook_name(name: &str) -> bool {
    name.starts_with("use") && name.as_bytes().get(3).is_some_and(u8::is_ascii_uppercase)
}

fn transition_loading_async_signal_symbols(
    component_span: Span,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let mut symbols = FxHashSet::default();
    for candidate in ctx.nodes().iter() {
        if !component_span.contains_inclusive(candidate.span()) {
            continue;
        }
        match candidate.kind() {
            AstKind::Function(function) if function.r#async => {
                if let Some(identifier) = &function.id {
                    symbols.insert(identifier.symbol_id());
                }
            }
            AstKind::VariableDeclarator(declarator) => {
                let Some(binding) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                let Some(initializer) = declarator.init.as_ref() else {
                    continue;
                };
                if matches!(initializer.get_inner_expression(),
                    Expression::ArrowFunctionExpression(function) if function.r#async)
                    || matches!(initializer.get_inner_expression(),
                        Expression::FunctionExpression(function) if function.r#async)
                    || matches!(initializer.get_inner_expression(), Expression::CallExpression(call)
                        if call.callee_name().is_some_and(|name| name.starts_with("use") && name.ends_with("Dispatch")))
                {
                    symbols.insert(binding.symbol_id());
                }
            }
            _ => {}
        }
    }
    symbols
}

fn transition_loading_setter_alongside_async_signal(
    component_id: NodeId,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let component_span = ctx.nodes().get_node(component_id).span();
    let async_symbols = transition_loading_async_signal_symbols(component_span, ctx);
    if async_symbols.is_empty() {
        return false;
    }
    ctx.nodes().iter().any(|candidate| {
        if candidate.id() == component_id
            || !component_span.contains_inclusive(candidate.span())
            || !matches!(
                candidate.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        {
            return false;
        }
        transition_loading_expression_calls_symbol(candidate.span(), setter_symbol_id, ctx)
            && async_symbols.iter().any(|symbol_id| {
                transition_loading_expression_calls_symbol(candidate.span(), *symbol_id, ctx)
            })
    })
}

fn transition_loading_setter_in_event_listener(
    component_span: Span,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !component_span.contains_inclusive(call.span)
            || call
                .callee
                .as_member_expression()
                .and_then(|member| member.static_property_name())
                != Some("addEventListener")
        {
            return false;
        }
        let Some(handler) = call.arguments.get(1).and_then(Argument::as_expression) else {
            return false;
        };
        match handler.get_inner_expression() {
            Expression::ArrowFunctionExpression(function) => {
                transition_loading_expression_calls_symbol(function.span, setter_symbol_id, ctx)
            }
            Expression::FunctionExpression(function) => {
                transition_loading_expression_calls_symbol(function.span, setter_symbol_id, ctx)
            }
            Expression::Identifier(identifier) => ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|handler_symbol| {
                    let declaration = ctx.symbol_declaration(handler_symbol);
                    transition_loading_expression_calls_symbol(
                        declaration.span(),
                        setter_symbol_id,
                        ctx,
                    )
                }),
            _ => false,
        }
    })
}

fn transition_loading_resource_event_attribute(
    call_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(call_id) {
        if ancestor.id() == component_id {
            return false;
        }
        if let AstKind::JSXAttribute(attribute) = ancestor.kind()
            && let JSXAttributeName::Identifier(name) = &attribute.name
        {
            return name.name.starts_with("onLoad")
                || name.name.starts_with("onError")
                || name.name.starts_with("onAbort")
                || name.name.starts_with("onProgress")
                || name.name.starts_with("onCanPlay")
                || name.name.starts_with("onStalled")
                || name.name.starts_with("onSuspend")
                || name.name.starts_with("onWaiting")
                || name.name.starts_with("onEnded");
        }
    }
    false
}

fn transition_loading_is_bare_inline_handler(
    call_id: NodeId,
    component_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let call = ctx.nodes().get_node(call_id);
    let parent = ctx.nodes().parent_node(call_id);
    let AstKind::ArrowFunctionExpression(arrow) = parent.kind() else {
        return false;
    };
    if arrow
        .get_expression()
        .is_none_or(|expression| expression.span() != call.span())
    {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(parent.id()) {
        if ancestor.id() == component_id {
            return false;
        }
        if let AstKind::JSXAttribute(attribute) = ancestor.kind()
            && let JSXAttributeName::Identifier(name) = &attribute.name
        {
            return name.name.starts_with("on")
                && name
                    .name
                    .as_bytes()
                    .get(2)
                    .is_some_and(u8::is_ascii_uppercase);
        }
    }
    false
}

fn transition_loading_tracks_file_reader(
    component_id: NodeId,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let component_span = ctx.nodes().get_node(component_id).span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(read_call) = candidate.kind() else {
            return false;
        };
        if !component_span.contains_inclusive(read_call.span) {
            return false;
        }
        let Some(member) = read_call.callee.as_member_expression() else {
            return false;
        };
        if !member
            .static_property_name()
            .is_some_and(|name| FILE_READER_METHOD_NAMES.contains(&name))
        {
            return false;
        }
        let Expression::Identifier(reader) = member.object().get_inner_expression() else {
            return false;
        };
        let Some(reader_symbol_id) = ctx
            .scoping()
            .get_reference(reader.reference_id())
            .symbol_id()
        else {
            return false;
        };
        let Some(origin_start) = transition_loading_file_reader_origin(
            reader_symbol_id,
            read_call.span.start,
            candidate.id(),
            ctx,
        ) else {
            return false;
        };
        if !transition_loading_setter_value_before(
            setter_symbol_id,
            true,
            0,
            read_call.span.start,
            candidate.id(),
            ctx,
        ) {
            return false;
        }
        ["onload", "onerror"].iter().all(|property| {
            transition_loading_latest_reader_callback(
                reader_symbol_id,
                property,
                origin_start,
                read_call.span.start,
                candidate.id(),
                ctx,
            )
            .is_some_and(|callback_span| {
                transition_loading_callback_clears_setter(
                    callback_span,
                    setter_symbol_id,
                    ctx,
                    &mut FxHashSet::default(),
                )
            })
        })
    })
}

fn transition_loading_file_reader_origin(
    reader_symbol_id: SymbolId,
    before: u32,
    read_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<u32> {
    let owner = transition_loading_nearest_function(read_id, ctx)?;
    let declaration = ctx.symbol_declaration(reader_symbol_id);
    let mut latest = match declaration.kind() {
        AstKind::VariableDeclarator(declarator)
            if declaration.span().start < before
                && transition_loading_nearest_function(declaration.id(), ctx) == Some(owner)
                && declarator.init.as_ref().is_some_and(|initializer| {
                    transition_loading_is_global_file_reader(initializer, ctx)
                }) =>
        {
            Some(declaration.span().start)
        }
        _ => None,
    };
    for candidate in ctx.nodes().iter() {
        let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
            continue;
        };
        if candidate.span().start >= before
            || transition_loading_nearest_function(candidate.id(), ctx) != Some(owner)
        {
            continue;
        }
        let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
            continue;
        };
        if ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            == Some(reader_symbol_id)
            && transition_loading_is_global_file_reader(&assignment.right, ctx)
            && latest.is_none_or(|start| start < candidate.span().start)
        {
            latest = Some(candidate.span().start);
        }
    }
    latest
}

fn transition_loading_is_global_file_reader(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(expression.get_inner_expression(), Expression::NewExpression(new_expression)
        if matches!(new_expression.callee.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "FileReader" && ctx.is_reference_to_global_variable(identifier)))
}

fn transition_loading_setter_value_before(
    setter_symbol_id: SymbolId,
    value: bool,
    after: u32,
    before: u32,
    owner_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let owner = transition_loading_nearest_function(owner_node_id, ctx);
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        call.span.start > after
            && call.span.start < before
            && transition_loading_nearest_function(candidate.id(), ctx) == owner
            && transition_loading_call_symbol(call, ctx) == Some(setter_symbol_id)
            && matches!(call.arguments.first(), Some(Argument::BooleanLiteral(literal)) if literal.value == value)
    })
}

fn transition_loading_latest_reader_callback(
    reader_symbol_id: SymbolId,
    property_name: &str,
    after: u32,
    before: u32,
    owner_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    let owner = transition_loading_nearest_function(owner_node_id, ctx);
    ctx.nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::AssignmentExpression(assignment) = candidate.kind() else {
                return None;
            };
            if candidate.span().start <= after
                || candidate.span().start >= before
                || transition_loading_nearest_function(candidate.id(), ctx) != owner
            {
                return None;
            }
            let member = assignment.left.as_member_expression()?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            (member.static_property_name() == Some(property_name)
                && ctx
                    .scoping()
                    .get_reference(receiver.reference_id())
                    .symbol_id()
                    == Some(reader_symbol_id))
            .then_some((candidate.span().start, assignment.right.span()))
        })
        .max_by_key(|(start, _)| *start)
        .map(|(_, span)| span)
}

fn transition_loading_callback_clears_setter(
    callback_span: Span,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if let Some(identifier_symbol_id) = ctx.nodes().iter().find_map(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return None;
        };
        if identifier.span != callback_span {
            return None;
        }
        ctx.scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
    }) {
        if !visited_symbols.insert(identifier_symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(identifier_symbol_id);
        let resolved_span = match declaration.kind() {
            AstKind::Function(function) => Some(function.span),
            AstKind::VariableDeclarator(declarator) => declarator.init.as_ref().map(GetSpan::span),
            _ => None,
        };
        return resolved_span.is_some_and(|span| {
            transition_loading_callback_clears_setter(span, setter_symbol_id, ctx, visited_symbols)
        });
    }
    if transition_loading_expression_calls_setter_value(callback_span, setter_symbol_id, false, ctx)
    {
        return true;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return false;
        };
        if !callback_span.contains_inclusive(call.span) {
            return false;
        }
        let Some(helper_symbol_id) = transition_loading_call_symbol(call, ctx) else {
            return false;
        };
        if !visited_symbols.insert(helper_symbol_id) {
            return false;
        }
        let declaration = ctx.symbol_declaration(helper_symbol_id);
        let helper_span = match declaration.kind() {
            AstKind::Function(function) => Some(function.span),
            AstKind::VariableDeclarator(declarator) => declarator.init.as_ref().map(GetSpan::span),
            _ => None,
        };
        helper_span.is_some_and(|span| {
            transition_loading_callback_clears_setter(span, setter_symbol_id, ctx, visited_symbols)
        })
    })
}

fn transition_loading_expression_calls_setter_value(
    span: Span,
    setter_symbol_id: SymbolId,
    value: bool,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        matches!(candidate.kind(), AstKind::CallExpression(call)
            if span.contains_inclusive(call.span)
                && transition_loading_call_symbol(call, ctx) == Some(setter_symbol_id)
                && matches!(call.arguments.first(), Some(Argument::BooleanLiteral(literal)) if literal.value == value))
    })
}
