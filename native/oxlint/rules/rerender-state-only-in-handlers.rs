use oxc_ast::{
    AstKind,
    ast::{
        Argument, ArrayExpressionElement, BindingPattern, Expression, FunctionBody, FunctionType,
        JSXAttributeName, JSXElementName, SimpleAssignmentTarget, Statement, UnaryOperator,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashSet;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const RERENDER_EFFECT_HOOK_NAMES: [&str; 2] = ["useEffect", "useLayoutEffect"];
const RERENDER_BUILTIN_HOOK_NAMES: [&str; 16] = [
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
];
const RERENDER_SYNCHRONOUS_ITERATOR_METHOD_NAMES: [&str; 10] = [
    "every",
    "filter",
    "find",
    "findIndex",
    "flatMap",
    "forEach",
    "map",
    "reduce",
    "reduceRight",
    "some",
];
const RERENDER_MUTATING_COLLECTION_METHOD_NAMES: [&str; 5] =
    ["add", "push", "set", "splice", "unshift"];

#[derive(Debug, Default, Clone)]
pub struct RerenderStateOnlyInHandlers;

declare_oxc_lint!(
    /// Warns when useState is updated but does not contribute to rendered output.
    RerenderStateOnlyInHandlers,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Warns when state is set but never shown on screen.",
);

#[derive(Clone, Copy)]
struct RerenderStateBinding<'a> {
    value_name: &'a str,
    setter_name: &'a str,
    value_symbol_id: SymbolId,
    setter_symbol_id: SymbolId,
    declarator_span: Span,
}

impl Rule for RerenderStateOnlyInHandlers {
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
                            rerender_is_component_name(identifier.name.as_str())
                        }) =>
                {
                    if let Some(body) = &function.body {
                        rerender_check_component(body, function.node_id.get(), &node_index, ctx);
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !rerender_is_component_name(identifier.name.as_str()) {
                        continue;
                    }
                    match &declarator.init {
                        Some(Expression::ArrowFunctionExpression(function)) => {
                            if let Some(body) = function.body.as_function_body() {
                                rerender_check_component(
                                    body,
                                    function.node_id.get(),
                                    &node_index,
                                    ctx,
                                );
                            }
                        }
                        Some(Expression::FunctionExpression(function)) => {
                            if let Some(body) = &function.body {
                                rerender_check_component(
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

fn rerender_check_component<'a>(
    body: &'a FunctionBody<'a>,
    component_node_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'a>,
) {
    if !rerender_component_has_render_return(body, component_node_id, node_index, ctx) {
        return;
    }
    let bindings = rerender_collect_state_bindings(body, ctx);
    if bindings.is_empty() {
        return;
    }
    let component_has_render_phase_call =
        rerender_component_has_render_phase_non_hook_call(component_node_id, node_index, ctx);
    let component_renders_location =
        rerender_component_renders_location(component_node_id, node_index, ctx);
    let custom_hook_argument_names = rerender_custom_hook_argument_names(component_node_id, ctx);

    for binding in bindings {
        if binding.value_name.starts_with('_')
            || rerender_is_force_render_setter(binding.setter_name)
            || !rerender_setter_is_called(binding.setter_symbol_id, ctx)
            || rerender_setter_is_called_during_render(
                binding.setter_symbol_id,
                component_node_id,
                ctx,
            )
            || rerender_state_is_effect_consumed(&binding, component_node_id, node_index, ctx)
            || custom_hook_argument_names.contains(binding.value_name)
            || rerender_symbol_is_render_reachable(
                binding.value_symbol_id,
                component_node_id,
                component_has_render_phase_call,
                ctx,
                &mut FxHashSet::default(),
            )
            || (component_renders_location
                && rerender_setter_invalidates_location(
                    binding.setter_symbol_id,
                    component_node_id,
                    ctx,
                ))
        {
            continue;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Each update to \"{}\" redraws your component for nothing because this useState is set but never shown on screen.",
                binding.value_name
            ))
            .with_label(binding.declarator_span),
        );
    }
}

fn rerender_collect_state_bindings<'a>(
    body: &'a FunctionBody<'a>,
    ctx: &LintContext<'a>,
) -> Vec<RerenderStateBinding<'a>> {
    let mut bindings = Vec::new();
    for statement in &body.statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(value)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(setter)) =
                pattern.elements.get(1).and_then(Option::as_ref)
            else {
                continue;
            };
            if !rerender_is_setter_name(setter.name.as_str()) {
                continue;
            }
            let Some(Expression::CallExpression(use_state_call)) = &declarator.init else {
                continue;
            };
            if !is_react_hook_call(use_state_call, &["useState"], ctx) {
                continue;
            }
            bindings.push(RerenderStateBinding {
                value_name: value.name.as_str(),
                setter_name: setter.name.as_str(),
                value_symbol_id: value.symbol_id(),
                setter_symbol_id: setter.symbol_id(),
                declarator_span: declarator.span,
            });
        }
    }
    bindings
}

fn rerender_component_has_render_return(
    body: &FunctionBody<'_>,
    component_node_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    node_index.node_ids(component_node_id).iter().any(|candidate_id| {
        let candidate = ctx.nodes().get_node(*candidate_id);
        matches!(candidate.kind(), AstKind::ReturnStatement(return_statement) if return_statement.argument.is_some())
            && body.span.contains_inclusive(candidate.span())
    })
}

fn rerender_statement_has_component_render_return(
    statement_span: Span,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        matches!(candidate.kind(), AstKind::ReturnStatement(return_statement)
            if return_statement.argument.is_some())
            && statement_span.contains_inclusive(candidate.span())
            && rerender_nearest_function_node_id(candidate.id(), ctx) == Some(component_node_id)
    })
}

fn rerender_controlled_region_updates_rendered_value(
    region_span: Span,
    component_node_id: NodeId,
    component_has_render_phase_call: bool,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    ctx.nodes()
        .iter()
        .filter(|candidate| {
            region_span.contains_inclusive(candidate.span())
                && rerender_nearest_function_node_id(candidate.id(), ctx) == Some(component_node_id)
        })
        .any(|candidate| match candidate.kind() {
            AstKind::AssignmentExpression(assignment) => {
                rerender_assignment_target_root_symbol(assignment, ctx).is_some_and(
                    |target_symbol_id| {
                        rerender_symbol_is_render_reachable(
                            target_symbol_id,
                            component_node_id,
                            component_has_render_phase_call,
                            ctx,
                            &mut visited_symbol_ids.clone(),
                        )
                    },
                ) || rerender_assignment_target_symbol_ids(assignment, ctx)
                    .into_iter()
                    .any(|target_symbol_id| {
                        rerender_symbol_is_render_reachable(
                            target_symbol_id,
                            component_node_id,
                            component_has_render_phase_call,
                            ctx,
                            &mut visited_symbol_ids.clone(),
                        )
                    })
            }
            AstKind::CallExpression(call_expression) => {
                let Some(member) = call_expression
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                else {
                    return false;
                };
                member.static_property_name().is_some_and(|method_name| {
                    RERENDER_MUTATING_COLLECTION_METHOD_NAMES.contains(&method_name.as_ref())
                }) && rerender_expression_root_symbol(member.object(), ctx).is_some_and(
                    |receiver_symbol_id| {
                        rerender_symbol_is_render_reachable(
                            receiver_symbol_id,
                            component_node_id,
                            component_has_render_phase_call,
                            ctx,
                            &mut visited_symbol_ids.clone(),
                        )
                    },
                )
            }
            _ => false,
        })
}

