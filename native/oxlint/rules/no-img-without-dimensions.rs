use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
};

use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXChild, JSXExpression,
        JSXOpeningElement, ObjectPropertyKind,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This image reserves no dimensions or aspect ratio before loading, so surrounding content can shift. Add width and height or an explicit aspect-ratio box.";

#[derive(Debug, Default, Clone)]
pub struct NoImgWithoutDimensions;

declare_oxc_lint!(
    /// Require images to reserve layout space before loading.
    NoImgWithoutDimensions,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Require images to reserve layout space before loading.",
);

impl Rule for NoImgWithoutDimensions {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_generated_image_render_filename(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let generated_image_ids = generated_image_jsx_opening_element_ids(ctx);
        let has_tailwind = has_capability_or_unspecified(ctx, "tailwind");
        let mut external_css = None;
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if generated_image_ids.contains(&node.id())
                || resolve_jsx_element_type(opening_element, ctx).map(|(name, _)| name)
                    != Some("img")
                || has_jsx_spread(opening_element)
                || is_statically_non_rendered(opening_element, has_tailwind)
            {
                continue;
            }
            let class_name = get_static_class_name(opening_element);
            if !has_tailwind && class_name.is_some() {
                continue;
            }
            if has_reserved_image_box(opening_element, has_tailwind, ctx)
                || has_reserved_parent_box(node.id(), has_tailwind, ctx)
            {
                continue;
            }
            let external_css = external_css.get_or_insert_with(|| StaticCssResolver::new(ctx));
            if has_reserved_external_css_box(node.id(), opening_element, external_css, ctx)
                || has_unresolved_box(opening_element, has_tailwind, ctx)
                || has_unresolved_parent_box(node.id(), has_tailwind, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
        }
    }
}

#[derive(Default)]
struct ReservedBoxEvidence {
    has_aspect_ratio: bool,
    has_height: bool,
    has_width: bool,
}

#[derive(Default, Clone)]
struct ExternalCssBoxEvidence {
    has_aspect_ratio: bool,
    has_height: bool,
    has_width: bool,
    height_reserves_with_parent: bool,
    width_reserves_with_parent: bool,
}

#[derive(Default, Clone, Copy)]
struct ParentBoxAxes {
    has_height: bool,
    has_width: bool,
}

fn has_reserved_image_box(
    opening_element: &JSXOpeningElement<'_>,
    has_tailwind: bool,
    ctx: &LintContext<'_>,
) -> bool {
    let mut evidence = ReservedBoxEvidence::default();
    if let Some(width) = get_authoritative_jsx_attribute(opening_element, "width", false) {
        evidence.has_width = dimension_attribute_reserves_space(width, ctx);
    }
    if let Some(height) = get_authoritative_jsx_attribute(opening_element, "height", false) {
        evidence.has_height = dimension_attribute_reserves_space(height, ctx);
    }
    let mut inline_evidence = ReservedBoxEvidence::default();
    merge_inline_box_evidence(opening_element, &mut inline_evidence, ctx);
    if !has_tailwind {
        evidence.has_aspect_ratio |= inline_evidence.has_aspect_ratio;
        evidence.has_height |= inline_evidence.has_height;
        evidence.has_width |= inline_evidence.has_width;
    } else if let Some(class_name) = get_static_class_name(opening_element) {
        let tokens = tailwind_class_name_tokens(class_name);
        let aspect_ratio =
            resolve_effective_box_utility(&tokens, |utility| utility.starts_with("aspect-"));
        let width = resolve_effective_box_utility(&tokens, |utility| {
            utility.starts_with("size-") || utility.starts_with("w-")
        });
        let height = resolve_effective_box_utility(&tokens, |utility| {
            utility.starts_with("size-") || utility.starts_with("h-")
        });
        evidence.has_aspect_ratio |= aspect_ratio
            .utility
            .is_some_and(tailwind_aspect_ratio_reserves_space)
            || !aspect_ratio.is_important && inline_evidence.has_aspect_ratio;
        evidence.has_width |= width
            .utility
            .is_some_and(|utility| tailwind_dimension_reserves_space(utility, false))
            || !width.is_important && inline_evidence.has_width;
        evidence.has_height |= height
            .utility
            .is_some_and(|utility| tailwind_dimension_reserves_space(utility, true))
            || !height.is_important && inline_evidence.has_height;
    } else {
        evidence.has_aspect_ratio |= inline_evidence.has_aspect_ratio;
        evidence.has_height |= inline_evidence.has_height;
        evidence.has_width |= inline_evidence.has_width;
    }
    evidence_reserves_box(&evidence, false)
}

#[derive(Default)]
struct EffectiveBoxUtility<'a> {
    utility: Option<&'a str>,
    is_important: bool,
    is_ambiguous: bool,
}

fn resolve_effective_box_utility<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    predicate: impl Fn(&str) -> bool,
) -> EffectiveBoxUtility<'a> {
    let applicable = tokens
        .iter()
        .filter(|token| token.variants.is_empty() && predicate(token.utility))
        .collect::<Vec<_>>();
    let is_important = applicable.iter().any(|token| token.is_important);
    let mut utility = None;
    let mut is_ambiguous = false;
    for token in applicable {
        if is_important && !token.is_important {
            continue;
        }
        if utility.is_some_and(|previous| previous != token.utility) {
            is_ambiguous = true;
            utility = None;
            break;
        }
        utility = Some(token.utility);
    }
    EffectiveBoxUtility {
        utility,
        is_important,
        is_ambiguous,
    }
}

fn dimension_attribute_reserves_space(attribute: &JSXAttribute<'_>, ctx: &LintContext<'_>) -> bool {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(literal)) => {
            let value = literal.value.trim();
            !value.is_empty()
                && value.chars().all(|character| character.is_ascii_digit())
                && value.parse::<f64>().is_ok_and(|value| value > 0.0)
        }
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::NumericLiteral(literal) => {
                literal.value.is_finite() && literal.value > 0.0
            }
            JSXExpression::StringLiteral(literal) => {
                let value = literal.value.trim();
                !value.is_empty()
                    && value.chars().all(|character| character.is_ascii_digit())
                    && value.parse::<f64>().is_ok_and(|value| value > 0.0)
            }
            JSXExpression::BooleanLiteral(_)
            | JSXExpression::NullLiteral(_)
            | JSXExpression::EmptyExpression(_) => false,
            JSXExpression::Identifier(identifier)
                if matches!(identifier.name.as_str(), "Infinity" | "NaN" | "undefined")
                    && ctx.is_reference_to_global_variable(identifier) =>
            {
                false
            }
            JSXExpression::UnaryExpression(unary) if unary.operator.is_void() => false,
            JSXExpression::UnaryExpression(unary) => {
                if let Some(value) = static_positive_number(&unary.argument) {
                    return match unary.operator {
                        oxc_syntax::operator::UnaryOperator::UnaryPlus => value > 0.0,
                        oxc_syntax::operator::UnaryOperator::UnaryNegation => -value > 0.0,
                        _ => true,
                    };
                }
                !matches!(
                    unary.operator,
                    oxc_syntax::operator::UnaryOperator::UnaryPlus
                        | oxc_syntax::operator::UnaryOperator::UnaryNegation
                ) || !matches!(unary.argument.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "Infinity" | "NaN" | "undefined") && ctx.is_reference_to_global_variable(identifier))
            }
            _ => true,
        },
        _ => false,
    }
}

fn static_positive_number(expression: &Expression<'_>) -> Option<f64> {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(number) if number.value.is_finite() => Some(number.value),
        _ => None,
    }
}

fn merge_inline_box_evidence(
    opening_element: &JSXOpeningElement<'_>,
    evidence: &mut ReservedBoxEvidence,
    ctx: &LintContext<'_>,
) {
    let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", false)
    else {
        return;
    };
    let Some(style) = get_inline_style_object_expression(style_attribute) else {
        return;
    };
    evidence.has_width |= get_effective_static_style_property(style, "width")
        .is_some_and(|property| style_property_reserves_space(&property.value, false, false, ctx));
    evidence.has_height |= get_effective_static_style_property(style, "height")
        .is_some_and(|property| style_property_reserves_space(&property.value, false, true, ctx));
    evidence.has_aspect_ratio |= get_effective_static_style_property(style, "aspectRatio")
        .is_some_and(|property| style_property_reserves_space(&property.value, true, false, ctx));
}

