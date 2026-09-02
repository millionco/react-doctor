use std::collections::HashSet;

use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, FunctionType, JSXAttribute, JSXAttributeItem, JSXAttributeName,
        JSXAttributeValue, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use oxc_span::{GetSpan, Span};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const UNCONTROLLED_INPUT_TAGS: [&str; 3] = ["input", "textarea", "select"];
const VALUE_BYPASS_INPUT_TYPES: [&str; 7] = [
    "button", "checkbox", "hidden", "image", "radio", "reset", "submit",
];
const VALUE_PARTNER_ATTRIBUTES: [&str; 4] = ["onChange", "onInput", "readOnly", "disabled"];

#[derive(Debug, Default, Clone)]
pub struct NoUncontrolledInput;

declare_oxc_lint!(
    /// Disallow uncontrolled input value mistakes.
    NoUncontrolledInput,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow uncontrolled input value mistakes.",
);

impl Rule for NoUncontrolledInput {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let opening_elements = ctx
            .nodes()
            .iter()
            .filter_map(|node| match node.kind() {
                AstKind::JSXOpeningElement(opening_element) => Some(opening_element),
                _ => None,
            })
            .collect::<Vec<_>>();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::Function(function)
                    if function.r#type == FunctionType::FunctionDeclaration
                        && function.id.as_ref().is_some_and(|identifier| {
                            no_uncontrolled_input_is_uppercase_name(identifier.name.as_str())
                        }) =>
                {
                    if let Some(body) = &function.body {
                        no_uncontrolled_input_check_component(
                            body.span,
                            Some(&body.statements),
                            &opening_elements,
                            ctx,
                        );
                    }
                }
                AstKind::VariableDeclarator(declarator) => {
                    let BindingPattern::BindingIdentifier(identifier) = &declarator.id else {
                        continue;
                    };
                    if !no_uncontrolled_input_is_uppercase_name(identifier.name.as_str()) {
                        continue;
                    }
                    let Some(initializer) = &declarator.init else {
                        continue;
                    };
                    match initializer {
                        Expression::ArrowFunctionExpression(function) => {
                            if let Some(expression_body) = function.get_expression() {
                                no_uncontrolled_input_check_component(
                                    expression_body.span(),
                                    None,
                                    &opening_elements,
                                    ctx,
                                );
                            } else if let Some(body) = function.body.as_function_body() {
                                no_uncontrolled_input_check_component(
                                    body.span,
                                    Some(&body.statements),
                                    &opening_elements,
                                    ctx,
                                );
                            }
                        }
                        Expression::FunctionExpression(function) => {
                            if let Some(body) = &function.body {
                                no_uncontrolled_input_check_component(
                                    body.span,
                                    Some(&body.statements),
                                    &opening_elements,
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

fn no_uncontrolled_input_check_component<'a>(
    body_span: Span,
    statements: Option<&[Statement<'a>]>,
    opening_elements: &[&'a oxc_ast::ast::JSXOpeningElement<'a>],
    ctx: &LintContext<'a>,
) {
    let undefined_initial_state_names = statements.map_or_else(HashSet::new, |statements| {
        no_uncontrolled_input_collect_undefined_initial_state_names(statements)
    });
    for opening_element in opening_elements {
        if !body_span.contains_inclusive(opening_element.span) {
            continue;
        }
        no_uncontrolled_input_check_opening_element(
            opening_element,
            &undefined_initial_state_names,
            ctx,
        );
    }
}

fn no_uncontrolled_input_collect_undefined_initial_state_names<'a>(
    statements: &[Statement<'a>],
) -> HashSet<&'a str> {
    let mut state_names = HashSet::new();
    for statement in statements {
        let Statement::VariableDeclaration(declaration) = statement else {
            continue;
        };
        for declarator in &declaration.declarations {
            let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
                continue;
            };
            let Some(BindingPattern::BindingIdentifier(value_identifier)) =
                pattern.elements.first().and_then(Option::as_ref)
            else {
                continue;
            };
            let Some(Expression::CallExpression(state_call)) = &declarator.init else {
                continue;
            };
            if no_uncontrolled_input_callee_name(&state_call.callee) != Some("useState") {
                continue;
            }
            let has_undefined_initializer = state_call.arguments.is_empty()
                || matches!(
                    state_call
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression),
                    Some(Expression::Identifier(identifier)) if identifier.name == "undefined"
                );
            if has_undefined_initializer {
                state_names.insert(value_identifier.name.as_str());
            }
        }
    }
    state_names
}

fn no_uncontrolled_input_callee_name<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    match expression {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        Expression::ComputedMemberExpression(member) => match &member.expression {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        },
        _ => None,
    }
}

fn no_uncontrolled_input_check_opening_element<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    undefined_initial_state_names: &HashSet<&str>,
    ctx: &LintContext<'a>,
) {
    let Some((tag_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return;
    };
    if !UNCONTROLLED_INPUT_TAGS.contains(&tag_name)
        || opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
    {
        return;
    }
    let Some(value_attribute) =
        no_uncontrolled_input_find_attribute(&opening_element.attributes, "value", false)
    else {
        return;
    };

    let type_attribute = (tag_name == "input")
        .then(|| no_uncontrolled_input_find_attribute(&opening_element.attributes, "type", true))
        .flatten();
    let has_explicit_input_type = type_attribute.is_some();
    let input_type_candidates = type_attribute.and_then(|attribute| {
        no_uncontrolled_input_exhaustive_static_string_values(attribute, ctx)
    });
    let does_type_bypass_missing_on_change = input_type_candidates.as_ref().is_some_and(|values| {
        !values.is_empty()
            && values.iter().all(|value| {
                VALUE_BYPASS_INPUT_TYPES.contains(&value.to_ascii_lowercase().as_str())
            })
    });
    let does_type_use_checked_controlledness =
        input_type_candidates.as_ref().is_some_and(|values| {
            !values.is_empty()
                && values
                    .iter()
                    .all(|value| matches!(value.as_str(), "checkbox" | "radio"))
        });
    let could_type_use_checked_controlledness = has_explicit_input_type
        && input_type_candidates.as_ref().is_none_or(|values| {
            values
                .iter()
                .any(|value| matches!(value.as_str(), "checkbox" | "radio"))
        });
    let has_allowed_partner = VALUE_PARTNER_ATTRIBUTES.iter().any(|partner_name| {
        let Some(partner_attribute) =
            no_uncontrolled_input_find_attribute(&opening_element.attributes, partner_name, false)
        else {
            return false;
        };
        *partner_name != "disabled"
            || !no_uncontrolled_input_attribute_is_literal_false(partner_attribute)
    });

    if let Some(state_name) = no_uncontrolled_input_value_identifier(value_attribute)
        && undefined_initial_state_names.contains(state_name)
        && !does_type_use_checked_controlledness
    {
        let partner_hint = if has_allowed_partner
            || does_type_bypass_missing_on_change
            || could_type_use_checked_controlledness
        {
            "Give useState a starting value"
        } else {
            "Give useState a starting value and add onChange (or readOnly)"
        };
        let message = if could_type_use_checked_controlledness {
            format!(
                "When `type` resolves to a value-controlled input type, this can trigger a console warning and reset the field because \"{state_name}\" starts undefined, so <input value={{{state_name}}}> can flip from uncontrolled to controlled. {partner_hint} (e.g. `useState(\"\")`)."
            )
        } else {
            format!(
                "This can trigger a console warning and reset the field because \"{state_name}\" starts undefined, so <{tag_name} value={{{state_name}}}> flips from uncontrolled to controlled. {partner_hint} (e.g. `useState(\"\")`)."
            )
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
        return;
    }

    if no_uncontrolled_input_find_attribute(&opening_element.attributes, "defaultValue", false)
        .is_some()
    {
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "Your users never see the `defaultValue` on this <{tag_name}> because React ignores it once `value` is set, so remove one."
            ))
            .with_label(opening_element.span),
        );
        return;
    }

