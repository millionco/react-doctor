use oxc_ast::{
    AstKind,
    ast::{
        ArrowFunctionBody, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName,
        JSXAttributeValue,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::GetSpan;
use oxc_syntax::operator::UnaryOperator;

use crate::{AstNode, context::LintContext, rule::Rule};

const VALUE_BYPASS_INPUT_TYPES: [&str; 8] = [
    "button", "checkbox", "file", "hidden", "image", "radio", "reset", "submit",
];

#[derive(Debug, Default, Clone)]
pub struct NoControlledInputValueWithoutStateUpdate;

declare_oxc_lint!(
    /// Disallow editable inputs whose controlled value is a fixed literal.
    NoControlledInputValueWithoutStateUpdate,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow controlled inputs with a fixed literal value.",
);

impl Rule for NoControlledInputValueWithoutStateUpdate {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening) = node.kind() else {
            return;
        };
        let Some(tag_name) = opening.name.get_identifier_name() else {
            return;
        };
        if !matches!(tag_name.as_str(), "input" | "textarea") {
            return;
        }
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        if opening
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
            && [
                "value",
                "onChange",
                "readOnly",
                "disabled",
                "className",
                "aria-hidden",
                "tabIndex",
            ]
            .into_iter()
            .chain((tag_name == "input").then_some("type"))
            .chain((tag_name == "input").then_some("checked"))
            .any(|name| controlled_input_authoritative_attribute(opening, name).is_none())
        {
            return;
        }
        let Some(value) = controlled_input_authoritative_attribute(opening, "value") else {
            return;
        };
        if !controlled_input_is_literal_value(value) {
            return;
        }
        let Some(on_change) = controlled_input_authoritative_attribute(opening, "onChange") else {
            return;
        };
        if controlled_input_is_noop_handler(on_change)
            || ["readOnly", "disabled"].iter().any(|name| {
                controlled_input_authoritative_attribute(opening, name)
                    .is_some_and(controlled_input_attribute_potentially_truthy)
            })
        {
            return;
        }
        if tag_name == "input" {
            if controlled_input_authoritative_attribute(opening, "checked")
                .is_some_and(controlled_input_attribute_potentially_truthy)
            {
                return;
            }
            if let Some(input_type) = controlled_input_authoritative_attribute(opening, "type") {
                let Some(input_type) = controlled_input_static_string(input_type) else {
                    return;
                };
                if VALUE_BYPASS_INPUT_TYPES
                    .iter()
                    .any(|candidate| input_type.eq_ignore_ascii_case(candidate))
                {
                    return;
                }
            }
        }
        if controlled_input_is_hidden_or_decoy(opening)
            || controlled_input_component_renders_state_driven_alternative(node, ctx)
        {
            return;
        }
        let message = format!(
            "Typing does nothing in this <{tag_name}> because its `value` is a fixed literal that `onChange` never updates, so drive `value` from state or drop it if the field should be read-only."
        );
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening.span));
    }
}

fn controlled_input_authoritative_attribute<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    name: &str,
) -> Option<&'a JSXAttribute<'a>> {
    let mut result = None;
    for item in &opening.attributes {
        match item {
            JSXAttributeItem::SpreadAttribute(_) => result = None,
            JSXAttributeItem::Attribute(attribute) if matches!(&attribute.name, JSXAttributeName::Identifier(identifier) if identifier.name == name) =>
            {
                result = Some(attribute);
            }
            _ => {}
        }
    }
    result.map(|attribute| &**attribute)
}

fn controlled_input_is_literal_value(attribute: &JSXAttribute<'_>) -> bool {
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(_)) => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => container
            .expression
            .as_expression()
            .is_some_and(|expression| {
                matches!(
                    expression.get_inner_expression(),
                    Expression::StringLiteral(_) | Expression::NumericLiteral(_)
                )
            }),
        _ => false,
    }
}

fn controlled_input_static_string<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(value)) => Some(value.value.as_str()),
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match container.expression.as_expression()?.get_inner_expression() {
                Expression::StringLiteral(value) => Some(value.value.as_str()),
                _ => None,
            }
        }
        _ => None,
    }
}