fn style_property_reserves_space(
    expression: &Expression<'_>,
    is_aspect_ratio: bool,
    is_height: bool,
    ctx: &LintContext<'_>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NumericLiteral(number) => number.value.is_finite() && number.value > 0.0,
        Expression::StringLiteral(literal) => {
            let value = literal.value.trim().to_ascii_lowercase();
            if value.is_empty() || matches!(value.as_str(), "auto" | "none") {
                return false;
            }
            if value.starts_with("calc(")
                || value.starts_with("clamp(")
                || value.starts_with("max(")
                || value.starts_with("min(")
                || value.starts_with("var(")
            {
                return true;
            }
            if is_aspect_ratio {
                let value = value.strip_prefix("auto ").unwrap_or(&value);
                let parts = value.split('/').map(str::trim).collect::<Vec<_>>();
                return parts.len() <= 2
                    && parts.iter().all(|part| {
                        part.parse::<f64>()
                            .is_ok_and(|number| number.is_finite() && number > 0.0)
                    });
            }
            if is_height && value.ends_with('%') {
                return false;
            }
            css_length_is_positive(&value)
        }
        Expression::Identifier(identifier)
            if matches!(identifier.name.as_str(), "Infinity" | "NaN" | "undefined")
                && ctx.is_reference_to_global_variable(identifier) =>
        {
            false
        }
        Expression::UnaryExpression(unary) if unary.operator.is_void() => false,
        Expression::UnaryExpression(unary) => {
            if let Some(value) = static_positive_number(&unary.argument) {
                return match unary.operator {
                    oxc_syntax::operator::UnaryOperator::UnaryPlus => value > 0.0,
                    oxc_syntax::operator::UnaryOperator::UnaryNegation => -value > 0.0,
                    _ => true,
                };
            }
            !matches!(
                unary.operator,
                oxc_syntax::operator::UnaryOperator::UnaryPlus
                    | oxc_syntax::operator::UnaryOperator::UnaryNegation
            ) || !matches!(unary.argument.get_inner_expression(), Expression::Identifier(identifier) if matches!(identifier.name.as_str(), "Infinity" | "NaN" | "undefined") && ctx.is_reference_to_global_variable(identifier))
        }
        Expression::BooleanLiteral(_) | Expression::NullLiteral(_) => false,
        _ => true,
    }
}

fn css_length_is_positive(value: &str) -> bool {
    let number_end = value
        .char_indices()
        .take_while(|(_, character)| character.is_ascii_digit() || *character == '.')
        .last()
        .map_or(0, |(index, character)| index + character.len_utf8());
    const CSS_LENGTH_UNITS: [&str; 49] = [
        "cap", "ch", "cm", "cqb", "cqh", "cqi", "cqmax", "cqmin", "cqw", "dvb", "dvh", "dvi",
        "dvmax", "dvmin", "dvw", "em", "ex", "ic", "in", "lh", "lvb", "lvh", "lvi", "lvmax",
        "lvmin", "lvw", "mm", "pc", "pt", "px", "q", "rcap", "rch", "rem", "rex", "ric", "rlh",
        "svb", "svh", "svi", "svmax", "svmin", "svw", "vb", "vh", "vi", "vmax", "vmin", "vw",
    ];
    number_end > 0
        && value[..number_end]
            .parse::<f64>()
            .is_ok_and(|number| number.is_finite() && number > 0.0)
        && (&value[number_end..] == "%" || CSS_LENGTH_UNITS.contains(&&value[number_end..]))
}

fn merge_tailwind_box_evidence(
    opening_element: &JSXOpeningElement<'_>,
    evidence: &mut ReservedBoxEvidence,
) {
    let Some(class_name) = get_static_class_name(opening_element) else {
        return;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    evidence.has_width |= get_effective_tailwind_class_name_token(&tokens, |utility| {
        utility.starts_with("size-") || utility.starts_with("w-")
    })
    .is_some_and(|utility| tailwind_dimension_reserves_space(utility, false));
    evidence.has_height |= get_effective_tailwind_class_name_token(&tokens, |utility| {
        utility.starts_with("size-") || utility.starts_with("h-")
    })
    .is_some_and(|utility| tailwind_dimension_reserves_space(utility, true));
    evidence.has_aspect_ratio |=
        get_effective_tailwind_class_name_token(&tokens, |utility| utility.starts_with("aspect-"))
            .is_some_and(tailwind_aspect_ratio_reserves_space);
}

fn tailwind_dimension_reserves_space(utility: &str, is_height: bool) -> bool {
    let value = utility
        .split_once('-')
        .map(|(_, value)| value)
        .unwrap_or("");
    if value.is_empty()
        || matches!(value, "auto" | "fit" | "min" | "max" | "0")
        || value.contains("[auto]")
        || value.contains("[fit-content]")
        || value.contains("[min-content]")
        || value.contains("[max-content]")
    {
        return false;
    }
    !(is_height
        && (value == "full"
            || value.contains('/')
            || value.starts_with('[') && value.ends_with("%]")))
}

fn tailwind_aspect_ratio_reserves_space(utility: &str) -> bool {
    let value = utility.strip_prefix("aspect-").unwrap_or("");
    if matches!(value, "" | "auto" | "[auto]") {
        return false;
    }
    let value = value.trim_matches(['[', ']']);
    if matches!(value, "square" | "video")
        || value.starts_with("var(")
        || value.starts_with("calc(")
    {
        return true;
    }
    let parts = value.split('/').map(str::trim).collect::<Vec<_>>();
    if parts.len() == 2 {
        return parts.iter().all(|part| {
            part.parse::<f64>()
                .is_ok_and(|number| number.is_finite() && number > 0.0)
        });
    }
    !value.starts_with(|character: char| character.is_ascii_digit())
}

fn evidence_reserves_box(evidence: &ReservedBoxEvidence, has_implicit_width: bool) -> bool {
    let has_width = evidence.has_width || has_implicit_width;
    has_width && evidence.has_height
        || evidence.has_aspect_ratio && (has_width || evidence.has_height)
}

fn is_statically_non_rendered(opening_element: &JSXOpeningElement<'_>, has_tailwind: bool) -> bool {
    if get_authoritative_jsx_attribute(opening_element, "hidden", false)
        .is_some_and(attribute_is_statically_truthy)
    {
        return true;
    }
    if has_tailwind
        && get_static_class_name(opening_element).is_some_and(tailwind_hides_at_every_display_scope)
    {
        return true;
    }
    get_authoritative_jsx_attribute(opening_element, "style", false)
        .and_then(get_inline_style_object_expression)
        .and_then(|style| get_effective_static_style_property(style, "display"))
        .is_some_and(|property| matches!(&property.value, Expression::StringLiteral(literal) if literal.value.eq_ignore_ascii_case("none")))
}

fn tailwind_hides_at_every_display_scope(class_name: &str) -> bool {
    let tokens = tailwind_class_name_tokens(class_name);
    let mut target_scopes = vec![Vec::new()];
    target_scopes.extend(
        tokens
            .iter()
            .filter(|token| {
                !token.variants.is_empty() && is_tailwind_display_utility(token.utility)
            })
            .map(|token| token.variants.clone()),
    );
    target_scopes.iter().all(|target_scope| {
        effective_tailwind_display_at_scope(&tokens, target_scope) == Some("hidden")
    })
}

fn effective_tailwind_display_at_scope<'a>(
    tokens: &'a [TailwindClassNameToken<'a>],
    target_scope: &[&str],
) -> Option<&'a str> {
    let applicable = tokens
        .iter()
        .filter(|token| {
            token.variants == target_scope && is_tailwind_display_utility(token.utility)
        })
        .collect::<Vec<_>>();
    let is_important = applicable.iter().any(|token| token.is_important);
    let mut utility = None;
    for token in applicable {
        if is_important && !token.is_important {
            continue;
        }
        if utility.is_some_and(|previous| previous != token.utility) {
            return None;
        }
        utility = Some(token.utility);
    }
    utility
}

fn is_tailwind_display_utility(utility: &str) -> bool {
    matches!(
        utility,
        "block"
            | "contents"
            | "flex"
            | "flow-root"
            | "grid"
            | "hidden"
            | "inline"
            | "inline-block"
            | "inline-flex"
            | "inline-grid"
            | "inline-table"
            | "list-item"
            | "table"
            | "table-caption"
            | "table-cell"
            | "table-column"
            | "table-column-group"
            | "table-footer-group"
            | "table-header-group"
            | "table-row"
            | "table-row-group"
    )
}

