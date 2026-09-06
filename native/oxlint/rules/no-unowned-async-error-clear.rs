use oxc_ast::{
    AstKind,
    ast::{
        Argument, AssignmentTarget, BindingPattern, Expression, JSXAttributeItem, JSXAttributeName,
        Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::{GetSpan as _, Span};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "An older async response can clear error state owned by a newer request. Check that this request still owns the error before clearing it, keep ownership in the state update, or key the state owner by request ID.";

#[derive(Debug, Default, Clone)]
pub struct NoUnownedAsyncErrorClear;

declare_oxc_lint!(
    /// Prevent stale async responses from clearing state owned by newer requests.
    NoUnownedAsyncErrorClear,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Stale async response clears newer request state.",
);

#[derive(Clone)]
struct RequestOwnerState {
    component_function_id: NodeId,
    owner_identity_references: Vec<OwnerIdentityReference>,
    setter_symbol_id: SymbolId,
}

#[derive(Clone, Copy)]
struct RequestScopedState {
    component_function_id: NodeId,
    is_boolean_activity_state: bool,
    setter_symbol_id: SymbolId,
}

#[derive(Clone, Copy)]
struct AsyncOwnerWrite {
    call_id: NodeId,
    has_clear: bool,
    has_request_identity: bool,
}

#[derive(Clone, PartialEq, Eq)]
struct OwnerIdentityReference {
    property_name: Option<String>,
    symbol_id: SymbolId,
}

impl Rule for NoUnownedAsyncErrorClear {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let nearest_function_index = build_local_callback_nearest_function_node_index(ctx);
        let nested_function_ids_by_parent = unowned_async_build_nested_function_ids_by_parent(ctx);
        let mut reported_component_function_ids = FxHashSet::default();
        for node in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            let owner_state = unowned_async_request_owner_state(node, declarator, ctx);
            let scoped_state = owner_state
                .is_none()
                .then(|| unowned_async_request_scoped_state(node, declarator, ctx))
                .flatten();
            let Some(component_function_id) = owner_state
                .as_ref()
                .map(|state| state.component_function_id)
                .or_else(|| scoped_state.map(|state| state.component_function_id))
            else {
                continue;
            };
            if reported_component_function_ids.contains(&component_function_id) {
                continue;
            }
            let unsafe_clear_id = owner_state
                .as_ref()
                .and_then(|state| {
                    unowned_async_unsafe_owner_clear(
                        state,
                        ctx,
                        &nearest_function_index,
                        &nested_function_ids_by_parent,
                    )
                })
                .or_else(|| {
                    scoped_state.and_then(|state| {
                        unowned_async_unsafe_request_scoped_clear(
                            state,
                            ctx,
                            &nearest_function_index,
                            &nested_function_ids_by_parent,
                        )
                    })
                });
            let Some(unsafe_clear_id) = unsafe_clear_id else {
                continue;
            };
            reported_component_function_ids.insert(component_function_id);
            let AstKind::CallExpression(call) = ctx.nodes().get_node(unsafe_clear_id).kind() else {
                continue;
            };
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
        }
    }
}

fn unowned_async_request_owner_state<'a>(
    declarator_node: &AstNode<'a>,
    declarator: &oxc_ast::ast::VariableDeclarator<'a>,
    ctx: &LintContext<'a>,
) -> Option<RequestOwnerState> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let Expression::CallExpression(call) = declarator.init.as_ref()? else {
        return None;
    };
    if !is_react_api_call(call, "useState", ctx)
        || call.arguments.len() != 1
        || !call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .is_some_and(unowned_async_is_null_literal)
    {
        return None;
    }
    let BindingPattern::BindingIdentifier(state_binding) = pattern.elements.first()?.as_ref()?
    else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter_binding) = pattern.elements.get(1)?.as_ref()?
    else {
        return None;
    };
    let component_function_id = local_callback_nearest_function_id(declarator_node.id(), ctx)?;
    let owner_identity_references = unowned_async_collect_owner_identity_references(
        state_binding.symbol_id(),
        component_function_id,
        ctx,
    );
    (!owner_identity_references.is_empty()).then_some(RequestOwnerState {
        component_function_id,
        owner_identity_references,
        setter_symbol_id: setter_binding.symbol_id(),
    })
}

