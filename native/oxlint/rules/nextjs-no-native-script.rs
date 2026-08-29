use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttributeValue, JSXElementName, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const MESSAGE: &str = "Plain <script> has no Next.js loading strategy, so it can block rendering.";
const EXECUTABLE_SCRIPT_TYPES: [&str; 3] = ["text/javascript", "application/javascript", "module"];

#[derive(Debug, Default, Clone)]
pub struct NextjsNoNativeScript;

declare_oxc_lint!(
    /// Disallow native scripts that can block Next.js rendering.
    NextjsNoNativeScript,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow render-blocking native scripts.",
);

impl Rule for NextjsNoNativeScript {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_next_file_active(ctx)
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

        let type_attribute = resolve_static_jsx_attribute(opening_element, "type", false);
        if type_attribute.is_unknown {
            return;
        }
        let type_value = script_attribute_static_string(&type_attribute)
            .map(|value| value.trim_matches(|character| is_js_whitespace(character)))
            .map(str::to_lowercase);
        if type_value
            .as_deref()
            .is_some_and(|value| !EXECUTABLE_SCRIPT_TYPES.contains(&value))
        {
            return;
        }

        let blocking_attribute = resolve_static_jsx_attribute(opening_element, "blocking", false);
        let has_render_blocking_token = script_attribute_static_string(&blocking_attribute)
            .is_some_and(|value| {
                value
                    .split(|character| is_js_whitespace(character))
                    .any(|token| token.eq_ignore_ascii_case("render"))
            });
        let has_explicit_render_blocking =
            has_render_blocking_token && is_inside_document_head(node, ctx);
        if !has_explicit_render_blocking {
            let async_attribute = resolve_static_jsx_attribute(opening_element, "async", false);
            let defer_attribute = resolve_static_jsx_attribute(opening_element, "defer", false);
            if async_attribute.is_unknown
                || defer_attribute.is_unknown
                || script_attribute_has_enabled_boolean(&async_attribute)
                || script_attribute_has_enabled_boolean(&defer_attribute)
                || type_value.as_deref() == Some("module")
            {
                return;
            }
        }

        let source_attribute = resolve_static_jsx_attribute(opening_element, "src", false);
        let inline_html_attribute =
            resolve_static_jsx_attribute(opening_element, "dangerouslySetInnerHTML", true);
        if source_attribute.is_unknown {
            return;
        }
        let has_source = script_attribute_has_runtime_value(&source_attribute, ctx);
        if !has_source && inline_html_attribute.is_unknown {
            return;
        }
        let has_inline_html = script_attribute_has_runtime_value(&inline_html_attribute, ctx);
        if (source_attribute.is_present && !has_source && !has_inline_html)
            || (has_inline_html && !has_source)
        {
            return;
        }

        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
    }
}

fn script_attribute_static_string<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a str> {
    resolution
        .attribute
        .and_then(|attribute| get_string_literal_attribute_value(attribute))
        .or_else(|| {
            resolution
                .expression
                .and_then(|expression| get_static_string_expression(expression))
        })
}

fn script_attribute_expression<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
) -> Option<&'a Expression<'a>> {
    if let Some(expression) = resolution.expression {
        return Some(expression.get_inner_expression());
    }
    let JSXAttributeValue::ExpressionContainer(container) = resolution.attribute?.value.as_ref()?
    else {
        return None;
    };
    Some(container.expression.as_expression()?.get_inner_expression())
}

fn script_attribute_has_enabled_boolean(resolution: &StaticJsxAttributeResolution<'_>) -> bool {
    if !resolution.is_present {
        return false;
    }
    if resolution
        .attribute
        .is_some_and(|attribute| attribute.value.is_none())
    {
        return true;
    }
    if resolution.attribute.is_some_and(|attribute| {
        matches!(
            attribute.value.as_ref(),
            Some(JSXAttributeValue::StringLiteral(_))
        )
    }) {
        return true;
    }
    script_attribute_expression(resolution)
        .and_then(|expression| static_literal_truthiness(expression))
        .unwrap_or(false)
}

fn script_attribute_has_runtime_value<'a>(
    resolution: &StaticJsxAttributeResolution<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if !resolution.is_present {
        return false;
    }
    if resolution
        .attribute
        .is_some_and(|attribute| attribute.value.is_none())
    {
        return true;
    }
    if resolution.attribute.is_some_and(|attribute| {
        matches!(
            attribute.value.as_ref(),
            Some(JSXAttributeValue::StringLiteral(_))
        )
    }) {
        return true;
    }
    let Some(expression) = script_attribute_expression(resolution) else {
        return false;
    };
    match expression {
        Expression::NullLiteral(_) => false,
        Expression::BooleanLiteral(literal) => literal.value,
        Expression::UnaryExpression(unary) if is_literal_void_expression(unary) => false,
        Expression::Identifier(identifier)
            if identifier.name == "undefined"
                && ctx
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            false
        }
        _ => true,
    }
}

fn is_inside_document_head(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        match ancestor.kind() {
            AstKind::JSXAttribute(_) => return false,
            AstKind::JSXElement(element)
                if is_next_document_head(&element.opening_element, ctx) =>
            {
                return true;
            }
            _ => {}
        }
    }
    false
}

fn is_next_document_head<'a>(
    opening_element: &JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match &opening_element.name {
        JSXElementName::Identifier(identifier) => identifier.name == "head",
        JSXElementName::IdentifierReference(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            ctx.module_record().import_entries.iter().any(|entry| {
                !entry.is_type
                    && entry.module_request.name() == "next/head"
                    && matches!(&entry.import_name, ImportImportName::Default(_))
                    && ctx
                        .scoping()
                        .get_root_binding(entry.local_name.name().into())
                        == Some(symbol_id)
            })
        }
        _ => false,
    }
}