fn attribute_is_statically_truthy(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        None | Some(JSXAttributeValue::StringLiteral(_)) => true,
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::BooleanLiteral(boolean) => boolean.value,
            JSXExpression::StringLiteral(_) | JSXExpression::NumericLiteral(_) => true,
            _ => false,
        },
        _ => false,
    }
}

fn has_unresolved_box(
    opening_element: &JSXOpeningElement<'_>,
    has_tailwind: bool,
    ctx: &LintContext<'_>,
) -> bool {
    if let Some(class_attribute) =
        get_authoritative_jsx_attribute(opening_element, "className", false)
    {
        if let Some(class_name) = get_static_class_name(opening_element) {
            if !class_name.trim().is_empty() && has_tailwind {
                let tokens = tailwind_class_name_tokens(class_name);
                let is_ambiguous = [
                    resolve_effective_box_utility(&tokens, |utility| {
                        utility.starts_with("aspect-")
                    }),
                    resolve_effective_box_utility(&tokens, |utility| {
                        utility.starts_with("size-") || utility.starts_with("w-")
                    }),
                    resolve_effective_box_utility(&tokens, |utility| {
                        utility.starts_with("size-") || utility.starts_with("h-")
                    }),
                ]
                .iter()
                .any(|resolution| resolution.is_ambiguous);
                if is_ambiguous {
                    return true;
                }
            }
        } else if let Some(JSXAttributeValue::ExpressionContainer(container)) =
            class_attribute.value.as_ref()
        {
            let Some(expression) = container.expression.as_expression() else {
                return false;
            };
            match expression.get_inner_expression() {
                Expression::NullLiteral(_) | Expression::BooleanLiteral(_) => return false,
                Expression::UnaryExpression(unary) if unary.operator.is_void() => return false,
                Expression::Identifier(identifier)
                    if identifier.name == "undefined"
                        && ctx.is_reference_to_global_variable(identifier) =>
                {
                    return false;
                }
                _ => return true,
            }
        } else {
            return class_attribute.value.is_some();
        }
        if has_tailwind
            && get_static_class_name(opening_element).is_some_and(|class_name| {
                tailwind_class_name_tokens(class_name)
                    .iter()
                    .any(|token| !is_known_image_box_utility(token.utility))
            })
        {
            return true;
        }
    }
    let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", false)
    else {
        return false;
    };
    let Some(style) = get_inline_style_object_expression(style_attribute) else {
        return true;
    };
    style.properties.iter().any(|property| match property {
        ObjectPropertyKind::ObjectProperty(property) => property.key.static_name().is_none(),
        ObjectPropertyKind::SpreadProperty(_) => true,
    })
}

fn is_known_image_box_utility(utility: &str) -> bool {
    utility.starts_with("aspect-")
        || utility.starts_with("size-")
        || utility.starts_with("w-")
        || utility.starts_with("h-")
        || is_tailwind_margin_utility(utility)
        || utility.starts_with("border")
        || utility.starts_with("max-h-")
        || utility.starts_with("max-w-")
        || utility.starts_with("object-")
        || utility.starts_with("opacity-")
        || utility.starts_with("rounded")
        || utility.starts_with("shadow")
        || is_tailwind_display_utility(utility)
        || matches!(utility, "collapse" | "grayscale" | "invisible" | "visible")
}

fn is_tailwind_margin_utility(utility: &str) -> bool {
    let utility = utility.strip_prefix('-').unwrap_or(utility);
    let Some(remainder) = utility.strip_prefix('m') else {
        return false;
    };
    let remainder =
        if remainder.chars().next().is_some_and(|character| {
            matches!(character, 't' | 'r' | 'b' | 'l' | 'e' | 's' | 'x' | 'y')
        }) {
            &remainder[1..]
        } else {
            remainder
        };
    remainder.starts_with('-') && remainder.len() > 1
}

fn has_reserved_parent_box(node_id: NodeId, has_tailwind: bool, ctx: &LintContext<'_>) -> bool {
    let Some(parent) = direct_parent_opening_element(node_id, ctx) else {
        return false;
    };
    if has_jsx_spread(parent) {
        return false;
    }
    let mut has_implicit_width = matches!(
        crate::utils::get_jsx_element_name(&parent.name).as_ref(),
        "article"
            | "aside"
            | "blockquote"
            | "details"
            | "div"
            | "dl"
            | "fieldset"
            | "figure"
            | "footer"
            | "form"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "header"
            | "hr"
            | "li"
            | "main"
            | "nav"
            | "ol"
            | "p"
            | "pre"
            | "section"
            | "ul"
    );
    let style = get_authoritative_jsx_attribute(parent, "style", false)
        .and_then(get_inline_style_object_expression);
    if let Some(style) = style {
        if let Some(display) = get_effective_static_style_property(style, "display")
            .and_then(|property| static_style_string(&property.value))
        {
            has_implicit_width = matches!(
                display.to_ascii_lowercase().as_str(),
                "block" | "flex" | "flow-root" | "grid" | "list-item"
            );
        }
        let position = get_effective_static_style_property(style, "position")
            .and_then(|property| static_style_string(&property.value));
        let float = get_effective_static_style_property(style, "float")
            .and_then(|property| static_style_string(&property.value));
        if position.is_some_and(|value| {
            matches!(value.to_ascii_lowercase().as_str(), "absolute" | "fixed")
        }) || float.is_some_and(|value| !value.eq_ignore_ascii_case("none"))
        {
            has_implicit_width = false;
        }
    }
    if has_tailwind && let Some(class_name) = get_static_class_name(parent) {
        let tokens = tailwind_class_name_tokens(class_name);
        if let Some(display) = get_effective_tailwind_class_name_token(&tokens, |utility| {
            is_tailwind_display_utility(utility)
        }) {
            has_implicit_width = matches!(
                display,
                "block" | "flex" | "flow-root" | "grid" | "list-item"
            );
        }
        let position = get_effective_tailwind_class_name_token(&tokens, |utility| {
            matches!(
                utility,
                "static" | "fixed" | "absolute" | "relative" | "sticky"
            )
        });
        let float = get_effective_tailwind_class_name_token(&tokens, |utility| {
            matches!(
                utility,
                "float-start" | "float-end" | "float-right" | "float-left" | "float-none"
            )
        });
        if matches!(position, Some("absolute" | "fixed"))
            || float.is_some_and(|utility| utility != "float-none")
        {
            has_implicit_width = false;
        }
    }
    let mut evidence = ReservedBoxEvidence::default();
    merge_inline_box_evidence(parent, &mut evidence, ctx);
    if has_tailwind {
        merge_tailwind_box_evidence(parent, &mut evidence);
    }
    evidence_reserves_box(&evidence, has_implicit_width)
}

fn static_style_string<'a>(expression: &'a Expression<'_>) -> Option<&'a str> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn direct_parent_opening_element<'a>(
    node_id: NodeId,
    ctx: &LintContext<'a>,
) -> Option<&'a JSXOpeningElement<'a>> {
    let image_element = ctx.nodes().parent_node(node_id);
    if !matches!(image_element.kind(), AstKind::JSXElement(_)) {
        return None;
    }
    let parent = ctx.nodes().parent_node(image_element.id());
    let AstKind::JSXElement(parent_element) = parent.kind() else {
        return None;
    };
    Some(&parent_element.opening_element)
}

fn element_has_implicit_width<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    resolve_jsx_element_type(opening_element, ctx).is_some_and(|(name, _)| {
        matches!(
            name,
            "article"
                | "aside"
                | "blockquote"
                | "details"
                | "div"
                | "dl"
                | "fieldset"
                | "figure"
                | "footer"
                | "form"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "header"
                | "hr"
                | "li"
                | "main"
                | "nav"
                | "ol"
                | "p"
                | "pre"
                | "section"
                | "ul"
        )
    })
}

fn has_unresolved_parent_box<'a>(
    node_id: NodeId,
    has_tailwind: bool,
    ctx: &LintContext<'a>,
) -> bool {
    direct_parent_opening_element(node_id, ctx).is_some_and(|parent| {
        (!has_tailwind && get_static_class_name(parent).is_some())
            || has_jsx_spread(parent)
            || has_unresolved_box(parent, has_tailwind, ctx)
    })
}

fn has_jsx_spread(opening_element: &JSXOpeningElement<'_>) -> bool {
    opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
}

fn external_css_values<'a>(style: &'a StaticCssStyle, property: &str) -> Option<&'a str> {
    (!style.ambiguous_properties.contains(property))
        .then(|| style.values_by_property.get(property))
        .flatten()
        .map(String::as_str)
}