fn unowned_async_request_scoped_state<'a>(
    declarator_node: &AstNode<'a>,
    declarator: &oxc_ast::ast::VariableDeclarator<'a>,
    ctx: &LintContext<'a>,
) -> Option<RequestScopedState> {
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return None;
    };
    let Expression::CallExpression(call) = declarator.init.as_ref()? else {
        return None;
    };
    if !is_react_api_call(call, "useState", ctx) {
        return None;
    }
    let BindingPattern::BindingIdentifier(state_binding) = pattern.elements.first()?.as_ref()?
    else {
        return None;
    };
    let BindingPattern::BindingIdentifier(setter_binding) = pattern.elements.get(1)?.as_ref()?
    else {
        return None;
    };
    let initial_value = call.arguments.first().and_then(Argument::as_expression);
    let is_boolean_activity_state = initial_value.is_some_and(|initial_value| {
        unowned_async_is_boolean_literal(initial_value, false)
            && unowned_async_is_activity_state_name(state_binding.name.as_str())
    });
    if !initial_value.is_some_and(unowned_async_is_null_literal) && !is_boolean_activity_state {
        return None;
    }
    let component_function_id = local_callback_nearest_function_id(declarator_node.id(), ctx)?;
    if !unowned_async_function_receives_request_identity(component_function_id, ctx) {
        return None;
    }
    Some(RequestScopedState {
        component_function_id,
        is_boolean_activity_state,
        setter_symbol_id: setter_binding.symbol_id(),
    })
}

fn unowned_async_is_null_literal(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::NullLiteral(_)
    )
}

fn unowned_async_is_boolean_literal(expression: &Expression<'_>, expected: bool) -> bool {
    matches!(expression.get_inner_expression(), Expression::BooleanLiteral(literal) if literal.value == expected)
}

fn unowned_async_is_activity_state_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("pending") || lower.contains("loading") || lower.contains("delivering")
}

fn unowned_async_identity_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "sentfor"
        || lower == "targetid"
        || lower.ends_with("request")
        || lower.ends_with("requestid")
        || lower.ends_with("requestref")
        || lower.ends_with("requestidref")
        || (lower
            .rfind("active")
            .is_some_and(|start| lower[start..].ends_with("idref")))
        || [
            "flight",
            "generation",
            "sequence",
            "attempt",
            "token",
            "version",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix) || lower.ends_with(&format!("{suffix}ref")))
}

fn unowned_async_node_contains_request_identity(span: Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !span.contains_inclusive(candidate.span()) {
            return false;
        }
        match candidate.kind() {
            AstKind::IdentifierReference(identifier) => {
                unowned_async_identity_name(&identifier.name)
            }
            AstKind::BindingIdentifier(identifier) => unowned_async_identity_name(&identifier.name),
            AstKind::StaticMemberExpression(member) => member
                .property
                .name
                .to_ascii_lowercase()
                .ends_with("requestid"),
            AstKind::ComputedMemberExpression(member) => member
                .static_property_name()
                .is_some_and(|name| name.to_ascii_lowercase().ends_with("requestid")),
            _ => false,
        }
    })
}

fn unowned_async_function_receives_request_identity(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    unowned_async_function_parameter_span(function_id, ctx)
        .is_some_and(|span| unowned_async_node_contains_request_identity(span, ctx))
}

fn unowned_async_function_parameter_span(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<Span> {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => Some(function.params.span),
        AstKind::ArrowFunctionExpression(function) => Some(function.params.span),
        _ => None,
    }
}

fn unowned_async_function_is_async(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::Function(function) => function.r#async,
        AstKind::ArrowFunctionExpression(function) => function.r#async,
        _ => false,
    }
}

fn unowned_async_is_function_expression(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::FunctionExpression(_) | Expression::ArrowFunctionExpression(_)
    )
}

