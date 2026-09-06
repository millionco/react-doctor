use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName,
        JSXAttributeValue, MemberExpression, ObjectPropertyKind, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};
use oxc_syntax::operator::LogicalOperator;
use oxc_syntax::node::NodeId;
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MISSING_MESSAGE: &str =
    "Your users can submit the form by accident because a `<button>` with no `type` defaults to submit.";
const INVALID_MESSAGE: &str =
    "This button has an invalid `type`, so the browser may treat it like a submit button.";
const REACT_ARIA_MODULES: &[&str] = &[
    "react-aria",
    "@react-aria/interactions",
    "@react-aria/focus",
    "@react-aria/utils",
];

#[derive(Debug, Default, Clone)]
pub struct ButtonHasType;

declare_oxc_lint!(
    /// Require explicit valid button types where implicit submission is possible.
    ButtonHasType,
    react_doctor_native,
    restriction,
    version = "0.1.0",
    short_description = "Require explicit valid button types.",
);

impl Rule for ButtonHasType {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !should_use_curated_port_behavior_host(ctx) || !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXOpeningElement(opening_element) => {
                check_jsx_button(opening_element, node, ctx);
            }
            AstKind::CallExpression(call_expression)
                if is_create_element_call(call_expression) =>
            {
                check_create_element_button(call_expression, node, ctx);
            }
            _ => {}
        }
    }
}

fn check_jsx_button<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) {
    let Some((element_type, element_span)) = resolve_jsx_element_type(opening_element, ctx) else {
        return;
    };
    if element_type != "button" {
        return;
    }
    let Some(type_attribute) = find_jsx_attribute_ignore_case(opening_element, "type") else {
        if should_use_curated_port_behavior(ctx)
            && !jsx_button_has_associated_form(opening_element)
            && !has_static_form_ancestor(node, ctx)
        {
            return;
        }
        if opening_element
            .attributes
            .iter()
            .any(|attribute| {
                let JSXAttributeItem::SpreadAttribute(spread) = attribute else {
                    return false;
                };
                !spread_cannot_supply_type(&spread.argument, ctx, &mut FxHashSet::default())
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(element_span));
        return;
    };
    let Some(value) = type_attribute.value.as_ref() else {
        report_invalid(type_attribute.span, ctx);
        return;
    };
    match value {
        JSXAttributeValue::StringLiteral(value) => {
            if !button_type_value_is_valid(value.value.as_str(), ctx) {
                report_invalid(type_attribute.span, ctx);
            }
        }
        JSXAttributeValue::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return;
            };
            if !is_consumer_prop_forward(expression, ctx, &mut FxHashSet::default())
                && !button_type_expression_is_proven_valid(
                    expression,
                    ctx,
                    &mut FxHashSet::default(),
                )
            {
                report_invalid(type_attribute.span, ctx);
            }
        }
        _ => {}
    }
}

fn check_create_element_button<'a>(
    call_expression: &'a oxc_ast::ast::CallExpression<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) {
    let Some(Argument::StringLiteral(element_type)) = call_expression.arguments.first() else {
        return;
    };
    if element_type.value != "button" {
        return;
    }
    let props_expression = call_expression
        .arguments
        .get(1)
        .and_then(Argument::as_expression);
    let has_form_owner = props_expression
        .is_some_and(create_element_button_has_associated_form)
        || has_static_form_ancestor(node, ctx);
    let Some(props_expression) = props_expression else {
        if !should_use_curated_port_behavior(ctx) || has_form_owner {
            ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(call_expression.span));
        }
        return;
    };
    if is_nullish_expression(props_expression) {
        if !should_use_curated_port_behavior(ctx) || has_form_owner {
            ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(call_expression.span));
        }
        return;
    }
    let Expression::ObjectExpression(props_object) = props_expression.get_inner_expression() else {
        return;
    };
    let type_property = props_object.properties.iter().find_map(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        property_key_matches_name(&property.key, "type").then_some(property)
    });
    let Some(type_property) = type_property else {
        if should_use_curated_port_behavior(ctx) && !has_form_owner {
            return;
        }
        if props_object
            .properties
            .iter()
            .any(|property| {
                let ObjectPropertyKind::SpreadProperty(spread) = property else {
                    return false;
                };
                !spread_cannot_supply_type(&spread.argument, ctx, &mut FxHashSet::default())
            })
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MISSING_MESSAGE).with_label(props_object.span));
        return;
    };
    if !is_consumer_prop_forward(&type_property.value, ctx, &mut FxHashSet::default())
        && !button_type_expression_is_proven_valid(
            &type_property.value,
            ctx,
            &mut FxHashSet::default(),
        )
    {
        report_invalid(type_property.value.span(), ctx);
    }
}