fn rerender_collect_binding_symbol_ids(
    pattern: &BindingPattern<'_>,
    symbol_ids: &mut FxHashSet<SymbolId>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => {
            symbol_ids.insert(identifier.symbol_id());
        }
        BindingPattern::AssignmentPattern(assignment) => {
            rerender_collect_binding_symbol_ids(&assignment.left, symbol_ids);
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                rerender_collect_binding_symbol_ids(&property.value, symbol_ids);
            }
            if let Some(rest) = &object.rest {
                rerender_collect_binding_symbol_ids(&rest.argument, symbol_ids);
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                rerender_collect_binding_symbol_ids(element, symbol_ids);
            }
            if let Some(rest) = &array.rest {
                rerender_collect_binding_symbol_ids(&rest.argument, symbol_ids);
            }
        }
    }
}

fn rerender_setter_is_called(setter_symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .any(|reference| rerender_reference_is_call_callee(reference.node_id(), ctx))
}

fn rerender_setter_is_called_during_render(
    setter_symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .filter(|reference| rerender_reference_is_call_callee(reference.node_id(), ctx))
        .any(|reference| {
            rerender_nearest_function_node_id(reference.node_id(), ctx) == Some(component_node_id)
        })
}

fn rerender_symbol_is_render_reachable(
    symbol_id: SymbolId,
    component_node_id: NodeId,
    component_has_render_phase_call: bool,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let reference_node_ids = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .map(|reference| reference.node_id())
        .collect::<Vec<_>>();
    reference_node_ids.into_iter().any(|reference_node_id| {
        if rerender_node_is_custom_hook_argument(reference_node_id, component_node_id, ctx) {
            return true;
        }
        rerender_node_flows_to_render(
            reference_node_id,
            component_node_id,
            component_has_render_phase_call,
            ctx,
            &mut visited_symbol_ids.clone(),
        )
    })
}