fn unowned_async_symbol_for_identifier(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn unowned_async_request_identity_member(
    expression: &Expression<'_>,
    async_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<OwnerIdentityReference> {
    let member = expression.get_inner_expression().as_member_expression()?;
    unowned_async_request_identity_member_parts(
        member.object(),
        member.static_property_name()?.as_ref(),
        async_function_id,
        ctx,
    )
}

fn unowned_async_request_identity_member_parts(
    receiver_expression: &Expression<'_>,
    property_name: &str,
    async_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<OwnerIdentityReference> {
    if !property_name.ends_with("Id") {
        return None;
    }
    let Expression::Identifier(receiver) = receiver_expression.get_inner_expression() else {
        return None;
    };
    let symbol_id = unowned_async_symbol_for_identifier(receiver, ctx)?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let parameter_span = unowned_async_function_parameter_span(async_function_id, ctx)?;
    if !parameter_span.contains_inclusive(declaration.span()) {
        return None;
    }
    let AstKind::FormalParameter(parameter) = declaration.kind() else {
        return None;
    };
    matches!(&parameter.pattern, BindingPattern::BindingIdentifier(identifier) if identifier.symbol_id() == symbol_id)
        .then_some(OwnerIdentityReference {
            property_name: Some(property_name.to_string()),
            symbol_id,
        })
}

fn unowned_async_owner_identity_reference(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<OwnerIdentityReference> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(OwnerIdentityReference {
            property_name: None,
            symbol_id: unowned_async_symbol_for_identifier(identifier, ctx)?,
        }),
        expression => {
            let member = expression.as_member_expression()?;
            let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
                return None;
            };
            Some(OwnerIdentityReference {
                property_name: Some(member.static_property_name()?.to_string()),
                symbol_id: unowned_async_symbol_for_identifier(receiver, ctx)?,
            })
        }
    }
}

fn unowned_async_collect_owner_identity_references(
    state_symbol_id: SymbolId,
    component_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Vec<OwnerIdentityReference> {
    let component_span = ctx.nodes().get_node(component_function_id).span();
    ctx.scoping()
        .get_resolved_references(state_symbol_id)
        .filter_map(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let reference_root = transparent_expression_root(reference_node, ctx);
            let parent = ctx.nodes().parent_node(reference_root.id());
            let AstKind::BinaryExpression(comparison) = parent.kind() else {
                return None;
            };
            if !component_span.contains_inclusive(parent.span())
                || !unowned_async_is_equality_operator(comparison.operator)
            {
                return None;
            }
            let counterpart = if comparison.left.span() == reference_root.span() {
                &comparison.right
            } else if comparison.right.span() == reference_root.span() {
                &comparison.left
            } else {
                return None;
            };
            unowned_async_owner_identity_reference(counterpart, ctx)
        })
        .collect()
}

fn unowned_async_is_equality_operator(operator: BinaryOperator) -> bool {
    matches!(
        operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    )
}

fn unowned_async_is_positive_equality_operator(operator: BinaryOperator) -> bool {
    matches!(
        operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    )
}

fn unowned_async_component_is_keyed_at_every_local_use(
    component_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(component_symbol_id) =
        unowned_async_function_binding_symbol(component_function_id, ctx)
    else {
        return false;
    };
    let references = ctx
        .scoping()
        .get_resolved_references(component_symbol_id)
        .collect::<Vec<_>>();
    if references.is_empty() {
        return false;
    }
    let mut opening_element_count = 0;
    for reference in references {
        let reference_node = ctx.nodes().get_node(reference.node_id());
        let parent = ctx.nodes().parent_node(reference_node.id());
        match parent.kind() {
            AstKind::JSXOpeningElement(opening) if opening.name.span() == reference_node.span() => {
                opening_element_count += 1;
                if !opening.attributes.iter().any(|attribute| {
                    matches!(attribute, JSXAttributeItem::Attribute(attribute)
                        if matches!(&attribute.name, JSXAttributeName::Identifier(name) if name.name == "key"))
                }) {
                    return false;
                }
            }
            AstKind::JSXClosingElement(closing) if closing.name.span() == reference_node.span() => {
            }
            _ if unowned_async_is_component_metadata_reference(reference_node, ctx) => {}
            _ => return false,
        }
    }
    opening_element_count > 0
}

fn unowned_async_function_binding_symbol(
    function_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let function_node = ctx.nodes().get_node(function_id);
    if let AstKind::Function(function) = function_node.kind()
        && function.is_declaration()
    {
        return function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id());
    }
    let function_root = transparent_expression_root(function_node, ctx);
    let parent = ctx.nodes().parent_node(function_root.id());
    match parent.kind() {
        AstKind::VariableDeclarator(declarator) => {
            Some(declarator.id.get_binding_identifier()?.symbol_id())
        }
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == function_root.span() =>
        {
            let AssignmentTarget::AssignmentTargetIdentifier(identifier) = &assignment.left else {
                return None;
            };
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
        }
        AstKind::CallExpression(_) => {
            let call_parent = ctx.nodes().parent_node(parent.id());
            let AstKind::VariableDeclarator(declarator) = call_parent.kind() else {
                return None;
            };
            Some(declarator.id.get_binding_identifier()?.symbol_id())
        }
        _ => None,
    }
}