fn external_css_length_reserves_without_parent(value: &str, is_height: bool) -> bool {
    if value.is_empty() || matches!(value, "auto" | "none") {
        return false;
    }
    if ["calc(", "clamp(", "max(", "min("]
        .iter()
        .any(|prefix| value.starts_with(prefix))
    {
        return !value.contains('%') && !css_value_contains_word(value, "auto");
    }
    css_length_is_positive(value) && (!is_height || !value.ends_with('%'))
}

fn external_css_length_reserves_with_parent(value: &str, is_height: bool) -> bool {
    if external_css_length_reserves_without_parent(value, is_height) {
        return true;
    }
    if ["calc(", "clamp(", "max(", "min("]
        .iter()
        .any(|prefix| value.starts_with(prefix))
    {
        return !css_value_contains_word(value, "auto") && !css_value_contains_word(value, "var");
    }
    css_length_is_positive(value) && value.ends_with('%')
}

fn css_value_contains_word(value: &str, word: &str) -> bool {
    value.match_indices(word).any(|(index, _)| {
        let before = value[..index].chars().next_back();
        let after = value[index + word.len()..].chars().next();
        before.is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
            && after.is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
    })
}

fn external_css_aspect_ratio_reserves_space(value: &str) -> bool {
    let value = value.strip_prefix("auto ").unwrap_or(value);
    let parts = value.split('/').map(str::trim).collect::<Vec<_>>();
    parts.len() == 2
        && parts.iter().all(|part| {
            part.parse::<f64>()
                .is_ok_and(|number| number.is_finite() && number > 0.0)
        })
}

fn get_external_css_box_evidence(style: &StaticCssStyle) -> ExternalCssBoxEvidence {
    let width = external_css_values(style, "width");
    let height = external_css_values(style, "height");
    ExternalCssBoxEvidence {
        has_aspect_ratio: external_css_values(style, "aspect-ratio")
            .is_some_and(external_css_aspect_ratio_reserves_space),
        has_height: height
            .is_some_and(|value| external_css_length_reserves_without_parent(value, true)),
        has_width: width
            .is_some_and(|value| external_css_length_reserves_without_parent(value, false)),
        height_reserves_with_parent: height
            .is_some_and(|value| external_css_length_reserves_with_parent(value, true)),
        width_reserves_with_parent: width
            .is_some_and(|value| external_css_length_reserves_with_parent(value, false)),
    }
}

fn get_external_css_box_evidence_with_inline_overrides(
    node_id: NodeId,
    opening_element: &JSXOpeningElement<'_>,
    resolver: &StaticCssResolver,
    ctx: &LintContext<'_>,
) -> Option<ExternalCssBoxEvidence> {
    let mut evidence = get_external_css_box_evidence(&resolver.resolve(node_id, ctx));
    let Some(style_attribute) = get_authoritative_jsx_attribute(opening_element, "style", false)
    else {
        return Some(evidence);
    };
    let style = get_inline_style_object_expression(style_attribute)?;
    let mut inline_evidence = ReservedBoxEvidence::default();
    merge_inline_box_evidence(opening_element, &mut inline_evidence, ctx);
    if get_effective_static_style_property(style, "aspectRatio").is_some() {
        evidence.has_aspect_ratio = inline_evidence.has_aspect_ratio;
    }
    if get_effective_static_style_property(style, "height").is_some() {
        evidence.has_height = inline_evidence.has_height;
        evidence.height_reserves_with_parent = false;
    }
    if get_effective_static_style_property(style, "width").is_some() {
        evidence.has_width = inline_evidence.has_width;
        evidence.width_reserves_with_parent = false;
    }
    Some(evidence)
}

fn inline_style_overrides_any(
    opening_element: &JSXOpeningElement<'_>,
    property_names: &[&str],
) -> bool {
    get_authoritative_jsx_attribute(opening_element, "style", false)
        .and_then(get_inline_style_object_expression)
        .is_some_and(|style| {
            property_names.iter().any(|property_name| {
                get_effective_static_style_property(style, property_name).is_some()
            })
        })
}

fn external_css_has_positive_flex_grow(style: &StaticCssStyle) -> bool {
    let mut values = [
        external_css_values(style, "flex-grow"),
        external_css_values(style, "flex"),
    ]
    .into_iter()
    .flatten();
    let Some(first) = values.next() else {
        return false;
    };
    std::iter::once(first).chain(values).all(|value| {
        value
            .split_ascii_whitespace()
            .next()
            .and_then(|number| number.parse::<f64>().ok())
            .is_some_and(|number| number.is_finite() && number > 0.0)
    })
}

fn get_external_css_element_box_axes<'a>(
    node_id: NodeId,
    opening_element: &JSXOpeningElement<'a>,
    resolver: &StaticCssResolver,
    ctx: &LintContext<'a>,
) -> ParentBoxAxes {
    let style = resolver.resolve(node_id, ctx);
    let Some(evidence) = get_external_css_box_evidence_with_inline_overrides(
        node_id,
        opening_element,
        resolver,
        ctx,
    ) else {
        return ParentBoxAxes::default();
    };
    let parent_id = parent_opening_node_id(node_id, ctx);
    let parent_axes = parent_id.map_or(
        ParentBoxAxes {
            has_height: resolver.has_definite_react_root_height,
            has_width: true,
        },
        |parent_id| {
            let AstKind::JSXOpeningElement(parent) = ctx.nodes().get_node(parent_id).kind() else {
                return ParentBoxAxes::default();
            };
            get_external_css_element_box_axes(parent_id, parent, resolver, ctx)
        },
    );
    let mut has_width = evidence.has_width
        || evidence.width_reserves_with_parent && parent_axes.has_width
        || element_has_implicit_width(opening_element, ctx);
    let mut has_height =
        evidence.has_height || evidence.height_reserves_with_parent && parent_axes.has_height;
    let Some(parent_id) = parent_id else {
        return ParentBoxAxes {
            has_height,
            has_width,
        };
    };
    let AstKind::JSXOpeningElement(parent) = ctx.nodes().get_node(parent_id).kind() else {
        return ParentBoxAxes {
            has_height,
            has_width,
        };
    };
    if inline_style_overrides_any(opening_element, &["alignSelf", "flex", "flexGrow"])
        || inline_style_overrides_any(
            parent,
            &["alignItems", "display", "flexDirection", "flexWrap"],
        )
    {
        return ParentBoxAxes {
            has_height,
            has_width,
        };
    }
    let parent_style = resolver.resolve(parent_id, ctx);
    let display = external_css_values(&parent_style, "display");
    let flex_direction = external_css_values(&parent_style, "flex-direction").unwrap_or("row");
    let flex_wrap = external_css_values(&parent_style, "flex-wrap").unwrap_or("nowrap");
    let align_items = external_css_values(&parent_style, "align-items").unwrap_or("stretch");
    let align_self = external_css_values(&style, "align-self").unwrap_or("auto");
    let is_flex_container = matches!(display, Some("flex" | "inline-flex"));
    let is_row_direction = matches!(flex_direction, "row" | "row-reverse");
    let is_column_direction = matches!(flex_direction, "column" | "column-reverse");
    if is_flex_container && (is_row_direction || is_column_direction) && flex_wrap == "nowrap" {
        if external_css_has_positive_flex_grow(&style) {
            if is_row_direction && parent_axes.has_width {
                has_width = true;
            }
            if is_column_direction && parent_axes.has_height {
                has_height = true;
            }
        }
        if align_items == "stretch" && matches!(align_self, "auto" | "stretch") {
            if is_row_direction && parent_axes.has_height {
                has_height = true;
            }
            if is_column_direction && parent_axes.has_width {
                has_width = true;
            }
        }
    }
    if evidence.has_aspect_ratio {
        has_height |= has_width;
        has_width |= has_height;
    }
    ParentBoxAxes {
        has_height,
        has_width,
    }
}

fn get_external_css_parent_box_axes(
    node_id: NodeId,
    resolver: &StaticCssResolver,
    ctx: &LintContext<'_>,
) -> ParentBoxAxes {
    let Some(parent_id) = parent_opening_node_id(node_id, ctx) else {
        return ParentBoxAxes::default();
    };
    let AstKind::JSXOpeningElement(parent) = ctx.nodes().get_node(parent_id).kind() else {
        return ParentBoxAxes::default();
    };
    get_external_css_element_box_axes(parent_id, parent, resolver, ctx)
}

