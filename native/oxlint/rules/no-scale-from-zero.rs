use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXElementName, JSXMemberExpressionObject, ObjectExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MOTION_FACTORY_MODULE_SOURCES: [&str; 2] = ["framer-motion", "motion/react"];
const MOTION_TAG_MODULE_SOURCES: [&str; 4] = [
    "framer-motion/client",
    "framer-motion/m",
    "motion/react-client",
    "motion/react-m",
];
const MOTION_FACTORY_EXPORT_NAMES: [&str; 2] = ["m", "motion"];
static NO_SCALE_FROM_ZERO_VALUE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^[+-]?(?:0+(?:\.0*)?|\.0+)%?$");
static NO_SCALE_FROM_ZERO_TRANSFORM_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i-u:\b(?:scale[xy]\(\s*[+-]?(?:0+(?:\.0*)?|\.0+)\s*\)|scale\(\s*[+-]?(?:0+(?:\.0*)?|\.0+)\s*(?:,\s*[+-]?(?:0+(?:\.0*)?|\.0+)\s*)?\)))"
);

#[derive(Debug, Default, Clone)]
pub struct NoScaleFromZero;

declare_oxc_lint!(
    /// Disallow transitions that animate scale from zero.
    NoScaleFromZero,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow scale-from-zero transitions.",
);

impl Rule for NoScaleFromZero {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if no_scale_from_zero_is_proven_motion_element(&opening_element.name, ctx) {
            for attribute_name in ["initial", "exit"] {
                let Some(attribute) =
                    get_authoritative_jsx_attribute(opening_element, attribute_name, true)
                else {
                    continue;
                };
                let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) =
                    attribute.value.as_ref()
                else {
                    continue;
                };
                let oxc_ast::ast::JSXExpression::ObjectExpression(object) = &container.expression
                else {
                    continue;
                };
                let Some(property) =
                    super::no_transition_all::no_transition_all_get_effective_static_style_property(
                        object, "scale",
                    )
                else {
                    continue;
                };
                if matches!(&property.value, Expression::NumericLiteral(number) if number.value == 0.0)
                {
                    ctx.diagnostic(
                        OxcDiagnostic::warn("This looks abrupt to your users because scale: 0 pops the element in from a single point, so use scale: 0.95 with opacity: 0 for a smoother entrance")
                            .with_label(property.span),
                    );
                }
            }
        }

        let class_name_values = if has_capability_or_unspecified(ctx, "tailwind") {
            match get_authoritative_jsx_attribute(opening_element, "className", true) {
                Some(attribute) => {
                    let Some(values) = get_static_jsx_attribute_string_values(attribute, ctx)
                    else {
                        return;
                    };
                    values
                }
                None => vec![String::new()],
            }
        } else {
            vec![String::new()]
        };
        let style = match get_authoritative_jsx_attribute(opening_element, "style", true) {
            Some(attribute) => {
                let Some(style) = get_inline_style_object_expression_with_aliases(attribute, ctx)
                else {
                    return;
                };
                Some(style)
            }
            None => None,
        };
        let has_tailwind_four = has_capability(ctx, "tailwind:4");
        if !class_name_values.iter().any(|class_name| {
            no_scale_from_zero_has_merged_transition(class_name, style, has_tailwind_four)
        }) {
            return;
        }
        let message = if class_name_values
            .iter()
            .any(|class_name| no_scale_from_zero_has_class_transition(class_name))
        {
            "This scale transition makes the element disappear completely. Use a small nonzero scale with opacity instead."
        } else {
            "This transition collapses the element to nothing. Keep a small visible scale and use opacity for the rest of the entrance or exit."
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
    }
}