fn unowned_async_is_component_metadata_reference<'a>(
    reference_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let reference_root = transparent_expression_root(reference_node, ctx);
    let parent = ctx.nodes().parent_node(reference_root.id());
    match parent.kind() {
        AstKind::StaticMemberExpression(member) => {
            member.object.span() == reference_root.span()
                && matches!(member.property.name.as_str(), "displayName" | "propTypes")
        }
        AstKind::ComputedMemberExpression(member) => {
            member.object.span() == reference_root.span()
                && matches!(
                    member.static_property_name().as_deref(),
                    Some("displayName" | "propTypes")
                )
        }
        _ => false,
    }
}

fn unowned_async_collect_async_owner_writes(
    async_function_id: NodeId,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> Vec<AsyncOwnerWrite> {
    if !unowned_async_function_is_async(async_function_id, ctx) {
        return Vec::new();
    }
    let own_node_ids = nearest_function_index.node_ids(async_function_id);
    let first_await_end = own_node_ids
        .iter()
        .filter_map(|node_id| match ctx.nodes().get_node(*node_id).kind() {
            AstKind::AwaitExpression(expression) => Some(expression.span.end),
            _ => None,
        })
        .min();
    let Some(first_await_end) = first_await_end else {
        return Vec::new();
    };
    own_node_ids
        .iter()
        .filter_map(|node_id| {
            let node = ctx.nodes().get_node(*node_id);
            let AstKind::CallExpression(call) = node.kind() else {
                return None;
            };
            if call.span.start < first_await_end
                || !unowned_async_call_targets_symbol(call, setter_symbol_id, ctx)
            {
                return None;
            }
            let next_owner = call.arguments.first()?.as_expression()?;
            if unowned_async_is_function_expression(next_owner) {
                return None;
            }
            Some(AsyncOwnerWrite {
                call_id: *node_id,
                has_clear: unowned_async_expression_contains_null(
                    next_owner,
                    async_function_id,
                    ctx,
                    nearest_function_index,
                ),
                has_request_identity: unowned_async_expression_contains_request_identity(
                    next_owner,
                    async_function_id,
                    ctx,
                    nearest_function_index,
                ),
            })
        })
        .collect()
}

fn unowned_async_call_targets_symbol(
    call: &oxc_ast::ast::CallExpression<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(&call.callee, Expression::Identifier(identifier)
        if unowned_async_symbol_for_identifier(identifier, ctx) == Some(symbol_id))
}

fn unowned_async_expression_contains_null(
    expression: &Expression<'_>,
    function_id: NodeId,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    if unowned_async_is_null_literal(expression) {
        return true;
    }
    nearest_function_index
        .node_ids(function_id)
        .iter()
        .any(|node_id| {
            let node = ctx.nodes().get_node(*node_id);
            expression.span().contains_inclusive(node.span())
                && matches!(node.kind(), AstKind::NullLiteral(_))
        })
}

fn unowned_async_expression_contains_non_null_value(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => false,
        Expression::ConditionalExpression(expression) => {
            unowned_async_expression_contains_non_null_value(&expression.consequent)
                || unowned_async_expression_contains_non_null_value(&expression.alternate)
        }
        Expression::LogicalExpression(expression) => {
            unowned_async_expression_contains_non_null_value(&expression.left)
                || unowned_async_expression_contains_non_null_value(&expression.right)
        }
        _ => true,
    }
}

