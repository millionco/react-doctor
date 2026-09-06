use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeValue, JSXExpression, JSXOpeningElement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

#[derive(Debug, Default, Clone)]
pub struct NoRedundantRoles;

declare_oxc_lint!(
    /// Disallows roles that duplicate an element's native semantics.
    NoRedundantRoles,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Redundant ARIA role.",
);

impl Rule for NoRedundantRoles {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        let curated_behavior = should_use_curated_port_behavior(ctx);
        if curated_behavior && is_local_test_scaffold_jsx(node, ctx) {
            return;
        }
        let Some(role_attribute) = jsx_attribute(opening_element, "role") else {
            return;
        };
        if curated_behavior && jsx_attribute(opening_element, "data-rac").is_some() {
            return;
        }
        let Some(JSXAttributeValue::StringLiteral(role_value)) = role_attribute.value.as_ref()
        else {
            return;
        };
        let tag = resolve_configured_jsx_element_type(opening_element, ctx);
        if curated_behavior {
            check_curated_redundant_role(
                opening_element,
                node,
                &tag,
                role_value.value.as_str(),
                role_attribute.span,
                ctx,
            );
        } else {
            check_upstream_redundant_roles(
                opening_element,
                &tag,
                role_value.value.as_str(),
                role_attribute.span,
                ctx,
            );
        }
    }
}

fn check_curated_redundant_role<'a>(
    opening_element: &JSXOpeningElement<'a>,
    node: &AstNode<'a>,
    tag: &str,
    role: &str,
    report_span: oxc_span::Span,
    ctx: &LintContext<'a>,
) {
    let implicit_role = if matches!(tag, "td" | "th") {
        if same_file_table_context(node, ctx) != TableContext::Table {
            return;
        }
        if tag == "td" {
            Some("cell")
        } else if jsx_attribute(opening_element, "scope")
            .and_then(direct_string_attribute_value)
            .is_some_and(|scope| matches!(scope.to_ascii_lowercase().as_str(), "row" | "rowgroup"))
        {
            Some("rowheader")
        } else {
            Some("columnheader")
        }
    } else if matches!(tag, "input" | "a" | "area" | "link") {
        get_implicit_role(opening_element, tag, ctx)
    } else {
        element_implicit_roles(tag)
            .iter()
            .copied()
            .find(|implicit_role| *implicit_role == role)
    };
    let Some(implicit_role) = implicit_role.filter(|implicit_role| *implicit_role == role) else {
        return;
    };
    if matches!((tag, implicit_role), ("ul" | "ol", "list"))
        || curated_role_exception(ctx, tag, implicit_role)
    {
        return;
    }
    report_redundant_role(tag, implicit_role, report_span, ctx);
}

fn check_upstream_redundant_roles(
    opening_element: &JSXOpeningElement<'_>,
    tag: &str,
    roles: &str,
    report_span: oxc_span::Span,
    ctx: &LintContext<'_>,
) {
    for role in roles.split_whitespace() {
        let Some(implicit_role) = upstream_implicit_role(opening_element, tag, role) else {
            continue;
        };
        let (has_explicit_exception, is_allowed) = upstream_role_exception(ctx, tag, implicit_role);
        if is_allowed || !has_explicit_exception && tag == "nav" && implicit_role == "navigation" {
            continue;
        }
        report_redundant_role(tag, implicit_role, report_span, ctx);
        return;
    }
}