fn button_type_value_is_valid(value: &str, ctx: &LintContext<'_>) -> bool {
    let setting_name = match value {
        "button" => "button",
        "submit" => "submit",
        "reset" => "reset",
        _ => return false,
    };
    configured_button_type_value(setting_name, ctx).unwrap_or(true)
}

fn configured_button_type_value(setting_name: &str, ctx: &LintContext<'_>) -> Option<bool> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("buttonHasType"))
        .and_then(|settings| settings.get(setting_name))
        .and_then(serde_json::Value::as_bool)
}

fn button_type_expression_is_proven_valid<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(value) => button_type_value_is_valid(value.value.as_str(), ctx),
        Expression::TemplateLiteral(template) => template.single_quasi().is_some_and(|value| {
            button_type_value_is_valid(value.as_str(), ctx)
        }),
        Expression::ConditionalExpression(conditional) => {
            button_type_expression_is_proven_valid(&conditional.consequent, ctx, visited_symbols)
                && button_type_expression_is_proven_valid(
                    &conditional.alternate,
                    ctx,
                    visited_symbols,
                )
        }
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
            let mut next_visited_symbols = visited_symbols.clone();
            next_visited_symbols.insert(symbol_id);
            resolve_direct_const_initializer(symbol_id, ctx).is_some_and(|initializer| {
                button_type_expression_is_proven_valid(initializer, ctx, &mut next_visited_symbols)
            })
        }
        _ => false,
    }
}

fn is_consumer_prop_forward<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            if identifier.name == "type" {
                return true;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if symbol_binds_to_parameter_property(symbol_id, "type", ctx)
                || identifier.name.ends_with("Type")
                    && parameter_property_default(symbol_id, ctx).is_some_and(|default_value| {
                        button_type_expression_is_proven_valid(
                            default_value,
                            ctx,
                            &mut FxHashSet::default(),
                        )
                    })
            {
                return true;
            }
            if visited_symbols.contains(&symbol_id) {
                return false;
            }
            let mut next_visited_symbols = visited_symbols.clone();
            next_visited_symbols.insert(symbol_id);
            resolve_direct_const_initializer(symbol_id, ctx).is_some_and(|initializer| {
                matches!(
                    initializer.get_inner_expression(),
                    Expression::ConditionalExpression(_) | Expression::LogicalExpression(_)
                ) && is_consumer_prop_forward(initializer, ctx, &mut next_visited_symbols)
            })
        }
        expression
            if matches!(
                expression.as_member_expression(),
                Some(MemberExpression::StaticMemberExpression(member))
                    if member.property.name == "type"
            ) =>
        {
            true
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::Or | LogicalOperator::Coalesce) =>
        {
            is_consumer_prop_forward(&logical.left, ctx, visited_symbols)
        }
        Expression::ConditionalExpression(conditional) => {
            let consequent_is_forward =
                is_consumer_prop_forward(&conditional.consequent, ctx, visited_symbols);
            let alternate_is_forward =
                is_consumer_prop_forward(&conditional.alternate, ctx, visited_symbols);
            (consequent_is_forward || alternate_is_forward)
                && (consequent_is_forward
                    || button_type_expression_is_proven_valid(
                        &conditional.consequent,
                        ctx,
                        &mut FxHashSet::default(),
                    ))
                && (alternate_is_forward
                    || button_type_expression_is_proven_valid(
                        &conditional.alternate,
                        ctx,
                        &mut FxHashSet::default(),
                    ))
        }
        _ => false,
    }
}

fn resolve_direct_const_initializer<'a>(
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
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return None;
    };
    variable_declaration
        .kind
        .is_const()
        .then(|| declarator.init.as_ref())
        .flatten()
}

fn symbol_binds_to_parameter_property(
    symbol_id: SymbolId,
    property_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    let mut visited_symbols = FxHashSet::default();
    symbol_binds_to_parameter_property_inner(
        symbol_id,
        property_name,
        ctx,
        &mut visited_symbols,
    )
}

