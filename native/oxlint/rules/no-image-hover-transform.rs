use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        JSXElementName, JSXExpression, JSXMemberExpressionObject,
    },
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
const MOTION_SCALE_PROPERTY_NAMES: [&str; 3] = ["scale", "scaleX", "scaleY"];
const MOTION_ROTATION_PROPERTY_NAMES: [&str; 4] = ["rotate", "rotateX", "rotateY", "rotateZ"];
const FUNCTIONAL_CONTEXT_VALUE_ATTRIBUTE_NAMES: [&str; 6] = [
    "aria-label",
    "aria-roledescription",
    "className",
    "data-testid",
    "id",
    "title",
];
const INACTIVE_CONTEXT_ATTRIBUTE_VALUES: [&str; 5] = ["", "0", "false", "none", "off"];
static FUNCTIONAL_CONTEXT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|[-_\s])(?:crop(?:per)?|gallery|image[-_\s]?viewer|lightbox|product[-_\s]?zoom|zoom)(?:$|[-_\s])"
);

#[derive(Debug, Default, Clone)]
pub struct NoImageHoverTransform;

declare_oxc_lint!(
    /// Disallow hover transforms that move an image under the pointer.
    NoImageHoverTransform,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow image hover transforms.",
);

impl Rule for NoImageHoverTransform {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if matches!(&opening_element.name, JSXElementName::Identifier(identifier) if identifier.name == "img")
        {
            let Some(class_name) = get_static_class_name(opening_element) else {
                return;
            };
            let Some(hover_transform) = get_hover_image_transform(class_name) else {
                return;
            };
            if has_functional_image_context_evidence(node, ctx) {
                return;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "The {hover_transform} treatment makes the image itself shift under the pointer. Use a steadier hover affordance."
                ))
                .with_label(opening_element.span),
            );
            return;
        }
        let Some(property_name) = get_motion_hover_transform_property(opening_element, node, ctx)
        else {
            return;
        };
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "The whileHover {property_name} treatment makes the image itself shift under the pointer. Use a steadier hover affordance."
            ))
            .with_label(opening_element.span),
        );
    }
}

fn get_hover_image_transform(class_name: &str) -> Option<String> {
    let tokens = tailwind_class_name_tokens(class_name);
    let mut variant_scopes = Vec::<Vec<&str>>::new();
    for token in &tokens {
        if !is_image_transform_utility(token.utility)
            || !token
                .variants
                .iter()
                .any(|variant| is_hover_variant(variant))
            || variant_scopes
                .iter()
                .any(|variants| variants == &token.variants)
        {
            continue;
        }
        variant_scopes.push(token.variants.clone());
    }
    for variants in variant_scopes {
        let EffectiveTailwindClassNameTokenResolution {
            is_important: _,
            utility: effective_scale,
            ..
        } = resolve_effective_tailwind_class_name_token(
            &tokens,
            |utility| remove_negative_modifier(utility).starts_with("scale-"),
            &variants,
        );
        if effective_scale.is_some_and(|utility| {
            utility.starts_with('-') || !is_neutral_scale(remove_negative_modifier(utility))
        }) {
            return Some(join_variant_utility(&variants, effective_scale?));
        }
        let EffectiveTailwindClassNameTokenResolution {
            is_important: _,
            utility: effective_rotation,
            ..
        } = resolve_effective_tailwind_class_name_token(
            &tokens,
            |utility| remove_negative_modifier(utility).starts_with("rotate-"),
            &variants,
        );
        if effective_rotation
            .is_some_and(|utility| !is_neutral_rotation(remove_negative_modifier(utility)))
        {
            return Some(join_variant_utility(&variants, effective_rotation?));
        }
    }
    None
}

fn is_hover_variant(variant: &str) -> bool {
    let hover = variant
        .strip_prefix("group-")
        .or_else(|| variant.strip_prefix("peer-"))
        .unwrap_or(variant);
    hover == "hover"
        || hover
            .strip_prefix("hover/")
            .is_some_and(|name| !name.is_empty())
}

fn is_image_transform_utility(utility: &str) -> bool {
    let utility = remove_negative_modifier(utility);
    utility.starts_with("scale-") || utility.starts_with("rotate-")
}

fn remove_negative_modifier(utility: &str) -> &str {
    utility.strip_prefix('-').unwrap_or(utility)
}