fn unowned_async_expression_contains_request_identity(
    expression: &Expression<'_>,
    async_function_id: NodeId,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> bool {
    nearest_function_index
        .node_ids(async_function_id)
        .iter()
        .any(|node_id| {
            let node = ctx.nodes().get_node(*node_id);
            if !expression.span().contains_inclusive(node.span()) {
                return false;
            }
            match node.kind() {
                AstKind::StaticMemberExpression(member) => {
                    unowned_async_request_identity_member_parts(
                        &member.object,
                        member.property.name.as_str(),
                        async_function_id,
                        ctx,
                    )
                    .is_some()
                }
                AstKind::ComputedMemberExpression(member) => {
                    member.static_property_name().is_some_and(|property_name| {
                        unowned_async_request_identity_member_parts(
                            &member.object,
                            property_name.as_ref(),
                            async_function_id,
                            ctx,
                        )
                        .is_some()
                    })
                }
                _ => false,
            }
        })
}

fn unowned_async_unsafe_owner_clear(
    state: &RequestOwnerState,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
    nested_function_ids_by_parent: &FxHashMap<NodeId, Vec<NodeId>>,
) -> Option<NodeId> {
    if unowned_async_component_is_keyed_at_every_local_use(state.component_function_id, ctx) {
        return None;
    }
    for function_id in unowned_async_direct_nested_function_ids(
        state.component_function_id,
        nested_function_ids_by_parent,
    ) {
        let writes = unowned_async_collect_async_owner_writes(
            *function_id,
            state.setter_symbol_id,
            ctx,
            nearest_function_index,
        );
        if !writes.iter().any(|write| write.has_request_identity) {
            continue;
        }
        if let Some(write) = writes.iter().find(|write| {
            write.has_clear
                && !unowned_async_call_has_owner_state_guard(
                    write.call_id,
                    *function_id,
                    &state.owner_identity_references,
                    ctx,
                )
        }) {
            return Some(write.call_id);
        }
    }
    None
}

fn unowned_async_build_nested_function_ids_by_parent(
    ctx: &LintContext<'_>,
) -> FxHashMap<NodeId, Vec<NodeId>> {
    let mut nested_function_ids_by_parent = FxHashMap::default();
    for candidate in ctx.nodes().iter() {
        if !matches!(
            candidate.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            continue;
        }
        let parent_function_id =
            ctx.nodes()
                .ancestors(candidate.id())
                .skip(1)
                .find_map(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                    .then_some(ancestor.id())
                });
        if let Some(parent_function_id) = parent_function_id {
            nested_function_ids_by_parent
                .entry(parent_function_id)
                .or_insert_with(Vec::new)
                .push(candidate.id());
        }
    }
    nested_function_ids_by_parent
}

fn unowned_async_direct_nested_function_ids(
    component_function_id: NodeId,
    nested_function_ids_by_parent: &FxHashMap<NodeId, Vec<NodeId>>,
) -> &[NodeId] {
    nested_function_ids_by_parent
        .get(&component_function_id)
        .map_or(&[], Vec::as_slice)
}

fn unowned_async_call_has_owner_state_guard(
    call_id: NodeId,
    async_function_id: NodeId,
    owner_identity_references: &[OwnerIdentityReference],
    ctx: &LintContext<'_>,
) -> bool {
    let call_span = ctx.nodes().get_node(call_id).span();
    for ancestor in ctx.nodes().ancestors(call_id) {
        if ancestor.id() == async_function_id {
            break;
        }
        let AstKind::IfStatement(statement) = ancestor.kind() else {
            continue;
        };
        if statement.consequent.span().contains_inclusive(call_span)
            && unowned_async_condition_has_owner_state_equality(
                &statement.test,
                async_function_id,
                owner_identity_references,
                ctx,
            )
        {
            return true;
        }
    }
    false
}

fn unowned_async_condition_has_owner_state_equality(
    condition: &Expression<'_>,
    async_function_id: NodeId,
    owner_identity_references: &[OwnerIdentityReference],
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::BinaryExpression(comparison) = candidate.kind() else {
            return false;
        };
        if !condition.span().contains_inclusive(candidate.span())
            || !unowned_async_is_positive_equality_operator(comparison.operator)
        {
            return false;
        }
        let counterpart =
            if unowned_async_request_identity_member(&comparison.left, async_function_id, ctx)
                .is_some()
            {
                Some(&comparison.right)
            } else if unowned_async_request_identity_member(
                &comparison.right,
                async_function_id,
                ctx,
            )
            .is_some()
            {
                Some(&comparison.left)
            } else {
                None
            };
        counterpart
            .and_then(|expression| unowned_async_owner_identity_reference(expression, ctx))
            .is_some_and(|identity| owner_identity_references.contains(&identity))
    })
}