    if has_allowed_partner || does_type_bypass_missing_on_change {
        return;
    }
    let could_resolve_to_read_only_value_type = tag_name == "input"
        && has_explicit_input_type
        && input_type_candidates.as_ref().is_none_or(|values| {
            values.iter().any(|value| {
                VALUE_BYPASS_INPUT_TYPES.contains(&value.to_ascii_lowercase().as_str())
            })
        });
    let message = if could_resolve_to_read_only_value_type {
        "When `type` resolves to an editable input type, users can't type in this <input value={...}> because it has no `onChange` or `readOnly`. Add `onChange` or `readOnly` unless `type` is always a read-only-value input type.".to_string()
    } else {
        format!(
            "Your users can't type in this <{tag_name} value={{...}}> because it has no `onChange` or `readOnly`, so add `onChange` (or `readOnly` if that's intended)."
        )
    };
    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
}

fn no_uncontrolled_input_find_attribute<'a>(
    attributes: &'a [JSXAttributeItem<'a>],
    attribute_name: &str,
    should_find_last: bool,
) -> Option<&'a JSXAttribute<'a>> {
    let find_attribute = |attribute: &'a JSXAttributeItem<'a>| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return None;
        };
        matches!(
            &attribute.name,
            JSXAttributeName::Identifier(identifier) if identifier.name == attribute_name
        )
        .then_some(&**attribute)
    };
    if should_find_last {
        attributes.iter().rev().find_map(find_attribute)
    } else {
        attributes.iter().find_map(find_attribute)
    }
}

