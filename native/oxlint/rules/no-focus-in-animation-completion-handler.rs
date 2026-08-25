use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ANIMATION_COMPLETION_HANDLER_NAMES: [&str; 4] = [
    "onAnimationEnd",
    "onAnimationEndCapture",
    "onTransitionEnd",
    "onTransitionEndCapture",
];

#[derive(Debug, Default, Clone)]
pub struct NoFocusInAnimationCompletionHandler;

declare_oxc_lint!(
    /// Disallow moving focus from animation and transition completion handlers.
    NoFocusInAnimationCompletionHandler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow moving focus from animation and transition completion handlers.",
);

#[derive(Clone, Copy, PartialEq, Eq)]
struct ProvenRenderLocation {
    owner_id: oxc_semantic::NodeId,
    root_id: oxc_semantic::NodeId,
}

#[derive(Clone, Copy)]
struct IntrinsicReactRefAttachment {
    location: ProvenRenderLocation,
    node_id: oxc_semantic::NodeId,
}

impl Rule for NoFocusInAnimationCompletionHandler {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let intrinsic_ref_index = collect_intrinsic_react_ref_index(ctx);
        let mut reported_focus_call_ids = std::collections::HashSet::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if intrinsic_element_name(opening_element).is_none() {
                continue;
            }
            let Some(handler_render_location) = get_proven_render_location(node, ctx) else {
                continue;
            };
            if is_in_statically_impossible_handler_path(node, handler_render_location.owner_id, ctx)
            {
                continue;
            }
            for handler_name in ANIMATION_COMPLETION_HANDLER_NAMES {
                let Some(handler_expression) =
                    resolve_completion_handler_expression(opening_element, handler_name)
                else {
                    continue;
                };
                let Some(handler_id) = resolve_react_completion_handler(handler_expression, ctx)
                else {
                    continue;
                };
                let handler_node = ctx.nodes().get_node(handler_id);
                if is_generator_function(handler_node)
                    || !is_handler_definition_reachable(handler_node, ctx)
                {
                    continue;
                }
                for focus_call_id in collect_direct_focus_call_ids(
                    handler_node,
                    node,
                    handler_render_location,
                    &intrinsic_ref_index,
                    ctx,
                ) {
                    if !reported_focus_call_ids.insert(focus_call_id) {
                        continue;
                    }
                    let focus_call = ctx.nodes().get_node(focus_call_id);
                    ctx.diagnostic(
                        OxcDiagnostic::warn(format!(
                            "This {handler_name} handler moves focus after visual completion. Completion events can be skipped when animation is canceled, reduced, or removed; move focus when the interaction state changes instead."
                        ))
                        .with_label(focus_call.span()),
                    );
                }
            }
        }
    }
}

fn intrinsic_element_name<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
) -> Option<&'a str> {
    let oxc_ast::ast::JSXElementName::Identifier(identifier) = &opening_element.name else {
        return None;
    };
    identifier
        .name
        .chars()
        .next()
        .is_some_and(char::is_lowercase)
        .then_some(identifier.name.as_str())
}

fn is_generator_function(node: &crate::AstNode<'_>) -> bool {
    matches!(node.kind(), AstKind::Function(function) if function.generator)
}