fn has_reserved_external_css_box(
    node_id: NodeId,
    opening_element: &JSXOpeningElement<'_>,
    resolver: &StaticCssResolver,
    ctx: &LintContext<'_>,
) -> bool {
    let mut class_evidence = ReservedBoxEvidence::default();
    let mut has_aspect_ratio_utility = false;
    let mut has_height_utility = false;
    let mut has_width_utility = false;
    if let Some(class_attribute) =
        get_authoritative_jsx_attribute(opening_element, "className", false)
    {
        let class_name = get_static_class_name(opening_element);
        if class_name.is_none() && class_attribute.value.is_some() {
            return false;
        }
        let Some(class_name) = class_name else {
            return false;
        };
        merge_tailwind_box_evidence(opening_element, &mut class_evidence);
        for token in tailwind_class_name_tokens(class_name) {
            has_aspect_ratio_utility |= token.utility.starts_with("aspect-");
            has_height_utility |=
                token.utility.starts_with("size-") || token.utility.starts_with("h-");
            has_width_utility |=
                token.utility.starts_with("size-") || token.utility.starts_with("w-");
        }
    }
    let Some(evidence) = get_external_css_box_evidence_with_inline_overrides(
        node_id,
        opening_element,
        resolver,
        ctx,
    ) else {
        return false;
    };
    let combined = ExternalCssBoxEvidence {
        has_aspect_ratio: class_evidence.has_aspect_ratio
            || !has_aspect_ratio_utility && evidence.has_aspect_ratio,
        has_height: class_evidence.has_height || !has_height_utility && evidence.has_height,
        has_width: class_evidence.has_width || !has_width_utility && evidence.has_width,
        height_reserves_with_parent: !has_height_utility && evidence.height_reserves_with_parent,
        width_reserves_with_parent: !has_width_utility && evidence.width_reserves_with_parent,
    };
    if combined.has_width && combined.has_height
        || combined.has_aspect_ratio && (combined.has_width || combined.has_height)
    {
        return true;
    }
    let parent_axes = get_external_css_parent_box_axes(node_id, resolver, ctx);
    let has_width =
        combined.has_width || combined.width_reserves_with_parent && parent_axes.has_width;
    let has_height =
        combined.has_height || combined.height_reserves_with_parent && parent_axes.has_height;
    has_width && has_height || combined.has_aspect_ratio && (has_width || has_height)
}

const TRACKED_CSS_PROPERTIES: [&str; 10] = [
    "align-items",
    "align-self",
    "aspect-ratio",
    "display",
    "flex",
    "flex-direction",
    "flex-grow",
    "flex-wrap",
    "height",
    "width",
];

#[derive(Clone)]
struct StaticCssDeclaration {
    property: String,
    value: String,
    is_important: bool,
    declaration_order: usize,
}

#[derive(Clone)]
struct StaticCssRule {
    selectors: Vec<String>,
    declarations: Vec<StaticCssDeclaration>,
    cascade_layer_key: Option<String>,
    is_conditional: bool,
    source_order: usize,
}

#[derive(Default)]
struct StaticCssResolver {
    rules: Vec<StaticCssRule>,
    has_definite_react_root_height: bool,
}

#[derive(Default)]
struct StaticCssStyle {
    ambiguous_properties: HashSet<String>,
    values_by_property: HashMap<String, String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StaticSelectorMatch {
    Ambiguous,
    Match,
    NoMatch,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord)]
struct CssSpecificity(usize, usize, usize);

#[derive(Clone)]
struct MatchedCssDeclaration {
    declaration: StaticCssDeclaration,
    cascade_layer_key: Option<String>,
    source_order: usize,
    specificity: CssSpecificity,
}

impl StaticCssResolver {
    fn new(ctx: &LintContext<'_>) -> Self {
        let file_path = ctx.file_path();
        if !file_path.is_absolute() {
            return Self::default();
        }
        let Ok(metadata) = fs::metadata(file_path) else {
            return Self::default();
        };
        if metadata.len() > 2_000_000 {
            return Self::default();
        }
        let Ok(source) = fs::read_to_string(file_path) else {
            return Self::default();
        };
        let directory = file_path.parent().unwrap_or_else(|| Path::new(""));
        let mut stylesheet_paths = Vec::new();
        for statement in source.split(['\n', ';']) {
            let trimmed = statement.trim_start();
            if !trimmed.starts_with("import ") {
                continue;
            }
            let Some(import_source) = quoted_import_source(trimmed) else {
                continue;
            };
            let import_path = import_source
                .split(['?', '#'])
                .next()
                .unwrap_or(import_source);
            if !import_path.starts_with('.') || !import_path.ends_with(".css") {
                continue;
            }
            let stylesheet_path = directory.join(import_path);
            if stylesheet_path.parent() == Some(directory)
                && !stylesheet_paths.contains(&stylesheet_path)
            {
                stylesheet_paths.push(stylesheet_path);
            }
        }
        let mut rules = Vec::new();
        let mut source_order = 0;
        let mut anonymous_layer_count = 0;
        for stylesheet_path in stylesheet_paths {
            let Ok(metadata) = fs::metadata(&stylesheet_path) else {
                continue;
            };
            if metadata.len() > 2_000_000 {
                continue;
            }
            let Ok(stylesheet) = fs::read_to_string(stylesheet_path) else {
                continue;
            };
            parse_css_rule_list(
                &strip_css_comments(&stylesheet),
                None,
                None,
                false,
                &mut rules,
                &mut source_order,
                &mut anonymous_layer_count,
            );
        }
        let mut resolver = Self {
            rules,
            has_definite_react_root_height: false,
        };
        resolver.has_definite_react_root_height = ["html", "body", "root"].iter().all(|target| {
            let style = resolver.resolve_root(target);
            !style.ambiguous_properties.contains("height")
                && style.values_by_property.get("height").map(String::as_str) == Some("100%")
        });
        resolver
    }

    fn resolve(&self, node_id: NodeId, ctx: &LintContext<'_>) -> StaticCssStyle {
        self.resolve_with_match(|selector| selector_matches(selector, node_id, ctx))
    }

    fn resolve_root(&self, target: &str) -> StaticCssStyle {
        self.resolve_with_match(|selector| selector_matches_root_target(selector, target))
    }

    fn resolve_with_match(
        &self,
        mut selector_match: impl FnMut(&str) -> StaticSelectorMatch,
    ) -> StaticCssStyle {
        let mut style = StaticCssStyle::default();
        let mut candidates: HashMap<String, Vec<MatchedCssDeclaration>> = HashMap::new();
        for rule in &self.rules {
            let mut matching_specificity: Option<CssSpecificity> = None;
            let mut ambiguous_specificity: Option<CssSpecificity> = None;
            for selector in &rule.selectors {
                let specificity = css_selector_specificity(selector);
                match selector_match(selector) {
                    StaticSelectorMatch::Match => {
                        matching_specificity = Some(
                            matching_specificity
                                .map_or(specificity, |current| current.max(specificity)),
                        );
                    }
                    StaticSelectorMatch::Ambiguous => {
                        ambiguous_specificity = Some(
                            ambiguous_specificity
                                .map_or(specificity, |current| current.max(specificity)),
                        );
                    }
                    StaticSelectorMatch::NoMatch => {}
                }
            }
            if rule.is_conditional {
                if matching_specificity.is_some() || ambiguous_specificity.is_some() {
                    for declaration in &rule.declarations {
                        style
                            .ambiguous_properties
                            .insert(declaration.property.clone());
                    }
                }
                continue;
            }
            if ambiguous_specificity.is_some_and(|ambiguous| {
                matching_specificity.is_none_or(|matching| ambiguous > matching)
            }) {
                for declaration in &rule.declarations {
                    style
                        .ambiguous_properties
                        .insert(declaration.property.clone());
                }
            }
            let Some(specificity) = matching_specificity else {
                continue;
            };
            for declaration in &rule.declarations {
                candidates
                    .entry(declaration.property.clone())
                    .or_default()
                    .push(MatchedCssDeclaration {
                        declaration: declaration.clone(),
                        cascade_layer_key: rule.cascade_layer_key.clone(),
                        source_order: rule.source_order,
                        specificity,
                    });
            }
        }
        for (property, candidates) in candidates {
            match resolve_css_cascade(&candidates) {
                Some(Ok(value)) => {
                    style.values_by_property.insert(property, value);
                }
                Some(Err(())) => {
                    style.ambiguous_properties.insert(property);
                }
                None => {}
            }
        }
        style
    }
}

