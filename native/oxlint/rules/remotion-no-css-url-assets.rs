use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const MESSAGE: &str = "Remotion cannot detect when a CSS `url()` asset has loaded, so the rendered frame can flicker. Render or preload the source with <Img> instead.";
const CSS_URL_PROPERTY_NAMES: [&str; 3] = ["backgroundImage", "maskImage", "WebkitMaskImage"];

#[derive(Debug, Default, Clone)]
pub struct RemotionNoCssUrlAssets;

declare_oxc_lint!(
    /// Require Remotion-aware loading for CSS URL assets.
    RemotionNoCssUrlAssets,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require Remotion-aware loading for CSS URL assets.",
);

impl Rule for RemotionNoCssUrlAssets {
    fn run_once(&self, ctx: &LintContext<'_>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::JSXAttribute(attribute) = node.kind() else {
                continue;
            };
            let Some(style) = get_inline_style_object_expression(attribute) else {
                continue;
            };
            if !is_render_phase_component_or_hook(node, ctx)
                || !remotion_render_function_has_evidence(node, ctx)
            {
                continue;
            }
            let Some(render_function) = enclosing_named_react_function(node, ctx) else {
                continue;
            };
            for property in &style.properties {
                let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) = property else {
                    continue;
                };
                if !property.key.static_name().is_some_and(|property_name| {
                    CSS_URL_PROPERTY_NAMES.contains(&property_name.as_ref())
                }) {
                    continue;
                }
                let Some(css_value) = get_static_string_expression(&property.value) else {
                    continue;
                };
                let Some(asset_source) = extract_css_url_asset(css_value) else {
                    continue;
                };
                if asset_source.starts_with("data:")
                    || asset_source.starts_with('#')
                    || component_preloads_static_image(render_function, asset_source, ctx)
                {
                    continue;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(property.span));
            }
        }
    }
}

fn enclosing_named_react_function<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && component_or_hook_function_name(ancestor, ctx).is_some()
    })
}

fn component_preloads_static_image<'a>(
    component: &AstNode<'a>,
    asset_source: &str,
    ctx: &LintContext<'a>,
) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !component.span().contains_inclusive(candidate.span()) {
            return false;
        }
        let AstKind::JSXOpeningElement(opening_element) = candidate.kind() else {
            return false;
        };
        if resolve_imported_jsx_component_name(opening_element, "remotion", ctx) != Some("Img") {
            return false;
        }
        find_jsx_attribute(opening_element, "src")
            .and_then(|attribute| get_string_literal_attribute_value(attribute))
            == Some(asset_source)
    })
}

fn extract_css_url_asset(css_value: &str) -> Option<&str> {
    let lowercase_value = css_value.to_ascii_lowercase();
    for (url_offset, _) in lowercase_value.match_indices("url(") {
        if url_offset > 0
            && (lowercase_value.as_bytes()[url_offset - 1].is_ascii_alphanumeric()
                || lowercase_value.as_bytes()[url_offset - 1] == b'_')
        {
            continue;
        }
        let closing_offset = css_value[url_offset + 4..].find(')')? + url_offset + 4;
        let mut asset_source = css_value[url_offset + 4..closing_offset].trim();
        if (asset_source.starts_with('"') && asset_source.ends_with('"'))
            || (asset_source.starts_with('\'') && asset_source.ends_with('\''))
        {
            asset_source = asset_source[1..asset_source.len() - 1].trim();
        }
        if !asset_source.is_empty()
            && !asset_source.contains(|character| matches!(character, '"' | '\'' | ')'))
        {
            return Some(asset_source);
        }
    }
    None
}