fn controlled_input_attribute_potentially_truthy(attribute: &JSXAttribute<'_>) -> bool {
    match &attribute.value {
        None => true,
        Some(JSXAttributeValue::StringLiteral(_)) => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            match container
                .expression
                .as_expression()
                .map(Expression::get_inner_expression)
            {
                Some(Expression::BooleanLiteral(value)) => value.value,
                Some(Expression::NullLiteral(_)) => false,
                Some(Expression::UnaryExpression(value)) if is_literal_void_expression(value) => {
                    false
                }
                _ => true,
            }
        }
        _ => true,
    }
}

fn controlled_input_is_noop_handler(attribute: &JSXAttribute<'_>) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    let expression = expression.get_inner_expression();
    let body_is_ignored = |expression: &Expression<'_>| match expression.get_inner_expression() {
        Expression::Identifier(identifier) if identifier.name == "undefined" => true,
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_) => true,
        Expression::UnaryExpression(expression) => is_literal_void_expression(expression),
        _ => false,
    };
    match expression {
        Expression::ArrowFunctionExpression(function) => {
            if let Some(body) = function.get_expression() {
                return body_is_ignored(body);
            }
            matches!(
                &function.body,
                ArrowFunctionBody::FunctionBody(body)
                    if body.statements.is_empty()
                        || matches!(body.statements.as_slice(), [oxc_ast::ast::Statement::ReturnStatement(statement)] if statement.argument.as_ref().is_none_or(body_is_ignored))
            )
        }
        Expression::FunctionExpression(function) => function.body.as_ref().is_some_and(|body| {
            body.statements.is_empty()
                || matches!(body.statements.as_slice(), [oxc_ast::ast::Statement::ReturnStatement(statement)] if statement.argument.as_ref().is_none_or(body_is_ignored))
        }),
        _ => false,
    }
}

fn controlled_input_component_renders_state_driven_alternative(
    flagged_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(function_id) = controlled_input_nearest_function_id(flagged_node, ctx) else {
        return false;
    };
    let Some(flagged_return_id) =
        controlled_input_return_ancestor_id(flagged_node.id(), function_id, ctx)
    else {
        return false;
    };
    for sibling_node in ctx.nodes().iter() {
        let AstKind::JSXOpeningElement(sibling) = sibling_node.kind() else {
            continue;
        };
        if sibling_node.id() == flagged_node.id()
            || controlled_input_nearest_function_id(sibling_node, ctx) != Some(function_id)
            || !matches!(
                sibling.name.get_identifier_name().map(|name| name.as_str()),
                Some("input" | "textarea")
            )
        {
            continue;
        }
        let Some(sibling_value) = controlled_input_authoritative_attribute(sibling, "value") else {
            continue;
        };
        if controlled_input_is_literal_value(sibling_value) {
            continue;
        }
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &sibling_value.value else {
            continue;
        };
        let Some(dynamic_value) = container.expression.as_expression() else {
            continue;
        };
        let Some(dynamic_value_key) = controlled_input_serialize_reference(dynamic_value, ctx)
        else {
            continue;
        };
        let Some(sibling_return_id) =
            controlled_input_return_ancestor_id(sibling_node.id(), function_id, ctx)
        else {
            continue;
        };
        if controlled_input_results_are_alternative_branches(
            flagged_node,
            sibling_node,
            flagged_return_id,
            sibling_return_id,
            &dynamic_value_key,
            ctx,
        ) {
            return true;
        }
    }
    false
}

fn controlled_input_nearest_function_id(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn controlled_input_return_ancestor_id(
    node_id: NodeId,
    boundary_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    for ancestor in ctx.nodes().ancestors(node_id) {
        if ancestor.id() == boundary_id {
            return None;
        }
        if matches!(ancestor.kind(), AstKind::ReturnStatement(_)) {
            return Some(ancestor.id());
        }
    }
    None
}

fn controlled_input_serialize_reference(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            Some(symbol_id.map_or_else(
                || identifier.name.to_string(),
                |symbol_id| format!("{}#{symbol_id:?}", identifier.name),
            ))
        }
        Expression::ThisExpression(_) => Some("this".to_string()),
        expression => {
            let member = expression.as_member_expression()?;
            let receiver = controlled_input_serialize_reference(member.object(), ctx)?;
            Some(format!("{receiver}.{}", member.static_property_name()?))
        }
    }
}

