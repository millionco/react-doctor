use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXChild, JSXElement, JSXElementName, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};

use crate::{context::LintContext, rule::Rule};

const NUMBERED_SECTION_LABEL_MAX_CHARACTERS: usize = 40;
const NUMBERED_SECTION_LABEL_MAX_FONT_SIZE_PX: f64 = 13.0;
const NUMBERED_SECTION_LABEL_MAX_INDEX: u32 = 40;
const NUMBERED_SECTION_LABEL_MIN_FONT_WEIGHT: u32 = 600;
const NUMBERED_SECTION_LABEL_MIN_COUNT: usize = 2;
const ROOT_FONT_SIZE_PX: f64 = 16.0;
const MESSAGE: &str = "Several headings are prefixed with styled numeric labels. Keep numbering for genuinely ordered steps, not visual scaffolding.";
const NUMBERED_LABEL_ELEMENT_NAMES: [&str; 7] = ["b", "div", "em", "p", "small", "span", "strong"];
const ORDERED_CONTEXT_ELEMENT_NAMES: [&str; 14] = [
    "article", "li", "menu", "nav", "ol", "table", "tbody", "td", "tfoot", "th", "thead",
    "time", "tr", "ul",
];
const ORDERED_CONTEXT_ROLES: [&str; 5] =
    ["list", "listitem", "navigation", "progressbar", "status"];
const BOLD_FONT_CLASS_NAMES: [&str; 4] = [
    "font-black",
    "font-bold",
    "font-extrabold",
    "font-semibold",
];

static ORDERED_CONTEXT_CLASS_SEGMENT_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|[-_:])(?:calendar|card|card-item|date|day|milestone|month|progress|step|stepper|steps|timeline|year)(?:$|[-_:])"
);
static ORDERED_CONTEXT_COMPONENT_NAME_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?:Calendar|Date|Day|Milestone|Month|Progress|Step|Stepper|Timeline|Year)");
static ORDERED_CONTEXT_LABEL_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?-u:\b)(?:progress|step|steps)(?-u:\b)");
static ORDERED_HEADING_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)^(?:phase|stage|step)(?-u:\b)");
static DATE_HEADING_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)^(?:fri(?:day)?|mon(?:day)?|sat(?:urday)?|sun(?:day)?|thu(?:rsday)?|tue(?:sday)?|wed(?:nesday)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?-u:\b)"
);
static DATE_LIKE_LABEL_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?-u:\b)(?:19|20)[0-9]{2}(?-u:\b)|(?-u:\b)(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?-u:\b)|[0-9]{1,2}[./:-][0-9]{1,2}"
);
static ACCENT_TEXT_CLASS_PATTERN: Lazy<Regex> = lazy_regex!(
    r"^text-(?:amber|blue|cyan|emerald|fuchsia|green|indigo|lime|orange|pink|purple|red|rose|sky|teal|violet|yellow)-[0-9]{2,3}$"
);
static ACCENT_ARBITRARY_TEXT_CLASS_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)^text-\[(?:#|color:|hsl|oklch|rgb)");

#[derive(Debug, Default, Clone)]
pub struct NoNumberedSectionMarkers;

declare_oxc_lint!(
    /// Disallow decorative styled numbers before section headings.
    NoNumberedSectionMarkers,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow decorative styled numbers before section headings.",
);

impl Rule for NoNumberedSectionMarkers {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let has_tailwind = has_capability_or_unspecified(ctx, "tailwind");
        let mut marker_buckets = Vec::<(NodeId, Vec<(u32, Span)>)>::new();
        for node in ctx.nodes().iter() {
            let AstKind::JSXElement(element) = node.kind() else {
                continue;
            };
            let Some(index) = get_section_marker(element, node, has_tailwind, ctx) else {
                continue;
            };
            let root_id = outermost_jsx_root_id(node.id(), ctx);
            let markers = if let Some((_, markers)) = marker_buckets
                .iter_mut()
                .find(|(candidate_root_id, _)| *candidate_root_id == root_id)
            {
                markers
            } else {
                marker_buckets.push((root_id, Vec::new()));
                &mut marker_buckets.last_mut().expect("marker bucket exists").1
            };
            if let Some((_, span)) = markers
                .iter_mut()
                .find(|(candidate_index, _)| *candidate_index == index)
            {
                *span = element.opening_element.span;
            } else {
                markers.push((index, element.opening_element.span));
            }
        }
        for (_, markers) in marker_buckets {
            if markers.len() >= NUMBERED_SECTION_LABEL_MIN_COUNT {
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(markers[0].1));
            }
        }
    }
}