fn quoted_import_source(source: &str) -> Option<&str> {
    let quote_index = source.find(['\'', '"'])?;
    let quote = source.as_bytes()[quote_index];
    let remainder = &source[quote_index + 1..];
    let end = remainder.bytes().position(|byte| byte == quote)?;
    Some(&remainder[..end])
}

fn strip_css_comments(source: &str) -> String {
    let mut output = String::with_capacity(source.len());
    let mut remainder = source;
    while let Some(start) = remainder.find("/*") {
        output.push_str(&remainder[..start]);
        let Some(end) = remainder[start + 2..].find("*/") else {
            break;
        };
        remainder = &remainder[start + end + 4..];
    }
    output.push_str(remainder);
    output
}

fn parse_css_rule_list(
    source: &str,
    parent_selectors: Option<&[String]>,
    cascade_layer_key: Option<&str>,
    is_conditional: bool,
    rules: &mut Vec<StaticCssRule>,
    source_order: &mut usize,
    anonymous_layer_count: &mut usize,
) {
    let mut cursor = 0;
    while let Some(open_offset) = find_top_level_character(&source[cursor..], '{') {
        let open = cursor + open_offset;
        let header = source[cursor..open].trim().trim_matches(';').trim();
        let Some(close) = find_matching_css_delimiter(source, open, b'{', b'}') else {
            break;
        };
        let body = &source[open + 1..close];
        if let Some(layer_name) = header.strip_prefix("@layer") {
            let layer_name = layer_name.trim();
            let layer_key = if layer_name.is_empty() {
                let key = format!("anonymous-{}", *anonymous_layer_count);
                *anonymous_layer_count += 1;
                key
            } else if let Some(parent_layer) = cascade_layer_key {
                format!("{parent_layer}.{layer_name}")
            } else {
                layer_name.to_string()
            };
            parse_css_rule_list(
                body,
                parent_selectors,
                Some(&layer_key),
                is_conditional,
                rules,
                source_order,
                anonymous_layer_count,
            );
        } else if header.starts_with('@') {
            let conditional = matches!(
                header
                    .split_ascii_whitespace()
                    .next()
                    .unwrap_or("")
                    .trim_start_matches('@'),
                "container" | "media" | "-moz-document" | "scope" | "starting-style" | "supports"
            );
            if conditional {
                parse_css_rule_list(
                    body,
                    parent_selectors,
                    cascade_layer_key,
                    true,
                    rules,
                    source_order,
                    anonymous_layer_count,
                );
            }
        } else if !header.is_empty() {
            let selectors = combine_css_selectors(parent_selectors, &split_css_list(header));
            parse_css_style_body(
                body,
                &selectors,
                cascade_layer_key,
                is_conditional,
                rules,
                source_order,
                anonymous_layer_count,
            );
        }
        cursor = close + 1;
    }
}

fn parse_css_style_body(
    source: &str,
    selectors: &[String],
    cascade_layer_key: Option<&str>,
    is_conditional: bool,
    rules: &mut Vec<StaticCssRule>,
    source_order: &mut usize,
    anonymous_layer_count: &mut usize,
) {
    let mut declarations_source = String::new();
    let mut cursor = 0;
    while let Some(open_offset) = find_top_level_character(&source[cursor..], '{') {
        let open = cursor + open_offset;
        let segment = &source[cursor..open];
        let header_start = segment.rfind(';').map_or(0, |index| index + 1);
        declarations_source.push_str(&segment[..header_start]);
        let header = segment[header_start..].trim();
        let Some(close) = find_matching_css_delimiter(source, open, b'{', b'}') else {
            break;
        };
        let body = &source[open + 1..close];
        if header.starts_with('@') {
            parse_css_rule_list(
                &format!("{header}{{{body}}}"),
                Some(selectors),
                cascade_layer_key,
                is_conditional,
                rules,
                source_order,
                anonymous_layer_count,
            );
        } else {
            let nested_selectors = combine_css_selectors(Some(selectors), &split_css_list(header));
            parse_css_style_body(
                body,
                &nested_selectors,
                cascade_layer_key,
                is_conditional,
                rules,
                source_order,
                anonymous_layer_count,
            );
        }
        cursor = close + 1;
    }
    declarations_source.push_str(&source[cursor..]);
    let declarations = parse_css_declarations(&declarations_source);
    if !declarations.is_empty() {
        rules.push(StaticCssRule {
            selectors: selectors.to_vec(),
            declarations,
            cascade_layer_key: cascade_layer_key.map(str::to_string),
            is_conditional,
            source_order: *source_order,
        });
    }
    *source_order += 1;
}

fn find_top_level_character(source: &str, target: char) -> Option<usize> {
    let mut square_depth = 0_u32;
    let mut parenthesis_depth = 0_u32;
    let mut quote = None;
    let mut escaped = false;
    for (index, character) in source.char_indices() {
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
            '[' => square_depth += 1,
            ']' => square_depth = square_depth.saturating_sub(1),
            '(' => parenthesis_depth += 1,
            ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
            _ => {}
        }
        if character == target && square_depth == 0 && parenthesis_depth == 0 {
            return Some(index);
        }
    }
    None
}

