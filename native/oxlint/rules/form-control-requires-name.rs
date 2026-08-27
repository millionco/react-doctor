use std::collections::HashMap;

use oxc_ast::{
    ast::{
        ArrayExpressionElement, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue,
        JSXChild, JSXOpeningElement, RegExpFlags,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::Span;
use oxc_syntax::operator::LogicalOperator;

use crate::{context::LintContext, rule::Rule, AstNode};

const FORM_CONTROL_TAG_NAMES: [&str; 3] = ["input", "select", "textarea"];
const NON_DATA_INPUT_TYPES: [&str; 4] = ["button", "image", "reset", "submit"];
const MESSAGE: &str = "This native control belongs to a form but has no name, so its value is omitted from FormData and native submission. Add a stable name.";

#[derive(Debug, Default, Clone)]
pub struct FormControlRequiresName;

struct StaticIdElement {
    element_type: String,
    node_id: NodeId,
}

struct ExternalControlCandidate {
    form_id: String,
    node_id: NodeId,
    owner_id: Option<NodeId>,
}

declare_oxc_lint!(
    /// Require data-bearing native form controls to have a name.
    FormControlRequiresName,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require native form controls to have a submission name.",
);

impl Rule for FormControlRequiresName {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let generated_image_element_ids = generated_image_jsx_opening_element_ids(ctx);
        let mut static_id_elements_by_owner =
            HashMap::<Option<NodeId>, HashMap<String, Vec<StaticIdElement>>>::new();
        let mut external_control_candidates = Vec::<ExternalControlCandidate>::new();

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let element_type = resolve_jsx_element_type_name(opening_element, ctx);
            let is_generated_image = generated_image_element_ids.contains(&node.id());
            if !is_generated_image && !form_control_is_inside_react_portal(node, ctx) {
                collect_static_form_control_id(
                    node,
                    opening_element,
                    &element_type,
                    &mut static_id_elements_by_owner,
                    ctx,
                );
            }
            if element_type == "form"
                || !FORM_CONTROL_TAG_NAMES.contains(&element_type.as_ref())
                || is_generated_image
                || form_control_opening_element_may_be_disabled(opening_element, ctx)
                || form_control_is_disabled_by_fieldset(node, ctx)
            {
                continue;
            }
            if element_type == "input" {
                let type_attribute =
                    get_authoritative_jsx_attribute(opening_element, "type", false);
                if !form_control_input_type_may_submit_data(
                    type_attribute,
                    form_control_has_spread_that_may_provide(opening_element, "type"),
                    ctx,
                ) {
                    continue;
                }
            }
            let name_attribute = get_authoritative_jsx_attribute(opening_element, "name", false);
            if name_attribute
                .is_some_and(|attribute| form_control_name_may_submit_data(attribute, ctx))
                || (name_attribute.is_none()
                    && form_control_has_spread_that_may_provide(opening_element, "name"))
            {
                continue;
            }

            let form_attribute = get_authoritative_jsx_attribute(opening_element, "form", false);
            let mut form_owner_attribute_is_absent =
                !form_control_has_spread_that_may_provide(opening_element, "form");
            if let Some(form_attribute) = form_attribute {
                match form_control_static_dom_string_attribute_value(form_attribute, ctx) {
                    StaticDomStringValue::Dynamic => continue,
                    StaticDomStringValue::String(value) if value.is_empty() => continue,
                    StaticDomStringValue::String(form_id) => {
                        if form_control_is_inside_react_portal(node, ctx) {
                            continue;
                        }
                        external_control_candidates.push(ExternalControlCandidate {
                            form_id,
                            node_id: node.id(),
                            owner_id: form_control_render_owner(node, ctx),
                        });
                        continue;
                    }
                    StaticDomStringValue::Omitted => {
                        form_owner_attribute_is_absent = true;
                    }
                }
            }
            if form_owner_attribute_is_absent && form_control_has_form_ancestor(node, ctx) {
                form_control_report(opening_element, ctx);
            }
        }

        for candidate in external_control_candidates {
            let Some(matching_elements) = static_id_elements_by_owner
                .get(&candidate.owner_id)
                .and_then(|elements| elements.get(&candidate.form_id))
            else {
                continue;
            };
            let candidate_node = ctx.nodes().get_node(candidate.node_id);
            let matching_elements = matching_elements
                .iter()
                .filter(|element| {
                    nodes_can_co_execute(ctx.nodes().get_node(element.node_id), candidate_node, ctx)
                })
                .collect::<Vec<_>>();
            if matching_elements.len() == 1 && matching_elements[0].element_type == "form" {
                let AstKind::JSXOpeningElement(opening_element) = candidate_node.kind() else {
                    continue;
                };
                form_control_report(opening_element, ctx);
            }
        }
    }
}