fn get_proven_render_location<'a>(
    opening_node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<ProvenRenderLocation> {
    let mut current = opening_node;
    let mut did_leave_own_element = false;
    loop {
        let transparent_root = transparent_expression_root(current, ctx);
        if transparent_root.id() != current.id() {
            current = transparent_root;
            continue;
        }
        let parent = ctx.nodes().parent_node(current.id());
        match parent.kind() {
            AstKind::JSXElement(element) => {
                if element.opening_element.node_id.get() == current.id() {
                    did_leave_own_element = true;
                } else if did_leave_own_element
                    && intrinsic_element_name(&element.opening_element).is_none()
                {
                    return None;
                }
                current = parent;
            }
            AstKind::JSXFragment(_) => current = parent,
            AstKind::JSXExpressionContainer(container)
                if container
                    .expression
                    .as_expression()
                    .is_some_and(|expression| expression.span() == current.span())
                    && !matches!(
                        ctx.nodes().parent_node(parent.id()).kind(),
                        AstKind::JSXAttribute(_)
                    ) =>
            {
                current = parent;
            }
            AstKind::ConditionalExpression(expression)
                if expression.consequent.span() == current.span()
                    || expression.alternate.span() == current.span() =>
            {
                current = parent;
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span() == current.span()
                    || (expression.left.span() == current.span()
                        && expression.operator != oxc_syntax::operator::LogicalOperator::And) =>
            {
                current = parent;
            }
            AstKind::ArrayExpression(expression)
                if expression.elements.iter().any(|element| {
                    element
                        .as_expression()
                        .is_some_and(|element| element.span() == current.span())
                }) =>
            {
                current = parent;
            }
            AstKind::SequenceExpression(expression)
                if expression
                    .expressions
                    .last()
                    .is_some_and(|expression| expression.span() == current.span()) =>
            {
                current = parent;
            }
            AstKind::ReturnStatement(statement)
                if statement
                    .argument
                    .as_ref()
                    .is_some_and(|argument| argument.span() == current.span()) =>
            {
                let owner = crate::ast_util::get_enclosing_function(parent, ctx)?;
                if is_generator_function(owner) {
                    return None;
                }
                return Some(ProvenRenderLocation {
                    owner_id: owner.id(),
                    root_id: parent.id(),
                });
            }
            AstKind::ArrowFunctionExpression(function)
                if function
                    .get_expression()
                    .is_some_and(|expression| expression.span() == current.span()) =>
            {
                return Some(ProvenRenderLocation {
                    owner_id: parent.id(),
                    root_id: parent.id(),
                });
            }
            _ => return None,
        }
    }
}

fn resolve_completion_handler_expression<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    handler_name: &str,
) -> Option<&'a Expression<'a>> {
    let resolution = resolve_static_jsx_attribute(opening_element, handler_name, true);
    if !resolution.is_present || resolution.is_unknown {
        return None;
    }
    if let Some(expression) = resolution.expression {
        return Some(expression);
    }
    let attribute = resolution.attribute?;
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) =
        attribute.value.as_ref()?
    else {
        return None;
    };
    container.expression.as_expression()
}

fn resolve_react_completion_handler<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<oxc_semantic::NodeId> {
    resolve_react_completion_handler_inner(expression, ctx, &mut Vec::new())
}

fn resolve_react_completion_handler_inner<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::CallExpression(call_expression)
            if is_react_api_call(call_expression, "useCallback", ctx) =>
        {
            resolve_react_completion_handler_inner(
                call_expression.arguments.first()?.as_expression()?,
                ctx,
                visited_symbol_ids,
            )
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if visited_symbol_ids.contains(&symbol_id)
                || ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .any(oxc_semantic::Reference::is_write)
            {
                return None;
            }
            visited_symbol_ids.push(symbol_id);
            let declaration = ctx.symbol_declaration(symbol_id);
            if matches!(declaration.kind(), AstKind::Function(_)) {
                return Some(declaration.id());
            }
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(
                parent.kind(),
                AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            resolve_react_completion_handler_inner(
                declarator.init.as_ref()?,
                ctx,
                visited_symbol_ids,
            )
        }
        _ => None,
    }
}

