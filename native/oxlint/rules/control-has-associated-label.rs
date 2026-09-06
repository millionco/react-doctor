use std::collections::HashSet;

use oxc_ast::{
    ast::{
        ArrayExpressionElement, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue,
        JSXChild, JSXElement, JSXElementName, JSXExpression, JSXMemberExpressionObject,
        ObjectPropertyKind,
    },
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
    utils::{
        has_jsx_prop_ignore_case, is_hidden_from_screen_reader, is_interactive_element,
        is_interactive_role,
    },
};

const MESSAGE: &str = "Blind users can't tell what this control does because its name is missing or only a symbol, so add visible text, `aria-label`, or `aria-labelledby`.";
const DEFAULT_DEPTH: f64 = 5.0;
const MAX_DEPTH: f64 = 25.0;
const DEFAULT_IGNORE_ELEMENTS: [&str; 2] = ["link", "canvas"];
const DEFAULT_LABELLING_PROPS: [&str; 3] = ["alt", "aria-label", "aria-labelledby"];
const NON_OPERABLE_ELEMENTS: [&str; 7] = ["td", "th", "tr", "option", "datalist", "audio", "video"];
const PLACEHOLDER_NAMEABLE_INPUT_TYPES: [&str; 7] = [
    "text", "search", "url", "tel", "email", "password", "number",
];
const ICON_LIBRARY_PACKAGES: [&str; 13] = [
    "lucide-react",
    "lucide-react-native",
    "react-feather",
    "phosphor-react",
    "iconoir-react",
    "react-bootstrap-icons",
    "@heroicons/react",
    "@tabler/icons-react",
    "@phosphor-icons/react",
    "@radix-ui/react-icons",
    "@mui/icons-material",
    "@ant-design/icons",
    "@primer/octicons-react",
];

#[derive(Debug, Default, Clone)]
pub struct ControlHasAssociatedLabel;

#[derive(Default)]
struct Settings {
    depth: f64,
    label_attributes: Vec<String>,
    control_components: Vec<String>,
    ignore_elements: Vec<String>,
    ignore_roles: Vec<String>,
}

struct Candidate<'a> {
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    control_id_keys: Vec<String>,
    enclosing_binding_name: Option<String>,
}

declare_oxc_lint!(
    /// Require controls to have accessible labels.
    ControlHasAssociatedLabel,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require controls to have accessible labels.",
);

impl Rule for ControlHasAssociatedLabel {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let settings = resolve_settings(ctx);
        let curated_behavior = should_use_curated_port_behavior(ctx);
        let mut label_html_for_keys = HashSet::new();
        let mut label_embedded_names = HashSet::new();
        let mut candidates = Vec::new();

        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            let opening_element = &element.opening_element;
            let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
            let tag_name = element_type.as_str();

            if renders_label_element(tag_name, opening_element)
                && has_accessible_label_text(element, &settings, ctx)
                && !is_inside_jsx_attribute(node.id(), ctx)
            {
                if let Some(html_for_attribute) = jsx_attribute(opening_element, "htmlFor") {
                    label_html_for_keys.extend(get_attribute_match_keys(html_for_attribute));
                }
                if tag_name == "label" {
                    collect_label_embedded_names(
                        &element.children,
                        1,
                        settings.depth,
                        &mut label_embedded_names,
                    );
                }
            }

            if DEFAULT_IGNORE_ELEMENTS.contains(&tag_name)
                || settings.ignore_elements.iter().any(|name| name == tag_name)
            {
                continue;
            }
            let role =
                jsx_attribute(opening_element, "role").and_then(get_string_literal_attribute_value);
            if role.is_some_and(|role| {
                !role.is_empty() && settings.ignore_roles.iter().any(|name| name == role)
            }) || is_element_inline_hidden(opening_element, ctx)
                || is_programmatic_hidden_file_input(tag_name, opening_element)
            {
                continue;
            }