enum StaticDomStringValue {
    String(String),
    Omitted,
    Dynamic,
}

fn form_control_report(opening_element: &JSXOpeningElement<'_>, ctx: &LintContext<'_>) {
    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
}

fn form_control_name_may_submit_data(attribute: &JSXAttribute<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(value) = &attribute.value else {
        return false;
    };
    if let Some(value) = get_string_literal_attribute_value(attribute) {
        return !value.is_empty();
    }
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return true;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => false,
        Expression::UnaryExpression(unary) if is_literal_void_expression(unary) => false,
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            false
        }
        _ => true,
    }
}

fn form_control_opening_element_may_be_disabled(
    opening_element: &JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, "disabled", false)
    else {
        return form_control_has_spread_that_may_provide(opening_element, "disabled");
    };
    let Some(value) = &attribute.value else {
        return true;
    };
    if let Some(value) = get_string_literal_attribute_value(attribute) {
        return !value.is_empty();
    }
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return true;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => false,
        Expression::BooleanLiteral(value) => value.value,
        Expression::NumericLiteral(value) => value.value != 0.0 && !value.value.is_nan(),
        Expression::BigIntLiteral(value) => value.value != "0",
        Expression::UnaryExpression(unary) if is_literal_void_expression(unary) => false,
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            false
        }
        _ => true,
    }
}

fn form_control_input_type_may_submit_data(
    attribute: Option<&JSXAttribute<'_>>,
    has_unresolved_type_spread: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(attribute) = attribute else {
        return !has_unresolved_type_spread;
    };
    if let Some(input_type) = get_string_literal_attribute_value(attribute) {
        return !NON_DATA_INPUT_TYPES
            .iter()
            .any(|candidate| input_type.eq_ignore_ascii_case(candidate));
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return true;
    };
    let Some(expression) = container.expression.as_expression() else {
        return true;
    };
    match expression.get_inner_expression() {
        expression if expression.is_literal() => true,
        Expression::UnaryExpression(unary) if is_literal_void_expression(unary) => true,
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            true
        }
        _ => false,
    }
}

fn form_control_static_dom_string_attribute_value(
    attribute: &JSXAttribute<'_>,
    ctx: &LintContext<'_>,
) -> StaticDomStringValue {
    let Some(value) = &attribute.value else {
        return StaticDomStringValue::String(String::new());
    };
    if let Some(value) = get_string_literal_attribute_value(attribute) {
        return StaticDomStringValue::String(value.to_string());
    }
    let JSXAttributeValue::ExpressionContainer(container) = value else {
        return StaticDomStringValue::Dynamic;
    };
    let Some(expression) = container.expression.as_expression() else {
        return StaticDomStringValue::Omitted;
    };
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => StaticDomStringValue::Omitted,
        Expression::NumericLiteral(value) => StaticDomStringValue::String(value.value.to_string()),
        Expression::BigIntLiteral(value) => StaticDomStringValue::String(value.value.to_string()),
        Expression::RegExpLiteral(value) => {
            StaticDomStringValue::String(form_control_regexp_string(value))
        }
        Expression::UnaryExpression(unary) if is_literal_void_expression(unary) => {
            StaticDomStringValue::Omitted
        }
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            StaticDomStringValue::Omitted
        }
        _ => StaticDomStringValue::Dynamic,
    }
}