fn rerender_node_flows_to_render(
    node_id: NodeId,
    component_node_id: NodeId,
    component_has_render_phase_call: bool,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let source_span = ctx.nodes().get_node(node_id).span();
    let mut current_id = node_id;
    let mut did_cross_unbound_function = false;
    loop {
        let parent = ctx.nodes().parent_node(current_id);
        match parent.kind() {
            AstKind::JSXAttribute(attribute) => {
                if let Some(function_node_id) = rerender_nearest_function_node_id(node_id, ctx)
                    && function_node_id != component_node_id
                {
                    return rerender_function_result_flows_to_render(
                        function_node_id,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    );
                }
                return !rerender_is_event_handler_attribute_name(&attribute.name)
                    || !rerender_node_is_direct_event_handler_value(node_id, parent.id(), ctx);
            }
            AstKind::ObjectProperty(property)
                if property
                    .key
                    .static_name()
                    .is_some_and(|name| rerender_is_event_handler_name(name.as_ref()))
                    && (did_cross_unbound_function
                        || rerender_node_resolves_to_function(node_id, ctx)) =>
            {
                return false;
            }
            AstKind::ReturnStatement(_) => {
                let Some(return_owner_node_id) =
                    rerender_nearest_function_node_id(parent.id(), ctx)
                else {
                    return false;
                };
                if return_owner_node_id == component_node_id {
                    return true;
                }
                return rerender_function_result_flows_to_render(
                    return_owner_node_id,
                    component_node_id,
                    component_has_render_phase_call,
                    ctx,
                    visited_symbol_ids,
                );
            }
            AstKind::VariableDeclarator(declarator) if declarator.init.is_some() => {
                if rerender_nearest_function_node_id(parent.id(), ctx) != Some(component_node_id) {
                    current_id = parent.id();
                    continue;
                }
                let mut binding_symbol_ids = FxHashSet::default();
                rerender_collect_binding_symbol_ids(&declarator.id, &mut binding_symbol_ids);
                for binding_symbol_id in binding_symbol_ids {
                    if rerender_symbol_is_effect_dependency(
                        binding_symbol_id,
                        component_node_id,
                        ctx,
                    ) || rerender_symbol_is_render_reachable(
                        binding_symbol_id,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    ) {
                        return true;
                    }
                }
            }
            AstKind::AssignmentExpression(assignment) => {
                if rerender_nearest_function_node_id(parent.id(), ctx) != Some(component_node_id) {
                    current_id = parent.id();
                    continue;
                }
                if let Some(target_symbol_id) =
                    rerender_assignment_target_root_symbol(assignment, ctx)
                    && rerender_symbol_is_render_reachable(
                        target_symbol_id,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    )
                {
                    return true;
                }
                for target_symbol_id in rerender_assignment_target_symbol_ids(assignment, ctx) {
                    if rerender_symbol_is_render_reachable(
                        target_symbol_id,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    ) {
                        return true;
                    }
                }
            }
            AstKind::CallExpression(call_expression) => {
                if rerender_call_is_standalone_render_phase_hook(parent.id(), call_expression, ctx)
                    && call_expression.arguments.iter().any(|argument| {
                        argument
                            .as_expression()
                            .is_some_and(|argument| argument.span().contains_inclusive(source_span))
                    })
                    && rerender_nearest_function_node_id(parent.id(), ctx)
                        == Some(component_node_id)
                {
                    return true;
                }
                if rerender_nearest_function_node_id(parent.id(), ctx) == Some(component_node_id) {
                    if rerender_iterator_mutates_rendered_collection(
                        call_expression,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    ) {
                        return true;
                    }
                    if rerender_call_argument_mutates_rendered_collection(
                        call_expression,
                        source_span,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    ) {
                        return true;
                    }
                }
            }
            AstKind::UnaryExpression(unary_expression)
                if unary_expression.operator == UnaryOperator::Void
                    && component_has_render_phase_call
                    && matches!(
                        ctx.nodes().parent_node(parent.id()).kind(),
                        AstKind::ExpressionStatement(_)
                    )
                    && matches!(
                        ctx.nodes()
                            .parent_node(ctx.nodes().parent_node(parent.id()).id())
                            .kind(),
                        AstKind::FunctionBody(_)
                    )
                    && rerender_nearest_function_node_id(parent.id(), ctx)
                        == Some(component_node_id) =>
            {
                return true;
            }
            AstKind::IfStatement(if_statement)
                if if_statement.test.span().contains_inclusive(source_span)
                    && (rerender_statement_has_component_render_return(
                        if_statement.span,
                        component_node_id,
                        ctx,
                    ) || rerender_controlled_region_updates_rendered_value(
                        if_statement.span,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    ))
                    && rerender_nearest_function_node_id(parent.id(), ctx)
                        == Some(component_node_id) =>
            {
                return true;
            }
            AstKind::SwitchStatement(switch_statement)
                if switch_statement
                    .discriminant
                    .span()
                    .contains_inclusive(source_span)
                    && (rerender_statement_has_component_render_return(
                        switch_statement.span,
                        component_node_id,
                        ctx,
                    ) || rerender_controlled_region_updates_rendered_value(
                        switch_statement.span,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    ))
                    && rerender_nearest_function_node_id(parent.id(), ctx)
                        == Some(component_node_id) =>
            {
                return true;
            }
            AstKind::SwitchCase(switch_case)
                if switch_case
                    .test
                    .as_ref()
                    .is_some_and(|test| test.span().contains_inclusive(source_span))
                    && (rerender_statement_has_component_render_return(
                        switch_case.span,
                        component_node_id,
                        ctx,
                    ) || rerender_controlled_region_updates_rendered_value(
                        switch_case.span,
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    )) =>
            {
                return true;
            }
            AstKind::WhileStatement(statement)
                if statement.test.span().contains_inclusive(source_span)
                    && (rerender_statement_has_component_render_return(
                        statement.body.span(),
                        component_node_id,
                        ctx,
                    ) || rerender_controlled_region_updates_rendered_value(
                        statement.body.span(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    )) =>
            {
                return true;
            }
            AstKind::DoWhileStatement(statement)
                if statement.test.span().contains_inclusive(source_span)
                    && (rerender_statement_has_component_render_return(
                        statement.body.span(),
                        component_node_id,
                        ctx,
                    ) || rerender_controlled_region_updates_rendered_value(
                        statement.body.span(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    )) =>
            {
                return true;
            }
            AstKind::ForStatement(statement)
                if (statement
                    .init
                    .as_ref()
                    .is_some_and(|init| init.span().contains_inclusive(source_span))
                    || statement
                        .test
                        .as_ref()
                        .is_some_and(|test| test.span().contains_inclusive(source_span))
                    || statement
                        .update
                        .as_ref()
                        .is_some_and(|update| update.span().contains_inclusive(source_span)))
                    && (rerender_statement_has_component_render_return(
                        statement.body.span(),
                        component_node_id,
                        ctx,
                    ) || rerender_controlled_region_updates_rendered_value(
                        statement.body.span(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    )) =>
            {
                return true;
            }
            AstKind::ForInStatement(statement)
                if statement.right.span().contains_inclusive(source_span)
                    && (rerender_statement_has_component_render_return(
                        statement.body.span(),
                        component_node_id,
                        ctx,
                    ) || rerender_controlled_region_updates_rendered_value(
                        statement.body.span(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    )) =>
            {
                return true;
            }
            AstKind::ForOfStatement(statement)
                if statement.right.span().contains_inclusive(source_span)
                    && (rerender_statement_has_component_render_return(
                        statement.body.span(),
                        component_node_id,
                        ctx,
                    ) || rerender_controlled_region_updates_rendered_value(
                        statement.body.span(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    )) =>
            {
                return true;
            }
            AstKind::WithStatement(statement)
                if statement.object.span().contains_inclusive(source_span)
                    && rerender_statement_has_component_render_return(
                        statement.body.span(),
                        component_node_id,
                        ctx,
                    ) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if expression.test.span().contains_inclusive(source_span)
                    && (rerender_controlled_region_updates_rendered_value(
                        expression.consequent.span(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    ) || rerender_controlled_region_updates_rendered_value(
                        expression.alternate.span(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    )) =>
            {
                return true;
            }
            AstKind::LogicalExpression(expression)
                if expression.left.span().contains_inclusive(source_span)
                    && rerender_controlled_region_updates_rendered_value(
                        expression.right.span(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        visited_symbol_ids,
                    ) =>
            {
                return true;
            }
            AstKind::Function(function) => {
                if function.node_id.get() == component_node_id {
                    return false;
                }
                if rerender_function_result_flows_to_render(
                    function.node_id.get(),
                    component_node_id,
                    component_has_render_phase_call,
                    ctx,
                    visited_symbol_ids,
                ) {
                    return true;
                }
                if rerender_function_binding_symbol_id(function.node_id.get(), ctx).is_some() {
                    return false;
                }
                did_cross_unbound_function = true;
            }
            AstKind::ArrowFunctionExpression(function) => {
                if function.node_id.get() == component_node_id {
                    return false;
                }
                if rerender_function_result_flows_to_render(
                    function.node_id.get(),
                    component_node_id,
                    component_has_render_phase_call,
                    ctx,
                    visited_symbol_ids,
                ) {
                    return true;
                }
                if rerender_function_binding_symbol_id(function.node_id.get(), ctx).is_some() {
                    return false;
                }
                did_cross_unbound_function = true;
            }
            _ => {}
        }
        if parent.id() == component_node_id || matches!(parent.kind(), AstKind::Program(_)) {
            return false;
        }
        current_id = parent.id();
    }
}

fn rerender_function_result_flows_to_render(
    function_node_id: NodeId,
    component_node_id: NodeId,
    component_has_render_phase_call: bool,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let mut is_inside_jsx_expression = false;
    for ancestor in ctx.nodes().ancestors(function_node_id) {
        match ancestor.kind() {
            AstKind::ObjectProperty(property)
                if property
                    .key
                    .static_name()
                    .is_some_and(|name| rerender_is_event_handler_name(name.as_ref())) =>
            {
                return false;
            }
            AstKind::JSXAttribute(attribute) => {
                return !rerender_is_event_handler_attribute_name(&attribute.name);
            }
            AstKind::JSXExpressionContainer(_) => {
                is_inside_jsx_expression = true;
            }
            AstKind::JSXElement(_) | AstKind::JSXFragment(_) if is_inside_jsx_expression => {
                return true;
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => break,
            _ => {}
        }
    }
    let function_span = ctx.nodes().get_node(function_node_id).span();
    if ctx.nodes().ancestors(function_node_id).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::CallExpression(call_expression)
        if is_react_hook_call(call_expression, &["useMemo"], ctx)
            && call_expression.arguments.iter().any(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    argument.span().contains_inclusive(function_span)
                })
            })
            && rerender_node_flows_to_render(
                ancestor.id(),
                component_node_id,
                component_has_render_phase_call,
                ctx,
                &mut visited_symbol_ids.clone(),
            ))
    }) {
        return true;
    }
    if rerender_function_is_render_iterator_callback(
        function_node_id,
        component_node_id,
        component_has_render_phase_call,
        ctx,
        visited_symbol_ids,
    ) {
        return true;
    }
    if let Some(function_symbol_id) = rerender_function_binding_symbol_id(function_node_id, ctx)
        .or_else(|| rerender_function_dependency_binding_symbol_id(function_node_id, ctx))
    {
        if ctx
            .scoping()
            .get_resolved_references(function_symbol_id)
            .any(|reference| {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let call_node = ctx.nodes().parent_node(reference_node.id());
                matches!(call_node.kind(), AstKind::CallExpression(call_expression)
                if call_expression.callee.span().contains_inclusive(reference_node.span())
                    && rerender_node_flows_to_render(
                        call_node.id(),
                        component_node_id,
                        component_has_render_phase_call,
                        ctx,
                        &mut visited_symbol_ids.clone(),
                    ))
            })
        {
            return true;
        }
        return rerender_symbol_is_effect_dependency(function_symbol_id, component_node_id, ctx)
            || rerender_symbol_is_render_reachable(
                function_symbol_id,
                component_node_id,
                component_has_render_phase_call,
                ctx,
                visited_symbol_ids,
            );
    }
    let mut enclosing_function_node_id = None;
    for ancestor in ctx.nodes().ancestors(function_node_id) {
        let ancestor_function_node_id = match ancestor.kind() {
            AstKind::Function(function) => function.node_id.get(),
            AstKind::ArrowFunctionExpression(function) => function.node_id.get(),
            _ => continue,
        };
        if ancestor_function_node_id == component_node_id {
            break;
        }
        if rerender_function_binding_symbol_id(ancestor_function_node_id, ctx).is_some() {
            enclosing_function_node_id = Some(ancestor_function_node_id);
            break;
        }
    }
    enclosing_function_node_id.is_some_and(|enclosing_function_node_id| {
        rerender_function_result_flows_to_render(
            enclosing_function_node_id,
            component_node_id,
            component_has_render_phase_call,
            ctx,
            visited_symbol_ids,
        )
    })
}

fn rerender_custom_hook_argument_names(
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    let component_span = ctx.nodes().get_node(component_node_id).span();
    ctx.nodes()
        .iter()
        .filter(|node| component_span.contains_inclusive(node.span()))
        .filter_map(|node| {
            let name = match node.kind() {
                AstKind::IdentifierReference(identifier) => identifier.name.as_str(),
                AstKind::BindingIdentifier(identifier) => identifier.name.as_str(),
                AstKind::IdentifierName(identifier) => identifier.name.as_str(),
                _ => return None,
            };
            rerender_node_is_custom_hook_argument(node.id(), component_node_id, ctx)
                .then(|| name.to_string())
        })
        .collect()
}

fn rerender_node_is_custom_hook_argument(
    node_id: NodeId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let node_span = ctx.nodes().get_node(node_id).span();
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == component_node_id {
            return false;
        }
        let AstKind::CallExpression(call_expression) = ancestor.kind() else {
            continue;
        };
        let Expression::Identifier(callee) = &call_expression.callee else {
            continue;
        };
        let callee_name = callee.name.as_str();
        if !rerender_is_hook_name(callee_name)
            || RERENDER_BUILTIN_HOOK_NAMES.contains(&callee_name)
            || is_react_hook_call(call_expression, &RERENDER_BUILTIN_HOOK_NAMES, ctx)
            || !call_expression.arguments.iter().any(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|argument| argument.span().contains_inclusive(node_span))
            })
        {
            continue;
        }
        return true;
    }
    false
}

