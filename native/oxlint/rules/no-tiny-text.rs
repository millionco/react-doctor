use oxc_ast::{
    AstKind,
    ast::{Expression, JSXChild, JSXElement, JSXElementName, JSXExpression, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const NO_TINY_TEXT_THRESHOLD_PX: f64 = 12.0;
const NO_TINY_TEXT_PREFORMATTED_ELEMENTS: [&str; 15] = [
    "code", "head", "kbd", "noscript", "option", "pre", "samp", "script", "style", "sub", "sup",
    "svg", "template", "title", "var",
];
const NO_TINY_TEXT_FUNCTIONAL_ELEMENTS: [&str; 13] = [
    "a",
    "button",
    "caption",
    "dd",
    "dt",
    "figcaption",
    "footer",
    "label",
    "nav",
    "summary",
    "td",
    "th",
    "time",
];
const NO_TINY_TEXT_FUNCTIONAL_ROLES: [&str; 16] = [
    "button",
    "cell",
    "checkbox",
    "columnheader",
    "gridcell",
    "link",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "navigation",
    "option",
    "radio",
    "rowheader",
    "switch",
    "tab",
    "treeitem",
];
const NO_TINY_TEXT_FUNCTIONAL_CLASS_PREFIXES: [&str; 13] = [
    "badge",
    "breadcrumb",
    "caption",
    "category",
    "chip",
    "eyebrow",
    "kicker",
    "label",
    "meta",
    "nav",
    "pill",
    "tag",
    "timestamp",
];
const NO_TINY_TEXT_PREFORMATTED_CLASS_PREFIXES: [&str; 6] =
    ["code", "console", "diff", "editor", "syntax", "terminal"];
const NO_TINY_TEXT_VISUALLY_HIDDEN_CLASSES: [&str; 9] = [
    "a11y-hidden",
    "hidden-visually",
    "offscreen",
    "screen-reader",
    "screen-reader-only",
    "screenreader",
    "sr-only",
    "visually-hidden",
    "visuallyhidden",
];

#[derive(Debug, Default, Clone)]
pub struct NoTinyText;

declare_oxc_lint!(
    /// Disallow unreadably small interface text.
    NoTinyText,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unreadably small interface text.",
);

impl Rule for NoTinyText {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_tailwind = has_capability_or_unspecified(ctx, "tailwind");
        let mut reported_px_values = Vec::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            let mut should_skip_text = no_tiny_text_should_skip_opening_element(
                &element.opening_element,
                has_tailwind,
                ctx,
            );
            if should_skip_text {
                continue;
            }
            let mut has_functional_context =
                no_tiny_text_is_functional_context(&element.opening_element, ctx);
            for ancestor in ctx.nodes().ancestors(node.id()) {
                let AstKind::JSXElement(ancestor_element) = ancestor.kind() else {
                    continue;
                };
                if no_tiny_text_should_skip_opening_element(
                    &ancestor_element.opening_element,
                    has_tailwind,
                    ctx,
                ) {
                    should_skip_text = true;
                    break;
                }
                has_functional_context |=
                    no_tiny_text_is_functional_context(&ancestor_element.opening_element, ctx);
            }
            if should_skip_text {
                continue;
            }
            let Some(px_value) =
                get_static_effective_font_size(&element.opening_element, has_tailwind)
            else {
                continue;
            };
            if px_value <= 0.0
                || px_value >= NO_TINY_TEXT_THRESHOLD_PX
                || reported_px_values.contains(&px_value)
                || no_tiny_text_has_glyph_only_content(element)
                || no_tiny_text_has_only_icon_identifier_children(element)
                || no_tiny_text_is_childless_icon_component(element)
                || no_tiny_text_is_uppercase_tracked_micro_label(&element.opening_element)
                    && !has_functional_context
            {
                continue;
            }
            reported_px_values.push(px_value);
            let formatted_px_value = format_javascript_number(px_value);
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Your users strain to read {formatted_px_value}px text, so use at least {NO_TINY_TEXT_THRESHOLD_PX}px for readable interface text, & 16px is best."
                ))
                .with_label(element.opening_element.span),
            );
        }
    }
}