fn symbol_binds_to_parameter_property_inner(
    symbol_id: SymbolId,
    property_name: &str,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::FormalParameter(parameter) => {
            pattern_property_for_symbol(&parameter.pattern, symbol_id)
                .is_some_and(|property| {
                    !property.computed
                        && property_key_matches_name(&property.key, property_name)
                })
        }
        AstKind::VariableDeclarator(declarator) => {
            if pattern_property_for_symbol(&declarator.id, symbol_id)
                .is_none_or(|property| {
                    property.computed
                        || !property_key_matches_name(&property.key, property_name)
                })
            {
                return false;
            }
            let Some(Expression::Identifier(source)) =
                declarator.init.as_ref().map(Expression::get_inner_expression)
            else {
                return false;
            };
            ctx.scoping()
                .get_reference(source.reference_id())
                .symbol_id()
                .is_some_and(|source_symbol_id| {
                    symbol_is_or_roots_at_parameter(source_symbol_id, ctx, visited_symbols)
                })
        }
        _ => false,
    }
}

fn symbol_is_or_roots_at_parameter(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    if !visited_symbols.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::FormalParameter(_) => true,
        AstKind::VariableDeclarator(declarator) => {
            let Some(Expression::Identifier(source)) =
                declarator.init.as_ref().map(Expression::get_inner_expression)
            else {
                return false;
            };
            ctx.scoping()
                .get_reference(source.reference_id())
                .symbol_id()
                .is_some_and(|source_symbol_id| {
                    symbol_is_or_roots_at_parameter(source_symbol_id, ctx, visited_symbols)
                })
        }
        _ => false,
    }
}

fn pattern_property_for_symbol<'a, 'b>(
    pattern: &'b BindingPattern<'a>,
    symbol_id: SymbolId,
) -> Option<&'b oxc_ast::ast::BindingProperty<'a>> {
    let BindingPattern::ObjectPattern(object_pattern) = pattern else {
        return None;
    };
    object_pattern
        .properties
        .iter()
        .find(|property| {
            property
                .value
                .get_binding_identifier()
                .is_some_and(|identifier| identifier.symbol_id() == symbol_id)
                || matches!(
                    &property.value,
                    BindingPattern::AssignmentPattern(assignment)
                        if assignment.left.get_binding_identifier().is_some_and(|identifier| {
                            identifier.symbol_id() == symbol_id
                        })
                )
        })
}

fn parameter_property_default<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let property = match declaration.kind() {
        AstKind::FormalParameter(parameter) => {
            pattern_property_for_symbol(&parameter.pattern, symbol_id)?
        }
        AstKind::VariableDeclarator(declarator) => {
            let property = pattern_property_for_symbol(&declarator.id, symbol_id)?;
            let Expression::Identifier(source) =
                declarator.init.as_ref()?.get_inner_expression()
            else {
                return None;
            };
            let source_symbol_id = ctx
                .scoping()
                .get_reference(source.reference_id())
                .symbol_id()?;
            if !symbol_is_or_roots_at_parameter(
                source_symbol_id,
                ctx,
                &mut FxHashSet::default(),
            ) {
                return None;
            }
            property
        }
        _ => return None,
    };
    if property.computed {
        return None;
    }
    let BindingPattern::AssignmentPattern(assignment) = &property.value else {
        return None;
    };
    Some(&assignment.right)
}

fn spread_cannot_supply_type<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(object) => object.properties.iter().all(|property| match property {
            ObjectPropertyKind::SpreadProperty(spread) => {
                spread_cannot_supply_type(&spread.argument, ctx, visited_symbols)
            }
            ObjectPropertyKind::ObjectProperty(property) => {
                !property.computed
                    && matches!(
                        &property.key,
                        PropertyKey::StaticIdentifier(_) | PropertyKey::StringLiteral(_)
                    )
                    && !property_key_matches_name(&property.key, "type")
            }
        }),
        Expression::CallExpression(call) => {
            let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
                return false;
            };
            if !direct_named_import_matches(callee, &["mergeProps"], REACT_ARIA_MODULES, ctx) {
                return false;
            }
            call.arguments.iter().all(|argument| {
                argument.as_expression().is_some_and(|argument| {
                    spread_cannot_supply_type(argument, ctx, visited_symbols)
                })
            })
        }
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
            let mut next_visited_symbols = visited_symbols.clone();
            next_visited_symbols.insert(symbol_id);
            if let Some(initializer) = resolve_direct_const_initializer(symbol_id, ctx) {
                return spread_cannot_supply_type(initializer, ctx, &mut next_visited_symbols);
            }
            destructured_call_bag_cannot_supply_type(
                symbol_id,
                ctx,
                &mut next_visited_symbols,
            )
        }
        _ => false,
    }
}