fn get_section_marker<'a>(
    element: &'a JSXElement<'a>,
    node: &crate::AstNode<'a>,
    has_tailwind: bool,
    ctx: &LintContext<'a>,
) -> Option<u32> {
    let JSXElementName::Identifier(element_name) = &element.opening_element.name else {
        return None;
    };
    if !NUMBERED_LABEL_ELEMENT_NAMES.contains(&element_name.name.as_str())
        || has_conditional_or_logical_ancestor(node.id(), ctx)
        || has_ordered_or_unresolved_context(node.id(), ctx)
        || has_hidden_or_unknown_ancestor(node.id(), has_tailwind, ctx)
    {
        return None;
    }
    let heading = get_following_static_heading(element, node, ctx)?;
    if has_ordered_or_unresolved_context(heading.node_id.get(), ctx)
        || has_hidden_or_unknown_ancestor(heading.node_id.get(), has_tailwind, ctx)
    {
        return None;
    }
    let label_text = fully_static_jsx_text(element)?;
    let index = parse_numbered_section_label(&label_text)?;
    let font_size = get_marker_font_size(&element.opening_element, has_tailwind, ctx)?;
    if font_size <= 0.0 || font_size > NUMBERED_SECTION_LABEL_MAX_FONT_SIZE_PX {
        return None;
    }
    (has_inline_micro_label_treatment(&element.opening_element, ctx)
        || has_tailwind && has_tailwind_micro_label_treatment(&element.opening_element))
    .then_some(index)
}

fn outermost_jsx_root_id(node_id: NodeId, ctx: &LintContext<'_>) -> NodeId {
    ctx.nodes()
        .ancestors(node_id)
        .filter(|ancestor| matches!(ancestor.kind(), AstKind::JSXElement(_) | AstKind::JSXFragment(_)))
        .map(crate::AstNode::id)
        .last()
        .unwrap_or(node_id)
}

fn has_conditional_or_logical_ancestor(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node_id).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::ConditionalExpression(_) | AstKind::LogicalExpression(_)
        )
    })
}

fn get_following_static_heading<'a>(
    element: &'a JSXElement<'a>,
    node: &crate::AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a JSXElement<'a>> {
    let sibling = get_next_static_jsx_element_sibling(element, node, ctx)?;
    let heading = get_heading_from_element(sibling)?;
    let heading_text = normalize_static_jsx_whitespace(&fully_static_jsx_text(heading)?);
    if heading_text.is_empty()
        || ORDERED_HEADING_PATTERN.is_match(&heading_text)
        || DATE_HEADING_PATTERN.is_match(&heading_text)
    {
        return None;
    }
    Some(heading)
}

fn get_heading_from_element<'a>(element: &'a JSXElement<'a>) -> Option<&'a JSXElement<'a>> {
    let JSXElementName::Identifier(element_name) = &element.opening_element.name else {
        return None;
    };
    if matches!(element_name.name.as_str(), "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
        return Some(element);
    }
    if !matches!(element_name.name.as_str(), "div" | "header") {
        return None;
    }
    for child in &element.children {
        match child {
            JSXChild::Text(text) if text.value.chars().all(is_js_whitespace) => {}
            JSXChild::ExpressionContainer(container)
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) => {}
            JSXChild::Element(child_element) => return get_heading_from_element(child_element),
            _ => return None,
        }
    }
    None
}