fn no_tiny_text_should_skip_opening_element<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    has_tailwind: bool,
    ctx: &LintContext<'a>,
) -> bool {
    no_tiny_text_has_unresolved_rendering_state(opening_element)
        || no_tiny_text_is_statically_non_rendered(opening_element, has_tailwind, ctx)
        || no_tiny_text_is_visually_hidden(opening_element)
        || no_tiny_text_is_preformatted_context(opening_element, ctx)
}

fn no_tiny_text_has_unresolved_rendering_state(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    has_any_jsx_spread_attribute(opening_element)
        || ["hidden", "aria-hidden"].iter().any(|attribute_name| {
            let Some(attribute) =
                get_authoritative_jsx_attribute(opening_element, attribute_name, false)
            else {
                return false;
            };
            let Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) =
                &attribute.value
            else {
                return false;
            };
            !no_tiny_text_is_static_visibility_expression(&container.expression)
        })
        || get_authoritative_jsx_attribute(opening_element, "className", true).is_some()
            && get_static_class_name(opening_element).is_none()
        || no_tiny_text_has_unresolved_inline_visibility(opening_element)
}

fn no_tiny_text_is_static_visibility_expression(expression: &JSXExpression<'_>) -> bool {
    match expression {
        JSXExpression::NullLiteral(_)
        | JSXExpression::BooleanLiteral(_)
        | JSXExpression::NumericLiteral(_)
        | JSXExpression::StringLiteral(_)
        | JSXExpression::BigIntLiteral(_)
        | JSXExpression::RegExpLiteral(_) => true,
        JSXExpression::TemplateLiteral(template) => template.expressions.is_empty(),
        _ => false,
    }
}

fn no_tiny_text_has_unresolved_inline_visibility(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", true)
    else {
        return false;
    };
    let Some(style_object) = get_inline_style_object_expression(style_attribute) else {
        return true;
    };
    if style_object.properties.iter().any(|property| {
        !matches!(property, ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some())
    }) {
        return true;
    }
    ["display", "visibility"].iter().any(|property_name| {
        get_effective_static_style_property(style_object, property_name)
            .is_some_and(|property| get_object_property_string_value(property).is_none())
    })
}

fn no_tiny_text_is_statically_non_rendered<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    has_tailwind: bool,
    ctx: &LintContext<'a>,
) -> bool {
    if get_authoritative_jsx_attribute(opening_element, "hidden", false)
        .is_some_and(|attribute| get_string_literal_attribute_value(attribute).is_some())
        || is_statically_hidden_from_screen_reader(opening_element, ctx)
    {
        return true;
    }
    if let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", true)
        && let Some(style_object) = get_inline_style_object_expression(style_attribute)
    {
        if get_effective_static_style_property(style_object, "display")
            .and_then(get_object_property_string_value)
            .is_some_and(|value| value.eq_ignore_ascii_case("none"))
        {
            return true;
        }
        if get_effective_static_style_property(style_object, "visibility")
            .and_then(get_object_property_string_value)
            .is_some_and(|value| {
                value.eq_ignore_ascii_case("hidden") || value.eq_ignore_ascii_case("collapse")
            })
        {
            return true;
        }
    }
    has_tailwind
        && get_static_class_name(opening_element)
            .and_then(get_tailwind_visibility_at_breakpoints)
            .is_some_and(|visibility| visibility.iter().all(|is_visible| !is_visible))
}