fn collect_intrinsic_react_ref_index(
    ctx: &LintContext<'_>,
) -> std::collections::HashMap<oxc_semantic::SymbolId, Vec<IntrinsicReactRefAttachment>> {
    let mut attachments_by_symbol_id = std::collections::HashMap::new();
    let mut ref_symbol_ids = std::collections::HashSet::new();
    let mut uncertain_ref_symbol_ids = std::collections::HashSet::new();
    for node in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        let Some(render_location) = get_proven_render_location(node, ctx) else {
            continue;
        };
        if !is_node_reachable_within_function(
            node,
            ctx.nodes().get_node(render_location.owner_id),
            ctx,
        ) || is_in_statically_impossible_handler_path(node, render_location.owner_id, ctx)
            || opening_element.attributes.iter().any(|attribute| {
                matches!(
                    attribute,
                    oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
                )
            })
        {
            continue;
        }
        let Some(ref_attribute) = get_authoritative_jsx_attribute(opening_element, "ref", true)
        else {
            continue;
        };
        let Some(Expression::Identifier(ref_identifier)) = ref_attribute
            .value
            .as_ref()
            .and_then(|value| match value {
                oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
                    container.expression.as_expression()
                }
                _ => None,
            })
            .map(Expression::get_inner_expression)
        else {
            continue;
        };
        let Some(symbol_id) = direct_react_ref_symbol(ref_identifier, ctx) else {
            continue;
        };
        ref_symbol_ids.insert(symbol_id);
        let is_focusable_attachment =
            intrinsic_element_name(opening_element).is_some_and(|tag_name| {
                is_focusable_jsx_opening_element(opening_element, tag_name, true)
                    && !has_statically_excluded_ancestry(node, render_location.root_id, ctx)
                    && !is_dynamically_typed_input(opening_element)
            });
        if is_focusable_attachment {
            attachments_by_symbol_id
                .entry(symbol_id)
                .or_insert_with(Vec::new)
                .push(IntrinsicReactRefAttachment {
                    location: render_location,
                    node_id: node.id(),
                });
        } else {
            uncertain_ref_symbol_ids.insert(symbol_id);
        }
    }
    for symbol_id in ref_symbol_ids {
        if ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| !is_safe_direct_react_ref_reference(reference.node_id(), ctx))
        {
            uncertain_ref_symbol_ids.insert(symbol_id);
        }
    }
    for symbol_id in uncertain_ref_symbol_ids {
        attachments_by_symbol_id.remove(&symbol_id);
    }
    attachments_by_symbol_id
}

fn direct_react_ref_symbol(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return None;
    }
    let Expression::CallExpression(call_expression) =
        declarator.init.as_ref()?.get_inner_expression()
    else {
        return None;
    };
    (is_react_api_call(call_expression, "useRef", ctx)
        || is_react_api_call(call_expression, "createRef", ctx))
    .then_some(symbol_id)
}

fn is_safe_direct_react_ref_reference(
    reference_node_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    let reference_node = ctx.nodes().get_node(reference_node_id);
    let reference_root = transparent_expression_root(reference_node, ctx);
    let parent = ctx.nodes().parent_node(reference_root.id());
    if ast_node_is_member_access(parent, reference_root.span(), "current") {
        let current_root = transparent_expression_root(parent, ctx);
        let focus_parent = ctx.nodes().parent_node(current_root.id());
        if ast_node_is_member_access(focus_parent, current_root.span(), "focus") {
            let focus_root = transparent_expression_root(focus_parent, ctx);
            let call_parent = ctx.nodes().parent_node(focus_root.id());
            return matches!(
                call_parent.kind(),
                AstKind::CallExpression(call) if call.callee.span() == focus_root.span()
            );
        }
        return false;
    }
    if let AstKind::ArrayExpression(array) = parent.kind() {
        let call_parent = ctx.nodes().parent_node(parent.id());
        if let AstKind::CallExpression(call) = call_parent.kind()
            && call
                .arguments
                .get(1)
                .and_then(oxc_ast::ast::Argument::as_expression)
                .is_some_and(|argument| argument.span() == array.span)
            && is_react_api_call(call, "useCallback", ctx)
        {
            return true;
        }
    }
    let AstKind::JSXExpressionContainer(_) = parent.kind() else {
        return false;
    };
    let attribute_parent = ctx.nodes().parent_node(parent.id());
    matches!(
        attribute_parent.kind(),
        AstKind::JSXAttribute(attribute)
            if matches!(
                &attribute.name,
                oxc_ast::ast::JSXAttributeName::Identifier(name) if name.name == "ref"
            )
    )
}

fn ast_node_is_member_access(
    node: &crate::AstNode<'_>,
    object_span: oxc_span::Span,
    property_name: &str,
) -> bool {
    match node.kind() {
        AstKind::StaticMemberExpression(member) => {
            member.object.span() == object_span && member.property.name == property_name
        }
        AstKind::ComputedMemberExpression(member) => {
            member.object.span() == object_span
                && matches!(
                    member.expression.get_inner_expression(),
                    Expression::StringLiteral(literal) if literal.value == property_name
                )
        }
        _ => false,
    }
}

fn is_dynamically_typed_input(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    if intrinsic_element_name(opening_element) != Some("input") {
        return false;
    }
    let Some(attribute) = first_jsx_attribute_ignore_case(opening_element, "type") else {
        return false;
    };
    !matches!(
        attribute.value.as_ref(),
        Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(_))
    )
}