fn fully_static_jsx_text(element: &JSXElement<'_>) -> Option<String> {
    fully_static_jsx_children_text(&element.children)
}

fn fully_static_jsx_children_text(children: &[JSXChild<'_>]) -> Option<String> {
    children
        .iter()
        .map(fully_static_jsx_child_text)
        .collect::<Option<Vec<_>>>()
        .map(|parts| parts.concat())
}

fn fully_static_jsx_child_text(child: &JSXChild<'_>) -> Option<String> {
    match child {
        JSXChild::Text(text) => Some(text.value.to_string()),
        JSXChild::Element(element) => fully_static_jsx_text(element),
        JSXChild::Fragment(fragment) => fully_static_jsx_children_text(&fragment.children),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_) => Some(String::new()),
            expression => fully_static_expression_text(expression.as_expression()?),
        },
        _ => None,
    }
}

fn fully_static_expression_text(expression: &Expression<'_>) -> Option<String> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::NumericLiteral(literal) => Some(literal.value.to_string()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => Some(
            template
                .quasis
                .iter()
                .map(|quasi| quasi.value.raw.as_str())
                .collect(),
        ),
        Expression::JSXElement(element) => fully_static_jsx_text(element),
        Expression::JSXFragment(fragment) => fully_static_jsx_children_text(&fragment.children),
        _ => None,
    }
}

fn parse_numbered_section_label(text: &str) -> Option<u32> {
    let normalized_text = normalize_static_jsx_whitespace(text);
    if normalized_text.is_empty()
        || normalized_text.encode_utf16().count() > NUMBERED_SECTION_LABEL_MAX_CHARACTERS
        || DATE_LIKE_LABEL_PATTERN.is_match(&normalized_text)
    {
        return None;
    }
    let bytes = normalized_text.as_bytes();
    let digit_count = bytes.iter().take_while(|byte| byte.is_ascii_digit()).count();
    let is_bare_label = digit_count == 2 && digit_count == bytes.len();
    let is_compound_label = if matches!(digit_count, 1 | 2) {
        let remainder = normalized_text[digit_count..].trim_start();
        remainder
            .chars()
            .next()
            .filter(|delimiter| matches!(delimiter, '/' | '|' | '·' | '•' | '—' | '–'))
            .and_then(|delimiter| remainder[delimiter.len_utf8()..].trim_start().chars().next())
            .is_some_and(char::is_alphabetic)
    } else {
        false
    };
    if !is_bare_label && !is_compound_label {
        return None;
    }
    let index = normalized_text[..digit_count].parse::<u32>().ok()?;
    (index > 0 && index <= NUMBERED_SECTION_LABEL_MAX_INDEX).then_some(index)
}

fn has_ordered_or_unresolved_context(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .filter_map(|ancestor| match ancestor.kind() {
            AstKind::JSXElement(element) => Some(&element.opening_element),
            _ => None,
        })
        .any(|opening_element| {
            if has_jsx_spread_attribute(opening_element) {
                return true;
            }
            if let JSXElementName::Identifier(element_name) = &opening_element.name
                && (ORDERED_CONTEXT_ELEMENT_NAMES.contains(&element_name.name.as_str())
                    || ORDERED_CONTEXT_COMPONENT_NAME_PATTERN.is_match(element_name.name.as_str()))
            {
                return true;
            }
            if attribute_is_unresolved(opening_element, "role") {
                return true;
            }
            if get_static_attribute_value(opening_element, "role")
                .is_some_and(|role| ORDERED_CONTEXT_ROLES.contains(&role.to_ascii_lowercase().as_str()))
                || get_authoritative_jsx_attribute(opening_element, "dateTime", false).is_some()
            {
                return true;
            }
            if attribute_is_unresolved(opening_element, "aria-label") {
                return true;
            }
            if get_static_attribute_value(opening_element, "aria-label")
                .is_some_and(|label| ORDERED_CONTEXT_LABEL_PATTERN.is_match(label))
            {
                return true;
            }
            let class_name_attribute =
                get_authoritative_jsx_attribute(opening_element, "className", true);
            let class_name = get_static_class_name(opening_element);
            class_name_attribute.is_some() && class_name.is_none()
                || class_name.is_some_and(|value| {
                    ORDERED_CONTEXT_CLASS_SEGMENT_PATTERN.is_match(value)
                })
        })
}

