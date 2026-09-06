use oxc_ast::{
    AstKind,
    ast::{JSXAttributeValue, JSXElementName, PropertyKey},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const EXECUTABLE_SCRIPT_TYPES: [&str; 3] = ["text/javascript", "application/javascript", "module"];
const MESSAGE: &str = "This blocks the page from loading until the script downloads because <script src> has no defer or async, so add defer for scripts that need the page, or async for standalone ones";

#[derive(Debug, Default, Clone)]
pub struct RenderingScriptDeferAsync;

declare_oxc_lint!(
    /// Require a loading strategy for render-blocking external scripts.
    RenderingScriptDeferAsync,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Require defer or async on external scripts.",
);

impl Rule for RenderingScriptDeferAsync {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if !matches!(
            &opening_element.name,
            JSXElementName::Identifier(identifier) if identifier.name == "script"
        ) {
            return;
        }
        let Some(source_attribute) = find_jsx_attribute(opening_element, "src") else {
            return;
        };
        if matches!(
            source_attribute.value.as_ref(),
            Some(JSXAttributeValue::StringLiteral(source))
                if rendering_script_is_bootstrap_source(source.value.as_str())
        ) || find_jsx_attribute(opening_element, "noModule").is_some()
            || rendering_script_is_post_body_placed(node, ctx)
        {
            return;
        }
        if let Some(JSXAttributeValue::StringLiteral(script_type)) =
            find_jsx_attribute(opening_element, "type")
                .and_then(|attribute| attribute.value.as_ref())
            && (script_type.value == "module"
                || !EXECUTABLE_SCRIPT_TYPES.contains(&script_type.value.as_str()))
        {
            return;
        }
        if find_jsx_attribute(opening_element, "defer").is_none()
            && find_jsx_attribute(opening_element, "async").is_none()
        {
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
        }
    }
}

fn rendering_script_is_bootstrap_source(source: &str) -> bool {
    let basename = source.rsplit('/').next().unwrap_or(source);
    rendering_script_prefixed_basename(basename, "theme", "init")
        || basename
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("__env"))
        || rendering_script_prefixed_basename(basename, "env", "config")
        || rendering_script_prefixed_basename(basename, "runtime", "env")
}

fn rendering_script_prefixed_basename(basename: &str, prefix: &str, suffix: &str) -> bool {
    let Some(remainder) = basename.get(prefix.len()..) else {
        return false;
    };
    if !basename[..prefix.len()].eq_ignore_ascii_case(prefix) {
        return false;
    }
    let remainder = remainder.strip_prefix(['-', '_', '.']).unwrap_or(remainder);
    remainder
        .get(..suffix.len())
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(suffix))
}

fn rendering_script_is_post_body_placed(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::ObjectProperty(property) => {
                let property_name = match &property.key {
                    PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
                    PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
                    _ => None,
                };
                if property_name.is_some_and(rendering_script_contains_post_body) {
                    return true;
                }
            }
            AstKind::CallExpression(call_expression) => {
                let Some(member_expression) = call_expression.callee.as_member_expression() else {
                    continue;
                };
                if matches!(
                    member_expression.object(),
                    oxc_ast::ast::Expression::Identifier(identifier)
                        if rendering_script_contains_post_body(identifier.name.as_str())
                ) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn rendering_script_contains_post_body(name: &str) -> bool {
    name.as_bytes()
        .windows(8)
        .any(|window| window.eq_ignore_ascii_case(b"postbody"))
}
