use lazy_regex::{Lazy, Regex, lazy_regex};
use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeItem, JSXChild, JSXElement, ObjectPropertyKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const CURSOR_MESSAGE: &str = "This fake cursor blinks continuously in display copy without an editable surface. Remove the simulated typing effect and let the composition hold attention.";
const STABLE_COPY_MESSAGE: &str = "This stable copy pulses continuously for attention. Remove the loop and use static hierarchy unless the element represents work in progress.";
const CURSOR_EXEMPT_ELEMENT_NAMES: [&str; 4] = ["code", "input", "pre", "textarea"];
const CURSOR_EXEMPT_ROLES: [&str; 3] = ["progressbar", "status", "textbox"];
const EXCLUDED_CONTENT_DIRECTORIES: [&str; 3] = ["doc", "docs", "documentation"];

static BUSY_TEXT_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i-u)\b(?:loading|processing|saving|syncing|uploading)\b");
static CURSOR_ANIMATION_NAME_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|[-_\s])(?:blink|caret|cursor|pulse)(?:$|[-_\s])");
static INFINITE_ANIMATION_TOKEN_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|\s)infinite(?:$|\s)");
static HERO_CONTEXT_CLASS_PATTERN: Lazy<Regex> =
    lazy_regex!(r"(?i)(?:^|[-_:])(?:hero|landing|marketing|masthead)(?:$|[-_:])");
static PREFORMATTED_CONTEXT_CLASS_PATTERN: Lazy<Regex> = lazy_regex!(
    r"(?i)(?:^|[-_:])(?:code|console|diff|editor|syntax|terminal)(?:$|[-_:])"
);

#[derive(Debug, Default, Clone)]
pub struct NoDecorativePulse;

declare_oxc_lint!(
    /// Disallow continuously pulsing stable copy and fake cursors.
    NoDecorativePulse,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow continuously pulsing stable copy and fake cursors.",
);

impl Rule for NoDecorativePulse {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let has_static_cursor_glyph = has_static_cursor_glyph(element);
        let possible_cursor_glyph = get_static_jsx_text(element);
        let possible_cursor_glyph =
            possible_cursor_glyph.trim_matches(|character| is_js_whitespace(character));
        if has_static_cursor_glyph || is_cursor_glyph(possible_cursor_glyph) {
            if !has_static_cursor_glyph
                || is_excluded_cursor_content_path(ctx)
                || has_cursor_semantic_exemption(element, node, ctx)
                || !is_hero_display_context(node, ctx)
                || !has_proven_cursor_animation(&element.opening_element, ctx)
            {
                return;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(CURSOR_MESSAGE).with_label(element.opening_element.span),
            );
            return;
        }

        let opening_element = &element.opening_element;
        let Some(class_name) = get_static_class_name(opening_element) else {
            return;
        };
        let tokens = tailwind_class_name_tokens(class_name);
        if get_effective_tailwind_class_name_token(&tokens, is_tailwind_animation_utility)
            != Some("animate-pulse")
        {
            return;
        }
        let text = normalize_decorative_pulse_text(&get_static_jsx_text(element));
        if text.is_empty() || BUSY_TEXT_PATTERN.is_match(&text) || is_busy_status(opening_element) {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(STABLE_COPY_MESSAGE).with_label(opening_element.span),
        );
    }
}

fn has_static_cursor_glyph(element: &JSXElement<'_>) -> bool {
    let Some(text) = get_strict_static_cursor_children_text(&element.children) else {
        return false;
    };
    is_cursor_glyph(text.trim_matches(|character| is_js_whitespace(character)))
}