fn find_matching_css_delimiter(
    source: &str,
    open_index: usize,
    open: u8,
    close: u8,
) -> Option<usize> {
    let bytes = source.as_bytes();
    let mut depth = 0_u32;
    let mut quote = None;
    let mut escaped = false;
    for (index, byte) in bytes.iter().copied().enumerate().skip(open_index) {
        if escaped {
            escaped = false;
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            continue;
        }
        if let Some(active_quote) = quote {
            if byte == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(byte, b'\'' | b'"') {
            quote = Some(byte);
        } else if byte == open {
            depth += 1;
        } else if byte == close {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn split_css_list(source: &str) -> Vec<String> {
    no_img_split_css_top_level(source, ',')
        .into_iter()
        .map(|part| part.trim().to_string())
        .filter(|part| !part.is_empty())
        .collect()
}

fn no_img_split_css_top_level(source: &str, delimiter: char) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    let mut square_depth = 0_u32;
    let mut parenthesis_depth = 0_u32;
    let mut quote = None;
    for (index, character) in source.char_indices() {
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
            '[' => square_depth += 1,
            ']' => square_depth = square_depth.saturating_sub(1),
            '(' => parenthesis_depth += 1,
            ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
            _ => {}
        }
        if character == delimiter && square_depth == 0 && parenthesis_depth == 0 {
            parts.push(&source[start..index]);
            start = index + character.len_utf8();
        }
    }
    parts.push(&source[start..]);
    parts
}

fn combine_css_selectors(parent: Option<&[String]>, children: &[String]) -> Vec<String> {
    let Some(parents) = parent else {
        return children.to_vec();
    };
    parents
        .iter()
        .flat_map(|parent| {
            children.iter().map(move |child| {
                if child.contains('&') {
                    child.replace('&', parent)
                } else {
                    format!("{parent} {child}")
                }
            })
        })
        .collect()
}

fn parse_css_declarations(source: &str) -> Vec<StaticCssDeclaration> {
    no_img_split_css_top_level(source, ';')
        .into_iter()
        .filter_map(|declaration| {
            let (property, value) = declaration.split_once(':')?;
            let property = property.trim().to_ascii_lowercase();
            if !TRACKED_CSS_PROPERTIES.contains(&property.as_str()) {
                return None;
            }
            let mut value = value.trim().to_ascii_lowercase();
            let is_important = value.ends_with("!important");
            if is_important {
                value.truncate(value.len() - "!important".len());
                value = value.trim().to_string();
            }
            Some((property, value, is_important))
        })
        .enumerate()
        .map(
            |(declaration_order, (property, value, is_important))| StaticCssDeclaration {
                property,
                value,
                is_important,
                declaration_order,
            },
        )
        .collect()
}

fn resolve_css_cascade(candidates: &[MatchedCssDeclaration]) -> Option<Result<String, ()>> {
    if candidates.is_empty() {
        return None;
    }
    let has_important = candidates
        .iter()
        .any(|candidate| candidate.declaration.is_important);
    let important_candidates = candidates
        .iter()
        .filter(|candidate| candidate.declaration.is_important == has_important)
        .collect::<Vec<_>>();
    let has_layered = important_candidates
        .iter()
        .any(|candidate| candidate.cascade_layer_key.is_some());
    let has_unlayered = important_candidates
        .iter()
        .any(|candidate| candidate.cascade_layer_key.is_none());
    let use_layered = if has_important {
        has_layered
    } else {
        !has_unlayered
    };
    let eligible = important_candidates
        .into_iter()
        .filter(|candidate| candidate.cascade_layer_key.is_some() == use_layered)
        .collect::<Vec<_>>();
    if use_layered {
        let layer_keys = eligible
            .iter()
            .filter_map(|candidate| candidate.cascade_layer_key.as_deref())
            .collect::<HashSet<_>>();
        let values = eligible
            .iter()
            .map(|candidate| candidate.declaration.value.as_str())
            .collect::<HashSet<_>>();
        if layer_keys.len() > 1 && values.len() > 1 {
            return Some(Err(()));
        }
    }
    eligible
        .into_iter()
        .max_by_key(|candidate| {
            (
                candidate.specificity,
                candidate.source_order,
                candidate.declaration.declaration_order,
            )
        })
        .map(|candidate| Ok(candidate.declaration.value.clone()))
}

fn combine_selector_match(
    left: StaticSelectorMatch,
    right: StaticSelectorMatch,
) -> StaticSelectorMatch {
    if left == StaticSelectorMatch::NoMatch || right == StaticSelectorMatch::NoMatch {
        StaticSelectorMatch::NoMatch
    } else if left == StaticSelectorMatch::Ambiguous || right == StaticSelectorMatch::Ambiguous {
        StaticSelectorMatch::Ambiguous
    } else {
        StaticSelectorMatch::Match
    }
}

fn combine_alternative_selector_matches(
    matches: impl IntoIterator<Item = StaticSelectorMatch>,
) -> StaticSelectorMatch {
    let mut has_ambiguous = false;
    for selector_match in matches {
        if selector_match == StaticSelectorMatch::Match {
            return StaticSelectorMatch::Match;
        }
        has_ambiguous |= selector_match == StaticSelectorMatch::Ambiguous;
    }
    if has_ambiguous {
        StaticSelectorMatch::Ambiguous
    } else {
        StaticSelectorMatch::NoMatch
    }
}

fn selector_matches(selector: &str, node_id: NodeId, ctx: &LintContext<'_>) -> StaticSelectorMatch {
    let selector = selector.trim();
    let Some((left, combinator, right)) = split_rightmost_css_combinator(selector) else {
        return css_compound_matches(selector, node_id, ctx);
    };
    let right_match = css_compound_matches(right, node_id, ctx);
    if right_match == StaticSelectorMatch::NoMatch {
        return right_match;
    }
    match combinator {
        '>' => parent_opening_node_id(node_id, ctx)
            .map_or(StaticSelectorMatch::NoMatch, |parent| {
                combine_selector_match(right_match, selector_matches(left, parent, ctx))
            }),
        ' ' => {
            let mut parent = parent_opening_node_id(node_id, ctx);
            let mut matches = Vec::new();
            while let Some(parent_id) = parent {
                matches.push(selector_matches(left, parent_id, ctx));
                parent = parent_opening_node_id(parent_id, ctx);
            }
            combine_selector_match(right_match, combine_alternative_selector_matches(matches))
        }
        _ => StaticSelectorMatch::Ambiguous,
    }
}

fn split_rightmost_css_combinator(selector: &str) -> Option<(&str, char, &str)> {
    let mut square_depth = 0_u32;
    let mut parenthesis_depth = 0_u32;
    let mut candidate = None;
    let characters = selector.char_indices().collect::<Vec<_>>();
    for (position, (index, character)) in characters.iter().copied().enumerate() {
        match character {
            '[' => square_depth += 1,
            ']' => square_depth = square_depth.saturating_sub(1),
            '(' => parenthesis_depth += 1,
            ')' => parenthesis_depth = parenthesis_depth.saturating_sub(1),
            '>' if square_depth == 0 && parenthesis_depth == 0 => {
                candidate = Some((index, '>', index + 1));
            }
            character
                if character.is_whitespace() && square_depth == 0 && parenthesis_depth == 0 =>
            {
                let previous_non_whitespace = selector[..index].trim_end();
                let next_index = characters[position..]
                    .iter()
                    .find(|(_, next)| !next.is_whitespace())
                    .map_or(selector.len(), |(next_index, _)| *next_index);
                if !previous_non_whitespace.ends_with('>')
                    && selector[next_index..].chars().next() != Some('>')
                {
                    candidate = Some((previous_non_whitespace.len(), ' ', next_index));
                }
            }
            _ => {}
        }
    }
    let (left_end, combinator, right_start) = candidate?;
    let left = selector[..left_end].trim();
    let right = selector[right_start..].trim();
    (!left.is_empty() && !right.is_empty()).then_some((left, combinator, right))
}

fn css_compound_matches(
    compound: &str,
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> StaticSelectorMatch {
    let node = ctx.nodes().get_node(node_id);
    let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
        return StaticSelectorMatch::NoMatch;
    };
    let bytes = compound.as_bytes();
    let mut index = 0;
    let mut result = StaticSelectorMatch::Match;
    while index < bytes.len() {
        if bytes[index].is_ascii_whitespace() {
            index += 1;
            continue;
        }
        let component_match = match bytes[index] {
            b'*' => {
                index += 1;
                StaticSelectorMatch::Match
            }
            b'.' | b'#' => {
                let marker = bytes[index];
                let end = css_identifier_end(bytes, index + 1);
                let name = &compound[index + 1..end];
                index = end;
                css_named_selector_matches(opening_element, marker, name)
            }
            b'[' => {
                let Some(end) = find_matching_css_delimiter(compound, index, b'[', b']') else {
                    return StaticSelectorMatch::Ambiguous;
                };
                let selector_match =
                    css_attribute_selector_matches(opening_element, &compound[index + 1..end]);
                index = end + 1;
                selector_match
            }
            b':' => {
                if bytes.get(index + 1) == Some(&b':') {
                    return StaticSelectorMatch::NoMatch;
                }
                let name_end = css_identifier_end(bytes, index + 1);
                let name = &compound[index + 1..name_end];
                if bytes.get(name_end) == Some(&b'(') {
                    let Some(end) = find_matching_css_delimiter(compound, name_end, b'(', b')')
                    else {
                        return StaticSelectorMatch::Ambiguous;
                    };
                    let arguments = &compound[name_end + 1..end];
                    index = end + 1;
                    css_functional_pseudo_matches(name, arguments, node_id, ctx)
                } else {
                    index = name_end;
                    css_pseudo_matches(name, node_id, ctx)
                }
            }
            _ => {
                let end = css_identifier_end(bytes, index);
                if end == index {
                    return StaticSelectorMatch::Ambiguous;
                }
                let tag = &compound[index..end];
                index = end;
                if resolve_jsx_element_type(opening_element, ctx)
                    .is_some_and(|(name, _)| name.eq_ignore_ascii_case(tag))
                {
                    StaticSelectorMatch::Match
                } else {
                    StaticSelectorMatch::NoMatch
                }
            }
        };
        result = combine_selector_match(result, component_match);
        if result == StaticSelectorMatch::NoMatch {
            return result;
        }
    }
    result
}

fn css_identifier_end(bytes: &[u8], start: usize) -> usize {
    let mut index = start;
    while index < bytes.len()
        && (bytes[index].is_ascii_alphanumeric() || matches!(bytes[index], b'-' | b'_' | b'\\'))
    {
        index += 1;
    }
    index
}

fn css_named_selector_matches(
    opening_element: &JSXOpeningElement<'_>,
    marker: u8,
    name: &str,
) -> StaticSelectorMatch {
    let attribute_name = if marker == b'.' { "className" } else { "id" };
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, attribute_name, false)
    else {
        return StaticSelectorMatch::NoMatch;
    };
    let Some(value) = get_static_attribute_string(attribute) else {
        return StaticSelectorMatch::Ambiguous;
    };
    let matches = if marker == b'.' {
        value
            .split_ascii_whitespace()
            .any(|class_name| class_name == name)
    } else {
        value == name
    };
    if matches {
        StaticSelectorMatch::Match
    } else {
        StaticSelectorMatch::NoMatch
    }
}

fn get_static_attribute_string<'a>(attribute: &'a JSXAttribute<'_>) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn css_attribute_selector_matches(
    opening_element: &JSXOpeningElement<'_>,
    selector: &str,
) -> StaticSelectorMatch {
    let operators = ["~=", "|=", "^=", "$=", "*=", "="];
    let operation = operators
        .iter()
        .find_map(|operator| selector.find(operator).map(|index| (*operator, index)));
    let attribute_name = operation
        .map_or(selector, |(_, index)| &selector[..index])
        .trim();
    let Some(attribute) = get_authoritative_jsx_attribute(opening_element, attribute_name, false)
    else {
        return StaticSelectorMatch::NoMatch;
    };
    let Some((operator, index)) = operation else {
        return StaticSelectorMatch::Match;
    };
    let Some(attribute_value) = get_static_attribute_string(attribute) else {
        return StaticSelectorMatch::Ambiguous;
    };
    let mut selector_value = selector[index + operator.len()..].trim();
    let is_case_insensitive = selector_value.ends_with(" i");
    if is_case_insensitive {
        selector_value = selector_value[..selector_value.len() - 2].trim_end();
    }
    selector_value = selector_value.trim_matches(['\'', '"']);
    let (attribute_value, selector_value) = if is_case_insensitive {
        (
            attribute_value.to_ascii_lowercase(),
            selector_value.to_ascii_lowercase(),
        )
    } else {
        (attribute_value.to_string(), selector_value.to_string())
    };
    let matches = match operator {
        "=" => attribute_value == selector_value,
        "~=" => attribute_value
            .split_ascii_whitespace()
            .any(|part| part == selector_value),
        "|=" => {
            attribute_value == selector_value
                || attribute_value.starts_with(&format!("{selector_value}-"))
        }
        "^=" => attribute_value.starts_with(&selector_value),
        "$=" => attribute_value.ends_with(&selector_value),
        "*=" => attribute_value.contains(&selector_value),
        _ => false,
    };
    if matches {
        StaticSelectorMatch::Match
    } else {
        StaticSelectorMatch::NoMatch
    }
}

