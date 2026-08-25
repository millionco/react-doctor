use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{
        ArrayExpressionElement, Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue,
        JSXChild, JSXElement, JSXElementName, JSXExpression, JSXFragment, JSXOpeningElement,
        ObjectExpression, ObjectProperty,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::get_element_type,
};

const MESSAGE: &str = "This content moves horizontally on an endless loop, so readers cannot control its pace. Keep it still or provide an accessible pause control.";
const MARQUEE_HORIZONTAL_TRAVEL_THRESHOLD_PERCENTAGE_POINTS: f64 = 20.0;
const LIVE_REGION_ROLES: [&str; 5] = ["alert", "log", "progressbar", "status", "timer"];
const HORIZONTAL_MOTION_PROPERTY_NAMES: [&str; 2] = ["x", "translateX"];
static MOVEMENT_CONTROL_ACTION_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u:\b(?:next|pause|play|prev|previous|resume|stop)\b)");
static MOVEMENT_CONTROL_CONTEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u:\b(?:carousel|marquee|slide|slider|ticker)\b)");
static PERCENTAGE_PATTERN: Lazy<Regex> =
    lazy_regex!(r"^(-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+))%$");

#[derive(Debug, Default, Clone)]
pub struct NoAutoScrollingContent;

declare_oxc_lint!(
    /// Disallow endless horizontal Motion tracks without an accessible movement control.
    NoAutoScrollingContent,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow endless horizontal Motion tracks without an accessible movement control.",
);

impl Rule for NoAutoScrollingContent {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        if is_inside_unresolved_or_live_region(element, node, ctx)
            || element.children.iter().any(has_unresolved_text_track_child)
            || get_static_jsx_text(element)
                .trim_matches(is_js_whitespace)
                .is_empty()
        {
            return;
        }
        let opening_element = &element.opening_element;
        let Some(animate_object) =
            get_static_motion_property_object(opening_element, "animate", ctx)
        else {
            return;
        };
        if !has_infinite_motion_repeat(opening_element, animate_object, ctx)
            || get_horizontal_travel(opening_element, animate_object, ctx).is_none_or(|travel| {
                travel < MARQUEE_HORIZONTAL_TRAVEL_THRESHOLD_PERCENTAGE_POINTS
            })
        {
            return;
        }
        let control_containers = ctx
            .nodes()
            .ancestors(node.id())
            .filter_map(|ancestor| match ancestor.kind() {
                AstKind::JSXElement(ancestor_element) => Some(ancestor_element),
                _ => None,
            })
            .take(2)
            .collect::<Vec<_>>();
        if has_pause_or_carousel_control(&control_containers, element, ctx) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn get_percentage_value(expression: &Expression<'_>) -> Option<f64> {
    let Expression::StringLiteral(string_literal) = expression else {
        return None;
    };
    let value = string_literal
        .value
        .trim_matches(|character| is_js_whitespace(character));
    PERCENTAGE_PATTERN
        .captures(value)?
        .get(1)?
        .as_str()
        .parse()
        .ok()
}

fn get_percentage_values(expression: &Expression<'_>) -> Option<Vec<f64>> {
    let Expression::ArrayExpression(array_expression) = expression else {
        return get_percentage_value(expression).map(|value| vec![value]);
    };
    let values = array_expression
        .elements
        .iter()
        .map(|element| match element {
            ArrayExpressionElement::SpreadElement(_) | ArrayExpressionElement::Elision(_) => None,
            element => element.as_expression().and_then(get_percentage_value),
        })
        .collect::<Option<Vec<_>>>()?;
    (!values.is_empty()).then_some(values)
}

fn has_infinite_motion_repeat<'a>(
    opening_element: &JSXOpeningElement<'a>,
    animate_object: &ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut transition_objects = Vec::new();
    if let Some(transition_object) =
        get_static_motion_property_object(opening_element, "transition", ctx)
    {
        transition_objects.push(transition_object);
    }
    if let Some(transition_property) =
        get_effective_static_style_property(animate_object, "transition")
        && let Expression::ObjectExpression(transition_object) = &transition_property.value
    {
        transition_objects.push(transition_object.as_ref());
    }
    transition_objects.into_iter().any(|transition_object| {
        get_effective_static_style_property(transition_object, "repeat")
            .is_some_and(|property| is_infinite_repeat_property(property, ctx))
    })
}