fn get_strict_static_cursor_children_text(children: &[JSXChild<'_>]) -> Option<String> {
    let mut text = String::new();
    for child in children {
        text.push_str(&get_strict_static_cursor_child_text(child)?);
    }
    Some(text)
}

fn get_strict_static_cursor_child_text(child: &JSXChild<'_>) -> Option<String> {
    match child {
        JSXChild::Text(text) => Some(text.value.to_string()),
        JSXChild::Element(element) => get_strict_static_cursor_children_text(&element.children),
        JSXChild::Fragment(fragment) => get_strict_static_cursor_children_text(&fragment.children),
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .and_then(get_strict_static_cursor_expression_text),
        _ => None,
    }
}

fn get_strict_static_cursor_expression_text(expression: &Expression<'_>) -> Option<String> {
    match expression {
        Expression::StringLiteral(string_literal) => Some(string_literal.value.to_string()),
        Expression::TemplateLiteral(template_literal) if template_literal.expressions.is_empty() => {
            Some(
                template_literal
                    .quasis
                    .iter()
                    .map(|quasi| {
                        quasi
                            .value
                            .cooked
                            .as_ref()
                            .map_or(quasi.value.raw.as_str(), |cooked| cooked.as_str())
                    })
                    .collect::<String>(),
            )
        }
        Expression::JSXElement(element) => get_strict_static_cursor_children_text(&element.children),
        Expression::JSXFragment(fragment) => {
            get_strict_static_cursor_children_text(&fragment.children)
        }
        _ => None,
    }
}

fn is_cursor_glyph(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(character) = characters.next() else {
        return false;
    };
    characters.next().is_none()
        && (matches!(character, '_' | '|' | '■' | '▮' | '❙' | '❚' | '｜')
            || ('▀'..='▟').contains(&character))
}

fn normalize_decorative_pulse_text(value: &str) -> String {
    value
        .split(is_js_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_busy_status(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    if find_jsx_attribute(opening_element, "aria-busy").is_some_and(is_busy_aria_attribute) {
        return true;
    }
    find_jsx_attribute(opening_element, "role")
        .and_then(get_string_literal_attribute_value)
        .is_some_and(|role| matches!(role, "status" | "progressbar"))
}

fn is_busy_aria_attribute(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    let Some(value) = &attribute.value else {
        return true;
    };
    match value {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            string_literal.value == "true"
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => {
            let Some(expression) = container.expression.as_expression() else {
                return true;
            };
            match expression.get_inner_expression() {
                Expression::BooleanLiteral(boolean_literal) => boolean_literal.value,
                Expression::StringLiteral(string_literal) => string_literal.value == "true",
                Expression::NullLiteral(_) => true,
                Expression::NumericLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::RegExpLiteral(_) => false,
                _ => true,
            }
        }
        _ => true,
    }
}

fn has_proven_cursor_animation<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    inline_cursor_animation_state(opening_element, ctx)
        .unwrap_or_else(|| has_static_tailwind_cursor_animation(opening_element))
}

fn inline_cursor_animation_state<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let style_attribute = get_authoritative_jsx_attribute(opening_element, "style", true)?;
    let style = get_inline_style_object_expression_with_aliases(style_attribute, ctx)?;
    if style.properties.iter().any(|property| {
        !matches!(
            property,
            ObjectPropertyKind::ObjectProperty(property) if property.key.static_name().is_some()
        )
    }) {
        return None;
    }
    if let Some(animation_property) = get_effective_static_style_property(style, "animation") {
        let animation = static_style_string_value(animation_property)?;
        return Some(is_infinite_cursor_animation(animation));
    }
    let animation_name = get_effective_static_style_property(style, "animationName");
    let iteration_count = get_effective_static_style_property(style, "animationIterationCount");
    let (Some(animation_name), Some(iteration_count)) = (animation_name, iteration_count) else {
        return None;
    };
    let animation_name = static_style_string_value(animation_name)?;
    let iteration_count = static_style_string_value(iteration_count)?;
    Some(
        iteration_count.eq_ignore_ascii_case("infinite")
            && has_cursor_animation_name(animation_name),
    )
}

fn static_style_string_value<'a>(
    property: &'a oxc_ast::ast::ObjectProperty<'a>,
) -> Option<&'a str> {
    let Expression::StringLiteral(string_literal) = &property.value else {
        return None;
    };
    Some(string_literal.value.as_str())
}

fn has_static_tailwind_cursor_animation(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
) -> bool {
    let Some(class_name) = get_static_class_name(opening_element) else {
        return false;
    };
    let tokens = tailwind_class_name_tokens(class_name);
    let Some(utility) =
        get_effective_tailwind_class_name_token(&tokens, is_tailwind_animation_utility)
    else {
        return false;
    };
    if utility == "animate-pulse" {
        return true;
    }
    let arbitrary_animation = utility
        .strip_prefix("animate-[")
        .and_then(|value| value.strip_suffix(']'))
        .or_else(|| {
            utility
                .strip_prefix("[animation:")
                .and_then(|value| value.strip_suffix(']'))
        });
    arbitrary_animation.is_some_and(|animation| {
        is_infinite_cursor_animation(&animation.replace('_', " "))
    })
}

fn is_tailwind_animation_utility(utility: &str) -> bool {
    utility.starts_with("animate-") || utility.starts_with("[animation:")
}

fn is_infinite_cursor_animation(value: &str) -> bool {
    split_css_top_level(value, ',').is_some_and(|segments| {
        segments.len() == 1
            && INFINITE_ANIMATION_TOKEN_PATTERN.is_match(value)
            && has_cursor_animation_name(value)
    })
}

fn has_cursor_animation_name(value: &str) -> bool {
    CURSOR_ANIMATION_NAME_PATTERN.is_match(&value.replace("\\_", "_"))
}