            let is_dom_element = HTML_TAG.contains(tag_name);
            let is_interactive_element = (!curated_behavior
                || !NON_OPERABLE_ELEMENTS.contains(&tag_name))
                && is_interactive_element(&element_type, opening_element);
            let is_non_focusable_separator = curated_behavior
                && role == Some("separator")
                && jsx_attribute(opening_element, "tabIndex").is_none();
            let has_interactive_role =
                role.is_some_and(is_interactive_role) && !is_non_focusable_separator;
            let is_control_component = settings
                .control_components
                .iter()
                .any(|name| name == tag_name);
            if !(is_interactive_element
                || (is_dom_element && has_interactive_role)
                || is_control_component)
            {
                continue;
            }

            if input_has_default_or_value_name(tag_name, opening_element)
                || (is_dom_element && has_non_empty_native_title(opening_element, ctx))
                || (supports_placeholder_name_fallback(tag_name, opening_element)
                    && jsx_attribute(opening_element, "placeholder")
                        .is_some_and(has_non_empty_prop_value))
                || has_labelling_prop(opening_element, &settings.label_attributes)
                || is_inside_jsx_attribute(node.id(), ctx)
                || ancestor_provides_name(node.id(), &settings, ctx)
                || (tag_name != "select"
                    && element
                        .children
                        .iter()
                        .any(|child| child_provides_label(child, 1, &settings, ctx)))
            {
                continue;
            }

            candidates.push(Candidate {
                opening_element,
                control_id_keys: jsx_attribute(opening_element, "id")
                    .map_or_else(Vec::new, get_attribute_match_keys),
                enclosing_binding_name: enclosing_binding_name(node.id(), ctx),
            });
        }

        for candidate in candidates {
            if candidate
                .control_id_keys
                .iter()
                .any(|key| label_html_for_keys.contains(key))
                || candidate
                    .enclosing_binding_name
                    .as_ref()
                    .is_some_and(|name| label_embedded_names.contains(name))
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(candidate.opening_element.span));
        }
    }
}

fn resolve_settings(ctx: &LintContext<'_>) -> Settings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("controlHasAssociatedLabel"));
    let depth = rule_settings
        .and_then(|settings| settings.get("depth"))
        .and_then(serde_json::Value::as_f64)
        .map_or(DEFAULT_DEPTH, |depth| depth.min(MAX_DEPTH));
    Settings {
        depth,
        label_attributes: string_array_setting(rule_settings, "labelAttributes"),
        control_components: string_array_setting(rule_settings, "controlComponents"),
        ignore_elements: string_array_setting(rule_settings, "ignoreElements"),
        ignore_roles: string_array_setting(rule_settings, "ignoreRoles"),
    }
}

fn string_array_setting(settings: Option<&serde_json::Value>, name: &str) -> Vec<String> {
    settings
        .and_then(|settings| settings.get(name))
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn jsx_attribute<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    name: &'a str,
) -> Option<&'a JSXAttribute<'a>> {
    has_jsx_prop_ignore_case(opening_element, name).and_then(JSXAttributeItem::as_attribute)
}

fn has_labelling_prop(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    custom_attributes: &[String],
) -> bool {
    for attribute in &opening_element.attributes {
        match attribute {
            JSXAttributeItem::SpreadAttribute(_) => return true,
            JSXAttributeItem::Attribute(attribute) => {
                let oxc_ast::ast::JSXAttributeName::Identifier(identifier) = &attribute.name else {
                    continue;
                };
                let name = identifier.name.as_str();
                if !DEFAULT_LABELLING_PROPS.contains(&name)
                    && !custom_attributes.iter().any(|candidate| candidate == name)
                {
                    continue;
                }
                return match attribute.value.as_ref() {
                    None => false,
                    Some(JSXAttributeValue::StringLiteral(value)) => !value.value.trim().is_empty(),
                    Some(_) => true,
                };
            }
        }
    }
    false
}

fn has_non_empty_prop_value(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        None => false,
        Some(JSXAttributeValue::StringLiteral(value)) => !value.value.trim().is_empty(),
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            match expression.get_inner_expression() {
                Expression::StringLiteral(value) => !value.value.trim().is_empty(),
                Expression::BooleanLiteral(value) => value.value,
                Expression::NumericLiteral(value) => value.value != 0.0,
                Expression::NullLiteral(_) => false,
                Expression::TemplateLiteral(template) => {
                    static_template_value(template).is_none_or(|value| !value.trim().is_empty())
                }
                _ => true,
            }
        }
        Some(_) => true,
    }
}