fn rerender_function_is_render_iterator_callback(
    function_node_id: NodeId,
    component_node_id: NodeId,
    component_has_render_phase_call: bool,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let function_span = ctx.nodes().get_node(function_node_id).span();
    for ancestor in ctx.nodes().ancestors(function_node_id) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
        let AstKind::CallExpression(call_expression) = ancestor.kind() else {
            continue;
        };
        let Some(member) = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            return false;
        };
        if !member.static_property_name().is_some_and(|method_name| {
            RERENDER_SYNCHRONOUS_ITERATOR_METHOD_NAMES.contains(&method_name.as_ref())
        }) || !call_expression.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span().contains_inclusive(function_span))
        }) {
            return false;
        }
        return rerender_node_flows_to_render(
            ancestor.id(),
            component_node_id,
            component_has_render_phase_call,
            ctx,
            visited_symbol_ids,
        );
    }
    false
}

fn rerender_state_is_effect_consumed(
    binding: &RerenderStateBinding<'_>,
    component_node_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let dependent_effects = node_index
        .node_ids(component_node_id)
        .iter()
        .filter_map(|candidate| {
            let candidate = ctx.nodes().get_node(*candidate);
            let AstKind::CallExpression(effect_call) = candidate.kind() else {
                return None;
            };
            if !is_react_hook_call(effect_call, &RERENDER_EFFECT_HOOK_NAMES, ctx)
                || !rerender_effect_depends_on_state(effect_call, binding.value_symbol_id, ctx)
            {
                return None;
            }
            Some(effect_call)
        })
        .collect::<Vec<_>>();
    if dependent_effects.is_empty() {
        return false;
    }
    !dependent_effects.into_iter().any(|effect_call| {
        let Some(callback) = effect_call
            .arguments
            .first()
            .and_then(Argument::as_expression)
        else {
            return false;
        };
        let Some(callback_node_id) = rerender_function_expression_node_id(callback) else {
            return false;
        };
        let callback_span = callback.span();
        let mut has_synchronous_setter_call = false;
        let mut has_nested_setter_call = false;
        for reference in ctx
            .scoping()
            .get_resolved_references(binding.setter_symbol_id)
            .filter(|reference| {
                callback_span.contains_inclusive(ctx.nodes().get_node(reference.node_id()).span())
            })
        {
            if !rerender_reference_is_call_callee(reference.node_id(), ctx) {
                continue;
            }
            if rerender_nearest_function_node_id(reference.node_id(), ctx) == Some(callback_node_id)
            {
                has_synchronous_setter_call = true;
            } else {
                has_nested_setter_call = true;
            }
        }
        if !has_synchronous_setter_call || has_nested_setter_call {
            return false;
        }
        let has_payload_read = ctx
            .scoping()
            .get_resolved_references(binding.value_symbol_id)
            .filter(|reference| {
                callback_span.contains_inclusive(ctx.nodes().get_node(reference.node_id()).span())
            })
            .any(|reference| {
                rerender_effect_reference_is_payload_read(
                    reference.node_id(),
                    callback_node_id,
                    binding.setter_symbol_id,
                    ctx,
                )
            });
        !has_payload_read
    })
}

fn rerender_effect_depends_on_state(
    effect_call: &oxc_ast::ast::CallExpression<'_>,
    state_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    effect_call.arguments.iter().skip(1).any(|argument| {
        let Some(Expression::ArrayExpression(dependencies)) = argument.as_expression() else {
            return false;
        };
        dependencies
            .elements
            .iter()
            .filter_map(ArrayExpressionElement::as_expression)
            .any(|dependency| {
                rerender_expression_root_symbol(dependency, ctx) == Some(state_symbol_id)
            })
    })
}

