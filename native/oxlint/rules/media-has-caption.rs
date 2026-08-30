use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttribute, JSXAttributeItem, JSXAttributeValue, JSXChild, JSXExpression,
        JSXOpeningElement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

const MESSAGE: &str = "Deaf and hard-of-hearing users need captions for this media. Add a `<track kind=\"captions\">` inside the `<audio>` or `<video>`.";

#[derive(Debug, Default, Clone)]
pub struct MediaHasCaption;

#[derive(Default)]
struct MediaHasCaptionSettings {
    audio: FxHashSet<String>,
    video: FxHashSet<String>,
    track: FxHashSet<String>,
}

declare_oxc_lint!(
    /// Requires caption tracks for statically authored audio and video.
    MediaHasCaption,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Media missing captions.",
);

impl Rule for MediaHasCaption {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = media_has_caption_settings(ctx);
        let possible_caption_track_spans = ctx
            .nodes()
            .iter()
            .filter_map(|node| {
                let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                    return None;
                };
                (settings
                    .track
                    .contains(&resolve_configured_jsx_element_type(opening_element, ctx))
                    && track_kind_might_be_captions(opening_element))
                .then_some(opening_element.span)
            })
            .collect::<Vec<_>>();

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
            if (!settings.audio.contains(&element_type) && !settings.video.contains(&element_type))
                || is_local_test_scaffold_jsx(node, ctx)
                || media_is_statically_muted(opening_element)
                || has_only_dynamic_playable_sources(opening_element, node, ctx)
            {
                continue;
            }
            let AstKind::JSXElement(element) = ctx.nodes().parent_kind(node.id()) else {
                report_media_without_caption(opening_element, ctx);
                continue;
            };
            if element
                .children
                .iter()
                .any(|child| child_may_render_caption_track(child, &possible_caption_track_spans))
                || element
                    .children
                    .iter()
                    .any(|child| direct_child_is_caption_track(child, &settings, ctx))
            {
                continue;
            }
            report_media_without_caption(opening_element, ctx);
        }
    }
}

fn media_has_caption_settings(ctx: &LintContext<'_>) -> MediaHasCaptionSettings {
    let mut settings = MediaHasCaptionSettings::default();
    settings.audio.insert("audio".to_string());
    settings.video.insert("video".to_string());
    settings.track.insert("track".to_string());
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("mediaHasCaption"));
    extend_string_setting(&mut settings.audio, rule_settings, "audio");
    extend_string_setting(&mut settings.video, rule_settings, "video");
    extend_string_setting(&mut settings.track, rule_settings, "track");
    settings
}

fn extend_string_setting(
    target: &mut FxHashSet<String>,
    settings: Option<&serde_json::Value>,
    name: &str,
) {
    let Some(values) = settings
        .and_then(|settings| settings.get(name))
        .and_then(serde_json::Value::as_array)
    else {
        return;
    };
    target.extend(
        values
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_owned),
    );
}

fn media_is_statically_muted(opening_element: &JSXOpeningElement<'_>) -> bool {
    let Some(attribute) =
        has_jsx_prop_ignore_case(opening_element, "muted").and_then(JSXAttributeItem::as_attribute)
    else {
        return false;
    };
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(value)) => value.value == "true",
        Some(JSXAttributeValue::ExpressionContainer(container)) => matches!(
            &container.expression,
            JSXExpression::BooleanLiteral(value) if value.value
        ),
        _ => false,
    }
}

fn has_only_dynamic_playable_sources<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut source_attributes = Vec::new();
    if let Some(attribute) = jsx_attribute(opening_element, "src") {
        source_attributes.push(attribute);
    }
    if let AstKind::JSXElement(element) = ctx.nodes().parent_kind(node.id()) {
        for child in &element.children {
            let JSXChild::Element(child_element) = child else {
                continue;
            };
            if resolve_configured_jsx_element_type(&child_element.opening_element, ctx) == "source"
                && let Some(attribute) = jsx_attribute(&child_element.opening_element, "src")
            {
                source_attributes.push(attribute);
            }
        }
    }
    !source_attributes.is_empty()
        && source_attributes
            .into_iter()
            .all(source_attribute_is_dynamic)
}

fn source_attribute_is_dynamic(attribute: &JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::BooleanLiteral(_)
            | JSXExpression::NullLiteral(_)
            | JSXExpression::NumericLiteral(_)
            | JSXExpression::BigIntLiteral(_)
            | JSXExpression::RegExpLiteral(_)
            | JSXExpression::StringLiteral(_) => false,
            JSXExpression::TemplateLiteral(template) => !template.expressions.is_empty(),
            _ => true,
        },
        _ => false,
    }
}

fn child_may_render_caption_track(child: &JSXChild<'_>, track_spans: &[Span]) -> bool {
    let JSXChild::ExpressionContainer(container) = child else {
        return false;
    };
    let is_dynamic_track_source = match &container.expression {
        JSXExpression::CallExpression(call_expression) => matches!(
            call_expression.callee.get_inner_expression(),
            Expression::StaticMemberExpression(member) if member.property.name == "map"
        ),
        JSXExpression::LogicalExpression(_) | JSXExpression::ConditionalExpression(_) => true,
        _ => false,
    };
    is_dynamic_track_source
        && track_spans
            .iter()
            .any(|track_span| container.expression.span().contains_inclusive(*track_span))
}

fn direct_child_is_caption_track<'a>(
    child: &JSXChild<'a>,
    settings: &MediaHasCaptionSettings,
    ctx: &LintContext<'a>,
) -> bool {
    let JSXChild::Element(element) = child else {
        return false;
    };
    settings
        .track
        .contains(&resolve_configured_jsx_element_type(
            &element.opening_element,
            ctx,
        ))
        && jsx_attribute(&element.opening_element, "kind")
            .and_then(static_attribute_string_value)
            .is_some_and(|value| value.eq_ignore_ascii_case("captions"))
}

fn track_kind_might_be_captions(opening_element: &JSXOpeningElement<'_>) -> bool {
    let Some(attribute) = jsx_attribute(opening_element, "kind") else {
        return false;
    };
    static_attribute_string_value(attribute)
        .is_none_or(|value| value.eq_ignore_ascii_case("captions"))
}

fn static_attribute_string_value<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(value) => Some(value.value.as_str()),
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::StringLiteral(value) => Some(value.value.as_str()),
            _ => None,
        },
        _ => None,
    }
}

fn jsx_attribute<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    name: &'a str,
) -> Option<&'a JSXAttribute<'a>> {
    has_jsx_prop_ignore_case(opening_element, name).and_then(JSXAttributeItem::as_attribute)
}

fn report_media_without_caption(opening_element: &JSXOpeningElement<'_>, ctx: &LintContext<'_>) {
    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.name.span()));
}