fn has_non_empty_native_title(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(attribute) = opening_element
        .attributes
        .iter()
        .rev()
        .find_map(|attribute| {
            let JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
        matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(identifier) if identifier.name.eq_ignore_ascii_case("title"))
            .then_some(attribute.as_ref())
        })
    else {
        return false;
    };
    match attribute.value.as_ref() {
        None => false,
        Some(JSXAttributeValue::StringLiteral(value)) => !value.value.trim().is_empty(),
        Some(JSXAttributeValue::ExpressionContainer(container)) => container
            .expression
            .as_expression()
            .is_some_and(|expression| native_title_expression_is_non_empty(expression, ctx)),
        Some(_) => true,
    }
}

fn native_title_expression_is_non_empty(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::StringLiteral(value) => !value.value.trim().is_empty(),
        Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => true,
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => false,
        Expression::TemplateLiteral(template) => {
            static_template_value(template).is_none_or(|value| !value.trim().is_empty())
        }
        Expression::Identifier(identifier) if identifier.name == "undefined" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some(),
        Expression::Identifier(_) => true,
        Expression::UnaryExpression(unary) => !matches!(
            unary.operator,
            oxc_syntax::operator::UnaryOperator::Void
                | oxc_syntax::operator::UnaryOperator::LogicalNot
        ),
        Expression::ArrowFunctionExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ClassExpression(_) => false,
        Expression::ArrayExpression(array) => {
            static_native_title_array_value(array, ctx).is_none_or(|value| !value.trim().is_empty())
        }
        Expression::ConditionalExpression(conditional) => {
            native_title_expression_is_non_empty(&conditional.consequent, ctx)
                && native_title_expression_is_non_empty(&conditional.alternate, ctx)
        }
        Expression::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .is_some_and(|expression| native_title_expression_is_non_empty(expression, ctx)),
        Expression::LogicalExpression(logical) => {
            native_title_logical_expression_is_non_empty(logical, ctx)
        }
        expression if is_global_symbol_expression(expression, ctx) => false,
        Expression::CallExpression(call) if is_global_symbol_expression(&call.callee, ctx) => false,
        _ => true,
    }
}

fn native_title_logical_expression_is_non_empty(
    logical: &oxc_ast::ast::LogicalExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let left = logical.left.get_inner_expression();
    let static_truthiness = static_literal_truthiness(left);
    match logical.operator {
        oxc_syntax::operator::LogicalOperator::And => static_truthiness.map_or(false, |truthy| {
            native_title_expression_is_non_empty(
                if truthy {
                    &logical.right
                } else {
                    &logical.left
                },
                ctx,
            )
        }),
        oxc_syntax::operator::LogicalOperator::Or => static_truthiness.map_or(true, |truthy| {
            native_title_expression_is_non_empty(
                if truthy {
                    &logical.left
                } else {
                    &logical.right
                },
                ctx,
            )
        }),
        oxc_syntax::operator::LogicalOperator::Coalesce => {
            if matches!(left, Expression::NullLiteral(_)) {
                native_title_expression_is_non_empty(&logical.right, ctx)
            } else if static_truthiness.is_some() {
                native_title_expression_is_non_empty(&logical.left, ctx)
            } else {
                true
            }
        }
    }
}

fn static_native_title_array_value(
    array: &oxc_ast::ast::ArrayExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    let mut values = Vec::new();
    for element in &array.elements {
        match element {
            ArrayExpressionElement::Elision(_) => values.push(String::new()),
            ArrayExpressionElement::SpreadElement(_) => return None,
            element => {
                let expression = element.as_expression()?.get_inner_expression();
                let value = match expression {
                    Expression::NullLiteral(_) => String::new(),
                    Expression::StringLiteral(value) => value.value.to_string(),
                    Expression::NumericLiteral(value) => value.value.to_string(),
                    Expression::BooleanLiteral(value) => value.value.to_string(),
                    Expression::TemplateLiteral(template) => {
                        static_template_value(template)?.to_owned()
                    }
                    Expression::Identifier(identifier) if identifier.name == "undefined" => {
                        if ctx
                            .scoping()
                            .get_reference(identifier.reference_id())
                            .symbol_id()
                            .is_some()
                        {
                            return None;
                        }
                        String::new()
                    }
                    Expression::UnaryExpression(unary) if unary.operator.is_void() => String::new(),
                    Expression::ArrayExpression(nested) => {
                        static_native_title_array_value(nested, ctx)?
                    }
                    _ => return None,
                };
                values.push(value);
            }
        }
    }
    Some(values.join(","))
}