fn controlled_input_node_reference_key(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    match node.kind() {
        AstKind::IdentifierReference(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            Some(symbol_id.map_or_else(
                || identifier.name.to_string(),
                |symbol_id| format!("{}#{symbol_id:?}", identifier.name),
            ))
        }
        AstKind::ThisExpression(_) => Some("this".to_string()),
        AstKind::StaticMemberExpression(member) => {
            let receiver = controlled_input_serialize_reference(&member.object, ctx)?;
            Some(format!("{receiver}.{}", member.property.name))
        }
        AstKind::ComputedMemberExpression(member) => {
            let receiver = controlled_input_serialize_reference(&member.object, ctx)?;
            Some(format!("{receiver}.{}", member.static_property_name()?))
        }
        _ => None,
    }
}

fn controlled_input_condition_references_dynamic_value(
    condition: &Expression<'_>,
    dynamic_value_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let condition_span = condition.span();
    ctx.nodes().iter().any(|candidate| {
        if !condition_span.contains_inclusive(candidate.span())
            || ctx
                .nodes()
                .ancestors(candidate.id())
                .take_while(|ancestor| condition_span.contains_inclusive(ancestor.span()))
                .any(|ancestor| {
                    matches!(
                        ancestor.kind(),
                        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                    )
                })
            || ctx
                .nodes()
                .ancestors(candidate.id())
                .take_while(|ancestor| condition_span.contains_inclusive(ancestor.span()))
                .any(|ancestor| controlled_input_node_reference_key(ancestor, ctx).is_some())
        {
            return false;
        }
        controlled_input_node_reference_key(candidate, ctx).is_some_and(|candidate_key| {
            candidate_key == dynamic_value_key
                || dynamic_value_key.starts_with(&format!("{candidate_key}."))
        })
    })
}

fn controlled_input_results_are_alternative_branches(
    flagged_node: &AstNode<'_>,
    sibling_node: &AstNode<'_>,
    flagged_return_id: NodeId,
    sibling_return_id: NodeId,
    dynamic_value_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    if flagged_return_id == sibling_return_id {
        return controlled_input_elements_share_related_conditional_result(
            flagged_node,
            sibling_node,
            flagged_return_id,
            dynamic_value_key,
            ctx,
        );
    }
    controlled_input_returns_are_opposite_if_branches(
        flagged_return_id,
        sibling_return_id,
        dynamic_value_key,
        ctx,
    ) || controlled_input_conditional_return_precedes_fallback(
        flagged_return_id,
        sibling_return_id,
        dynamic_value_key,
        ctx,
    ) || controlled_input_conditional_return_precedes_fallback(
        sibling_return_id,
        flagged_return_id,
        dynamic_value_key,
        ctx,
    )
}

fn controlled_input_elements_share_related_conditional_result(
    flagged_node: &AstNode<'_>,
    sibling_node: &AstNode<'_>,
    boundary_id: NodeId,
    dynamic_value_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(flagged_node.id()) {
        if ancestor.id() == boundary_id {
            break;
        }
        let AstKind::ConditionalExpression(conditional) = ancestor.kind() else {
            continue;
        };
        if controlled_input_nodes_are_in_opposite_spans(
            flagged_node,
            sibling_node,
            conditional.consequent.span(),
            conditional.alternate.span(),
        ) && controlled_input_condition_references_dynamic_value(
            &conditional.test,
            dynamic_value_key,
            ctx,
        ) {
            return true;
        }
    }
    false
}

fn controlled_input_returns_are_opposite_if_branches(
    flagged_return_id: NodeId,
    sibling_return_id: NodeId,
    dynamic_value_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let flagged_return = ctx.nodes().get_node(flagged_return_id);
    let sibling_return = ctx.nodes().get_node(sibling_return_id);
    for ancestor in ctx.nodes().ancestors(flagged_return_id) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        let AstKind::IfStatement(statement) = ancestor.kind() else {
            continue;
        };
        let Some(alternate) = &statement.alternate else {
            continue;
        };
        if controlled_input_nodes_are_in_opposite_spans(
            flagged_return,
            sibling_return,
            statement.consequent.span(),
            alternate.span(),
        ) && controlled_input_condition_references_dynamic_value(
            &statement.test,
            dynamic_value_key,
            ctx,
        ) && controlled_input_return_path_has_only_related_conditions(
            flagged_return_id,
            ancestor.id(),
            dynamic_value_key,
            ctx,
        ) && controlled_input_return_path_has_only_related_conditions(
            sibling_return_id,
            ancestor.id(),
            dynamic_value_key,
            ctx,
        ) {
            return true;
        }
    }
    false
}