fn join_variant_utility(variants: &[&str], utility: &str) -> String {
    let mut parts = variants.to_vec();
    parts.push(utility);
    parts.join(":")
}

fn is_neutral_scale(utility: &str) -> bool {
    let Some(value) = axis_utility_value(utility, "scale") else {
        return false;
    };
    value == "100"
        || value == "none"
        || value
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
            .is_some_and(|value| {
                is_decimal_with_integer(value, "1")
                    || value
                        .strip_suffix('%')
                        .is_some_and(|number| is_decimal_with_integer(number, "100"))
            })
}

fn is_neutral_rotation(utility: &str) -> bool {
    let Some(value) = axis_utility_value(utility, "rotate") else {
        return false;
    };
    if matches!(value, "0" | "none") {
        return true;
    }
    value
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .is_some_and(|value| {
            ["deg", "grad", "rad", "turn", ""].iter().any(|unit| {
                value
                    .strip_suffix(unit)
                    .is_some_and(|number| is_zero_decimal(number))
            })
        })
}

fn axis_utility_value<'a>(utility: &'a str, prefix: &str) -> Option<&'a str> {
    let suffix = utility.strip_prefix(prefix)?.strip_prefix('-')?;
    for axis in ["x-", "y-", "z-"] {
        if let Some(value) = suffix.strip_prefix(axis) {
            return Some(value);
        }
    }
    Some(suffix)
}

fn is_decimal_with_integer(value: &str, integer: &str) -> bool {
    value == integer
        || value
            .strip_prefix(integer)
            .and_then(|fraction| fraction.strip_prefix('.'))
            .is_some_and(|fraction| {
                !fraction.is_empty() && fraction.bytes().all(|byte| byte == b'0')
            })
}

fn is_zero_decimal(value: &str) -> bool {
    is_decimal_with_integer(value, "0")
}

fn get_motion_hover_transform_property<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    if !is_proven_motion_image(opening_element, ctx)
        || has_functional_image_context_evidence(node, ctx)
    {
        return None;
    }
    let attribute = get_authoritative_jsx_attribute(opening_element, "whileHover", true)?;
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    let JSXExpression::ObjectExpression(object_expression) = &container.expression else {
        return None;
    };
    for property_name in MOTION_SCALE_PROPERTY_NAMES {
        let Some(property) = get_effective_static_style_property(object_expression, property_name)
        else {
            continue;
        };
        if get_static_style_property_number_value(property).is_some_and(|value| value != 1.0) {
            return Some(property_name);
        }
    }
    for property_name in MOTION_ROTATION_PROPERTY_NAMES {
        let Some(property) = get_effective_static_style_property(object_expression, property_name)
        else {
            continue;
        };
        if get_static_style_property_number_value(property).is_some_and(|value| value != 0.0) {
            return Some(property_name);
        }
    }
    None
}

fn is_proven_motion_image(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if !is_proven_motion_element_name(&opening_element.name, ctx) {
        return false;
    }
    match &opening_element.name {
        JSXElementName::MemberExpression(member_expression) => {
            member_expression.property.name == "img"
        }
        JSXElementName::IdentifierReference(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            let Some(symbol_id) = resolve_terminal_const_symbol(symbol_id, ctx, &mut Vec::new())
            else {
                return false;
            };
            if imported_name(symbol_id, ctx) == Some("img") {
                return true;
            }
            const_initializer(symbol_id, ctx).and_then(get_static_intrinsic_factory_target)
                == Some("img")
        }
        _ => false,
    }
}

fn is_proven_motion_element_name(element_name: &JSXElementName<'_>, ctx: &LintContext<'_>) -> bool {
    match element_name {
        JSXElementName::IdentifierReference(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| is_motion_component_symbol(symbol_id, ctx, &mut Vec::new())),
        JSXElementName::MemberExpression(member_expression) => {
            is_motion_factory_jsx_object(&member_expression.object, ctx, &mut Vec::new())
        }
        _ => false,
    }
}