fn has_cursor_semantic_exemption<'a>(
    element: &'a JSXElement<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    has_cursor_semantic_exemption_on_opening_element(&element.opening_element, ctx)
        || ctx.nodes().ancestors(node.id()).any(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::JSXElement(ancestor_element)
                    if has_cursor_semantic_exemption_on_opening_element(
                        &ancestor_element.opening_element,
                        ctx,
                    )
            )
        })
}

fn has_cursor_semantic_exemption_on_opening_element<'a>(
    opening_element: &'a oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if opening_element
        .attributes
        .iter()
        .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)))
    {
        return true;
    }
    let element_name = resolve_jsx_element_type_name(opening_element, ctx);
    if CURSOR_EXEMPT_ELEMENT_NAMES
        .iter()
        .any(|candidate| element_name.eq_ignore_ascii_case(candidate))
        || ["Code", "Console", "Diff", "Editor", "Syntax", "Terminal"]
            .iter()
            .any(|fragment| element_name.contains(fragment))
        || has_unresolved_or_enabled_attribute(opening_element, "contentEditable")
        || has_unresolved_or_enabled_attribute(opening_element, "aria-busy")
    {
        return true;
    }
    if let Some(role_attribute) = get_authoritative_jsx_attribute(opening_element, "role", false) {
        let Some(role) = get_string_literal_attribute_value(role_attribute) else {
            return true;
        };
        let role = role
            .trim_matches(|character| is_js_whitespace(character))
            .split(is_js_whitespace)
            .next()
            .unwrap_or_default();
        if role.is_empty()
            || CURSOR_EXEMPT_ROLES
                .iter()
                .any(|candidate| role.eq_ignore_ascii_case(candidate))
        {
            return true;
        }
    }
    if let Some(live_attribute) =
        get_authoritative_jsx_attribute(opening_element, "aria-live", false)
    {
        let Some(live) = get_string_literal_attribute_value(live_attribute) else {
            return true;
        };
        if live.is_empty() || !live.eq_ignore_ascii_case("off") {
            return true;
        }
    }
    get_static_class_name(opening_element).is_some_and(|class_name| {
        tailwind_class_name_tokens(class_name).iter().any(|token| {
            PREFORMATTED_CONTEXT_CLASS_PATTERN.is_match(token.utility)
        })
    })
}

fn has_unresolved_or_enabled_attribute(
    opening_element: &oxc_ast::ast::JSXOpeningElement<'_>,
    attribute_name: &str,
) -> bool {
    get_authoritative_jsx_attribute(opening_element, attribute_name, false)
        .is_some_and(|attribute| !is_static_false_attribute(attribute))
}

fn is_static_false_attribute(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    let Some(value) = &attribute.value else {
        return false;
    };
    match value {
        oxc_ast::ast::JSXAttributeValue::StringLiteral(string_literal) => {
            string_literal.value == "false"
        }
        oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| {
                matches!(
                    expression.get_inner_expression(),
                    Expression::BooleanLiteral(boolean_literal) if !boolean_literal.value
                ) || matches!(
                    expression.get_inner_expression(),
                    Expression::StringLiteral(string_literal) if string_literal.value == "false"
                )
            }),
        _ => false,
    }
}

fn is_hero_display_context<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        let AstKind::JSXElement(ancestor_element) = ancestor.kind() else {
            return false;
        };
        let opening_element = &ancestor_element.opening_element;
        let element_name = resolve_jsx_element_type_name(opening_element, ctx);
        element_name == "h1"
            || ["Hero", "Landing", "Marketing", "Masthead"]
                .iter()
                .any(|fragment| element_name.contains(fragment))
            || get_static_class_name(opening_element).is_some_and(|class_name| {
                tailwind_class_name_tokens(class_name)
                    .iter()
                    .any(|token| HERO_CONTEXT_CLASS_PATTERN.is_match(token.utility))
            })
            || matches!(element_name.as_ref(), "header" | "section")
                && contains_static_h1_descendant(&ancestor_element.children, ctx)
    })
}

fn contains_static_h1_descendant<'a>(children: &'a [JSXChild<'a>], ctx: &LintContext<'a>) -> bool {
    children.iter().any(|child| match child {
        JSXChild::Element(element) => {
            resolve_jsx_element_type_name(&element.opening_element, ctx) == "h1"
                || contains_static_h1_descendant(&element.children, ctx)
        }
        JSXChild::Fragment(fragment) => contains_static_h1_descendant(&fragment.children, ctx),
        _ => false,
    })
}

fn is_excluded_cursor_content_path(ctx: &LintContext<'_>) -> bool {
    let root_directory = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    format!("{root_directory}/{}", ctx.file_path().to_string_lossy())
        .split(['/', '\\'])
        .any(|segment| {
            EXCLUDED_CONTENT_DIRECTORIES
                .iter()
                .any(|directory| segment.eq_ignore_ascii_case(directory))
        })
}