fn controlled_input_conditional_return_precedes_fallback(
    conditional_return_id: NodeId,
    fallback_return_id: NodeId,
    dynamic_value_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let fallback_return = ctx.nodes().get_node(fallback_return_id);
    for ancestor in ctx.nodes().ancestors(conditional_return_id) {
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            break;
        }
        let AstKind::IfStatement(statement) = ancestor.kind() else {
            continue;
        };
        let containing_block = ctx.nodes().parent_node(ancestor.id());
        let AstKind::BlockStatement(block) = containing_block.kind() else {
            continue;
        };
        if ctx.nodes().parent_node(fallback_return.id()).id() != containing_block.id() {
            continue;
        }
        let conditional_index = block
            .body
            .iter()
            .position(|statement| statement.span() == ancestor.span());
        let fallback_index = block
            .body
            .iter()
            .position(|statement| statement.span() == fallback_return.span());
        if conditional_index
            .zip(fallback_index)
            .is_some_and(|(conditional_index, fallback_index)| conditional_index < fallback_index)
            && controlled_input_return_path_has_only_blocks(
                conditional_return_id,
                ancestor.id(),
                ctx,
            )
            && controlled_input_condition_references_dynamic_value(
                &statement.test,
                dynamic_value_key,
                ctx,
            )
        {
            return true;
        }
    }
    false
}

fn controlled_input_return_path_has_only_blocks(
    return_id: NodeId,
    boundary_id: NodeId,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(return_id) {
        if ancestor.id() == boundary_id {
            return true;
        }
        if !matches!(ancestor.kind(), AstKind::BlockStatement(_)) {
            return false;
        }
    }
    false
}

fn controlled_input_return_path_has_only_related_conditions(
    return_id: NodeId,
    boundary_id: NodeId,
    dynamic_value_key: &str,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(return_id) {
        if ancestor.id() == boundary_id {
            return true;
        }
        match ancestor.kind() {
            AstKind::BlockStatement(_) => {}
            AstKind::IfStatement(statement)
                if controlled_input_condition_references_dynamic_value(
                    &statement.test,
                    dynamic_value_key,
                    ctx,
                ) => {}
            _ => return false,
        }
    }
    false
}

fn controlled_input_nodes_are_in_opposite_spans(
    first_node: &AstNode<'_>,
    second_node: &AstNode<'_>,
    consequent_span: oxc_span::Span,
    alternate_span: oxc_span::Span,
) -> bool {
    (consequent_span.contains_inclusive(first_node.span())
        && alternate_span.contains_inclusive(second_node.span()))
        || (alternate_span.contains_inclusive(first_node.span())
            && consequent_span.contains_inclusive(second_node.span()))
}

fn controlled_input_is_hidden_or_decoy(opening: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    if controlled_input_authoritative_attribute(opening, "aria-hidden").is_some_and(|attribute| {
        attribute.value.is_none() || controlled_input_static_string(attribute) == Some("true")
    }) {
        return true;
    }
    if controlled_input_authoritative_attribute(opening, "className")
        .and_then(controlled_input_static_string)
        .is_some_and(|value| {
            let lower = value.to_ascii_lowercase();
            lower.contains("sr-only")
                || lower.contains("visually-hidden")
                || lower.contains("offscreen")
        })
    {
        return true;
    }
    let Some(tab_index) = controlled_input_authoritative_attribute(opening, "tabIndex") else {
        return false;
    };
    match &tab_index.value {
        Some(JSXAttributeValue::StringLiteral(value)) => {
            value.value.parse::<f64>().is_ok_and(|value| value < 0.0)
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            matches!(container.expression.as_expression().map(Expression::get_inner_expression), Some(Expression::UnaryExpression(expression)) if expression.operator == UnaryOperator::UnaryNegation && matches!(&expression.argument, Expression::NumericLiteral(value) if value.value > 0.0))
        }
        _ => false,
    }
}
