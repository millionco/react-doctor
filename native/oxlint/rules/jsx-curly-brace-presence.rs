use oxc_ast::{
    AstKind,
    ast::{
        JSXAttributeItem, JSXAttributeValue, JSXChild, JSXElementName, JSXExpression,
        JSXExpressionContainer,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const UNNECESSARY_BRACES_MESSAGE: &str =
    "These curly braces wrap a literal value, so they add JSX noise without changing output.";
const REQUIRED_BRACES_MESSAGE: &str =
    "This JSX value needs `{ }` so React reads it as an expression instead of text.";

#[derive(Debug, Default, Clone)]
pub struct JsxCurlyBracePresence;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum CurlyBraceMode {
    Always,
    Never,
    #[default]
    Ignore,
}

#[derive(Debug)]
struct JsxCurlyBracePresenceSettings {
    props: CurlyBraceMode,
    children: CurlyBraceMode,
    prop_element_values: CurlyBraceMode,
}

impl Default for JsxCurlyBracePresenceSettings {
    fn default() -> Self {
        Self {
            props: CurlyBraceMode::Never,
            children: CurlyBraceMode::Never,
            prop_element_values: CurlyBraceMode::Ignore,
        }
    }
}

declare_oxc_lint!(
    /// Enforce consistent curly-brace presence in JSX values.
    JsxCurlyBracePresence,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce consistent curly-brace presence in JSX values.",
);

impl Rule for JsxCurlyBracePresence {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let settings = resolve_jsx_curly_brace_presence_settings(ctx);
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXElement(element) => {
                    for attribute in &element.opening_element.attributes {
                        check_jsx_curly_brace_attribute(attribute, &settings, ctx);
                    }
                    if settings.children == CurlyBraceMode::Never
                        && matches!(
                            &element.opening_element.name,
                            JSXElementName::Identifier(identifier) if identifier.name == "script"
                        )
                    {
                        continue;
                    }
                    check_jsx_curly_brace_children(&element.children, &settings, ctx);
                }
                AstKind::JSXFragment(fragment) => {
                    check_jsx_curly_brace_children(&fragment.children, &settings, ctx);
                }
                _ => {}
            }
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}

fn check_jsx_curly_brace_attribute<'a>(
    attribute: &JSXAttributeItem<'a>,
    settings: &JsxCurlyBracePresenceSettings,
    ctx: &LintContext<'a>,
) {
    let JSXAttributeItem::Attribute(attribute) = attribute else {
        return;
    };
    let Some(value) = attribute.value.as_ref() else {
        return;
    };
    match value {
        JSXAttributeValue::ExpressionContainer(container) => {
            check_jsx_curly_brace_expression_container(container, None, true, settings, ctx);
        }
        JSXAttributeValue::Element(element)
            if settings.prop_element_values == CurlyBraceMode::Always =>
        {
            report_required_curly_braces(element.span, ctx);
        }
        JSXAttributeValue::Fragment(fragment)
            if settings.prop_element_values == CurlyBraceMode::Always =>
        {
            report_required_curly_braces(fragment.span, ctx);
        }
        JSXAttributeValue::StringLiteral(string_literal)
            if settings.props == CurlyBraceMode::Always =>
        {
            report_required_curly_braces(string_literal.span, ctx);
        }
        _ => {}
    }
}

fn check_jsx_curly_brace_children<'a>(
    children: &[JSXChild<'a>],
    settings: &JsxCurlyBracePresenceSettings,
    ctx: &LintContext<'a>,
) {
    for child in children {
        match child {
            JSXChild::ExpressionContainer(container) => {
                check_jsx_curly_brace_expression_container(
                    container,
                    Some(children),
                    false,
                    settings,
                    ctx,
                );
            }
            JSXChild::Text(text)
                if settings.children == CurlyBraceMode::Always
                    && !contains_only_html_entities(&text.value)
                    && !is_whitespace_only(&text.value)
                    && !text.value.trim().is_empty() =>
            {
                report_required_curly_braces(text.span, ctx);
            }
            _ => {}
        }
    }
}

fn check_jsx_curly_brace_expression_container<'a>(
    container: &JSXExpressionContainer<'a>,
    sibling_children: Option<&[JSXChild<'a>]>,
    parent_is_attribute: bool,
    settings: &JsxCurlyBracePresenceSettings,
    ctx: &LintContext<'a>,
) {
    let allowed_mode = if parent_is_attribute {
        settings.props
    } else {
        settings.children
    };
    let has_adjacent_container = sibling_children
        .is_some_and(|children| has_adjacent_expression_container(children, container.span));
    match &container.expression {
        JSXExpression::EmptyExpression(_) => {}
        JSXExpression::JSXFragment(_)
            if !parent_is_attribute
                && settings.children == CurlyBraceMode::Never
                && !has_adjacent_container =>
        {
            report_unnecessary_curly_braces(container.span, ctx);
        }
        JSXExpression::JSXElement(element) => {
            if parent_is_attribute {
                if settings.prop_element_values == CurlyBraceMode::Never
                    && element.closing_element.is_none()
                {
                    report_unnecessary_curly_braces(container.span, ctx);
                }
            } else if settings.children == CurlyBraceMode::Never && !has_adjacent_container {
                report_unnecessary_curly_braces(container.span, ctx);
            }
        }
        JSXExpression::StringLiteral(string_literal) if allowed_mode == CurlyBraceMode::Never => {
            let raw = ctx.source_range(string_literal.span.shrink_left(1).shrink_right(1));
            if !is_allowed_string_like_in_container(
                raw,
                parent_is_attribute,
                has_adjacent_container,
            ) {
                report_unnecessary_curly_braces(container.span, ctx);
            }
        }
        JSXExpression::TemplateLiteral(template_literal)
            if allowed_mode == CurlyBraceMode::Never
                && template_literal.expressions.is_empty()
                && template_literal.quasis.len() == 1 =>
        {
            let quasi = &template_literal.quasis[0];
            let cooked = quasi
                .value
                .cooked
                .as_ref()
                .map_or(quasi.value.raw.as_str(), |value| value.as_str());
            let raw = quasi.value.raw.as_str();
            if (!parent_is_attribute && contains_any_quote(cooked))
                || is_allowed_string_like_in_container(
                    raw,
                    parent_is_attribute,
                    has_adjacent_container,
                )
            {
                return;
            }
            report_unnecessary_curly_braces(container.span, ctx);
        }
        _ => {}
    }
}