fn has_hidden_or_unknown_ancestor(
    node_id: NodeId,
    has_tailwind: bool,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.nodes()
        .ancestors(node_id)
        .filter_map(|ancestor| match ancestor.kind() {
            AstKind::JSXElement(element) => Some(&element.opening_element),
            _ => None,
        })
        .any(|opening_element| {
            if has_jsx_spread_attribute(opening_element)
                || attribute_is_unresolved(opening_element, "hidden")
                || attribute_is_unresolved(opening_element, "aria-hidden")
                || is_statically_hidden_from_screen_reader(opening_element, ctx)
            {
                return true;
            }
            let class_name_attribute =
                get_authoritative_jsx_attribute(opening_element, "className", true);
            let class_name = get_static_class_name(opening_element);
            if class_name_attribute.is_some() && class_name.is_none() {
                return true;
            }
            let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true);
            if let Some(style_attribute) = style_attribute {
                let Some(style_object) =
                    get_inline_style_object_expression_with_aliases(style_attribute, ctx)
                else {
                    return true;
                };
                if style_object.properties.iter().any(|property| {
                    !matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some())
                }) {
                    return true;
                }
                for property_name in ["display", "visibility"] {
                    if let Some(property) =
                        get_effective_static_style_property(style_object, property_name)
                    {
                        let Some(value) = object_property_string_value(property) else {
                            return true;
                        };
                        if value.eq_ignore_ascii_case("none")
                            || value.eq_ignore_ascii_case("hidden")
                            || value.eq_ignore_ascii_case("collapse")
                        {
                            return true;
                        }
                    }
                }
            }
            has_tailwind
                && class_name.is_some_and(|value| {
                    get_tailwind_visibility_at_breakpoints(value)
                        .is_none_or(|visibility| visibility.iter().all(|is_visible| !is_visible))
                })
        })
}

fn has_jsx_spread_attribute(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
}

fn attribute_is_unresolved(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    attribute_name: &str,
) -> bool {
    let Some(attribute) =
        get_authoritative_jsx_attribute(opening_element, attribute_name, false)
    else {
        return false;
    };
    match attribute.value.as_ref() {
        None | Some(oxc_ast::ast::JSXAttributeValue::StringLiteral(_)) => false,
        Some(oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container)) => {
            !matches!(
                container.expression.as_expression().map(Expression::get_inner_expression),
                Some(
                    Expression::StringLiteral(_)
                        | Expression::NumericLiteral(_)
                        | Expression::BooleanLiteral(_)
                        | Expression::NullLiteral(_)
                )
            )
        }
        _ => true,
    }
}

fn get_static_attribute_value<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    attribute_name: &str,
) -> Option<&'a str> {
    get_authoritative_jsx_attribute(opening_element, attribute_name, false)
        .and_then(get_string_literal_attribute_value)
}

fn get_marker_font_size<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    has_tailwind: bool,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    let class_name = get_static_class_name(opening_element);
    let tailwind_font_size = has_tailwind
        .then(|| class_name.and_then(|class_name| get_static_tailwind_font_size(class_name)))
        .flatten();
    if has_tailwind
        && class_name.is_some_and(|class_name| has_important_tailwind_font_size(class_name))
    {
        return tailwind_font_size;
    }
    let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", true)
    else {
        return tailwind_font_size;
    };
    let style_object = get_inline_style_object_expression_with_aliases(style_attribute, ctx)?;
    if let Some(font_size_property) =
        get_effective_static_style_property(style_object, "fontSize")
    {
        return get_static_style_property_number_value(font_size_property)
            .or_else(|| parse_font_size_string(object_property_string_value(font_size_property)?));
    }
    style_object
        .properties
        .iter()
        .all(|property| matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some()))
        .then_some(tailwind_font_size)
        .flatten()
}