fn upstream_implicit_role<'a>(
    opening_element: &JSXOpeningElement<'_>,
    tag: &str,
    explicit_role: &'a str,
) -> Option<&'a str> {
    let normalized_role = explicit_role.to_ascii_lowercase();
    if matches!(tag, "header" | "footer" | "main" | "address") {
        return None;
    }
    if tag == "body" {
        return (normalized_role == "document").then_some("document");
    }
    if tag == "img" {
        if jsx_attribute(opening_element, "alt").and_then(direct_string_attribute_value) == Some("")
            || jsx_attribute(opening_element, "src")
                .and_then(direct_string_attribute_value)
                .is_some_and(|source| source.contains(".svg"))
        {
            return None;
        }
        return (normalized_role == "img").then_some("img");
    }
    if tag == "input" {
        return upstream_input_implicit_role(opening_element, &normalized_role);
    }
    if tag == "select" {
        let is_multiple =
            jsx_attribute(opening_element, "multiple").is_some_and(attribute_is_truthy);
        let size = jsx_attribute(opening_element, "size")
            .and_then(static_attribute_number)
            .unwrap_or(0.0);
        let implicit_role = if is_multiple || size > 1.0 {
            "listbox"
        } else {
            "combobox"
        };
        return (normalized_role == implicit_role).then_some(implicit_role);
    }
    element_implicit_roles(tag)
        .iter()
        .copied()
        .find(|implicit_role| implicit_role.eq_ignore_ascii_case(&normalized_role))
}

fn upstream_input_implicit_role(
    opening_element: &JSXOpeningElement<'_>,
    explicit_role: &str,
) -> Option<&'static str> {
    let input_type = match jsx_attribute(opening_element, "type") {
        None => "text",
        Some(attribute) => match attribute.value.as_ref() {
            Some(JSXAttributeValue::StringLiteral(value)) => value.value.as_str(),
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                match &container.expression {
                    JSXExpression::StringLiteral(value) => value.value.as_str(),
                    JSXExpression::BooleanLiteral(_) | JSXExpression::NumericLiteral(_) => {
                        return None;
                    }
                    _ => "text",
                }
            }
            _ => "text",
        },
    }
    .to_ascii_lowercase();
    let implicit_role = match input_type.as_str() {
        "button" | "image" | "reset" | "submit" => "button",
        "checkbox" => "checkbox",
        "radio" => "radio",
        "range" => "slider",
        "number" => "spinbutton",
        "search" if explicit_role == "searchbox" => "searchbox",
        "search" if jsx_attribute(opening_element, "list").is_some() => "combobox",
        "search" => return None,
        "email" | "tel" | "url" | "text" | "" if explicit_role == "textbox" => "textbox",
        "email" | "tel" | "url" | "text" | ""
            if jsx_attribute(opening_element, "list").is_some() =>
        {
            "combobox"
        }
        _ => return None,
    };
    (explicit_role == implicit_role).then_some(implicit_role)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TableContext {
    Table,
    Grid,
    Unknown,
    None,
}

fn same_file_table_context(node: &AstNode<'_>, ctx: &LintContext<'_>) -> TableContext {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            continue;
        };
        let ancestor_role_attribute = jsx_attribute(&element.opening_element, "role");
        match ancestor_role_attribute.and_then(direct_string_attribute_value) {
            Some("grid" | "treegrid") => return TableContext::Grid,
            Some("table") => return TableContext::Table,
            _ => {}
        }
        if resolve_configured_jsx_element_type(&element.opening_element, ctx) == "table" {
            return if ancestor_role_attribute.is_some() {
                TableContext::Unknown
            } else {
                TableContext::Table
            };
        }
    }
    TableContext::None
}

fn element_implicit_roles(tag: &str) -> &'static [&'static str] {
    match tag {
        "a" => &["link"],
        "address" => &["group"],
        "area" => &["link"],
        "article" => &["article"],
        "aside" => &["complementary"],
        "blockquote" => &["blockquote"],
        "button" => &["button"],
        "caption" => &["caption"],
        "code" => &["code"],
        "datalist" => &["listbox"],
        "del" | "s" => &["deletion"],
        "details" | "fieldset" | "hgroup" | "optgroup" => &["group"],
        "dfn" => &["term"],
        "dialog" => &["dialog"],
        "em" => &["emphasis"],
        "figure" => &["figure"],
        "footer" => &["contentinfo"],
        "form" => &["form"],
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => &["heading"],
        "header" => &["banner"],
        "hr" => &["separator"],
        "img" => &["img", "image"],
        "input" => &[
            "checkbox",
            "combobox",
            "radio",
            "searchbox",
            "slider",
            "spinbutton",
            "textbox",
        ],
        "ins" => &["insertion"],
        "li" => &["listitem"],
        "main" => &["main"],
        "math" => &["math"],
        "menu" | "ol" | "ul" => &["list"],
        "meter" => &["meter"],
        "nav" => &["navigation"],
        "option" => &["option"],
        "output" => &["status"],
        "p" => &["paragraph"],
        "progress" => &["progressbar"],
        "search" => &["search"],
        "section" => &["region"],
        "select" => &["combobox", "listbox"],
        "strong" => &["strong"],
        "sub" => &["subscript"],
        "sup" => &["superscript"],
        "svg" => &["graphics-document"],
        "table" => &["table"],
        "tbody" | "tfoot" | "thead" => &["rowgroup"],
        "td" => &["cell", "gridcell"],
        "textarea" => &["textbox"],
        "th" => &["columnheader", "rowheader", "gridcell"],
        "time" => &["time"],
        "tr" => &["row"],
        _ => &[],
    }
}