fn no_tiny_text_is_visually_hidden(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    let has_important_screen_reader_only = tokens
        .iter()
        .any(|token| token.utility == "sr-only" && token.is_important);
    let has_important_visible_override = tokens
        .iter()
        .any(|token| token.utility == "not-sr-only" && token.is_important);
    if has_important_screen_reader_only && !has_important_visible_override {
        return true;
    }
    if tokens.iter().any(|token| token.utility == "not-sr-only") {
        return false;
    }
    tokens.iter().any(|token| {
        NO_TINY_TEXT_VISUALLY_HIDDEN_CLASSES.contains(&token.utility.to_ascii_lowercase().as_str())
    })
}

fn no_tiny_text_is_preformatted_context<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some((element_name, _)) = resolve_jsx_element_type(opening_element, ctx) else {
        return false;
    };
    if NO_TINY_TEXT_PREFORMATTED_ELEMENTS.contains(&element_name.to_ascii_lowercase().as_str())
        || no_tiny_text_is_preformatted_component_name(element_name)
    {
        return true;
    }
    get_static_class_name(opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name).iter().any(|token| {
            NO_TINY_TEXT_PREFORMATTED_CLASS_PREFIXES
                .iter()
                .any(|prefix| no_tiny_text_matches_class_prefix(token.utility, prefix))
        })
    })
}

fn no_tiny_text_matches_class_prefix(utility: &str, prefix: &str) -> bool {
    utility
        .get(..prefix.len())
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(prefix))
        && utility
            .get(prefix.len()..)
            .is_some_and(|suffix| suffix.is_empty() || suffix.starts_with('-'))
}

fn no_tiny_text_is_preformatted_component_name(element_name: &str) -> bool {
    if element_name == "SyntaxHighlighter" {
        return true;
    }
    ["Code", "Console", "Diff", "Editor", "Syntax", "Terminal"]
        .iter()
        .any(|prefix| {
            element_name.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.is_empty()
                    || matches!(
                        suffix,
                        "Block" | "Output" | "Pane" | "Renderer" | "View" | "Viewer"
                    )
            })
        })
}

fn no_tiny_text_is_functional_context<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if resolve_jsx_element_type(opening_element, ctx).is_some_and(|(element_name, _)| {
        NO_TINY_TEXT_FUNCTIONAL_ELEMENTS.contains(&element_name.to_ascii_lowercase().as_str())
    }) {
        return true;
    }
    if get_authoritative_jsx_attribute(opening_element, "role", false)
        .and_then(get_string_literal_attribute_value)
        .is_some_and(|role| {
            NO_TINY_TEXT_FUNCTIONAL_ROLES.contains(&role.to_ascii_lowercase().as_str())
        })
    {
        return true;
    }
    get_static_class_name(opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name).iter().any(|token| {
            NO_TINY_TEXT_FUNCTIONAL_CLASS_PREFIXES
                .iter()
                .any(|prefix| no_tiny_text_matches_class_prefix(token.utility, prefix))
        })
    })
}

fn no_tiny_text_is_uppercase_tracked_micro_label(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    if let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", true)
        && let Some(style_object) = get_inline_style_object_expression(style_attribute)
        && get_effective_static_style_property(style_object, "textTransform")
            .and_then(get_object_property_string_value)
            == Some("uppercase")
        && no_tiny_text_has_nonzero_inline_letter_spacing(style_object)
    {
        return true;
    }
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    get_effective_tailwind_class_name_token(&tokens, |utility| {
        matches!(
            utility,
            "capitalize" | "lowercase" | "normal-case" | "uppercase"
        )
    }) == Some("uppercase")
        && get_effective_nonzero_tailwind_tracking(&tokens).is_some()
}

fn no_tiny_text_has_nonzero_inline_letter_spacing(
    style_object: &oxc_ast::ast::ObjectExpression<'_>,
) -> bool {
    let Some(property) = get_effective_static_style_property(style_object, "letterSpacing") else {
        return false;
    };
    if let Some(value) = get_static_style_property_number_value(property) {
        return value != 0.0;
    }
    let Some(value) = get_object_property_string_value(property) else {
        return false;
    };
    value != "normal"
        && no_tiny_text_parse_javascript_float_prefix(value)
            .is_some_and(|value| value.is_finite() && value != 0.0)
}