fn rerender_symbol_is_effect_dependency(
    symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(effect_call) = candidate.kind() else {
            return false;
        };
        rerender_nearest_function_node_id(candidate.id(), ctx) == Some(component_node_id)
            && is_react_hook_call(effect_call, &RERENDER_EFFECT_HOOK_NAMES, ctx)
            && rerender_effect_depends_on_state(effect_call, symbol_id, ctx)
    })
}

fn rerender_effect_reference_is_payload_read(
    reference_node_id: NodeId,
    callback_node_id: NodeId,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let reference_span = ctx.nodes().get_node(reference_node_id).span();
    let parent = ctx.nodes().parent_node(reference_node_id);
    if parent
        .kind()
        .as_member_expression_kind()
        .is_some_and(|member| member.object().span().contains_inclusive(reference_span))
    {
        return !rerender_is_inside_condition_test(reference_node_id, callback_node_id, ctx);
    }
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    if !call_expression.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|argument| argument.span().contains_inclusive(reference_span))
    }) {
        return false;
    }
    rerender_expression_root_symbol(&call_expression.callee, ctx) != Some(setter_symbol_id)
}

fn rerender_is_inside_condition_test(
    node_id: NodeId,
    callback_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let source_span = ctx.nodes().get_node(node_id).span();
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == callback_node_id {
            break;
        }
        match ancestor.kind() {
            AstKind::IfStatement(statement)
                if statement.test.span().contains_inclusive(source_span) =>
            {
                return true;
            }
            AstKind::ConditionalExpression(expression)
                if expression.test.span().contains_inclusive(source_span) =>
            {
                return true;
            }
            AstKind::WhileStatement(statement)
                if statement.test.span().contains_inclusive(source_span) =>
            {
                return true;
            }
            AstKind::DoWhileStatement(statement)
                if statement.test.span().contains_inclusive(source_span) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn rerender_component_has_render_phase_non_hook_call(
    component_node_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    node_index
        .node_ids(component_node_id)
        .iter()
        .any(|candidate_id| {
            let candidate = ctx.nodes().get_node(*candidate_id);
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return false;
            };
            !rerender_call_name(call_expression).is_some_and(|name| rerender_is_hook_name(&name))
        })
}

fn rerender_call_is_standalone_render_phase_hook<'a>(
    call_node_id: NodeId,
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !matches!(
        ctx.nodes().parent_node(call_node_id).kind(),
        AstKind::ExpressionStatement(_)
    ) {
        return false;
    }
    let has_hook_name = matches!(&call_expression.callee, Expression::Identifier(callee)
        if rerender_is_hook_name(callee.name.as_str()));
    (has_hook_name || is_react_hook_call(call_expression, &RERENDER_BUILTIN_HOOK_NAMES, ctx))
        && !is_react_hook_call(call_expression, &RERENDER_EFFECT_HOOK_NAMES, ctx)
}

fn rerender_iterator_mutates_rendered_collection(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    component_node_id: NodeId,
    component_has_render_phase_call: bool,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Some(member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    if !RERENDER_SYNCHRONOUS_ITERATOR_METHOD_NAMES.contains(&method_name.as_ref()) {
        return false;
    }
    call_expression
        .arguments
        .iter()
        .filter_map(Argument::as_expression)
        .filter_map(rerender_function_expression_node_id)
        .any(|callback_node_id| {
            let callback_span = ctx.nodes().get_node(callback_node_id).span();
            ctx.nodes().iter().any(|candidate| {
                let AstKind::CallExpression(mutation_call) = candidate.kind() else {
                    return false;
                };
                if !callback_span.contains_inclusive(candidate.span()) {
                    return false;
                }
                let Some(mutation_member) = mutation_call
                    .callee
                    .get_inner_expression()
                    .as_member_expression()
                else {
                    return false;
                };
                let Some(mutation_method_name) = mutation_member.static_property_name() else {
                    return false;
                };
                if !RERENDER_MUTATING_COLLECTION_METHOD_NAMES
                    .contains(&mutation_method_name.as_ref())
                {
                    return false;
                }
                rerender_expression_root_symbol(mutation_member.object(), ctx).is_some_and(
                    |receiver_symbol_id| {
                        rerender_symbol_is_render_reachable(
                            receiver_symbol_id,
                            component_node_id,
                            component_has_render_phase_call,
                            ctx,
                            visited_symbol_ids,
                        )
                    },
                )
            })
        })
}

fn rerender_call_argument_mutates_rendered_collection(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    source_span: Span,
    component_node_id: NodeId,
    component_has_render_phase_call: bool,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !call_expression.arguments.iter().any(|argument| {
        argument
            .as_expression()
            .is_some_and(|argument| argument.span().contains_inclusive(source_span))
    }) {
        return false;
    }
    let Some(member) = call_expression
        .callee
        .get_inner_expression()
        .as_member_expression()
    else {
        return false;
    };
    let Some(method_name) = member.static_property_name() else {
        return false;
    };
    RERENDER_MUTATING_COLLECTION_METHOD_NAMES.contains(&method_name.as_ref())
        && rerender_expression_root_symbol(member.object(), ctx).is_some_and(|receiver_symbol_id| {
            rerender_symbol_is_render_reachable(
                receiver_symbol_id,
                component_node_id,
                component_has_render_phase_call,
                ctx,
                visited_symbol_ids,
            )
        })
}

fn rerender_component_renders_location(
    component_node_id: NodeId,
    node_index: &LocalCallbackNearestFunctionNodeIndex,
    ctx: &LintContext<'_>,
) -> bool {
    let component_has_render_phase_call =
        rerender_component_has_render_phase_non_hook_call(component_node_id, node_index, ctx);
    let component_span = ctx.nodes().get_node(component_node_id).span();
    if !ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        component_span.contains_inclusive(candidate.span())
            && matches!(
                identifier.name.as_str(),
                "globalThis" | "location" | "window"
            )
            && ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_none()
    }) {
        return false;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        if !component_span.contains_inclusive(candidate.span())
            || !rerender_identifier_reads_global_location(
                candidate.id(),
                identifier,
                ctx,
                &mut FxHashSet::default(),
            )
        {
            return false;
        }
        rerender_node_flows_to_render(
            candidate.id(),
            component_node_id,
            component_has_render_phase_call,
            ctx,
            &mut FxHashSet::default(),
        )
    })
}