fn is_global_symbol_expression(expression: &Expression<'_>, ctx: &LintContext<'_>) -> bool {
    let identifier = match expression.get_inner_expression() {
        Expression::Identifier(identifier) => identifier,
        expression => {
            let Some(member) = expression.as_member_expression() else {
                return false;
            };
            let Expression::Identifier(identifier) = member.object().get_inner_expression() else {
                return false;
            };
            identifier
        }
    };
    identifier.name == "Symbol"
        && ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none()
}

fn input_has_default_or_value_name(
    tag_name: &str,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    if tag_name != "input" {
        return false;
    }
    let input_type = jsx_attribute(opening_element, "type")
        .and_then(get_string_literal_attribute_value)
        .map(str::to_ascii_lowercase);
    matches!(input_type.as_deref(), Some("submit" | "reset"))
        || (input_type.as_deref() == Some("button")
            && jsx_attribute(opening_element, "value").is_some_and(has_non_empty_prop_value))
}

fn supports_placeholder_name_fallback(
    tag_name: &str,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    if tag_name == "textarea" {
        return true;
    }
    if tag_name != "input" {
        return false;
    }
    jsx_attribute(opening_element, "type")
        .and_then(get_string_literal_attribute_value)
        .is_none_or(|input_type| {
            PLACEHOLDER_NAMEABLE_INPUT_TYPES
                .iter()
                .any(|candidate| input_type.eq_ignore_ascii_case(candidate))
        })
}

fn is_element_inline_hidden<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    is_hidden_from_screen_reader(ctx, opening_element)
        || hidden_attribute_is_truthy(opening_element)
        || has_static_hidden_style(opening_element)
}

fn hidden_attribute_is_truthy(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(attribute) = jsx_attribute(opening_element, "hidden") else {
        return false;
    };
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(value)) => {
            value.value != "false" && !value.value.is_empty()
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => match container
            .expression
            .as_expression()
            .map(Expression::get_inner_expression)
        {
            Some(Expression::BooleanLiteral(value)) => value.value,
            Some(Expression::StringLiteral(value)) => !value.value.is_empty(),
            Some(Expression::NumericLiteral(value)) => value.value != 0.0,
            Some(Expression::NullLiteral(_)) => false,
            _ => true,
        },
        Some(_) => true,
    }
}

fn has_static_hidden_style(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(JSXAttributeValue::ExpressionContainer(container)) =
        jsx_attribute(opening_element, "style").and_then(|attribute| attribute.value.as_ref())
    else {
        return false;
    };
    let Some(expression) = container
        .expression
        .as_expression()
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    let Expression::ObjectExpression(object) = expression else {
        return false;
    };
    object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        if property.computed {
            return false;
        }
        let Some(name) = property.key.static_name() else {
            return false;
        };
        let expected = match name.as_ref() {
            "display" => "none",
            "visibility" => "hidden",
            _ => return false,
        };
        matches!(property.value.get_inner_expression(), Expression::StringLiteral(value) if value.value == expected)
    })
}

fn is_programmatic_hidden_file_input(
    tag_name: &str,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    tag_name.eq_ignore_ascii_case("input")
        && jsx_attribute(opening_element, "type")
            .and_then(get_string_literal_attribute_value)
            .is_some_and(|value| value.eq_ignore_ascii_case("file"))
        && has_display_none_class(opening_element)
        && jsx_attribute(opening_element, "ref").is_some()
}