fn no_tiny_text_parse_javascript_float_prefix(value: &str) -> Option<f64> {
    let value = value.trim_start_matches(is_js_whitespace);
    let bytes = value.as_bytes();
    let mut end = usize::from(matches!(bytes.first(), Some(b'+') | Some(b'-')));
    if value[end..].starts_with("Infinity") {
        return Some(if bytes.first() == Some(&b'-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        });
    }
    let integer_digit_count = bytes[end..]
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    end += integer_digit_count;
    let mut fractional_digit_count = 0;
    if bytes.get(end) == Some(&b'.') {
        end += 1;
        fractional_digit_count = bytes[end..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        end += fractional_digit_count;
    }
    if integer_digit_count == 0 && fractional_digit_count == 0 {
        return None;
    }
    if matches!(bytes.get(end), Some(b'e') | Some(b'E')) {
        let exponent_start = end;
        end += 1;
        end += usize::from(matches!(bytes.get(end), Some(b'+') | Some(b'-')));
        let exponent_digit_count = bytes[end..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count();
        if exponent_digit_count == 0 {
            end = exponent_start;
        } else {
            end += exponent_digit_count;
        }
    }
    value[..end].parse().ok()
}

fn no_tiny_text_has_only_icon_identifier_children(element: &JSXElement<'_>) -> bool {
    let mut expression_child_count = 0;
    for child in &element.children {
        match child {
            JSXChild::Text(text) if text.value.trim().is_empty() => {}
            JSXChild::ExpressionContainer(container)
                if no_tiny_text_is_icon_identifier_jsx_expression(&container.expression) =>
            {
                expression_child_count += 1;
            }
            _ => return false,
        }
    }
    expression_child_count > 0
}

fn no_tiny_text_is_icon_identifier_jsx_expression(expression: &JSXExpression<'_>) -> bool {
    let Some(expression) = expression.as_expression() else {
        return false;
    };
    no_tiny_text_is_icon_identifier_expression(expression.get_inner_expression())
}

fn no_tiny_text_is_icon_identifier_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) => true,
        Expression::StringLiteral(literal) => literal.value.is_empty(),
        Expression::Identifier(identifier) => no_tiny_text_is_icon_name(identifier.name.as_str()),
        Expression::StaticMemberExpression(member) => {
            no_tiny_text_is_icon_name(member.property.name.as_str())
        }
        Expression::ComputedMemberExpression(member) => matches!(
            member.expression.get_inner_expression(),
            Expression::Identifier(identifier) if no_tiny_text_is_icon_name(identifier.name.as_str())
        ),
        Expression::ConditionalExpression(conditional) => {
            no_tiny_text_is_icon_identifier_expression(&conditional.consequent)
                && no_tiny_text_is_icon_identifier_expression(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            no_tiny_text_is_icon_identifier_expression(&logical.right)
        }
        _ => false,
    }
}

fn no_tiny_text_is_icon_name(name: &str) -> bool {
    name.to_ascii_lowercase().contains("icon") || name.to_ascii_lowercase().contains("glyph")
}

fn no_tiny_text_is_childless_icon_component(element: &JSXElement<'_>) -> bool {
    let element_name = match &element.opening_element.name {
        JSXElementName::Identifier(identifier) => identifier.name.as_str(),
        JSXElementName::IdentifierReference(identifier) => identifier.name.as_str(),
        _ => return false,
    };
    if !element_name
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_uppercase())
        || !no_tiny_text_is_known_icon_component_name(element_name)
    {
        return false;
    }
    element
        .children
        .iter()
        .all(|child| matches!(child, JSXChild::Text(text) if text.value.trim().is_empty()))
}

fn no_tiny_text_is_known_icon_component_name(name: &str) -> bool {
    const REACT_ICON_PREFIXES: [&str; 22] = [
        "Fa", "Md", "Io", "Bs", "Bi", "Ri", "Gi", "Hi", "Lu", "Tb", "Fi", "Ai", "Cg", "Di", "Gr",
        "Im", "Pi", "Si", "Sl", "Ti", "Vsc", "Wi",
    ];
    no_tiny_text_is_icon_name(name)
        || REACT_ICON_PREFIXES.iter().any(|prefix| {
            name.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.chars().next().is_some_and(|character| {
                    character.is_ascii_uppercase() || character.is_ascii_digit()
                })
            })
        })
}