fn form_control_regexp_string(value: &oxc_ast::ast::RegExpLiteral<'_>) -> String {
    let mut rendered_value = String::with_capacity(value.regex.pattern.text.len() + 10);
    rendered_value.push('/');
    rendered_value.push_str(value.regex.pattern.text.as_str());
    rendered_value.push('/');
    for (flag, character) in [
        (RegExpFlags::D, 'd'),
        (RegExpFlags::G, 'g'),
        (RegExpFlags::I, 'i'),
        (RegExpFlags::M, 'm'),
        (RegExpFlags::S, 's'),
        (RegExpFlags::U, 'u'),
        (RegExpFlags::V, 'v'),
        (RegExpFlags::Y, 'y'),
    ] {
        if value.regex.flags.contains(flag) {
            rendered_value.push(character);
        }
    }
    rendered_value
}

fn form_control_has_spread_that_may_provide(
    opening_element: &JSXOpeningElement<'_>,
    attribute_name: &str,
) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            JSXAttributeItem::SpreadAttribute(spread)
                if can_expression_override_jsx_attribute(&spread.argument, attribute_name, false)
        )
    })
}

fn form_control_is_disabled_by_fieldset<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::JSXElement(fieldset) = ancestor.kind() else {
            continue;
        };
        if resolve_jsx_element_type_name(&fieldset.opening_element, ctx) != "fieldset"
            || !form_control_opening_element_may_be_disabled(&fieldset.opening_element, ctx)
        {
            continue;
        }
        let first_legend = form_control_first_fieldset_legend(fieldset, node.span(), ctx);
        if first_legend.is_none_or(|legend| !legend.contains_inclusive(node.span())) {
            return true;
        }
    }
    false
}

fn form_control_first_fieldset_legend<'a>(
    fieldset: &'a oxc_ast::ast::JSXElement<'a>,
    target_span: Span,
    ctx: &LintContext<'a>,
) -> Option<Span> {
    form_control_first_legend_child(&fieldset.children, target_span, ctx)
}

fn form_control_first_legend_child<'a>(
    children: &'a [JSXChild<'a>],
    target_span: Span,
    ctx: &LintContext<'a>,
) -> Option<Span> {
    for child in children {
        match child {
            JSXChild::Element(element)
                if resolve_jsx_element_type_name(&element.opening_element, ctx) == "legend" =>
            {
                return Some(element.span);
            }
            JSXChild::Fragment(fragment) => {
                if let Some(legend) =
                    form_control_first_legend_child(&fragment.children, target_span, ctx)
                {
                    return Some(legend);
                }
            }
            JSXChild::ExpressionContainer(container) => {
                let Some(expression) = container.expression.as_expression() else {
                    continue;
                };
                let mut potential_legends = Vec::new();
                form_control_collect_potential_legends(expression, ctx, &mut potential_legends);
                if let Some(containing_legend) = potential_legends
                    .iter()
                    .find(|legend| legend.contains_inclusive(target_span))
                {
                    return Some(*containing_legend);
                }
                if let Some(first_legend) = potential_legends.first() {
                    return Some(*first_legend);
                }
            }
            _ => {}
        }
    }
    None
}

fn form_control_collect_potential_legends<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    legends: &mut Vec<Span>,
) {
    match expression.get_inner_expression() {
        Expression::JSXElement(element)
            if resolve_jsx_element_type_name(&element.opening_element, ctx) == "legend" =>
        {
            legends.push(element.span);
        }
        Expression::LogicalExpression(logical) => {
            form_control_collect_potential_legends(&logical.right, ctx, legends);
        }
        Expression::ConditionalExpression(conditional) => {
            form_control_collect_potential_legends(&conditional.consequent, ctx, legends);
            form_control_collect_potential_legends(&conditional.alternate, ctx, legends);
        }
        _ => {}
    }
}