fn css_pseudo_matches(name: &str, node_id: NodeId, ctx: &LintContext<'_>) -> StaticSelectorMatch {
    if matches!(
        name,
        "active" | "focus" | "focus-visible" | "focus-within" | "hover"
    ) {
        return StaticSelectorMatch::NoMatch;
    }
    if matches!(name, "first-child" | "last-child") {
        let Some((index, total)) = static_jsx_element_position(node_id, ctx) else {
            return StaticSelectorMatch::Ambiguous;
        };
        let matches = if name == "first-child" {
            index == 1
        } else {
            index == total
        };
        return if matches {
            StaticSelectorMatch::Match
        } else {
            StaticSelectorMatch::NoMatch
        };
    }
    StaticSelectorMatch::Ambiguous
}

fn css_functional_pseudo_matches(
    name: &str,
    arguments: &str,
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> StaticSelectorMatch {
    if matches!(name, "is" | "where" | "any" | "local" | "global") {
        return combine_alternative_selector_matches(
            split_css_list(arguments)
                .iter()
                .map(|selector| selector_matches(selector, node_id, ctx)),
        );
    }
    if name == "not" {
        return match combine_alternative_selector_matches(
            split_css_list(arguments)
                .iter()
                .map(|selector| selector_matches(selector, node_id, ctx)),
        ) {
            StaticSelectorMatch::Match => StaticSelectorMatch::NoMatch,
            StaticSelectorMatch::NoMatch => StaticSelectorMatch::Match,
            StaticSelectorMatch::Ambiguous => StaticSelectorMatch::Ambiguous,
        };
    }
    if name == "nth-child" {
        if arguments.contains(" of ") {
            return StaticSelectorMatch::Ambiguous;
        }
        let Some((index, _)) = static_jsx_element_position(node_id, ctx) else {
            return StaticSelectorMatch::Ambiguous;
        };
        let argument = arguments.trim().to_ascii_lowercase();
        let matches = if argument == "odd" {
            index % 2 == 1
        } else if argument == "even" {
            index % 2 == 0
        } else if let Ok(expected) = argument.parse::<usize>() {
            index == expected
        } else {
            nth_child_expression_matches(&argument, index as i64)
        };
        return if matches {
            StaticSelectorMatch::Match
        } else {
            StaticSelectorMatch::NoMatch
        };
    }
    StaticSelectorMatch::Ambiguous
}

fn nth_child_expression_matches(expression: &str, index: i64) -> bool {
    let Some(n_index) = expression.find('n') else {
        return false;
    };
    let coefficient = match expression[..n_index].trim() {
        "" | "+" => 1,
        "-" => -1,
        value => match value.parse::<i64>() {
            Ok(value) => value,
            Err(_) => return false,
        },
    };
    let offset = expression[n_index + 1..].trim().parse::<i64>().unwrap_or(0);
    let difference = index - offset;
    coefficient != 0 && difference % coefficient == 0 && difference / coefficient >= 0
}

fn static_jsx_element_position(node_id: NodeId, ctx: &LintContext<'_>) -> Option<(usize, usize)> {
    let opening_node = ctx.nodes().get_node(node_id);
    let element_node = ctx.nodes().parent_node(opening_node.id());
    let AstKind::JSXElement(element) = element_node.kind() else {
        return None;
    };
    let parent_node = ctx.nodes().parent_node(element_node.id());
    let AstKind::JSXElement(parent) = parent_node.kind() else {
        return None;
    };
    let mut siblings = Vec::new();
    for child in &parent.children {
        match child {
            JSXChild::Element(child_element) => siblings.push(child_element.span),
            JSXChild::Text(text) if text.value.trim().is_empty() => {}
            _ => return None,
        }
    }
    let index = siblings.iter().position(|span| *span == element.span)?;
    Some((index + 1, siblings.len()))
}

fn parent_opening_node_id(node_id: NodeId, ctx: &LintContext<'_>) -> Option<NodeId> {
    let opening_node = ctx.nodes().get_node(node_id);
    let element_node = ctx.nodes().parent_node(opening_node.id());
    if !matches!(element_node.kind(), AstKind::JSXElement(_)) {
        return None;
    }
    let parent_node = ctx.nodes().parent_node(element_node.id());
    let AstKind::JSXElement(parent) = parent_node.kind() else {
        return None;
    };
    Some(parent.opening_element.node_id.get())
}

fn selector_matches_root_target(selector: &str, target: &str) -> StaticSelectorMatch {
    let selector = selector.trim();
    if split_rightmost_css_combinator(selector).is_some() || selector.contains("::") {
        return StaticSelectorMatch::NoMatch;
    }
    let expected = if target == "root" { "#root" } else { target };
    if selector == expected || selector == format!("*{expected}") {
        StaticSelectorMatch::Match
    } else if selector.starts_with(expected) {
        StaticSelectorMatch::Ambiguous
    } else {
        StaticSelectorMatch::NoMatch
    }
}

fn css_selector_specificity(selector: &str) -> CssSpecificity {
    let mut ids = 0;
    let mut classes = 0;
    let mut types = 0;
    let bytes = selector.as_bytes();
    let mut index = 0;
    let mut expects_type = true;
    while index < bytes.len() {
        match bytes[index] {
            b'#' => {
                ids += 1;
                index = css_identifier_end(bytes, index + 1);
                expects_type = false;
            }
            b'.' | b'[' => {
                classes += 1;
                if bytes[index] == b'[' {
                    index = find_matching_css_delimiter(selector, index, b'[', b']')
                        .map_or(bytes.len(), |end| end + 1);
                } else {
                    index = css_identifier_end(bytes, index + 1);
                }
                expects_type = false;
            }
            b':' => {
                let name_end = css_identifier_end(bytes, index + 1);
                let name = &selector[index + 1..name_end];
                if bytes.get(name_end) == Some(&b'(') {
                    let Some(end) = find_matching_css_delimiter(selector, name_end, b'(', b')')
                    else {
                        break;
                    };
                    if name != "where" {
                        let maximum = split_css_list(&selector[name_end + 1..end])
                            .iter()
                            .map(|part| css_selector_specificity(part))
                            .max()
                            .unwrap_or_default();
                        ids += maximum.0;
                        classes += maximum.1;
                        types += maximum.2;
                    }
                    index = end + 1;
                } else {
                    classes += 1;
                    index = name_end;
                }
                expects_type = false;
            }
            b'>' => {
                index += 1;
                expects_type = true;
            }
            byte if byte.is_ascii_whitespace() => {
                index += 1;
                expects_type = true;
            }
            b'*' => {
                index += 1;
                expects_type = false;
            }
            _ => {
                let end = css_identifier_end(bytes, index);
                if expects_type && end > index {
                    types += 1;
                }
                index = end.max(index + 1);
                expects_type = false;
            }
        }
    }
    CssSpecificity(ids, classes, types)
}