fn no_scale_from_zero_has_merged_transition(
    class_name: &str,
    style: Option<&ObjectExpression<'_>>,
    has_tailwind_four: bool,
) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    let inline_transform_property = style.and_then(|style| {
        super::no_transition_all::no_transition_all_get_effective_static_style_property(
            style,
            "transform",
        )
    });
    let inline_transform_value =
        inline_transform_property.and_then(no_scale_from_zero_property_string);
    let inline_scale_property = style.and_then(|style| {
        super::no_transition_all::no_transition_all_get_effective_static_style_property(
            style, "scale",
        )
    });
    let mut variant_scopes = vec![Vec::new()];
    for token in &tokens {
        if !variant_scopes.iter().any(|scope| scope == &token.variants) {
            variant_scopes.push(token.variants.clone());
        }
    }
    variant_scopes.into_iter().any(|scope| {
        let transform_scale_state =
            no_scale_from_zero_resolve_boolean_state(&tokens, &scope, |utility| {
                no_scale_from_zero_transform_scale_state(utility, has_tailwind_four)
            });
        let individual_scale_state =
            no_scale_from_zero_resolve_boolean_state(&tokens, &scope, |utility| {
                no_scale_from_zero_individual_scale_state(utility, has_tailwind_four)
            });
        let important_transform_scale =
            no_scale_from_zero_has_important_token(&tokens, &scope, |utility| {
                no_scale_from_zero_transform_scale_state(utility, has_tailwind_four).is_some()
            });
        let important_individual_scale =
            no_scale_from_zero_has_important_token(&tokens, &scope, |utility| {
                no_scale_from_zero_individual_scale_state(utility, has_tailwind_four).is_some()
            });
        let has_transform_setter = tokens.iter().any(|token| {
            no_scale_from_zero_transform_scale_state(token.utility, has_tailwind_four).is_some()
                && does_tailwind_variant_scope_cover(&token.variants, &scope)
        });
        let has_individual_setter = tokens.iter().any(|token| {
            no_scale_from_zero_individual_scale_state(token.utility, has_tailwind_four).is_some()
                && does_tailwind_variant_scope_cover(&token.variants, &scope)
        });
        let inline_transform_zero = !important_transform_scale
            && inline_transform_value.is_some_and(no_scale_from_zero_transform_contains_zero);
        let inline_individual_zero = !important_individual_scale
            && inline_scale_property.is_some_and(no_scale_from_zero_property_is_zero);
        let class_transform_zero = has_transform_setter
            && transform_scale_state == Some(true)
            && (important_transform_scale || inline_transform_property.is_none());
        let class_individual_zero = has_individual_setter
            && individual_scale_state == Some(true)
            && (important_individual_scale || inline_scale_property.is_none());
        let effective_transform_zero = inline_transform_zero || class_transform_zero;
        let effective_individual_zero = inline_individual_zero || class_individual_zero;
        if !effective_transform_zero && !effective_individual_zero {
            return false;
        }
        let has_transition_setter = tokens.iter().any(|token| {
            no_scale_from_zero_transition_relevant_state(token.utility).is_some()
                && does_tailwind_variant_scope_cover(&token.variants, &scope)
        });
        let transition_all_state =
            no_scale_from_zero_resolve_boolean_state(&tokens, &scope, |utility| {
                super::no_transition_all::no_transition_all_property_effect(utility)
                    .map(|effect| effect.includes_all)
            });
        let transform_transition_state = no_scale_from_zero_resolve_boolean_state(
            &tokens,
            &scope,
            no_scale_from_zero_transform_transition_state,
        );
        let scale_transition_state =
            no_scale_from_zero_resolve_boolean_state(&tokens, &scope, |utility| {
                no_scale_from_zero_scale_transition_state(utility, has_tailwind_four)
            });
        let duration_state =
            no_scale_from_zero_resolve_duration_state(&tokens, &scope, &["scale", "transform"]);
        let important_transition_property =
            no_scale_from_zero_has_important_token(&tokens, &scope, |utility| {
                no_scale_from_zero_transition_relevant_state(utility).is_some()
            });
        let important_transition_duration = no_scale_from_zero_has_important_token(
            &tokens,
            &scope,
            super::no_transition_all::no_transition_all_is_duration_setter,
        );
        let default_property = if !has_transition_setter || transition_all_state == Some(true) {
            "all"
        } else if effective_individual_zero && scale_transition_state == Some(true) {
            "scale"
        } else if effective_transform_zero && transform_transition_state == Some(true) {
            "transform"
        } else {
            "opacity"
        };
        super::no_transition_all::no_transition_all_effective_css_transitions(
            style,
            default_property,
            duration_state == Some(true),
            important_transition_property,
            important_transition_duration,
        )
        .is_some_and(|transitions| {
            transitions.iter().any(|(property, duration)| {
                *duration > 0.0
                    && (property == "all"
                        || effective_transform_zero && property == "transform"
                        || effective_individual_zero && property == "scale")
            })
        })
    })
}