fn rerender_identifier_reads_global_location(
    node_id: NodeId,
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let node_span = ctx.nodes().get_node(node_id).span();
    if ctx.nodes().ancestors(node_id).any(|ancestor| {
        ancestor
            .kind()
            .as_member_expression_kind()
            .is_some_and(|member| {
                member.static_property_name().as_deref() == Some("location")
                    && member.object().span().contains_inclusive(node_span)
                    && rerender_expression_resolves_to_browser_global(
                        member.object(),
                        ctx,
                        &mut FxHashSet::default(),
                    )
            })
    }) {
        return true;
    }
    let reference = ctx.scoping().get_reference(identifier.reference_id());
    let Some(symbol_id) = reference.symbol_id() else {
        if identifier.name == "location" {
            return true;
        }
        return false;
    };
    rerender_symbol_reads_global_location(symbol_id, ctx, visited_symbol_ids)
}

fn rerender_symbol_reads_global_location(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return false;
    };
    let initializer_span = initializer.span();
    ctx.nodes().iter().any(|candidate| {
        let AstKind::IdentifierReference(identifier) = candidate.kind() else {
            return false;
        };
        initializer_span.contains_inclusive(candidate.span())
            && rerender_identifier_reads_global_location(
                candidate.id(),
                identifier,
                ctx,
                &mut visited_symbol_ids.clone(),
            )
    })
}

fn rerender_setter_invalidates_location(
    setter_symbol_id: SymbolId,
    component_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(setter_symbol_id)
        .filter(|reference| rerender_reference_is_call_callee(reference.node_id(), ctx))
        .any(|reference| {
            let setter_span = ctx.nodes().get_node(reference.node_id()).span();
            let setter_call = ctx.nodes().parent_node(reference.node_id());
            if let AstKind::CallExpression(call_expression) = setter_call.kind()
                && call_expression
                    .arguments
                    .iter()
                    .filter_map(Argument::as_expression)
                    .filter_map(|argument| {
                        rerender_expression_resolves_to_function_node_id(argument, ctx)
                    })
                    .any(|updater_function_id| {
                        rerender_function_mutates_history_before_suspension(
                            updater_function_id,
                            setter_span,
                            ctx,
                        )
                    })
            {
                return true;
            }
            let Some(owner_function_id) =
                rerender_nearest_function_node_id(reference.node_id(), ctx)
            else {
                return false;
            };
            owner_function_id != component_node_id
                && ((rerender_function_is_react_batched(owner_function_id, ctx)
                    && rerender_function_mutates_history_before_suspension(
                        owner_function_id,
                        setter_span,
                        ctx,
                    ))
                    || rerender_function_is_location_listener(owner_function_id, ctx))
        })
}

fn rerender_function_mutates_history_before_suspension(
    function_node_id: NodeId,
    setter_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    rerender_function_mutates_history_before_suspension_inner(
        function_node_id,
        setter_span,
        ctx,
        &mut FxHashSet::default(),
    )
}

fn rerender_function_mutates_history_before_suspension_inner(
    function_node_id: NodeId,
    setter_span: Span,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited_function_ids.insert(function_node_id) {
        return false;
    }
    let function_span = ctx.nodes().get_node(function_node_id).span();
    let first_await_start = ctx
        .nodes()
        .iter()
        .filter(|candidate| {
            function_span.contains_inclusive(candidate.span())
                && matches!(candidate.kind(), AstKind::AwaitExpression(_))
                && rerender_nearest_function_node_id(candidate.id(), ctx) == Some(function_node_id)
        })
        .map(|candidate| candidate.span().start)
        .min()
        .unwrap_or(u32::MAX);
    if function_span.contains_inclusive(setter_span) && setter_span.start >= first_await_start {
        return false;
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        if !function_span.contains_inclusive(candidate.span())
            || candidate.span().start >= first_await_start
            || candidate.span().end > first_await_start
            || rerender_nearest_function_node_id(candidate.id(), ctx) != Some(function_node_id)
        {
            return false;
        }
        if call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
            .is_some_and(|member| {
                matches!(
                    member.static_property_name(),
                    Some("pushState" | "replaceState")
                ) && rerender_expression_resolves_to_global_member(
                    member.object(),
                    "history",
                    ctx,
                    &mut FxHashSet::default(),
                )
            })
        {
            return true;
        }
        rerender_expression_resolves_to_function_node_id(&call_expression.callee, ctx).is_some_and(
            |called_function_id| {
                rerender_function_mutates_history_before_suspension_inner(
                    called_function_id,
                    setter_span,
                    ctx,
                    &mut visited_function_ids.clone(),
                )
            },
        )
    })
}

fn rerender_function_is_react_batched(function_node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    rerender_function_is_react_batched_inner(function_node_id, ctx, &mut FxHashSet::default())
}

fn rerender_function_is_react_batched_inner(
    function_node_id: NodeId,
    ctx: &LintContext<'_>,
    visited_function_ids: &mut FxHashSet<NodeId>,
) -> bool {
    if !visited_function_ids.insert(function_node_id) {
        return false;
    }
    if rerender_function_is_effect_callback(function_node_id, ctx)
        || rerender_node_is_intrinsic_event_handler(function_node_id, ctx)
    {
        return true;
    }
    let Some(function_symbol_id) = rerender_function_binding_symbol_id(function_node_id, ctx)
    else {
        return false;
    };
    ctx.scoping()
        .get_resolved_references(function_symbol_id)
        .any(|reference| {
            if rerender_node_is_intrinsic_event_handler(reference.node_id(), ctx) {
                return true;
            }
            if !rerender_reference_is_call_callee(reference.node_id(), ctx) {
                return false;
            }
            rerender_nearest_function_node_id(reference.node_id(), ctx).is_some_and(
                |caller_function_id| {
                    rerender_function_is_react_batched_inner(
                        caller_function_id,
                        ctx,
                        &mut visited_function_ids.clone(),
                    )
                },
            )
        })
}

fn rerender_function_is_effect_callback(function_node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let function_span = ctx.nodes().get_node(function_node_id).span();
    ctx.nodes().ancestors(function_node_id).any(|ancestor| {
        let AstKind::CallExpression(call_expression) = ancestor.kind() else {
            return false;
        };
        call_expression.arguments.iter().any(|argument| {
            argument
                .as_expression()
                .is_some_and(|argument| argument.span().contains_inclusive(function_span))
        }) && is_react_hook_call(call_expression, &RERENDER_EFFECT_HOOK_NAMES, ctx)
    })
}

fn rerender_node_is_intrinsic_event_handler(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let mut did_find_event_attribute = false;
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                if !rerender_is_event_handler_attribute_name(&attribute.name) {
                    return false;
                }
                did_find_event_attribute = true;
            }
            AstKind::JSXOpeningElement(opening_element) if did_find_event_attribute => {
                return matches!(&opening_element.name, JSXElementName::Identifier(identifier)
                    if identifier.name.as_bytes().first().is_some_and(u8::is_ascii_lowercase));
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_)
                if ancestor.id() != node_id =>
            {
                return false;
            }
            _ => {}
        }
    }
    false
}