fn is_motion_factory_jsx_object(
    object: &JSXMemberExpressionObject<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    match object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| is_motion_factory_symbol(symbol_id, ctx, visited_symbol_ids)),
        JSXMemberExpressionObject::MemberExpression(member_expression) => {
            MOTION_FACTORY_EXPORT_NAMES.contains(&member_expression.property.name.as_str())
                && matches!(
                    &member_expression.object,
                    JSXMemberExpressionObject::IdentifierReference(identifier)
                        if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
                            |symbol_id| is_namespace_import_from(symbol_id, &MOTION_FACTORY_MODULE_SOURCES, ctx)
                        )
                )
        }
        _ => false,
    }
}

fn is_motion_factory_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if is_namespace_import_from(symbol_id, &MOTION_TAG_MODULE_SOURCES, ctx)
        || imported_name_from(symbol_id, &MOTION_FACTORY_MODULE_SOURCES, ctx)
            .is_some_and(|name| MOTION_FACTORY_EXPORT_NAMES.contains(&name))
    {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = const_initializer(symbol_id, ctx) else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let result = is_motion_factory_expression(initializer, ctx, visited_symbol_ids);
    visited_symbol_ids.pop();
    result
}

fn is_motion_factory_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| is_motion_factory_symbol(symbol_id, ctx, visited_symbol_ids));
    }
    let Some(member_expression) = expression.as_member_expression() else {
        return false;
    };
    MOTION_FACTORY_EXPORT_NAMES.contains(&member_expression.static_property_name().unwrap_or(""))
        && matches!(
            member_expression.object().get_inner_expression(),
            Expression::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_some_and(
                    |symbol_id| is_namespace_import_from(symbol_id, &MOTION_FACTORY_MODULE_SOURCES, ctx)
                )
        )
}

fn is_motion_component_symbol(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    if imported_name_from(symbol_id, &MOTION_TAG_MODULE_SOURCES, ctx)
        .is_some_and(|name| name != "create")
    {
        return true;
    }
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    let Some(initializer) = const_initializer(symbol_id, ctx) else {
        return false;
    };
    visited_symbol_ids.push(symbol_id);
    let result = is_motion_component_expression(initializer, ctx, visited_symbol_ids);
    visited_symbol_ids.pop();
    result
}

fn is_motion_component_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        return ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                is_motion_component_symbol(symbol_id, ctx, visited_symbol_ids)
            });
    }
    if let Some(member_expression) = expression.as_member_expression()
        && is_motion_factory_expression(member_expression.object(), ctx, visited_symbol_ids)
    {
        return true;
    }
    let Expression::CallExpression(call_expression) = expression else {
        return false;
    };
    if is_motion_factory_expression(&call_expression.callee, ctx, visited_symbol_ids) {
        return true;
    }
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    member_expression.static_property_name() == Some("create")
        && is_motion_factory_expression(member_expression.object(), ctx, visited_symbol_ids)
}

fn get_static_intrinsic_factory_target<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    let expression = expression.get_inner_expression();
    if let Some(member_expression) = expression.as_member_expression() {
        return member_expression.static_property_name();
    }
    let Expression::CallExpression(call_expression) = expression else {
        return None;
    };
    let Expression::StringLiteral(target) = call_expression.arguments.first()?.as_expression()?
    else {
        return None;
    };
    Some(target.value.as_str())
}

fn resolve_terminal_const_symbol(
    mut symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'_>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> Option<oxc_semantic::SymbolId> {
    loop {
        if visited_symbol_ids.contains(&symbol_id) {
            return None;
        }
        let Some(initializer) = const_initializer(symbol_id, ctx) else {
            return Some(symbol_id);
        };
        let Expression::Identifier(identifier) = initializer.get_inner_expression() else {
            return Some(symbol_id);
        };
        visited_symbol_ids.push(symbol_id);
        symbol_id = ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
    }
}

fn const_initializer<'a>(
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

fn imported_name<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &'a LintContext<'_>,
) -> Option<&'a str> {
    ctx.module_record().import_entries.iter().find_map(|entry| {
        (!entry.is_type
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

fn imported_name_from<'a>(
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

fn is_namespace_import_from(
    symbol_id: oxc_semantic::SymbolId,
    module_sources: &[&str],
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
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
    })
}

fn has_functional_image_context_evidence(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        let opening_element = match ancestor.kind() {
            AstKind::JSXOpeningElement(opening_element) => opening_element,
            AstKind::JSXElement(element) => &element.opening_element,
            _ => return false,
        };
        has_active_drag_attribute(opening_element, ctx)
            || resolve_jsx_element_name(opening_element)
                .is_some_and(identifier_contains_functional_context_word)
            || opening_element.attributes.iter().any(|attribute_item| {
                let JSXAttributeItem::Attribute(attribute) = attribute_item else {
                    return false;
                };
                is_authoritative_functional_context_attribute(opening_element, attribute, ctx)
            })
    })
}