fn unowned_async_condition_proves_request_ownership(
    condition: &Expression<'_>,
    when_truthy: bool,
    ctx: &LintContext<'_>,
) -> bool {
    match condition.get_inner_expression() {
        Expression::UnaryExpression(expression)
            if expression.operator == UnaryOperator::LogicalNot =>
        {
            unowned_async_condition_proves_request_ownership(
                &expression.argument,
                !when_truthy,
                ctx,
            )
        }
        Expression::BinaryExpression(expression) => {
            if !unowned_async_node_contains_request_identity(expression.left.span(), ctx)
                || !unowned_async_node_contains_request_identity(expression.right.span(), ctx)
            {
                return false;
            }
            match expression.operator {
                BinaryOperator::Equality | BinaryOperator::StrictEquality => when_truthy,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality => !when_truthy,
                _ => false,
            }
        }
        Expression::LogicalExpression(expression) => {
            let left = unowned_async_condition_proves_request_ownership(
                &expression.left,
                when_truthy,
                ctx,
            );
            let right = unowned_async_condition_proves_request_ownership(
                &expression.right,
                when_truthy,
                ctx,
            );
            match expression.operator {
                LogicalOperator::And => {
                    if when_truthy {
                        left || right
                    } else {
                        left && right
                    }
                }
                LogicalOperator::Or => {
                    if when_truthy {
                        left && right
                    } else {
                        left || right
                    }
                }
                LogicalOperator::Coalesce => false,
            }
        }
        _ => false,
    }
}

fn unowned_async_call_is_ownership_guarded(
    call_id: NodeId,
    async_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    unowned_async_call_is_in_ownership_proven_branch(call_id, async_function_id, ctx)
        || unowned_async_call_follows_ownership_exit_guard(call_id, async_function_id, ctx)
}

fn unowned_async_call_is_in_ownership_proven_branch(
    call_id: NodeId,
    async_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let call_span = ctx.nodes().get_node(call_id).span();
    for ancestor in ctx.nodes().ancestors(call_id) {
        if ancestor.id() == async_function_id {
            break;
        }
        let AstKind::IfStatement(statement) = ancestor.kind() else {
            continue;
        };
        if statement.consequent.span().contains_inclusive(call_span)
            && unowned_async_condition_proves_request_ownership(&statement.test, true, ctx)
        {
            return true;
        }
        if statement
            .alternate
            .as_ref()
            .is_some_and(|alternate| alternate.span().contains_inclusive(call_span))
            && unowned_async_condition_proves_request_ownership(&statement.test, false, ctx)
        {
            return true;
        }
    }
    false
}

fn unowned_async_call_follows_ownership_exit_guard(
    call_id: NodeId,
    async_function_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let call_span = ctx.nodes().get_node(call_id).span();
    for ancestor in ctx.nodes().ancestors(call_id) {
        if ancestor.id() == async_function_id {
            break;
        }
        let AstKind::BlockStatement(block) = ancestor.kind() else {
            continue;
        };
        for statement in &block.body {
            if statement.span().contains_inclusive(call_span) {
                break;
            }
            let Statement::IfStatement(statement) = statement else {
                continue;
            };
            if statement_always_exits(&statement.consequent)
                && unowned_async_condition_proves_request_ownership(&statement.test, false, ctx)
            {
                return true;
            }
            if statement.alternate.as_ref().is_some_and(|alternate| {
                statement_always_exits(alternate)
                    && unowned_async_condition_proves_request_ownership(&statement.test, true, ctx)
            }) {
                return true;
            }
        }
    }
    false
}

fn unowned_async_setter_calls(
    function_id: NodeId,
    setter_symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
) -> Vec<NodeId> {
    nearest_function_index
        .node_ids(function_id)
        .iter()
        .copied()
        .filter(|node_id| {
            matches!(ctx.nodes().get_node(*node_id).kind(), AstKind::CallExpression(call)
                if unowned_async_call_targets_symbol(call, setter_symbol_id, ctx))
        })
        .collect()
}