fn rerender_function_is_location_listener(function_node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let registrations = ctx
        .nodes()
        .iter()
        .filter_map(|candidate| {
            let AstKind::CallExpression(call_expression) = candidate.kind() else {
                return None;
            };
            rerender_location_listener_call(
                call_expression,
                function_node_id,
                "addEventListener",
                ctx,
            )
            .map(|(event_name, capture)| {
                (
                    candidate.span(),
                    rerender_nearest_function_node_id(candidate.id(), ctx),
                    event_name,
                    capture,
                )
            })
        })
        .collect::<Vec<_>>();
    registrations.into_iter().any(
        |(registration_span, registration_owner, event_name, registration_capture)| {
            !ctx.nodes().iter().any(|candidate| {
                let AstKind::CallExpression(call_expression) = candidate.kind() else {
                    return false;
                };
                if candidate.span().start <= registration_span.start
                    || rerender_nearest_function_node_id(candidate.id(), ctx) != registration_owner
                    || rerender_call_is_conditionally_executed(candidate.id(), ctx)
                {
                    return false;
                }
                matches!(
                    rerender_location_listener_call(
                        call_expression,
                        function_node_id,
                        "removeEventListener",
                        ctx,
                    ),
                    Some((removal_event_name, removal_capture))
                        if removal_event_name == event_name
                            && removal_capture.is_some()
                            && removal_capture == registration_capture
                )
            })
        },
    )
}

fn rerender_location_listener_call(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    function_node_id: NodeId,
    operation_name: &str,
    ctx: &LintContext<'_>,
) -> Option<(String, Option<bool>)> {
    if !rerender_is_global_listener_operation(call_expression, operation_name, ctx) {
        return None;
    }
    let event_name = match call_expression
        .arguments
        .first()
        .and_then(Argument::as_expression)?
        .get_inner_expression()
    {
        Expression::StringLiteral(literal)
            if matches!(literal.value.as_str(), "hashchange" | "popstate") =>
        {
            literal.value.to_string()
        }
        _ => return None,
    };
    let listener = call_expression
        .arguments
        .get(1)
        .and_then(Argument::as_expression)?;
    if !rerender_expression_resolves_to_function_node(listener, function_node_id, ctx) {
        return None;
    }
    Some((
        event_name,
        rerender_static_listener_capture(call_expression.arguments.get(2)),
    ))
}

fn rerender_is_global_listener_operation(
    call_expression: &oxc_ast::ast::CallExpression<'_>,
    operation_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            identifier.name == operation_name
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            if member.static_property_name().as_deref() != Some(operation_name) {
                return false;
            }
            matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "globalThis" | "window")
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
        }
    }
}

fn rerender_expression_resolves_to_function_node(
    expression: &Expression<'_>,
    function_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if rerender_function_expression_node_id(expression) == Some(function_node_id) {
        return true;
    }
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
    rerender_function_binding_symbol_id(function_node_id, ctx) == Some(symbol_id)
}

fn rerender_expression_resolves_to_function_node_id(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    if let Some(function_node_id) = rerender_function_expression_node_id(expression) {
        return Some(function_node_id);
    }
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    rerender_symbol_resolves_to_function_node_id(symbol_id, ctx, &mut FxHashSet::default())
}