fn parse_font_size_string(value: &str) -> Option<f64> {
    let value = value.trim_matches(is_js_whitespace);
    let (number, multiplier) = value
        .strip_suffix("px")
        .map(|number| (number, 1.0))
        .or_else(|| {
            value
                .strip_suffix("rem")
                .map(|number| (number, ROOT_FONT_SIZE_PX))
        })?;
    if !is_unsigned_decimal_literal(number) {
        return None;
    }
    number.parse::<f64>().ok().map(|number| number * multiplier)
}

fn has_important_tailwind_font_size(class_name: &str) -> bool {
    tailwind_class_name_tokens(class_name).iter().any(|token| {
        token.variants.is_empty()
            && token.is_important
            && parse_static_tailwind_font_size(token.utility).is_some()
    })
}

fn has_inline_micro_label_treatment<'a>(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", true)
    else {
        return false;
    };
    let Some(style_object) =
        get_inline_style_object_expression_with_aliases(style_attribute, ctx)
    else {
        return false;
    };
    if get_effective_static_style_property(style_object, "fontFamily")
        .and_then(object_property_string_value)
        .is_some_and(|value| value.to_ascii_lowercase().contains("mono"))
    {
        return true;
    }
    if let Some(font_weight) = get_effective_static_style_property(style_object, "fontWeight") {
        let string_value = object_property_string_value(font_weight);
        if get_static_style_property_number_value(font_weight)
            .is_some_and(|value| value >= f64::from(NUMBERED_SECTION_LABEL_MIN_FONT_WEIGHT))
            || string_value.is_some_and(|value| {
                javascript_integer_prefix_is_at_least(
                    value,
                    NUMBERED_SECTION_LABEL_MIN_FONT_WEIGHT,
                )
            })
            || string_value.is_some_and(|value| {
                value.eq_ignore_ascii_case("bold") || value.eq_ignore_ascii_case("bolder")
            })
        {
            return true;
        }
    }
    if let Some(letter_spacing) = get_effective_static_style_property(style_object, "letterSpacing")
    {
        let value = get_static_style_property_number_value(letter_spacing).or_else(|| {
            object_property_string_value(letter_spacing)
                .and_then(parse_javascript_float_prefix_value)
        });
        if value.is_some_and(|value| value > 0.0) {
            return true;
        }
    }
    get_effective_static_style_property(style_object, "textTransform")
        .and_then(object_property_string_value)
        .is_some_and(|value| value.eq_ignore_ascii_case("uppercase"))
}

fn has_tailwind_micro_label_treatment(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    tailwind_class_name_tokens(class_name).iter().any(|token| {
        token.variants.is_empty()
            && (token.utility == "font-mono"
                || token.utility == "uppercase"
                || BOLD_FONT_CLASS_NAMES.contains(&token.utility)
                || token.utility.starts_with("tracking-") && token.utility != "tracking-normal"
                || ACCENT_TEXT_CLASS_PATTERN.is_match(token.utility)
                || ACCENT_ARBITRARY_TEXT_CLASS_PATTERN.is_match(token.utility))
    })
}

fn object_property_string_value<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    let Expression::StringLiteral(literal) = &property.value else {
        return None;
    };
    Some(literal.value.as_str())
}

fn javascript_integer_prefix_is_at_least(value: &str, minimum: u32) -> bool {
    let value = value.trim_start_matches(is_js_whitespace);
    let value = value.strip_prefix('+').unwrap_or(value);
    if value.starts_with('-') {
        return false;
    }
    let digit_count = value
        .bytes()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    if digit_count == 0 {
        return false;
    }
    let significant_digits = value[..digit_count].trim_start_matches('0');
    if significant_digits.is_empty() {
        return minimum == 0;
    }
    significant_digits
        .parse::<u32>()
        .map_or(true, |parsed_value| parsed_value >= minimum)
}

fn parse_javascript_float_prefix_value(value: &str) -> Option<f64> {
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