fn first_jsx_attribute_ignore_case<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
) -> Option<&'b oxc_ast::ast::JSXAttribute<'a>> {
    opening_element.attributes.iter().find_map(|attribute| {
        let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(
            &attribute.name,
            oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                if identifier.name.eq_ignore_ascii_case(attribute_name)
        )
        .then_some(&**attribute)
    })
}

fn has_statically_excluded_ancestry(
    opening_node: &crate::AstNode<'_>,
    render_root_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if is_statically_excluded_opening_element(opening_node, true, ctx) {
        return true;
    }
    for ancestor in ctx.nodes().ancestors(opening_node.id()) {
        if ancestor.id() == render_root_id {
            return false;
        }
        if let AstKind::JSXElement(element) = ancestor.kind() {
            let opening = ctx.nodes().get_node(element.opening_element.node_id.get());
            if opening.id() != opening_node.id()
                && is_statically_excluded_opening_element(opening, false, ctx)
            {
                return true;
            }
        }
    }
    false
}

fn is_statically_excluded_opening_element(
    opening_node: &crate::AstNode<'_>,
    is_target: bool,
    _ctx: &LintContext<'_>,
) -> bool {
    let AstKind::JSXOpeningElement(opening_element) = opening_node.kind() else {
        return true;
    };
    let Some(tag_name) = intrinsic_element_name(opening_element) else {
        return true;
    };
    if static_boolean_attribute_state(opening_element, "hidden") != Some(false)
        || static_boolean_attribute_state(opening_element, "inert") != Some(false)
        || has_statically_hiding_class_name(opening_element)
        || has_statically_hiding_style(opening_element)
        || tag_name == "template"
        || (tag_name == "fieldset"
            && static_boolean_attribute_state(opening_element, "disabled") != Some(false))
        || (matches!(tag_name, "dialog" | "details")
            && static_boolean_attribute_state(opening_element, "open") != Some(true))
    {
        return true;
    }
    is_target && is_dynamically_typed_input(opening_element)
}

fn static_boolean_attribute_state(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    attribute_name: &str,
) -> Option<bool> {
    let Some(attribute) = first_jsx_attribute_ignore_case(opening_element, attribute_name) else {
        return Some(false);
    };
    let Some(value) = &attribute.value else {
        return Some(true);
    };
    let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) = value else {
        return Some(true);
    };
    match container.expression.as_expression()?.get_inner_expression() {
        Expression::BooleanLiteral(literal) => Some(literal.value),
        _ => None,
    }
}

fn has_statically_hiding_class_name(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    first_jsx_attribute_ignore_case(opening_element, "className")
        .and_then(|attribute| attribute.value.as_ref())
        .and_then(|value| match value {
            oxc_ast::ast::JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        })
        .is_some_and(|class_name| {
            tailwind_class_name_tokens(class_name)
                .iter()
                .any(|token| matches!(token.utility, "hidden" | "invisible" | "collapse"))
        })
}

fn has_statically_hiding_style(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(attribute) = first_jsx_attribute_ignore_case(opening_element, "style") else {
        return false;
    };
    let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) =
        attribute.value.as_ref()
    else {
        return false;
    };
    let Some(Expression::ObjectExpression(style)) = container.expression.as_expression() else {
        return false;
    };
    style.properties.iter().any(|property| {
        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        let Some(property_name) = property.key.static_name() else {
            return false;
        };
        let Expression::StringLiteral(value) = &property.value else {
            return false;
        };
        matches!(
            (property_name.as_ref(), value.value.as_str()),
            ("display", "none")
                | ("visibility", "hidden" | "collapse")
                | ("contentVisibility", "hidden")
        )
    })
}

fn is_handler_definition_reachable<'a>(
    handler: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if is_inside_statically_unreachable_branch(handler, ctx)
        || node_has_impossible_predicate_constraints(handler, ctx)
    {
        return false;
    }
    let Some(outer_function) = crate::ast_util::get_enclosing_function(handler, ctx) else {
        return true;
    };
    if matches!(handler.kind(), AstKind::Function(_))
        && matches!(
            ctx.nodes().parent_node(handler.id()).kind(),
            AstKind::FunctionBody(_)
        )
    {
        return true;
    }
    is_node_reachable_within_function(handler, outer_function, ctx)
}