fn rerender_symbol_resolves_to_function_node_id(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> Option<NodeId> {
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function) => Some(function.node_id.get()),
        AstKind::VariableDeclarator(declarator) => {
            let initializer = declarator.init.as_ref()?.get_inner_expression();
            match initializer {
                Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                Expression::FunctionExpression(function) => Some(function.node_id.get()),
                Expression::Identifier(identifier) => {
                    let initializer_symbol_id = ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()?;
                    rerender_symbol_resolves_to_function_node_id(
                        initializer_symbol_id,
                        ctx,
                        visited_symbol_ids,
                    )
                }
                Expression::CallExpression(call_expression)
                    if is_react_hook_call(call_expression, &["useCallback"], ctx) =>
                {
                    call_expression
                        .arguments
                        .first()
                        .and_then(Argument::as_expression)
                        .and_then(|callback| {
                            rerender_expression_resolves_to_function_node_id(callback, ctx)
                        })
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn rerender_static_listener_capture(argument: Option<&Argument<'_>>) -> Option<bool> {
    let Some(expression) = argument.and_then(Argument::as_expression) else {
        return Some(false);
    };
    match expression.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        Expression::NullLiteral(_) => Some(false),
        Expression::Identifier(identifier) if identifier.name == "undefined" => Some(false),
        Expression::ObjectExpression(object) => {
            let mut capture = false;
            for candidate in &object.properties {
                let Some(property) = candidate.as_property() else {
                    return None;
                };
                if property.key.static_name().as_deref() != Some("capture") {
                    continue;
                }
                match property.value.get_inner_expression() {
                    Expression::BooleanLiteral(literal) => capture = literal.value,
                    Expression::NullLiteral(_) => capture = false,
                    Expression::Identifier(identifier) if identifier.name == "undefined" => {
                        capture = false;
                    }
                    _ => return None,
                }
            }
            Some(capture)
        }
        _ => None,
    }
}

fn rerender_call_is_conditionally_executed(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::IfStatement(_)
            | AstKind::ConditionalExpression(_)
            | AstKind::LogicalExpression(_)
            | AstKind::SwitchCase(_)
            | AstKind::WhileStatement(_)
            | AstKind::DoWhileStatement(_)
            | AstKind::ForStatement(_)
            | AstKind::ForInStatement(_)
            | AstKind::ForOfStatement(_) => return true,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
    }
    false
}

fn rerender_expression_resolves_to_global_member(
    expression: &Expression<'_>,
    expected_name: &str,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if matches!(expression, Expression::Identifier(identifier)
        if identifier.name == expected_name
            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
    {
        return true;
    }
    if let Expression::Identifier(identifier) = expression {
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
        let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind()
        else {
            return false;
        };
        return declarator.init.as_ref().is_some_and(|initializer| {
            rerender_expression_resolves_to_global_member(
                initializer,
                expected_name,
                ctx,
                visited_symbol_ids,
            )
        });
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    member.static_property_name().as_deref() == Some(expected_name)
        && rerender_expression_resolves_to_browser_global(
            member.object(),
            ctx,
            &mut FxHashSet::default(),
        )
}

fn rerender_expression_resolves_to_browser_global(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let reference = ctx.scoping().get_reference(identifier.reference_id());
    let Some(symbol_id) = reference.symbol_id() else {
        return matches!(identifier.name.as_str(), "globalThis" | "window");
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    declarator.init.as_ref().is_some_and(|initializer| {
        rerender_expression_resolves_to_browser_global(initializer, ctx, visited_symbol_ids)
    })
}

fn rerender_assignment_target_root_symbol(
    assignment: &oxc_ast::ast::AssignmentExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let target = assignment.left.as_simple_assignment_target()?;
    match target {
        SimpleAssignmentTarget::AssignmentTargetIdentifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id(),
        _ => rerender_expression_root_symbol(target.as_member_expression()?.object(), ctx),
    }
}

fn rerender_assignment_target_symbol_ids(
    assignment: &oxc_ast::ast::AssignmentExpression<'_>,
    ctx: &LintContext<'_>,
) -> FxHashSet<SymbolId> {
    let target_span = assignment.left.span();
    ctx.nodes()
        .iter()
        .filter(|candidate| target_span.contains_inclusive(candidate.span()))
        .filter_map(|candidate| {
            let AstKind::IdentifierReference(identifier) = candidate.kind() else {
                return None;
            };
            let reference = ctx.scoping().get_reference(identifier.reference_id());
            reference
                .is_write()
                .then(|| reference.symbol_id())
                .flatten()
        })
        .collect()
}

fn rerender_expression_root_symbol(
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

fn rerender_function_expression_node_id(expression: &Expression<'_>) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        _ => None,
    }
}

fn rerender_function_binding_symbol_id(
    function_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let function_node = ctx.nodes().get_node(function_node_id);
    if let AstKind::Function(function) = function_node.kind()
        && function.r#type == FunctionType::FunctionDeclaration
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    for ancestor in ctx.nodes().ancestors(function_node_id) {
        match ancestor.kind() {
            AstKind::VariableDeclarator(declarator) => {
                let initializer = declarator.init.as_ref()?.get_inner_expression();
                let directly_initializes_binding =
                    rerender_function_expression_node_id(initializer) == Some(function_node_id);
                let initializes_use_callback_binding = matches!(initializer, Expression::CallExpression(call_expression)
                        if is_react_hook_call(call_expression, &["useCallback"], ctx)
                            && call_expression
                                .arguments
                                .first()
                                .and_then(Argument::as_expression)
                                .and_then(rerender_function_expression_node_id)
                                == Some(function_node_id));
                return (directly_initializes_binding || initializes_use_callback_binding)
                    .then(|| {
                        declarator
                            .id
                            .get_binding_identifier()
                            .map(|identifier| identifier.symbol_id())
                    })
                    .flatten();
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_) => {
                return None;
            }
            _ => {}
        }
    }
    None
}

fn rerender_function_dependency_binding_symbol_id(
    function_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let function_span = ctx.nodes().get_node(function_node_id).span();
    for ancestor in ctx.nodes().ancestors(function_node_id) {
        match ancestor.kind() {
            AstKind::VariableDeclarator(declarator)
                if declarator.init.as_ref().is_some_and(|initializer| {
                    initializer.span().contains_inclusive(function_span)
                }) =>
            {
                return declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id());
            }
            AstKind::AssignmentExpression(assignment)
                if assignment.right.span().contains_inclusive(function_span) =>
            {
                return rerender_assignment_target_root_symbol(assignment, ctx);
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) | AstKind::Program(_) => {
                return None;
            }
            _ => {}
        }
    }
    None
}

fn rerender_reference_is_call_callee(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let node = ctx.nodes().get_node(node_id);
    matches!(ctx.nodes().parent_node(node_id).kind(), AstKind::CallExpression(call_expression)
        if call_expression.callee.span() == node.span())
}

fn rerender_node_is_direct_event_handler_value(
    node_id: NodeId,
    attribute_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if !rerender_node_resolves_to_function(node_id, ctx) {
        return false;
    }
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == attribute_node_id {
            return true;
        }
        if matches!(ancestor.kind(), AstKind::CallExpression(_)) {
            return false;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            return false;
        }
    }
    false
}

fn rerender_node_resolves_to_function(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let AstKind::IdentifierReference(identifier) = ctx.nodes().get_node(node_id).kind() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    rerender_symbol_resolves_to_function(symbol_id, ctx, &mut FxHashSet::default())
        || rerender_member_root_resolves_to_function(node_id, symbol_id, ctx)
}

fn rerender_member_root_resolves_to_function(
    node_id: NodeId,
    object_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let node_span = ctx.nodes().get_node(node_id).span();
    let parent = ctx.nodes().parent_node(node_id);
    let Some(member) = parent.kind().as_member_expression_kind() else {
        return false;
    };
    if member.object().span() != node_span {
        return false;
    }
    let Some(property_name) = member.static_property_name() else {
        return false;
    };
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(object_symbol_id).kind()
    else {
        return false;
    };
    let Some(Expression::ObjectExpression(object)) = declarator
        .init
        .as_ref()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    object.properties.iter().any(|candidate| {
        let Some(property) = candidate.as_property() else {
            return false;
        };
        property.key.static_name().as_deref() == Some(property_name.as_ref())
            && rerender_expression_resolves_to_function_node_id(&property.value, ctx).is_some()
    })
}

fn rerender_symbol_resolves_to_function(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            declarator.init.as_ref().is_some_and(|initializer| {
                match initializer.get_inner_expression() {
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
                        true
                    }
                    Expression::CallExpression(call_expression) => {
                        is_react_hook_call(call_expression, &["useCallback"], ctx)
                    }
                    Expression::Identifier(identifier) => ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_some_and(|initializer_symbol_id| {
                            rerender_symbol_resolves_to_function(
                                initializer_symbol_id,
                                ctx,
                                visited_symbol_ids,
                            )
                        }),
                    _ => false,
                }
            })
        }
        _ => false,
    }
}

fn rerender_nearest_function_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .find_map(|ancestor| match ancestor.kind() {
            AstKind::Function(function) => Some(function.node_id.get()),
            AstKind::ArrowFunctionExpression(function) => Some(function.node_id.get()),
            _ => None,
        })
}

fn rerender_call_name(call_expression: &oxc_ast::ast::CallExpression<'_>) -> Option<String> {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        expression => Some(
            expression
                .as_member_expression()?
                .static_property_name()?
                .to_string(),
        ),
    }
}

fn rerender_is_hook_name(name: &str) -> bool {
    let Some(suffix) = name.strip_prefix("use") else {
        return false;
    };
    suffix.is_empty()
        || suffix
            .as_bytes()
            .first()
            .is_some_and(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
}

fn rerender_is_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn rerender_is_setter_name(name: &str) -> bool {
    name.strip_prefix("set")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}

fn rerender_is_force_render_setter(name: &str) -> bool {
    let Some(suffix) = name.strip_prefix("set") else {
        return false;
    };
    matches!(
        suffix.to_ascii_lowercase().as_str(),
        "triggerrender"
            | "forceupdate"
            | "rerender"
            | "forcerender"
            | "tick"
            | "bump"
            | "bumpversion"
            | "invalidaterender"
            | "refresh"
            | "repaint"
    )
}

fn rerender_is_event_handler_attribute_name(name: &JSXAttributeName<'_>) -> bool {
    matches!(name, JSXAttributeName::Identifier(identifier)
        if rerender_is_event_handler_name(identifier.name.as_str()))
}

fn rerender_is_event_handler_name(name: &str) -> bool {
    name.strip_prefix("on")
        .and_then(|suffix| suffix.as_bytes().first())
        .is_some_and(u8::is_ascii_uppercase)
}