fn no_scale_from_zero_has_class_transition(class_name: &str) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    tokens.iter().any(|token| {
        no_scale_from_zero_resolve_boolean_state(
            &tokens,
            &token.variants,
            no_scale_from_zero_scale_state,
        ) == Some(true)
            && no_scale_from_zero_resolve_boolean_state(
                &tokens,
                &token.variants,
                no_scale_from_zero_transition_relevant_state,
            ) == Some(true)
            && no_scale_from_zero_resolve_duration_state(
                &tokens,
                &token.variants,
                &["scale", "transform"],
            ) == Some(true)
    })
}

fn no_scale_from_zero_property_string<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    let Expression::StringLiteral(value) = &property.value else {
        return None;
    };
    Some(value.value.as_str())
}

fn no_scale_from_zero_property_is_zero(property: &oxc_ast::ast::ObjectProperty<'_>) -> bool {
    if matches!(&property.value, Expression::NumericLiteral(number) if number.value == 0.0) {
        return true;
    }
    no_scale_from_zero_property_string(property)
        .is_some_and(|value| no_scale_from_zero_components_are_zero(value))
}

fn no_scale_from_zero_scale_state(utility: &str) -> Option<bool> {
    no_scale_from_zero_built_in_scale_state(utility)
        .or_else(|| no_scale_from_zero_transform_scale_state(utility, false))
        .or_else(|| no_scale_from_zero_individual_scale_state(utility, true))
}

fn no_scale_from_zero_built_in_scale_state(utility: &str) -> Option<bool> {
    if !utility.starts_with("scale-") || utility.starts_with("scale-origin-") {
        return None;
    }
    let value = ["scale-x-", "scale-y-", "scale-"]
        .iter()
        .find_map(|prefix| utility.strip_prefix(prefix))?;
    if value == "0" {
        return Some(true);
    }
    let Some(value) = value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    else {
        return Some(false);
    };
    Some(no_scale_from_zero_scale_value_is_zero(value))
}

fn no_scale_from_zero_transform_scale_state(
    utility: &str,
    has_tailwind_four: bool,
) -> Option<bool> {
    super::no_transition_all::no_transition_all_arbitrary_value(utility, "[transform:")
        .or_else(|| {
            super::no_transition_all::no_transition_all_arbitrary_value(utility, "transform-[")
        })
        .map(|value| {
            no_scale_from_zero_transform_contains_zero(
                &super::no_transition_all::no_transition_all_normalize_arbitrary(value),
            )
        })
        .or_else(|| {
            (!has_tailwind_four)
                .then(|| no_scale_from_zero_built_in_scale_state(utility))
                .flatten()
        })
}

fn no_scale_from_zero_individual_scale_state(
    utility: &str,
    has_tailwind_four: bool,
) -> Option<bool> {
    super::no_transition_all::no_transition_all_arbitrary_value(utility, "[scale:")
        .map(no_scale_from_zero_scale_value_is_zero)
        .or_else(|| {
            has_tailwind_four
                .then(|| no_scale_from_zero_built_in_scale_state(utility))
                .flatten()
        })
}