fn is_allowed_string_like_in_container(
    text: &str,
    is_prop: bool,
    has_adjacent_container: bool,
) -> bool {
    is_whitespace_only(text)
        || text.contains(['\n', '\r'])
        || contains_html_entity(text)
        || (is_prop && text.contains('"') && text.contains('\''))
        || (!is_prop && text.contains(['<', '>', '{', '}', '\\']))
        || (!is_prop && text.trim() != text)
        || text.contains("/*")
        || text.contains("*/")
        || text
            .as_bytes()
            .windows(2)
            .any(|pair| matches!(pair, [b'\\', b'n' | b'r']))
        || text
            .as_bytes()
            .windows(2)
            .any(|pair| matches!(pair, [b'\\', b'u']))
        || has_adjacent_container
}

fn is_whitespace_only(text: &str) -> bool {
    !text.is_empty() && text.chars().all(char::is_whitespace)
}

fn contains_any_quote(text: &str) -> bool {
    text.contains(['"', '\''])
}

fn contains_html_entity(text: &str) -> bool {
    let bytes = text.as_bytes();
    (0..bytes.len()).any(|index| html_entity_end(bytes, index).is_some())
}

fn contains_only_html_entities(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if let Some(entity_end) = html_entity_end(bytes, index) {
            index = entity_end;
            continue;
        }
        let character = text[index..].chars().next().unwrap();
        if !character.is_whitespace() {
            return false;
        }
        index += character.len_utf8();
    }
    true
}

fn html_entity_end(bytes: &[u8], start: usize) -> Option<usize> {
    if bytes.get(start) != Some(&b'&') {
        return None;
    }
    let mut index = start + 1;
    let content_start = index;
    while bytes
        .get(index)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'#')
    {
        index += 1;
    }
    (index > content_start && bytes.get(index) == Some(&b';')).then_some(index + 1)
}

fn has_adjacent_expression_container(children: &[JSXChild<'_>], container_span: Span) -> bool {
    let Some(container_index) = children
        .iter()
        .position(|child| child.span() == container_span)
    else {
        return false;
    };
    [
        container_index.checked_sub(1),
        container_index.checked_add(1),
    ]
    .into_iter()
    .flatten()
    .filter_map(|index| children.get(index))
    .any(JSXChild::is_expression_container)
}

fn resolve_jsx_curly_brace_presence_settings(
    ctx: &LintContext<'_>,
) -> JsxCurlyBracePresenceSettings {
    let settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("jsxCurlyBracePresence"));
    if let Some(mode) = settings
        .and_then(serde_json::Value::as_str)
        .and_then(curly_brace_mode)
    {
        return JsxCurlyBracePresenceSettings {
            props: mode,
            children: mode,
            prop_element_values: mode,
        };
    }
    let Some(settings) = settings.and_then(serde_json::Value::as_object) else {
        return JsxCurlyBracePresenceSettings::default();
    };
    JsxCurlyBracePresenceSettings {
        props: configured_curly_brace_mode(settings.get("props"), CurlyBraceMode::Never),
        children: configured_curly_brace_mode(settings.get("children"), CurlyBraceMode::Never),
        prop_element_values: configured_curly_brace_mode(
            settings.get("propElementValues"),
            CurlyBraceMode::Ignore,
        ),
    }
}

fn configured_curly_brace_mode(
    value: Option<&serde_json::Value>,
    default_mode: CurlyBraceMode,
) -> CurlyBraceMode {
    match value {
        None | Some(serde_json::Value::Null) => default_mode,
        Some(serde_json::Value::String(value)) => {
            curly_brace_mode(value).unwrap_or(CurlyBraceMode::Ignore)
        }
        Some(_) => CurlyBraceMode::Ignore,
    }
}

fn curly_brace_mode(value: &str) -> Option<CurlyBraceMode> {
    match value {
        "always" => Some(CurlyBraceMode::Always),
        "never" => Some(CurlyBraceMode::Never),
        "ignore" => Some(CurlyBraceMode::Ignore),
        _ => None,
    }
}

fn report_unnecessary_curly_braces(span: Span, ctx: &LintContext<'_>) {
    ctx.diagnostic(OxcDiagnostic::warn(UNNECESSARY_BRACES_MESSAGE).with_label(span));
}

fn report_required_curly_braces(span: Span, ctx: &LintContext<'_>) {
    ctx.diagnostic(OxcDiagnostic::warn(REQUIRED_BRACES_MESSAGE).with_label(span));
}