fn form_control_has_form_ancestor(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(ancestor.kind(), AstKind::JSXAttribute(_))
            || form_control_node_is_react_portal_call(ancestor, ctx)
        {
            return false;
        }
        if form_control_is_function_node(ancestor) {
            if !function_executes_during_render(ancestor, ctx)
                || !form_control_is_returned_from_function(node, ancestor, ctx)
            {
                return false;
            }
        }
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        let element_type = resolve_jsx_element_type_name(&element.opening_element, ctx);
        if element_type == "form" {
            return true;
        }
        if element_type
            .chars()
            .next()
            .is_some_and(|character| !character.to_lowercase().eq(std::iter::once(character)))
        {
            return false;
        }
    }
    false
}

fn form_control_is_inside_react_portal(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .any(|ancestor| form_control_node_is_react_portal_call(ancestor, ctx))
}

fn form_control_node_is_react_portal_call<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    matches!(
        node.kind(),
        AstKind::CallExpression(call)
            if imported_module_api_matches(&call.callee, "createPortal", "react-dom", ctx)
    )
}

fn form_control_is_function_node(node: &AstNode<'_>) -> bool {
    matches!(
        node.kind(),
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
    )
}

fn form_control_is_returned_from_function(
    node: &AstNode<'_>,
    function_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let mut current = node;
    let mut crossed_return_statement = false;
    loop {
        let parent = ctx.nodes().parent_node(current.id());
        if parent.id() == function_node.id() {
            return crossed_return_statement
                || matches!(
                    function_node.kind(),
                    AstKind::ArrowFunctionExpression(function)
                        if function.get_expression().is_some_and(|expression| {
                            expression.span().contains_inclusive(node.span())
                        })
                );
        }
        match parent.kind() {
            AstKind::ReturnStatement(_) => crossed_return_statement = true,
            AstKind::VariableDeclarator(_)
            | AstKind::JSXAttribute(_)
            | AstKind::ObjectProperty(_) => {
                return false;
            }
            AstKind::Program(_) => return false,
            _ => {}
        }
        current = parent;
    }
}

fn form_control_render_owner(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    let mut search_node_id = node.id();
    loop {
        let Some(function_node) = ctx
            .nodes()
            .ancestors(search_node_id)
            .find(|ancestor| form_control_is_function_node(ancestor))
        else {
            return form_control_top_level_owner(node, ctx);
        };
        if !function_executes_during_render(function_node, ctx)
            || !form_control_is_returned_from_function(node, function_node, ctx)
        {
            return Some(function_node.id());
        }
        search_node_id = function_node.id();
    }
}

fn form_control_top_level_owner(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    let mut top_level_owner = None;
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if matches!(ancestor.kind(), AstKind::Program(_)) {
            break;
        }
        top_level_owner = Some(ancestor.id());
    }
    top_level_owner
}

fn collect_static_form_control_id<'a>(
    node: &AstNode<'a>,
    opening_element: &JSXOpeningElement<'a>,
    element_type: &str,
    static_id_elements_by_owner: &mut HashMap<
        Option<NodeId>,
        HashMap<String, Vec<StaticIdElement>>,
    >,
    ctx: &LintContext<'a>,
) {
    let Some(id_attribute) = get_authoritative_jsx_attribute(opening_element, "id", false) else {
        return;
    };
    let StaticDomStringValue::String(element_id) =
        form_control_static_dom_string_attribute_value(id_attribute, ctx)
    else {
        return;
    };
    if element_id.is_empty() || !form_control_element_is_rendered(node, ctx) {
        return;
    }
    static_id_elements_by_owner
        .entry(form_control_render_owner(node, ctx))
        .or_default()
        .entry(element_id)
        .or_default()
        .push(StaticIdElement {
            element_type: element_type.to_string(),
            node_id: node.id(),
        });
}