fn no_uncontrolled_input_attribute_is_literal_false(attribute: &JSXAttribute<'_>) -> bool {
    matches!(
        attribute.value.as_ref(),
        Some(JSXAttributeValue::ExpressionContainer(container))
            if matches!(container.expression.as_expression(), Some(Expression::BooleanLiteral(literal)) if !literal.value)
    )
}

fn no_uncontrolled_input_value_identifier<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref() else {
        return None;
    };
    match container.expression.as_expression()? {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}

fn no_uncontrolled_input_exhaustive_static_string_values<'a>(
    attribute: &JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) -> Option<Vec<String>> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => Some(vec![literal.value.to_string()]),
        JSXAttributeValue::ExpressionContainer(container) => {
            no_uncontrolled_input_resolve_static_string_values(
                container.expression.as_expression()?,
                ctx,
                &mut Vec::new(),
            )
        }
        _ => None,
    }
}

fn no_uncontrolled_input_resolve_static_string_values<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    resolving_symbol_ids: &mut Vec<SymbolId>,
) -> Option<Vec<String>> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(vec![literal.value.to_string()]),
        Expression::TemplateLiteral(template)
            if template.expressions.is_empty() && template.quasis.len() == 1 =>
        {
            let quasi = &template.quasis[0];
            Some(vec![
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    .to_string(),
            ])
        }
        Expression::ConditionalExpression(conditional) => {
            if let Expression::BooleanLiteral(test) = conditional.test.get_inner_expression() {
                return no_uncontrolled_input_resolve_static_string_values(
                    if test.value {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    ctx,
                    resolving_symbol_ids,
                );
            }
            let mut values = no_uncontrolled_input_resolve_static_string_values(
                &conditional.consequent,
                ctx,
                &mut resolving_symbol_ids.clone(),
            )?;
            values.extend(no_uncontrolled_input_resolve_static_string_values(
                &conditional.alternate,
                ctx,
                resolving_symbol_ids,
            )?);
            Some(values)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if resolving_symbol_ids.contains(&symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return None;
            };
            let parent = ctx.nodes().parent_node(declaration.id());
            if !matches!(
                parent.kind(),
                AstKind::VariableDeclaration(variable_declaration)
                    if variable_declaration.kind.is_const()
            ) || declarator
                .id
                .get_binding_identifier()
                .is_none_or(|binding| binding.symbol_id() != symbol_id)
            {
                return None;
            }
            resolving_symbol_ids.push(symbol_id);
            let values = no_uncontrolled_input_resolve_static_string_values(
                declarator.init.as_ref()?,
                ctx,
                resolving_symbol_ids,
            );
            resolving_symbol_ids.pop();
            values
        }
        _ => None,
    }
}

fn no_uncontrolled_input_is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