fn collect_direct_focus_call_ids(
    handler: &crate::AstNode<'_>,
    handler_site: &crate::AstNode<'_>,
    handler_render_location: ProvenRenderLocation,
    intrinsic_ref_index: &std::collections::HashMap<
        oxc_semantic::SymbolId,
        Vec<IntrinsicReactRefAttachment>,
    >,
    ctx: &LintContext<'_>,
) -> Vec<oxc_semantic::NodeId> {
    let mut focus_call_ids = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            continue;
        };
        if !handler.span().contains_inclusive(candidate.span())
            || !call_executes_directly_in_handler(candidate, handler, ctx)
            || is_in_statically_impossible_handler_path(candidate, handler.id(), ctx)
        {
            continue;
        }
        let Some(focus_member) = call_expression
            .callee
            .get_inner_expression()
            .as_member_expression()
        else {
            continue;
        };
        if focus_member.static_property_name() != Some("focus") {
            continue;
        }
        let focus_receiver = focus_member.object().get_inner_expression();
        if is_handler_current_target(focus_receiver, handler, ctx)
            && handler_site
                .kind()
                .as_jsx_opening_element()
                .is_some_and(|opening| {
                    intrinsic_element_name(opening).is_some_and(|tag_name| {
                        is_focusable_jsx_opening_element(opening, tag_name, true)
                            && !has_statically_excluded_ancestry(
                                handler_site,
                                handler_render_location.root_id,
                                ctx,
                            )
                    })
                })
        {
            focus_call_ids.push(candidate.id());
            continue;
        }
        let Some(ref_symbol_id) = react_ref_symbol_from_current_member(focus_receiver, ctx) else {
            continue;
        };
        if intrinsic_ref_index
            .get(&ref_symbol_id)
            .is_some_and(|attachments| {
                attachments.iter().any(|attachment| {
                    attachment.location == handler_render_location
                        && nodes_can_co_execute(
                            ctx.nodes().get_node(attachment.node_id),
                            handler,
                            ctx,
                        )
                        && nodes_can_co_execute(
                            ctx.nodes().get_node(attachment.node_id),
                            handler_site,
                            ctx,
                        )
                        && nodes_can_co_execute(
                            ctx.nodes().get_node(attachment.node_id),
                            candidate,
                            ctx,
                        )
                })
            })
        {
            focus_call_ids.push(candidate.id());
        }
    }
    focus_call_ids
}

fn call_executes_directly_in_handler(
    call: &crate::AstNode<'_>,
    handler: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut execution_node = call;
    for ancestor in ctx.nodes().ancestors(call.id()) {
        if ancestor.id() == handler.id() {
            return is_node_reachable_within_function(execution_node, ancestor, ctx);
        }
        match ancestor.kind() {
            AstKind::PropertyDefinition(_) | AstKind::AccessorProperty(_) => return false,
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                if is_generator_function(ancestor)
                    || !is_immediately_invoked_function(ancestor, ctx)
                    || !is_node_reachable_within_function(execution_node, ancestor, ctx)
                {
                    return false;
                }
                execution_node = ancestor;
            }
            _ => {}
        }
    }
    false
}

fn is_immediately_invoked_function<'a>(
    function: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let root = transparent_expression_root(function, ctx);
    let parent = ctx.nodes().parent_node(root.id());
    matches!(
        parent.kind(),
        AstKind::CallExpression(call) if call.callee.span() == root.span()
    )
}

fn is_in_statically_impossible_handler_path(
    node: &crate::AstNode<'_>,
    boundary_id: oxc_semantic::NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    if is_inside_statically_unreachable_branch(node, ctx)
        || node_has_impossible_predicate_constraints(node, ctx)
    {
        return true;
    }
    let mut child = node;
    for parent in ctx.nodes().ancestors(node.id()) {
        if parent.id() == boundary_id {
            return false;
        }
        if matches!(parent.kind(), AstKind::SwitchCase(_)) {
            return true;
        }
        let predicate = match parent.kind() {
            AstKind::IfStatement(statement)
                if statement.consequent.span().contains_inclusive(child.span()) =>
            {
                Some((&statement.test, true))
            }
            AstKind::IfStatement(statement)
                if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span().contains_inclusive(child.span())) =>
            {
                Some((&statement.test, false))
            }
            AstKind::ConditionalExpression(expression)
                if expression
                    .consequent
                    .span()
                    .contains_inclusive(child.span()) =>
            {
                Some((&expression.test, true))
            }
            AstKind::ConditionalExpression(expression)
                if expression.alternate.span().contains_inclusive(child.span()) =>
            {
                Some((&expression.test, false))
            }
            AstKind::LogicalExpression(expression)
                if expression.right.span().contains_inclusive(child.span()) =>
            {
                match expression.operator {
                    oxc_syntax::operator::LogicalOperator::And => Some((&expression.left, true)),
                    oxc_syntax::operator::LogicalOperator::Or => Some((&expression.left, false)),
                    oxc_syntax::operator::LogicalOperator::Coalesce => None,
                }
            }
            _ => None,
        };
        if predicate.is_some_and(|(test, expected_truthiness)| {
            has_contradictory_boolean_requirements(test, expected_truthiness, ctx)
        }) {
            return true;
        }
        child = parent;
    }
    false
}