fn has_active_drag_attribute(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ["drag", "draggable"].iter().any(|attribute_name| {
        get_authoritative_jsx_attribute(opening_element, attribute_name, true)
            .is_some_and(|attribute| is_potentially_active_context_attribute(attribute, ctx))
    })
}

fn is_authoritative_functional_context_attribute<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    attribute: &JSXAttribute<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let attribute_name = jsx_attribute_name(attribute);
    if !get_authoritative_jsx_attribute(opening_element, &attribute_name, true)
        .is_some_and(|authoritative| std::ptr::eq(authoritative, attribute))
    {
        return false;
    }
    if FUNCTIONAL_CONTEXT_PATTERN.is_match(&attribute_name)
        && is_potentially_active_context_attribute(attribute, ctx)
    {
        return true;
    }
    if attribute_name
        .get(..6)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("onDrag"))
        && is_potentially_active_event_handler(attribute, ctx)
    {
        return true;
    }
    FUNCTIONAL_CONTEXT_VALUE_ATTRIBUTE_NAMES.contains(&attribute_name.as_str())
        && get_static_jsx_attribute_string_values(attribute, ctx).is_some_and(|values| {
            values
                .iter()
                .any(|value| FUNCTIONAL_CONTEXT_PATTERN.is_match(value))
        })
}

fn jsx_attribute_name(attribute: &JSXAttribute<'_>) -> String {
    match &attribute.name {
        JSXAttributeName::Identifier(identifier) => identifier.name.to_string(),
        JSXAttributeName::NamespacedName(namespaced_name) => format!(
            "{}:{}",
            namespaced_name.namespace.name, namespaced_name.name.name
        ),
    }
}

fn is_potentially_active_context_attribute(
    attribute: &JSXAttribute<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(value)) => {
            !is_known_inactive_context_string(value.value.as_str())
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => container
            .expression
            .as_expression()
            .is_some_and(|expression| !is_known_inactive_context_expression(expression, ctx)),
        _ => false,
    }
}

fn is_potentially_active_event_handler(
    attribute: &JSXAttribute<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref() else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    !is_known_inactive_context_expression(expression, ctx)
        && !expression.get_inner_expression().is_literal()
}

fn is_known_inactive_context_expression(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) => is_literal_void_expression(unary),
        Expression::Identifier(identifier) => {
            identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none()
        }
        Expression::BooleanLiteral(value) => !value.value,
        Expression::NullLiteral(_) => true,
        Expression::NumericLiteral(value) => value.value == 0.0,
        Expression::StringLiteral(value) => is_known_inactive_context_string(value.value.as_str()),
        _ => false,
    }
}

fn is_known_inactive_context_string(value: &str) -> bool {
    INACTIVE_CONTEXT_ATTRIBUTE_VALUES
        .iter()
        .any(|inactive| value.trim().eq_ignore_ascii_case(inactive))
}

fn identifier_contains_functional_context_word(identifier: &str) -> bool {
    tokenize_identifier_words(identifier)
        .iter()
        .any(|word| ["crop", "cropper", "gallery", "lightbox", "zoom"].contains(&word.as_str()))
}

fn tokenize_identifier_words(identifier: &str) -> Vec<String> {
    let characters = identifier.chars().collect::<Vec<_>>();
    let mut words = Vec::new();
    let mut index = 0;
    while index < characters.len() {
        if !characters[index].is_ascii_alphanumeric() {
            index += 1;
            continue;
        }
        let start = index;
        if characters[index].is_ascii_digit() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_digit() {
                index += 1;
            }
        } else if characters[index].is_ascii_uppercase() {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_uppercase() {
                if index + 1 < characters.len() && characters[index + 1].is_ascii_lowercase() {
                    break;
                }
                index += 1;
            }
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        } else {
            index += 1;
            while index < characters.len() && characters[index].is_ascii_lowercase() {
                index += 1;
            }
        }
        words.push(
            characters[start..index]
                .iter()
                .collect::<String>()
                .to_ascii_lowercase(),
        );
    }
    words
}