fn is_infinite_repeat_property(property: &ObjectProperty<'_>, ctx: &LintContext<'_>) -> bool {
    match &property.value {
        Expression::Identifier(identifier) if identifier.name == "Infinity" => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_none(),
        Expression::NumericLiteral(number_literal) => number_literal.value.is_infinite(),
        _ => false,
    }
}

fn get_horizontal_travel<'a>(
    opening_element: &JSXOpeningElement<'a>,
    animate_object: &ObjectExpression<'a>,
    ctx: &LintContext<'a>,
) -> Option<f64> {
    let initial_object = get_static_motion_property_object(opening_element, "initial", ctx);
    for property_name in HORIZONTAL_MOTION_PROPERTY_NAMES {
        let Some(animate_property) =
            get_effective_static_style_property(animate_object, property_name)
        else {
            continue;
        };
        let Some(mut percentage_values) = get_percentage_values(&animate_property.value) else {
            continue;
        };
        if percentage_values.len() == 1
            && let Some(initial_object) = initial_object
        {
            let Some(initial_property) =
                get_effective_static_style_property(initial_object, property_name)
            else {
                continue;
            };
            let Some(initial_values) = get_percentage_values(&initial_property.value) else {
                continue;
            };
            if initial_values.len() != 1 {
                continue;
            }
            percentage_values.push(initial_values[0]);
        }
        if percentage_values.len() < 2 {
            continue;
        }
        let minimum = percentage_values.iter().copied().fold(f64::INFINITY, f64::min);
        let maximum = percentage_values
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        return Some(maximum - minimum);
    }
    None
}

fn has_unresolved_text_track_child(child: &JSXChild<'_>) -> bool {
    match child {
        JSXChild::Text(_) => false,
        JSXChild::Spread(_) => true,
        JSXChild::Element(element) => has_unresolved_text_track_element(element),
        JSXChild::Fragment(fragment) => has_unresolved_text_track_fragment(fragment),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_) => false,
            expression => expression.as_expression().is_none_or(|expression| {
                has_unresolved_text_track_expression(expression)
            }),
        },
    }
}

fn has_unresolved_text_track_expression(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::StringLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_) => false,
        Expression::TemplateLiteral(template_literal) => !template_literal.expressions.is_empty(),
        Expression::JSXElement(element) => has_unresolved_text_track_element(element),
        Expression::JSXFragment(fragment) => has_unresolved_text_track_fragment(fragment),
        _ => true,
    }
}

fn has_unresolved_text_track_element(element: &JSXElement<'_>) -> bool {
    element.closing_element.is_none()
        || !matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(identifier)
                if identifier.name.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        )
        || has_jsx_spread_attribute(&element.opening_element)
        || element
            .opening_element
            .attributes
            .iter()
            .any(|attribute| match attribute {
                JSXAttributeItem::Attribute(attribute) => has_dynamic_jsx_attribute_value(attribute),
                JSXAttributeItem::SpreadAttribute(_) => false,
            })
        || element.children.iter().any(has_unresolved_text_track_child)
}

fn has_unresolved_text_track_fragment(fragment: &JSXFragment<'_>) -> bool {
    fragment.children.iter().any(has_unresolved_text_track_child)
}

fn has_dynamic_jsx_attribute_value(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        None | Some(JSXAttributeValue::StringLiteral(_)) => false,
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            let Some(expression) = container.expression.as_expression() else {
                return true;
            };
            match expression {
                Expression::StringLiteral(_)
                | Expression::BooleanLiteral(_)
                | Expression::NullLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::RegExpLiteral(_) => false,
                Expression::TemplateLiteral(template_literal) => {
                    !template_literal.expressions.is_empty()
                }
                _ => true,
            }
        }
        _ => true,
    }
}