fn has_display_none_class(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(attribute) = jsx_attribute(opening_element, "className")
        .or_else(|| jsx_attribute(opening_element, "class"))
    else {
        return false;
    };
    if let Some(value) = get_string_literal_attribute_value(attribute) {
        return tailwind_top_level_tokens(value)
            .iter()
            .any(|token| token.eq_ignore_ascii_case("hidden"));
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = attribute.value.as_ref() else {
        return false;
    };
    let JSXExpression::TemplateLiteral(template) = &container.expression else {
        return false;
    };
    template.quasis.iter().enumerate().any(|(index, quasi)| {
        let value = quasi
            .value
            .cooked
            .as_ref()
            .map_or(quasi.value.raw.as_str(), |value| value.as_str());
        let mut tokens = tailwind_top_level_tokens(value);
        if index > 0 && !value.starts_with(char::is_whitespace) && !tokens.is_empty() {
            tokens.remove(0);
        }
        if index + 1 < template.quasis.len()
            && !value.ends_with(char::is_whitespace)
            && !tokens.is_empty()
        {
            tokens.pop();
        }
        tokens
            .iter()
            .any(|token| token.eq_ignore_ascii_case("hidden"))
    })
}

fn tailwind_top_level_tokens(value: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut depth = 0_u32;
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in value.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(character, '\'' | '"') {
            quote = Some(character);
            continue;
        }
        match character {
            '[' | '(' | '{' => depth += 1,
            ']' | ')' | '}' => depth = depth.saturating_sub(1),
            _ if depth == 0 && character.is_whitespace() => {
                if start < index {
                    tokens.push(&value[start..index]);
                }
                start = index + character.len_utf8();
            }
            _ => {}
        }
    }
    if start < value.len() {
        tokens.push(&value[start..]);
    }
    tokens
}

fn static_template_value<'a>(template: &'a oxc_ast::ast::TemplateLiteral<'a>) -> Option<&'a str> {
    if !template.expressions.is_empty() || template.quasis.len() != 1 {
        return None;
    }
    let quasi = &template.quasis[0];
    Some(
        quasi
            .value
            .cooked
            .as_ref()
            .map_or(quasi.value.raw.as_str(), |value| value.as_str()),
    )
}

fn has_accessible_label_text<'a>(
    element: &JSXElement<'a>,
    settings: &Settings,
    ctx: &LintContext<'a>,
) -> bool {
    has_labelling_prop(&element.opening_element, &settings.label_attributes)
        || element
            .children
            .iter()
            .any(|child| child_provides_label(child, 1, settings, ctx))
}

fn child_provides_label<'a>(
    child: &JSXChild<'a>,
    current_depth: usize,
    settings: &Settings,
    ctx: &LintContext<'a>,
) -> bool {
    if current_depth as f64 > settings.depth {
        return false;
    }
    match child {
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| {
                expression_provides_label(expression, current_depth, settings, ctx)
            }),
        JSXChild::Text(text) => has_letter_or_decimal_digit(text.value.as_str()),
        JSXChild::Fragment(fragment) => fragment
            .children
            .iter()
            .any(|child| child_provides_label(child, current_depth + 1, settings, ctx)),
        JSXChild::Element(element) => {
            jsx_element_provides_label(element, current_depth, settings, ctx)
        }
        JSXChild::Spread(_) => false,
    }
}

fn jsx_element_provides_label<'a>(
    element: &JSXElement<'a>,
    current_depth: usize,
    settings: &Settings,
    ctx: &LintContext<'a>,
) -> bool {
    if has_labelling_prop(&element.opening_element, &settings.label_attributes) {
        return true;
    }
    if element.children.is_empty() {
        let element_type = resolve_configured_jsx_element_type(&element.opening_element, ctx);
        if is_react_component_name(element_type.as_str())
            && !settings
                .control_components
                .iter()
                .any(|component| component == element_type.as_str())
            && !is_icon_component(&element.opening_element.name, ctx)
        {
            return true;
        }
    }
    element
        .children
        .iter()
        .any(|child| child_provides_label(child, current_depth + 1, settings, ctx))
}