fn no_scale_from_zero_scale_value_is_zero(value: &str) -> bool {
    let normalized = super::no_transition_all::no_transition_all_normalize_arbitrary(value);
    no_scale_from_zero_components_are_zero(&normalized)
}

fn no_scale_from_zero_components_are_zero(value: &str) -> bool {
    let mut components = value
        .split(is_js_whitespace)
        .filter(|component| !component.is_empty())
        .peekable();
    components.peek().is_some()
        && components.all(|component| NO_SCALE_FROM_ZERO_VALUE_PATTERN.is_match(component))
}

fn no_scale_from_zero_transform_contains_zero(value: &str) -> bool {
    if !value
        .chars()
        .any(|character| is_js_whitespace(character) && !character.is_ascii_whitespace())
    {
        return NO_SCALE_FROM_ZERO_TRANSFORM_PATTERN.is_match(value);
    }
    let normalized_whitespace = value
        .chars()
        .map(|character| {
            if is_js_whitespace(character) {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    NO_SCALE_FROM_ZERO_TRANSFORM_PATTERN.is_match(&normalized_whitespace)
}

fn no_scale_from_zero_transition_relevant_state(utility: &str) -> Option<bool> {
    let effect = super::no_transition_all::no_transition_all_property_effect(utility)?;
    Some(effect.includes_scale || effect.includes_transform)
}

fn no_scale_from_zero_transform_transition_state(utility: &str) -> Option<bool> {
    let effect = super::no_transition_all::no_transition_all_property_effect(utility)?;
    Some(effect.includes_transform)
}

fn no_scale_from_zero_scale_transition_state(
    utility: &str,
    has_tailwind_four: bool,
) -> Option<bool> {
    let effect = super::no_transition_all::no_transition_all_property_effect(utility)?;
    if !has_tailwind_four && matches!(utility, "transition" | "transition-transform") {
        return Some(false);
    }
    Some(effect.includes_scale)
}

fn no_scale_from_zero_resolve_boolean_state<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    scope: &[&str],
    get_state: impl Fn(&str) -> Option<bool>,
) -> Option<bool> {
    let applicable = no_scale_from_zero_highest_priority_tokens(tokens, scope, |utility| {
        get_state(utility).is_some()
    });
    let first = get_state(applicable.first()?.utility)?;
    applicable
        .iter()
        .all(|token| get_state(token.utility) == Some(first))
        .then_some(first)
}

fn no_scale_from_zero_highest_priority_tokens<'a, 'b>(
    tokens: &'b [TailwindClassNameToken<'a>],
    scope: &[&str],
    predicate: impl Fn(&str) -> bool,
) -> Vec<&'b TailwindClassNameToken<'a>> {
    let applicable = tokens
        .iter()
        .filter(|token| {
            predicate(token.utility) && does_tailwind_variant_scope_cover(&token.variants, scope)
        })
        .collect::<Vec<_>>();
    let has_important = applicable.iter().any(|token| token.is_important);
    let most_specific = applicable
        .iter()
        .filter(|token| !has_important || token.is_important)
        .map(|token| token.variants.len())
        .max();
    applicable
        .into_iter()
        .filter(|token| {
            (!has_important || token.is_important) && Some(token.variants.len()) == most_specific
        })
        .collect()
}

fn no_scale_from_zero_has_important_token<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    scope: &[&str],
    predicate: impl Fn(&str) -> bool,
) -> bool {
    no_scale_from_zero_highest_priority_tokens(tokens, scope, predicate)
        .iter()
        .any(|token| token.is_important)
}