fn no_tiny_text_has_glyph_only_content(element: &JSXElement<'_>) -> bool {
    let mut static_text = String::new();
    for child in &element.children {
        match child {
            JSXChild::Text(text) => static_text.push_str(text.value.as_str()),
            JSXChild::ExpressionContainer(container) => {
                if no_tiny_text_is_icon_identifier_jsx_expression(&container.expression) {
                    continue;
                }
                let Some(expression) = container.expression.as_expression() else {
                    return false;
                };
                let Some(expression_text) =
                    no_tiny_text_collect_static_expression_text(expression.get_inner_expression())
                else {
                    return false;
                };
                static_text.push_str(&expression_text);
            }
            _ => {}
        }
    }
    let decoded_text = no_tiny_text_decode_html_entities(static_text.trim());
    !decoded_text.is_empty() && !decoded_text.chars().any(char::is_alphanumeric)
}

fn no_tiny_text_collect_static_expression_text(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => Some(String::new()),
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::NumericLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => Some(
            template
                .quasis
                .iter()
                .map(|quasi| quasi.value.raw.as_str())
                .collect(),
        ),
        Expression::ConditionalExpression(conditional) => Some(format!(
            "{}{}",
            no_tiny_text_collect_static_expression_text(&conditional.consequent)?,
            no_tiny_text_collect_static_expression_text(&conditional.alternate)?
        )),
        Expression::LogicalExpression(logical) => {
            no_tiny_text_collect_static_expression_text(&logical.right)
        }
        _ => None,
    }
}

fn no_tiny_text_decode_html_entities(text: &str) -> String {
    let mut decoded = String::new();
    let mut remainder = text;
    while let Some(entity_start) = remainder.find('&') {
        decoded.push_str(&remainder[..entity_start]);
        remainder = &remainder[entity_start..];
        let Some(entity_end) = remainder.find(';') else {
            decoded.push_str(remainder);
            return decoded;
        };
        let entity = &remainder[1..entity_end];
        let replacement = entity
            .strip_prefix("#x")
            .or_else(|| entity.strip_prefix("#X"))
            .and_then(|digits| u32::from_str_radix(digits, 16).ok())
            .and_then(char::from_u32)
            .or_else(|| {
                entity
                    .strip_prefix('#')
                    .and_then(|digits| digits.parse::<u32>().ok())
                    .and_then(char::from_u32)
            })
            .or_else(|| no_tiny_text_named_entity(entity));
        if let Some(replacement) = replacement {
            decoded.push(replacement);
        } else {
            decoded.push_str(&remainder[..=entity_end]);
        }
        remainder = &remainder[entity_end + 1..];
    }
    decoded.push_str(remainder);
    decoded
}

fn no_tiny_text_named_entity(entity: &str) -> Option<char> {
    match entity.to_ascii_lowercase().as_str() {
        "times" => Some('×'),
        "middot" => Some('·'),
        "bull" => Some('•'),
        "hellip" => Some('…'),
        "rarr" => Some('→'),
        "larr" => Some('←'),
        "uarr" => Some('↑'),
        "darr" => Some('↓'),
        "nbsp" => Some(' '),
        "mdash" => Some('—'),
        "ndash" => Some('–'),
        "laquo" => Some('«'),
        "raquo" => Some('»'),
        "lsaquo" => Some('‹'),
        "rsaquo" => Some('›'),
        "deg" => Some('°'),
        "check" => Some('✓'),
        _ => None,
    }
}