fn destructured_call_bag_cannot_supply_type<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let Some(property) = pattern_property_for_symbol(&declarator.id, symbol_id) else {
        return false;
    };
    if property.computed {
        return false;
    }
    if !matches!(
        &property.key,
        PropertyKey::StaticIdentifier(_) | PropertyKey::StringLiteral(_)
    ) {
        return false;
    }
    let Some(bag_name) = property.key.static_name() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const()) {
        return false;
    }
    let Some(Expression::CallExpression(call)) =
        declarator.init.as_ref().map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    let expected_hooks = match bag_name.as_ref() {
        "pressProps" => &["usePress"][..],
        "longPressProps" => &["useLongPress"][..],
        "hoverProps" => &["useHover"][..],
        "focusProps" => &["useFocus", "useFocusRing"][..],
        "focusWithinProps" => &["useFocusWithin"][..],
        "keyboardProps" => &["useKeyboard"][..],
        "moveProps" => &["useMove"][..],
        _ => &[][..],
    };
    if !expected_hooks.is_empty()
        && direct_named_import_matches(callee, expected_hooks, REACT_ARIA_MODULES, ctx)
    {
        return true;
    }
    local_function_return_expressions(callee, ctx).is_some_and(|return_expressions| {
        !return_expressions.is_empty()
            && return_expressions.iter().all(|returned| {
                let Expression::ObjectExpression(returned_object) = returned.get_inner_expression()
                else {
                    return false;
                };
                for returned_property in &returned_object.properties {
                    let ObjectPropertyKind::ObjectProperty(returned_property) = returned_property
                    else {
                        return false;
                    };
                    if returned_property.computed {
                        continue;
                    }
                    if property_key_matches_name(&returned_property.key, bag_name.as_ref()) {
                        return spread_cannot_supply_type(
                            &returned_property.value,
                            ctx,
                            visited_symbols,
                        );
                    }
                }
                true
            })
    })
}

fn local_function_return_expressions<'a>(
    callee: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<Vec<&'a Expression<'a>>> {
    let symbol_id = ctx
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()?;
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_node_id = match declaration.kind() {
        AstKind::Function(function) => function.node_id.get(),
        AstKind::VariableDeclarator(declarator) => match declarator.init.as_ref()?.get_inner_expression() {
            Expression::ArrowFunctionExpression(function) => {
                if let Some(expression) = function.get_expression() {
                    return Some(vec![expression]);
                }
                function.node_id.get()
            }
            Expression::FunctionExpression(function) => function.node_id.get(),
            _ => return None,
        },
        _ => return None,
    };
    let mut return_expressions = Vec::new();
    for candidate in ctx.nodes().iter() {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            continue;
        };
        if nearest_function_ancestor_id(candidate, ctx) != Some(function_node_id) {
            continue;
        }
        let Some(argument) = return_statement.argument.as_ref() else {
            return None;
        };
        return_expressions.push(argument);
    }
    Some(return_expressions)
}

fn nearest_function_ancestor_id(node: &AstNode<'_>, ctx: &LintContext<'_>) -> Option<NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then_some(ancestor.id())
    })
}

fn jsx_button_has_associated_form(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    get_authoritative_jsx_attribute(opening_element, "form", false)
        .and_then(|attribute| get_string_literal_attribute_value(attribute))
        .is_some_and(|value| !value.trim().is_empty())
}

fn create_element_button_has_associated_form(props_expression: &Expression<'_>) -> bool {
    get_static_object_property_value(props_expression, "form")
        .and_then(|expression| get_static_string_expression(expression))
        .is_some_and(|value| !value.trim().is_empty())
}

fn has_static_form_ancestor(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).skip(1).any(|ancestor| match ancestor.kind() {
        AstKind::JSXElement(element) => resolve_jsx_element_type(&element.opening_element, ctx)
            .is_some_and(|(element_type, _)| element_type == "form"),
        AstKind::CallExpression(call) if is_create_element_call(call) => matches!(
            call.arguments.first(),
            Some(Argument::StringLiteral(element_type)) if element_type.value == "form"
        ),
        _ => false,
    })
}

fn find_jsx_attribute_ignore_case<'a, 'b>(
    opening_element: &'b oxc_ast::ast::JSXOpeningElement<'a>,
    target_name: &str,
) -> Option<&'b JSXAttribute<'a>> {
    opening_element.attributes.iter().find_map(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier)
                if identifier.name.eq_ignore_ascii_case(target_name)
        )
        .then_some(attribute.as_ref())
    })
}

fn report_invalid(span: Span, ctx: &LintContext<'_>) {
    ctx.diagnostic(OxcDiagnostic::warn(INVALID_MESSAGE).with_label(span));
}