fn unowned_async_unsafe_request_scoped_clear(
    state: RequestScopedState,
    ctx: &LintContext<'_>,
    nearest_function_index: &LocalCallbackNearestFunctionNodeIndex,
    nested_function_ids_by_parent: &FxHashMap<NodeId, Vec<NodeId>>,
) -> Option<NodeId> {
    if unowned_async_component_is_keyed_at_every_local_use(state.component_function_id, ctx) {
        return None;
    }
    for function_id in unowned_async_direct_nested_function_ids(
        state.component_function_id,
        nested_function_ids_by_parent,
    ) {
        let mut completion_call_ids = Vec::new();
        let mut activity_start_call_ids = Vec::new();
        if unowned_async_function_is_async(*function_id, ctx) {
            let first_await_end = nearest_function_index
                .node_ids(*function_id)
                .iter()
                .filter_map(|node_id| match ctx.nodes().get_node(*node_id).kind() {
                    AstKind::AwaitExpression(expression) => Some(expression.span.end),
                    _ => None,
                })
                .min();
            let Some(first_await_end) = first_await_end else {
                continue;
            };
            for call_id in unowned_async_setter_calls(
                *function_id,
                state.setter_symbol_id,
                ctx,
                nearest_function_index,
            ) {
                if ctx.nodes().get_node(call_id).span().start >= first_await_end {
                    completion_call_ids.push(call_id);
                } else {
                    activity_start_call_ids.push(call_id);
                }
            }
        } else if unowned_async_function_is_then_handler(*function_id, ctx) {
            completion_call_ids = unowned_async_setter_calls(
                *function_id,
                state.setter_symbol_id,
                ctx,
                nearest_function_index,
            );
        }
        if completion_call_ids.is_empty() {
            continue;
        }
        if state.is_boolean_activity_state {
            let starts_activity = activity_start_call_ids.iter().any(|call_id| {
                unowned_async_call_argument(*call_id, ctx)
                    .is_some_and(|argument| unowned_async_is_boolean_literal(argument, true))
            });
            if !starts_activity {
                continue;
            }
            if let Some(call_id) = completion_call_ids.iter().copied().find(|call_id| {
                unowned_async_call_argument(*call_id, ctx)
                    .is_some_and(|argument| unowned_async_is_boolean_literal(argument, false))
                    && !unowned_async_call_is_ownership_guarded(*call_id, *function_id, ctx)
            }) {
                return Some(call_id);
            }
            continue;
        }
        let function_span = ctx.nodes().get_node(*function_id).span();
        if !unowned_async_node_contains_request_identity(function_span, ctx) {
            continue;
        }
        let has_clear = completion_call_ids.iter().any(|call_id| {
            unowned_async_call_argument(*call_id, ctx).is_some_and(|argument| {
                unowned_async_expression_contains_null(
                    argument,
                    *function_id,
                    ctx,
                    nearest_function_index,
                )
            })
        });
        let has_failure = completion_call_ids.iter().any(|call_id| {
            unowned_async_call_argument(*call_id, ctx)
                .is_some_and(unowned_async_expression_contains_non_null_value)
        });
        if !has_clear || !has_failure {
            continue;
        }
        if let Some(call_id) = completion_call_ids.iter().copied().find(|call_id| {
            unowned_async_call_argument(*call_id, ctx).is_some_and(|argument| {
                !unowned_async_is_function_expression(argument)
                    && unowned_async_expression_contains_null(
                        argument,
                        *function_id,
                        ctx,
                        nearest_function_index,
                    )
                    && !unowned_async_call_is_ownership_guarded(*call_id, *function_id, ctx)
            })
        }) {
            return Some(call_id);
        }
    }
    None
}

fn unowned_async_call_argument<'node, 'ast>(
    call_id: NodeId,
    ctx: &'node LintContext<'ast>,
) -> Option<&'node Expression<'ast>> {
    let AstKind::CallExpression(call) = ctx.nodes().get_node(call_id).kind() else {
        return None;
    };
    call.arguments.first()?.as_expression()
}

fn unowned_async_function_is_then_handler(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    let function_node = ctx.nodes().get_node(function_id);
    let parent = ctx.nodes().parent_node(function_node.id());
    let AstKind::CallExpression(call) = parent.kind() else {
        return false;
    };
    call.arguments
        .iter()
        .any(|argument| argument.span() == function_node.span())
        && call
            .callee
            .as_member_expression()
            .is_some_and(|member| member.static_property_name().as_deref() == Some("then"))
}