fn no_scale_from_zero_resolve_duration_state<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    scope: &[&str],
    targets: &[&str],
) -> Option<bool> {
    let applicable = no_scale_from_zero_highest_priority_tokens(tokens, scope, |utility| {
        super::no_transition_all::no_transition_all_duration_effect(utility, targets).is_some()
    });
    let effects = applicable
        .iter()
        .filter_map(|token| {
            super::no_transition_all::no_transition_all_duration_effect(token.utility, targets)
        })
        .collect::<Vec<_>>();
    let has_explicit = effects.iter().any(|effect| effect.is_explicit);
    let property_names = no_scale_from_zero_effective_transition_property_names(tokens, scope);
    let states = effects
        .iter()
        .filter(|effect| !has_explicit || effect.is_explicit)
        .map(|effect| {
            super::no_transition_all::no_transition_all_duration_effect_state(
                effect,
                property_names.as_deref(),
                targets,
            )
        })
        .collect::<Vec<_>>();
    let first = *states.first()?;
    states
        .iter()
        .all(|state| *state == first)
        .then_some(first)
        .flatten()
}

fn no_scale_from_zero_effective_transition_property_names<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    scope: &[&str],
) -> Option<Vec<String>> {
    let applicable = no_scale_from_zero_highest_priority_tokens(tokens, scope, |utility| {
        super::no_transition_all::no_transition_all_property_effect(utility).is_some()
    });
    if applicable.is_empty() {
        return Some(vec!["all".to_string()]);
    }
    let first = super::no_transition_all::no_transition_all_property_effect(applicable[0].utility)?
        .property_names?;
    applicable
        .iter()
        .skip(1)
        .all(|token| {
            super::no_transition_all::no_transition_all_property_effect(token.utility)
                .and_then(|effect| effect.property_names)
                .as_ref()
                == Some(&first)
        })
        .then_some(first)
}

fn no_scale_from_zero_is_proven_motion_element(
    element_name: &JSXElementName<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match element_name {
        JSXElementName::IdentifierReference(identifier) => {
            if identifier
                .name
                .chars()
                .next()
                .is_none_or(|character| character.is_ascii_lowercase())
            {
                return false;
            }
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol_id| {
                    no_scale_from_zero_is_motion_component_symbol(symbol_id, ctx, &mut Vec::new())
                })
        }
        JSXElementName::MemberExpression(member_expression) => {
            no_scale_from_zero_is_motion_factory_jsx_object(
                &member_expression.object,
                ctx,
                &mut Vec::new(),
            )
        }
        _ => false,
    }
}

fn no_scale_from_zero_is_motion_factory_jsx_object(
    object: &JSXMemberExpressionObject<'_>,
    ctx: &LintContext<'_>,
    visited: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    match object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                no_scale_from_zero_is_motion_factory_symbol(symbol_id, ctx, visited)
            }),
        JSXMemberExpressionObject::MemberExpression(member) => {
            MOTION_FACTORY_EXPORT_NAMES.contains(&member.property.name.as_str())
                && matches!(
                    &member.object,
                    JSXMemberExpressionObject::IdentifierReference(identifier)
                        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
                            |symbol_id| no_scale_from_zero_is_namespace_import_from(
                                symbol_id,
                                &MOTION_FACTORY_MODULE_SOURCES,
                                ctx,
                            )
                        )
                )
        }
        _ => false,
    }
}

fn no_scale_from_zero_is_motion_factory_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if no_scale_from_zero_is_namespace_import_from(symbol_id, &MOTION_TAG_MODULE_SOURCES, ctx)
        || no_scale_from_zero_imported_name_from(symbol_id, &MOTION_FACTORY_MODULE_SOURCES, ctx)
            .is_some_and(|name| MOTION_FACTORY_EXPORT_NAMES.contains(&name))
    {
        return true;
    }
    if visited.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = no_scale_from_zero_const_initializer(symbol_id, ctx) else {
        return false;
    };
    visited.push(symbol_id);
    let result = no_scale_from_zero_is_motion_factory_expression(initializer, ctx, visited);
    visited.pop();
    result
}