fn expression_provides_label<'a>(
    expression: &Expression<'a>,
    current_depth: usize,
    settings: &Settings,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => false,
        Expression::StringLiteral(value) => has_letter_or_decimal_digit(value.value.as_str()),
        Expression::NumericLiteral(_) => true,
        Expression::BigIntLiteral(_) | Expression::RegExpLiteral(_) => false,
        Expression::TemplateLiteral(template) => {
            static_template_value(template).is_none_or(has_letter_or_decimal_digit)
        }
        Expression::ConditionalExpression(conditional) => {
            expression_provides_label(&conditional.consequent, current_depth, settings, ctx)
                || expression_provides_label(&conditional.alternate, current_depth, settings, ctx)
        }
        Expression::LogicalExpression(logical) => match logical.operator {
            oxc_syntax::operator::LogicalOperator::And => {
                expression_provides_label(&logical.right, current_depth, settings, ctx)
            }
            _ => {
                expression_provides_label(&logical.left, current_depth, settings, ctx)
                    || expression_provides_label(&logical.right, current_depth, settings, ctx)
            }
        },
        Expression::JSXElement(element) => {
            jsx_element_provides_label(element, current_depth, settings, ctx)
        }
        Expression::JSXFragment(fragment) => fragment
            .children
            .iter()
            .any(|child| child_provides_label(child, current_depth + 1, settings, ctx)),
        _ => true,
    }
}

fn has_letter_or_decimal_digit(value: &str) -> bool {
    value.chars().any(char::is_alphanumeric)
}

fn is_react_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn is_icon_component<'a>(element_name: &JSXElementName<'a>, ctx: &LintContext<'a>) -> bool {
    let Some(component_name) = jsx_element_name_trailing_segment(element_name) else {
        return false;
    };
    if component_name.ends_with("Icon")
        || component_name.strip_prefix("Icon").is_some_and(|suffix| {
            suffix.is_empty()
                || suffix.as_bytes().first().is_some_and(|byte| {
                    byte.is_ascii_uppercase() || byte.is_ascii_digit() || *byte == b'_'
                })
        })
    {
        return true;
    }
    let root_identifier = match element_name {
        JSXElementName::IdentifierReference(identifier) => identifier,
        JSXElementName::MemberExpression(member) => match &member.object {
            JSXMemberExpressionObject::IdentifierReference(identifier) => identifier,
            _ => return false,
        },
        _ => return false,
    };
    resolve_identifier_import(root_identifier, ctx)
        .is_some_and(|entry| is_icon_library_module(entry.module_request.name()))
}

fn is_icon_library_module(source: &str) -> bool {
    source == "react-icons"
        || source.starts_with("react-icons/")
        || source == "@fortawesome/react-fontawesome"
        || source
            .strip_prefix("@fortawesome/free-")
            .is_some_and(|suffix| {
                suffix
                    .split('/')
                    .next()
                    .is_some_and(|package| package.ends_with("-svg-icons"))
            })
        || ICON_LIBRARY_PACKAGES.iter().any(|package| {
            source == *package
                || source
                    .strip_prefix(package)
                    .is_some_and(|suffix| suffix.starts_with('/'))
        })
}

fn renders_label_element(
    tag_name: &str,
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    matches!(tag_name, "label" | "Label")
        || jsx_attribute(opening_element, "component").and_then(get_string_literal_attribute_value)
            == Some("label")
}

fn is_inside_jsx_attribute(node_id: oxc_semantic::NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .any(|ancestor| matches!(ancestor.kind(), AstKind::JSXAttribute(_)))
}

fn ancestor_provides_name(
    node_id: oxc_semantic::NodeId,
    settings: &Settings,
    ctx: &LintContext<'_>,
) -> bool {
    let mut crossed_function_boundary = false;
    for ancestor in ctx.nodes().ancestors(node_id) {
        if matches!(ancestor.kind(), AstKind::JSXAttribute(_)) {
            break;
        }
        if matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) {
            crossed_function_boundary = true;
            continue;
        }
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        let opening_element = &element.opening_element;
        if is_element_inline_hidden(opening_element, ctx) {
            return true;
        }
        let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
        if !crossed_function_boundary
            && renders_label_element(element_type.as_str(), opening_element)
            && has_accessible_label_text(element, settings, ctx)
        {
            return true;
        }
        if is_react_component_name(element_type.as_str())
            && jsx_attribute(opening_element, "label").is_some_and(has_non_empty_prop_value)
        {
            return true;
        }
    }
    false
}