fn has_contradictory_boolean_requirements(
    expression: &Expression<'_>,
    expected_truthiness: bool,
    ctx: &LintContext<'_>,
) -> bool {
    fn collect(
        expression: &Expression<'_>,
        required_truthiness: bool,
        requirements: &mut std::collections::HashMap<oxc_semantic::SymbolId, bool>,
        ctx: &LintContext<'_>,
    ) -> bool {
        let expression = expression.get_inner_expression();
        if let Some(value) = completion_static_truthiness(expression) {
            return value != required_truthiness;
        }
        if let Expression::UnaryExpression(unary) = expression
            && unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
        {
            return collect(&unary.argument, !required_truthiness, requirements, ctx);
        }
        if let Expression::LogicalExpression(logical) = expression
            && ((logical.operator == oxc_syntax::operator::LogicalOperator::And
                && required_truthiness)
                || (logical.operator == oxc_syntax::operator::LogicalOperator::Or
                    && !required_truthiness))
        {
            return collect(&logical.left, required_truthiness, requirements, ctx)
                || collect(&logical.right, required_truthiness, requirements, ctx);
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
        if requirements
            .get(&symbol_id)
            .is_some_and(|previous| *previous != required_truthiness)
        {
            return true;
        }
        requirements.insert(symbol_id, required_truthiness);
        false
    }
    collect(
        expression,
        expected_truthiness,
        &mut std::collections::HashMap::new(),
        ctx,
    )
}

fn completion_static_truthiness(expression: &Expression<'_>) -> Option<bool> {
    let expression = expression.get_inner_expression();
    if let Some(truthiness) = static_literal_truthiness(expression) {
        return Some(truthiness);
    }
    match expression {
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            Some(
                template.quasis[0]
                    .value
                    .cooked
                    .as_ref()
                    .is_some_and(|value| !value.as_str().is_empty()),
            )
        }
        Expression::UnaryExpression(unary)
            if unary.operator == oxc_syntax::operator::UnaryOperator::LogicalNot =>
        {
            completion_static_truthiness(&unary.argument).map(|truthiness| !truthiness)
        }
        _ => None,
    }
}

fn is_handler_current_target(
    expression: &Expression<'_>,
    handler: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(current_target) = expression.as_member_expression() else {
        return false;
    };
    if current_target.static_property_name() != Some("currentTarget") {
        return false;
    }
    let Expression::Identifier(event_identifier) = current_target.object().get_inner_expression()
    else {
        return false;
    };
    let Some(event_symbol_id) = ctx
        .scoping()
        .get_reference(event_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    match handler.kind() {
        AstKind::Function(function) => function
            .params
            .items
            .first()
            .and_then(|parameter| parameter.pattern.get_binding_identifier())
            .is_some_and(|binding| binding.symbol_id() == event_symbol_id),
        AstKind::ArrowFunctionExpression(function) => function
            .params
            .items
            .first()
            .and_then(|parameter| parameter.pattern.get_binding_identifier())
            .is_some_and(|binding| binding.symbol_id() == event_symbol_id),
        _ => false,
    }
}

fn react_ref_symbol_from_current_member(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::SymbolId> {
    let current_member = expression.as_member_expression()?;
    if current_member.static_property_name() != Some("current") {
        return None;
    }
    let Expression::Identifier(identifier) = current_member.object().get_inner_expression() else {
        return None;
    };
    direct_react_ref_symbol(identifier, ctx)
}