fn no_scale_from_zero_is_motion_factory_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                no_scale_from_zero_is_motion_factory_symbol(symbol_id, ctx, visited)
            });
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    MOTION_FACTORY_EXPORT_NAMES.contains(&member.static_property_name().unwrap_or(""))
        && matches!(
            member.object().get_inner_expression(),
            Expression::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
                    |symbol_id| no_scale_from_zero_is_namespace_import_from(
                        symbol_id,
                        &MOTION_FACTORY_MODULE_SOURCES,
                        ctx,
                    )
                )
        )
}

fn no_scale_from_zero_is_motion_component_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if no_scale_from_zero_is_named_motion_tag_import(symbol_id, ctx) {
        return true;
    }
    if visited.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = no_scale_from_zero_const_initializer(symbol_id, ctx) else {
        return false;
    };
    visited.push(symbol_id);
    let result = no_scale_from_zero_is_motion_component_expression(initializer, ctx, visited);
    visited.pop();
    result
}

fn no_scale_from_zero_is_motion_component_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                no_scale_from_zero_is_motion_component_symbol(symbol_id, ctx, visited)
            });
    }
    if let Some(member) = expression.as_member_expression()
        && member.static_property_name().is_some()
        && no_scale_from_zero_is_motion_factory_expression(member.object(), ctx, visited)
    {
        return true;
    }
    let Expression::CallExpression(call) = expression else {
        return false;
    };
    if no_scale_from_zero_is_motion_factory_expression(&call.callee, ctx, visited) {
        return true;
    }
    let Some(member) = call.callee.as_member_expression() else {
        return false;
    };
    member.static_property_name() == Some("create")
        && no_scale_from_zero_is_motion_factory_expression(member.object(), ctx, visited)
}

fn no_scale_from_zero_const_initializer<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_node(declaration.id()).kind()
    else {
        return None;
    };
    (variable_declaration.kind.is_const()
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|identifier| identifier.symbol_id() == symbol_id))
    .then_some(declarator.init.as_ref())?
}

fn no_scale_from_zero_imported_name_from<'a>(
    symbol_id: oxc_semantic::SymbolId,
    module_sources: &[&str],
    ctx: &'a LintContext<'_>,
) -> Option<&'a str> {
    ctx.module_record().import_entries.iter().find_map(|entry| {
        (!entry.is_type
            && module_sources.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id))
        .then(|| match &entry.import_name {
            crate::module_record::ImportImportName::Name(name) => Some(name.name()),
            crate::module_record::ImportImportName::Default(_) => Some("default"),
            crate::module_record::ImportImportName::NamespaceObject => None,
        })?
    })
}

fn no_scale_from_zero_is_named_motion_tag_import(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && MOTION_TAG_MODULE_SOURCES.contains(&entry.module_request.name())
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(name) if name.name() != "create"
            )
    })
}

fn no_scale_from_zero_is_namespace_import_from(
    symbol_id: oxc_semantic::SymbolId,
    module_sources: &[&str],
    ctx: &LintContext<'_>,
) -> bool {
    no_scale_from_zero_is_namespace_import_from_with_visited(
        symbol_id,
        module_sources,
        ctx,
        &mut Vec::new(),
    )
}

fn no_scale_from_zero_is_namespace_import_from_with_visited(
    symbol_id: oxc_semantic::SymbolId,
    module_sources: &[&str],
    ctx: &LintContext<'_>,
    visited: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && module_sources.contains(&entry.module_request.name())
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    }) {
        return true;
    }
    if visited.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = no_scale_from_zero_const_initializer(symbol_id, ctx) else {
        return false;
    };
    let Expression::Identifier(identifier) = initializer.get_inner_expression() else {
        return false;
    };
    let Some(initializer_symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    visited.push(symbol_id);
    let result = no_scale_from_zero_is_namespace_import_from_with_visited(
        initializer_symbol_id,
        module_sources,
        ctx,
        visited,
    );
    visited.pop();
    result
}