fn has_jsx_spread_attribute(opening_element: &JSXOpeningElement<'_>) -> bool {
    opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
}

fn is_inside_unresolved_or_live_region<'a>(
    element: &JSXElement<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    has_unresolved_or_live_semantics(&element.opening_element, ctx)
        || ctx.nodes().ancestors(node.id()).any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::JSXElement(ancestor_element)
                    if has_unresolved_or_live_semantics(&ancestor_element.opening_element, ctx)
            )
        })
}

fn has_unresolved_or_live_semantics<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if has_jsx_spread_attribute(opening_element) {
        return true;
    }
    if let Some(role_attribute) = get_authoritative_jsx_attribute(opening_element, "role", false)
    {
        let Some(role_values) = get_static_jsx_attribute_string_values(role_attribute, ctx) else {
            return true;
        };
        if role_values.iter().any(|role| {
            role.split(|character| is_js_whitespace(character))
                .any(|token| {
                    LIVE_REGION_ROLES
                        .iter()
                        .any(|live_role| token.eq_ignore_ascii_case(live_role))
                })
        }) {
            return true;
        }
    }
    let Some(live_attribute) =
        get_authoritative_jsx_attribute(opening_element, "aria-live", false)
    else {
        return false;
    };
    get_static_jsx_attribute_string_values(live_attribute, ctx)
        .is_none_or(|values| values.iter().any(|value| !value.eq_ignore_ascii_case("off")))
}

fn has_pause_or_carousel_control<'a>(
    containers: &[&'a JSXElement<'a>],
    moving_element: &'a JSXElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let moving_ids = get_authoritative_jsx_attribute(
        &moving_element.opening_element,
        "id",
        false,
    )
    .and_then(|attribute| get_static_jsx_attribute_string_values(attribute, ctx))
    .unwrap_or_default();
    let mut descendants = Vec::new();
    for container in containers {
        collect_static_jsx_descendant_elements(&container.children, &mut descendants);
    }
    descendants.into_iter().any(|element| {
        let opening_element = &element.opening_element;
        if get_element_type(ctx, opening_element) != "button" {
            return false;
        }
        let mut labels = get_authoritative_jsx_attribute(opening_element, "aria-label", false)
            .and_then(|attribute| get_static_jsx_attribute_string_values(attribute, ctx))
            .unwrap_or_default();
        let visible_label = get_static_jsx_text(element)
            .trim_matches(|character| is_js_whitespace(character))
            .to_string();
        if !visible_label.is_empty() {
            labels.push(visible_label);
        }
        if !labels
            .iter()
            .any(|label| MOVEMENT_CONTROL_ACTION_PATTERN.is_match(label))
        {
            return false;
        }
        if labels
            .iter()
            .any(|label| MOVEMENT_CONTROL_CONTEXT_PATTERN.is_match(label))
        {
            return true;
        }
        let controlled_ids =
            get_authoritative_jsx_attribute(opening_element, "aria-controls", false)
                .and_then(|attribute| get_static_jsx_attribute_string_values(attribute, ctx))
                .unwrap_or_default();
        controlled_ids
            .iter()
            .any(|controlled_id| moving_ids.contains(controlled_id))
    })
}

fn collect_static_jsx_descendant_elements<'a>(
    children: &'a [JSXChild<'a>],
    descendants: &mut Vec<&'a JSXElement<'a>>,
) {
    for child in children {
        match child {
            JSXChild::Element(element) => {
                descendants.push(element);
                collect_static_jsx_descendant_elements(&element.children, descendants);
            }
            JSXChild::Fragment(fragment) => {
                collect_static_jsx_descendant_elements(&fragment.children, descendants);
            }
            _ => {}
        }
    }
}