fn enclosing_binding_name(node_id: oxc_semantic::NodeId, ctx: &LintContext<'_>) -> Option<String> {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::VariableDeclarator(declarator) => {
                return declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.name.to_string());
            }
            AstKind::Function(function) => {
                if function.is_function_declaration() {
                    return function
                        .id
                        .as_ref()
                        .map(|identifier| identifier.name.to_string());
                }
                let parent = ctx.nodes().parent_node(ancestor.id());
                let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                    return None;
                };
                return declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.name.to_string());
            }
            AstKind::ArrowFunctionExpression(_) => {
                let parent = ctx.nodes().parent_node(ancestor.id());
                let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                    return None;
                };
                return declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.name.to_string());
            }
            _ => {}
        }
    }
    None
}

fn collect_label_embedded_names(
    children: &[JSXChild<'_>],
    current_depth: usize,
    maximum_depth: f64,
    names: &mut HashSet<String>,
) {
    if current_depth as f64 > maximum_depth {
        return;
    }
    for child in children {
        match child {
            JSXChild::ExpressionContainer(container) => {
                if let Some(expression) = container.expression.as_expression() {
                    collect_embedded_names_from_expression(expression, names);
                }
            }
            JSXChild::Element(element) => collect_label_embedded_names(
                &element.children,
                current_depth + 1,
                maximum_depth,
                names,
            ),
            JSXChild::Fragment(fragment) => collect_label_embedded_names(
                &fragment.children,
                current_depth + 1,
                maximum_depth,
                names,
            ),
            _ => {}
        }
    }
}

fn collect_embedded_names_from_expression(
    expression: &Expression<'_>,
    names: &mut HashSet<String>,
) {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => {
            names.insert(identifier.name.to_string());
        }
        Expression::CallExpression(call) => {
            if let Expression::Identifier(identifier) = call.callee.get_inner_expression() {
                names.insert(identifier.name.to_string());
            }
        }
        Expression::LogicalExpression(logical) => {
            collect_embedded_names_from_expression(&logical.left, names);
            collect_embedded_names_from_expression(&logical.right, names);
        }
        Expression::ConditionalExpression(conditional) => {
            collect_embedded_names_from_expression(&conditional.consequent, names);
            collect_embedded_names_from_expression(&conditional.alternate, names);
        }
        _ => {}
    }
}

fn get_attribute_match_keys(attribute: &JSXAttribute<'_>) -> Vec<String> {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(value)) => {
            attribute_match_key("literal", value.value.as_str())
                .into_iter()
                .collect()
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => container
            .expression
            .as_expression()
            .map_or_else(Vec::new, expression_match_keys),
        _ => Vec::new(),
    }
}

fn expression_match_keys(expression: &Expression<'_>) -> Vec<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(value) => attribute_match_key("literal", value.value.as_str())
            .into_iter()
            .collect(),
        Expression::NumericLiteral(value) => {
            attribute_match_key("literal", &format_javascript_number(value.value))
                .into_iter()
                .collect()
        }
        Expression::TemplateLiteral(template) => {
            if let Some(value) = static_template_value(template) {
                return attribute_match_key("literal", value).into_iter().collect();
            }
            template_structure_match_key(template).into_iter().collect()
        }
        Expression::ConditionalExpression(conditional) => {
            let mut keys = expression_match_keys(&conditional.consequent);
            keys.extend(expression_match_keys(&conditional.alternate));
            keys
        }
        expression => expression_path_key(expression)
            .and_then(|path| attribute_match_key("identifier", &path))
            .into_iter()
            .collect(),
    }
}

fn attribute_match_key(kind: &str, value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| format!("{kind}:{value}"))
}

fn expression_path_key(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.to_string()),
        expression => {
            let member = expression.as_member_expression()?;
            let object = expression_path_key(member.object())?;
            let property = member.static_property_name()?;
            Some(format!("{object}.{property}"))
        }
    }
}

fn template_structure_match_key(template: &oxc_ast::ast::TemplateLiteral<'_>) -> Option<String> {
    let mut value = String::new();
    for (index, quasi) in template.quasis.iter().enumerate() {
        value.push_str(
            quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |value| value.as_str()),
        );
        if let Some(expression) = template.expressions.get(index) {
            value.push('\0');
            value.push_str(&expression_path_key(expression)?);
            value.push('\0');
        }
    }
    attribute_match_key("template", &value)
}
