use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXAttributeValue, JSXChild},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

#[derive(Debug, Default, Clone)]
pub struct NoShapeAssembledIllustration;
declare_oxc_lint!(
    /// Disallow large illustrations assembled from primitive SVG shapes.
    NoShapeAssembledIllustration,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow large illustrations assembled from primitive SVG shapes."
);

#[derive(Default)]
struct ShapeIllustrationEvidence {
    fills: Vec<String>,
    text_count: usize,
    has_pattern: bool,
}

impl Rule for NoShapeAssembledIllustration {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if no_shape_name(&element.opening_element) != Some("svg") {
            return;
        }
        let Some((width, height)) = no_shape_dimensions(&element.opening_element, ctx) else {
            return;
        };
        if width < 200.0 || height < 200.0 {
            return;
        }
        let mut evidence = ShapeIllustrationEvidence::default();
        if !no_shape_collect(element, ctx, false, &mut evidence)
            || evidence.has_pattern
            || evidence.text_count > 2
            || evidence.fills.len() < 8
        {
            return;
        }
        let distinct = evidence
            .fills
            .iter()
            .collect::<rustc_hash::FxHashSet<_>>()
            .len();
        if distinct < 3 {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(format!("This {:.0}×{:.0} SVG assembles a large illustration from {} basic shapes and {distinct} fills. Use deliberate artwork instead of placeholder clip art.", width.round(), height.round(), evidence.fills.len())).with_label(element.opening_element.span));
    }
}
fn no_shape_name<'a>(opening: &'a oxc_ast::ast::JSXOpeningElement<'a>) -> Option<&'a str> {
    match &opening.name {
        oxc_ast::ast::JSXElementName::Identifier(identifier) => Some(identifier.name.as_str()),
        _ => None,
    }
}
fn no_shape_number(value: Option<&JSXAttributeValue<'_>>) -> Option<f64> {
    let expression = match value? {
        JSXAttributeValue::StringLiteral(value) => {
            return no_shape_parse_unsigned_dimension(value.value.as_str());
        }
        JSXAttributeValue::ExpressionContainer(container) => {
            container.expression.as_expression()?.get_inner_expression()
        }
        _ => return None,
    };
    match expression {
        Expression::NumericLiteral(value) => value.value.is_finite().then_some(value.value),
        Expression::StringLiteral(value) => no_shape_parse_unsigned_dimension(value.value.as_str()),
        _ => None,
    }
}
fn no_shape_parse_unsigned_dimension(value: &str) -> Option<f64> {
    let normalized = value.trim().to_ascii_lowercase();
    let number = normalized.strip_suffix("px").unwrap_or(&normalized);
    let mut exponent_parts = number.split('e');
    let mantissa = exponent_parts.next()?;
    let exponent = exponent_parts.next();
    if exponent_parts.next().is_some()
        || exponent.is_some_and(|exponent| {
            let digits = exponent
                .strip_prefix('+')
                .or_else(|| exponent.strip_prefix('-'))
                .unwrap_or(exponent);
            digits.is_empty() || !digits.chars().all(|character| character.is_ascii_digit())
        })
    {
        return None;
    }
    let mut decimal_parts = mantissa.split('.');
    let whole = decimal_parts.next()?;
    let fraction = decimal_parts.next();
    if decimal_parts.next().is_some()
        || whole.is_empty() && fraction.is_none_or(str::is_empty)
        || !whole.chars().all(|character| character.is_ascii_digit())
        || fraction
            .is_some_and(|fraction| !fraction.chars().all(|character| character.is_ascii_digit()))
    {
        return None;
    }
    number
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite())
}
fn no_shape_dimensions<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<(f64, f64)> {
    if opening
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
    {
        return None;
    }
    if let Some(attribute) = get_authoritative_jsx_attribute(opening, "style", true) {
        let style = get_inline_style_object_expression_with_aliases(attribute, ctx)?;
        if ["width", "height", "maxWidth", "maxHeight"]
            .iter()
            .any(|name| get_effective_static_style_property(style, name).is_some())
        {
            return None;
        }
    }
    if get_authoritative_jsx_attribute(opening, "className", true).is_some() {
        let class_name = get_static_class_name(opening)?;
        if {
            tailwind_class_name_tokens(class_name).iter().any(|token| {
                token.utility.starts_with("size-")
                    || token.utility.starts_with("w-")
                    || token.utility.starts_with("h-")
                    || token.utility.starts_with("max-w-")
                    || token.utility.starts_with("max-h-")
                    || token.utility.starts_with("[width:")
                    || token.utility.starts_with("[height:")
                    || token.utility.starts_with("[max-width:")
                    || token.utility.starts_with("[max-height:")
            })
        } {
            return None;
        }
    }
    let width = no_shape_number(
        get_authoritative_jsx_attribute(opening, "width", true)?
            .value
            .as_ref(),
    )?;
    let height = no_shape_number(
        get_authoritative_jsx_attribute(opening, "height", true)?
            .value
            .as_ref(),
    )?;
    (width > 0.0 && height > 0.0).then_some((width, height))
}
fn no_shape_string(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> Option<String> {
    if let Some(value) = get_string_literal_attribute_value(attribute) {
        return Some(value.to_string());
    }
    let JSXAttributeValue::ExpressionContainer(container) = attribute.value.as_ref()? else {
        return None;
    };
    container
        .expression
        .as_expression()
        .and_then(|expression| get_static_string_expression(expression))
        .map(str::to_string)
}
fn no_shape_fill<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<String> {
    if opening
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
    {
        return None;
    }
    let value = if let Some(attribute) = get_authoritative_jsx_attribute(opening, "style", true) {
        let style = get_inline_style_object_expression_with_aliases(attribute, ctx)?;
        if let Some(property) = get_effective_static_style_property(style, "fill") {
            get_object_property_string_value(property).map(str::to_string)
        } else {
            if style.properties.iter().any(|property| !matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some())) { return None; }
            get_authoritative_jsx_attribute(opening, "fill", true).and_then(no_shape_string)
        }
    } else {
        get_authoritative_jsx_attribute(opening, "fill", true).and_then(no_shape_string)
    };
    let normalized = value?.trim().to_ascii_lowercase();
    if matches!(
        normalized.as_str(),
        "none" | "transparent" | "currentcolor" | "inherit" | "context-fill" | "context-stroke"
    ) || normalized.starts_with("var(")
    {
        return None;
    }
    let parsed = parse_color_to_rgb(if normalized == "white" {
        "#fff"
    } else if normalized == "black" {
        "#000"
    } else {
        &normalized
    })?;
    let alpha = if normalized.starts_with('#') && normalized.len() == 5 {
        u8::from_str_radix(&normalized[4..], 16).ok()? as f64 / 15.0
    } else if normalized.starts_with('#') && normalized.len() == 9 {
        u8::from_str_radix(&normalized[7..], 16).ok()? as f64 / 255.0
    } else if normalized.starts_with("rgb(")
        || normalized.starts_with("rgba(")
        || normalized.starts_with("hsl(")
        || normalized.starts_with("hsla(")
    {
        no_shape_function_alpha(&normalized)?
    } else {
        1.0
    };
    (alpha > 0.0
        && [parsed.red, parsed.green, parsed.blue].iter().all(|value| {
            value.is_finite() && value.fract() == 0.0 && (0.0..=255.0).contains(value)
        }))
    .then(|| format!("{},{},{}", parsed.red, parsed.green, parsed.blue))
}
fn no_shape_hidden<'a>(
    opening: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    if opening
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
    {
        return None;
    }
    if let Some(attribute) = get_authoritative_jsx_attribute(opening, "hidden", false) {
        let hidden = match attribute.value.as_ref() {
            None => true,
            Some(JSXAttributeValue::StringLiteral(_)) => true,
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                match container.expression.as_expression()?.get_inner_expression() {
                    Expression::BooleanLiteral(value) => value.value,
                    Expression::NullLiteral(_) => false,
                    Expression::StringLiteral(_)
                    | Expression::NumericLiteral(_)
                    | Expression::BigIntLiteral(_)
                    | Expression::RegExpLiteral(_) => true,
                    _ => return None,
                }
            }
            _ => return None,
        };
        if hidden {
            return Some(true);
        }
    }
    for name in ["display", "visibility"] {
        if let Some(attribute) = get_authoritative_jsx_attribute(opening, name, false) {
            let value = no_shape_string(attribute)?;
            if matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "none" | "hidden" | "collapse"
            ) {
                return Some(true);
            }
        }
    }
    if let Some(attribute) = get_authoritative_jsx_attribute(opening, "opacity", false) {
        let opacity = no_shape_number(attribute.value.as_ref())?;
        if opacity == 0.0 {
            return Some(true);
        }
    }
    if let Some(style_attribute) = get_authoritative_jsx_attribute(opening, "style", true) {
        let style = get_inline_style_object_expression_with_aliases(style_attribute, ctx)?;
        if style.properties.iter().any(|property| !matches!(property, oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some())) { return None; }
        for name in ["display", "visibility"] {
            if let Some(property) = get_effective_static_style_property(style, name) {
                let value = get_object_property_string_value(property)?;
                if matches!(
                    value.trim().to_ascii_lowercase().as_str(),
                    "none" | "hidden" | "collapse"
                ) {
                    return Some(true);
                }
            }
        }
        if let Some(property) = get_effective_static_style_property(style, "opacity") {
            let opacity = get_static_style_property_number_value(property)
                .or_else(|| get_object_property_string_value(property)?.trim().parse().ok())?;
            if opacity == 0.0 {
                return Some(true);
            }
        }
    }
    if get_authoritative_jsx_attribute(opening, "className", true).is_some() {
        let class_name = get_static_class_name(opening)?;
        let visibility = get_tailwind_visibility_at_breakpoints(class_name)?;
        if visibility.iter().all(|value| !value) {
            return Some(true);
        }
    }
    Some(false)
}
fn no_shape_function_alpha(value: &str) -> Option<f64> {
    let contents = get_css_function_contents(value)?;
    let slash = split_css_top_level(contents, '/')?;
    let alpha = if slash.len() == 2 {
        no_shape_alpha(slash[1])?
    } else if slash.len() == 1 {
        let comma = split_css_top_level(contents, ',')?;
        if comma.len() == 4 {
            no_shape_alpha(comma[3])?
        } else {
            1.0
        }
    } else {
        return None;
    };
    Some(alpha)
}
fn no_shape_alpha(value: &str) -> Option<f64> {
    let value = value.trim();
    let (number, divisor) = value
        .strip_suffix('%')
        .map_or((value, 1.0), |value| (value, 100.0));
    let alpha = number.parse::<f64>().ok()? / divisor;
    (alpha.is_finite() && (0.0..=1.0).contains(&alpha)).then_some(alpha)
}
fn no_shape_empty_expression(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => true,
        Expression::StringLiteral(value) => value.value.trim().is_empty(),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
            template.quasis.first().is_some_and(|quasi| {
                quasi
                    .value
                    .cooked
                    .as_ref()
                    .map_or(quasi.value.raw.as_str(), |value| value.as_str())
                    .trim()
                    .is_empty()
            })
        }
        _ => false,
    }
}
fn no_shape_collect<'a>(
    element: &'a oxc_ast::ast::JSXElement<'a>,
    ctx: &LintContext<'a>,
    excluded: bool,
    evidence: &mut ShapeIllustrationEvidence,
) -> bool {
    let Some(name) = no_shape_name(&element.opening_element) else {
        return false;
    };
    if !is_svg_tag_name(name) {
        return false;
    }
    let Some(hidden) = no_shape_hidden(&element.opening_element, ctx) else {
        return false;
    };
    let excluded =
        excluded || hidden || matches!(name, "defs" | "symbol" | "mask" | "clipPath" | "pattern");
    if name == "pattern" {
        evidence.has_pattern = true;
    }
    if !excluded && matches!(name, "text" | "tspan") {
        evidence.text_count += 1;
    }
    if !excluded && matches!(name, "rect" | "circle" | "ellipse" | "polygon") {
        if let Some(fill) = no_shape_fill(&element.opening_element, ctx) {
            evidence.fills.push(fill);
        }
    }
    for child in &element.children {
        match child {
            JSXChild::Text(_) => {}
            JSXChild::Element(child) => {
                if !no_shape_collect(child, ctx, excluded, evidence) {
                    return false;
                }
            }
            JSXChild::ExpressionContainer(container) => {
                if container
                    .expression
                    .as_expression()
                    .is_some_and(|expression| !no_shape_empty_expression(expression))
                {
                    return false;
                }
            }
            _ => return false,
        }
    }
    true
}