fn curated_role_exception(ctx: &LintContext<'_>, tag: &str, role: &str) -> bool {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("noRedundantRoles"))
        .and_then(|settings| settings.get("exceptions"))
        .and_then(|exceptions| exceptions.get(tag))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|roles| {
            roles
                .iter()
                .any(|candidate| candidate.as_str() == Some(role))
        })
}

fn upstream_role_exception(ctx: &LintContext<'_>, tag: &str, role: &str) -> (bool, bool) {
    let value = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("noRedundantRoles"))
        .and_then(|settings| settings.get(tag));
    let Some(roles) = value.and_then(serde_json::Value::as_array) else {
        return (false, false);
    };
    if !roles.iter().all(serde_json::Value::is_string) {
        return (false, false);
    }
    (
        true,
        roles
            .iter()
            .any(|candidate| candidate.as_str() == Some(role)),
    )
}

fn attribute_is_truthy(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> bool {
    match attribute.value.as_ref() {
        None => true,
        Some(JSXAttributeValue::StringLiteral(value)) => !value.value.is_empty(),
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::BooleanLiteral(value) => value.value,
            JSXExpression::NumericLiteral(value) => value.value != 0.0,
            JSXExpression::StringLiteral(value) => !value.value.is_empty(),
            _ => false,
        },
        _ => false,
    }
}

fn static_attribute_number(attribute: &oxc_ast::ast::JSXAttribute<'_>) -> Option<f64> {
    match attribute.value.as_ref()? {
        JSXAttributeValue::StringLiteral(value) => {
            let value = value.value.trim();
            if value.is_empty() {
                Some(0.0)
            } else {
                value.parse().ok()
            }
        }
        JSXAttributeValue::ExpressionContainer(container) => match &container.expression {
            JSXExpression::NumericLiteral(value) => Some(value.value),
            JSXExpression::StringLiteral(value) => {
                let value = value.value.trim();
                if value.is_empty() {
                    Some(0.0)
                } else {
                    value.parse().ok()
                }
            }
            JSXExpression::BooleanLiteral(value) => Some(if value.value { 1.0 } else { 0.0 }),
            JSXExpression::NullLiteral(_) => Some(0.0),
            _ => None,
        },
        _ => None,
    }
}

fn direct_string_attribute_value<'a>(
    attribute: &'a oxc_ast::ast::JSXAttribute<'a>,
) -> Option<&'a str> {
    let JSXAttributeValue::StringLiteral(value) = attribute.value.as_ref()? else {
        return None;
    };
    Some(value.value.as_str())
}

fn jsx_attribute<'a>(
    opening_element: &'a JSXOpeningElement<'a>,
    name: &'a str,
) -> Option<&'a oxc_ast::ast::JSXAttribute<'a>> {
    has_jsx_prop_ignore_case(opening_element, name).and_then(JSXAttributeItem::as_attribute)
}

fn report_redundant_role(tag: &str, role: &str, span: oxc_span::Span, ctx: &LintContext<'_>) {
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "Screen reader users gain nothing from this `role` because `<{tag}>` already acts as a `{role}`, so remove it."
        ))
        .with_label(span),
    );
}