fn form_control_element_is_rendered(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let Some(owner_id) = form_control_render_owner(node, ctx) else {
        return true;
    };
    let owner = ctx.nodes().get_node(owner_id);
    if !form_control_is_function_node(owner) {
        return true;
    }
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::JSXElement(target_element) = parent.kind() else {
        return false;
    };
    if let AstKind::ArrowFunctionExpression(function) = owner.kind() {
        if let Some(expression) = function.get_expression() {
            return form_control_expression_may_render_element(
                expression,
                target_element.span,
                ctx,
                &mut Vec::new(),
            );
        }
    }
    let owner_span = owner.span();
    ctx.nodes().iter().any(|candidate| {
        if !owner_span.contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return false;
        };
        let Some(argument) = &return_statement.argument else {
            return false;
        };
        ctx.nodes()
            .ancestors(candidate.id())
            .find(|ancestor| form_control_is_function_node(ancestor))
            .is_some_and(|function| function.id() == owner.id())
            && form_control_expression_may_render_element(
                argument,
                target_element.span,
                ctx,
                &mut Vec::new(),
            )
    })
}

fn form_control_expression_may_render_element<'a>(
    expression: &Expression<'a>,
    target_span: Span,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if visited_symbols.contains(&symbol_id) {
                return false;
            }
            let Some(initializer) = resolve_direct_unreassigned_initializer(identifier, ctx) else {
                return false;
            };
            visited_symbols.push(symbol_id);
            let may_render = form_control_expression_may_render_element(
                initializer,
                target_span,
                ctx,
                visited_symbols,
            );
            visited_symbols.pop();
            may_render
        }
        Expression::JSXElement(element) => {
            element.span == target_span
                || form_control_jsx_children_may_render_element(
                    &element.children,
                    target_span,
                    ctx,
                    visited_symbols,
                )
        }
        Expression::JSXFragment(fragment) => form_control_jsx_children_may_render_element(
            &fragment.children,
            target_span,
            ctx,
            visited_symbols,
        ),
        Expression::ConditionalExpression(conditional) => {
            form_control_expression_may_render_element(
                &conditional.consequent,
                target_span,
                ctx,
                visited_symbols,
            ) || form_control_expression_may_render_element(
                &conditional.alternate,
                target_span,
                ctx,
                visited_symbols,
            )
        }
        Expression::LogicalExpression(logical) => {
            (logical.operator != LogicalOperator::And
                && form_control_expression_may_render_element(
                    &logical.left,
                    target_span,
                    ctx,
                    visited_symbols,
                ))
                || form_control_expression_may_render_element(
                    &logical.right,
                    target_span,
                    ctx,
                    visited_symbols,
                )
        }
        Expression::ArrayExpression(array) => array.elements.iter().any(|element| {
            ArrayExpressionElement::as_expression(element).is_some_and(|expression| {
                form_control_expression_may_render_element(
                    expression,
                    target_span,
                    ctx,
                    visited_symbols,
                )
            })
        }),
        Expression::SequenceExpression(sequence) => {
            sequence.expressions.last().is_some_and(|expression| {
                form_control_expression_may_render_element(
                    expression,
                    target_span,
                    ctx,
                    visited_symbols,
                )
            })
        }
        _ => false,
    }
}

fn form_control_jsx_children_may_render_element<'a>(
    children: &[JSXChild<'a>],
    target_span: Span,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Element(element) => {
            element.span == target_span
                || form_control_jsx_children_may_render_element(
                    &element.children,
                    target_span,
                    ctx,
                    visited_symbols,
                )
        }
        JSXChild::Fragment(fragment) => form_control_jsx_children_may_render_element(
            &fragment.children,
            target_span,
            ctx,
            visited_symbols,
        ),
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| {
                form_control_expression_may_render_element(
                    expression,
                    target_span,
                    ctx,
                    visited_symbols,
                )
            }),
        JSXChild::Text(_) | JSXChild::Spread(_) => false,
    })
}
