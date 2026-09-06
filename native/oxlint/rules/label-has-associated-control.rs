use oxc_ast::{
    AstKind,
    ast::{
        Expression, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::has_jsx_prop_ignore_case,
};

use super::simple_glob_matches::simple_glob_matches;

const MESSAGE_NO_LABEL: &str = "Blind users can't identify this field because screen readers find no label text, so add visible text, `aria-label`, or `aria-labelledby`.";
const MESSAGE_NO_CONTROL: &str = "Screen reader users can't tell which input this label names because it's tied to none, so add `htmlFor` or wrap the input inside it.";
const DEFAULT_CONTROL_COMPONENTS: [&str; 6] =
    ["input", "meter", "output", "progress", "select", "textarea"];
const DEFAULT_LABEL_COMPONENTS: [&str; 1] = ["label"];
const DEFAULT_LABEL_ATTRIBUTES: [&str; 3] = ["alt", "aria-label", "aria-labelledby"];
const CONTROL_NAMED_COMPONENT_PARTS: [&str; 12] = [
    "input",
    "select",
    "textarea",
    "checkbox",
    "radio",
    "switch",
    "slider",
    "combobox",
    "autocomplete",
    "picker",
    "dropdown",
    "toggle",
];
const CONTROL_RENDERING_NAME_PARTS: [&str; 15] = [
    "child",
    "control",
    "input",
    "select",
    "textarea",
    "checkbox",
    "radio",
    "field",
    "element",
    "component",
    "content",
    "widget",
    "render",
    "node",
    "slot",
];
const I18N_TRANSLATION_CALLEE_NAMES: [&str; 6] =
    ["t", "_", "__", "gettext", "formatMessage", "translate"];

#[derive(Debug, Default, Clone)]
pub struct LabelHasAssociatedControl;

struct LabelHasAssociatedControlSettings {
    label_components: Vec<String>,
    label_attributes: Vec<String>,
    control_components: Vec<String>,
    assertion: String,
    depth: f64,
    for_attributes: Vec<String>,
}

declare_oxc_lint!(
    /// Require labels to identify and associate with form controls.
    LabelHasAssociatedControl,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require labels to identify and associate with form controls.",
);

impl Rule for LabelHasAssociatedControl {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx() && !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let settings = resolve_label_has_associated_control_settings(ctx);
        let tag_name = resolve_configured_jsx_element_type(&element.opening_element, ctx);
        if !settings
            .label_components
            .iter()
            .any(|component| component == &tag_name)
        {
            return;
        }
        let has_spread_properties = element
            .opening_element
            .attributes
            .iter()
            .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)));
        let has_html_for = has_spread_properties
            || settings.for_attributes.iter().any(|attribute_name| {
                let Some(JSXAttributeItem::Attribute(attribute)) =
                    has_jsx_prop_ignore_case(&element.opening_element, attribute_name)
                else {
                    return false;
                };
                !matches!(
                    attribute.value.as_ref(),
                    Some(JSXAttributeValue::StringLiteral(string_literal))
                        if string_literal.value.is_empty()
                )
            });
        let has_control = element.children.iter().any(|child| {
            search_for_nested_control(child, 1, &settings, ctx)
        });
        if !has_accessible_label(element, &settings, ctx) {
            ctx.diagnostic(
                OxcDiagnostic::warn(MESSAGE_NO_LABEL).with_label(element.opening_element.span),
            );
            return;
        }
        let should_report = match settings.assertion.as_str() {
            "htmlFor" => !has_html_for,
            "nesting" => !has_control,
            "both" => !has_html_for || !has_control,
            _ => !has_html_for && !has_control,
        };
        if should_report {
            ctx.diagnostic(
                OxcDiagnostic::warn(MESSAGE_NO_CONTROL).with_label(element.opening_element.span),
            );
        }
    }
}

fn resolve_label_has_associated_control_settings(
    ctx: &LintContext<'_>,
) -> LabelHasAssociatedControlSettings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("labelHasAssociatedControl"));
    let string_array = |name| {
        rule_settings
            .and_then(|settings| settings.get(name))
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
    };
    let mut label_components = DEFAULT_LABEL_COMPONENTS
        .iter()
        .map(|component| (*component).to_string())
        .collect::<Vec<_>>();
    label_components.extend(string_array("labelComponents").unwrap_or_default());
    let mut label_attributes = DEFAULT_LABEL_ATTRIBUTES
        .iter()
        .map(|attribute| (*attribute).to_string())
        .collect::<Vec<_>>();
    label_attributes.extend(string_array("labelAttributes").unwrap_or_default());
    let for_attributes = ctx.settings().jsx_a11y.attributes.get("for").map_or_else(
        || vec!["htmlFor".to_string()],
        |attributes| attributes.iter().map(ToString::to_string).collect(),
    );
    LabelHasAssociatedControlSettings {
        label_components,
        label_attributes,
        control_components: string_array("controlComponents").unwrap_or_default(),
        assertion: rule_settings
            .and_then(|settings| settings.get("assert"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("either")
            .to_string(),
        depth: rule_settings
            .and_then(|settings| settings.get("depth"))
            .and_then(serde_json::Value::as_f64)
            .unwrap_or(5.0)
            .min(25.0),
        for_attributes,
    }
}

fn has_accessible_label<'a>(
    element: &JSXElement<'a>,
    settings: &LabelHasAssociatedControlSettings,
    ctx: &LintContext<'a>,
) -> bool {
    if element.opening_element.attributes.iter().any(|attribute| {
        match attribute {
            JSXAttributeItem::SpreadAttribute(_) => true,
            JSXAttributeItem::Attribute(attribute) => {
                let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                    return false;
                };
                settings
                    .label_attributes
                    .iter()
                    .any(|configured_name| configured_name == attribute_name.name.as_str())
            }
        }
    }) {
        return true;
    }
    element.children.iter().any(|child| {
        search_for_accessible_label(child, 1, settings, ctx)
    })
}

fn search_for_accessible_label<'a>(
    child: &JSXChild<'a>,
    current_depth: u32,
    settings: &LabelHasAssociatedControlSettings,
    ctx: &LintContext<'a>,
) -> bool {
    if f64::from(current_depth) > settings.depth {
        return false;
    }
    match child {
        JSXChild::ExpressionContainer(_) => true,
        JSXChild::Text(text) => !text.value.trim().is_empty(),
        JSXChild::Fragment(fragment) => fragment.children.iter().any(|child| {
            search_for_accessible_label(child, current_depth + 1, settings, ctx)
        }),
        JSXChild::Element(element) => {
            if element.opening_element.attributes.iter().any(|attribute| {
                match attribute {
                    JSXAttributeItem::SpreadAttribute(_) => true,
                    JSXAttributeItem::Attribute(attribute) => {
                        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
                            return false;
                        };
                        if !settings
                            .label_attributes
                            .iter()
                            .any(|configured_name| {
                                configured_name == attribute_name.name.as_str()
                            })
                        {
                            return false;
                        }
                        match attribute.value.as_ref() {
                            None => false,
                            Some(JSXAttributeValue::StringLiteral(string_literal)) => {
                                !string_literal.value.trim().is_empty()
                            }
                            Some(_) => true,
                        }
                    }
                }
            }) {
                return true;
            }
            if element.children.is_empty() {
                let tag_name =
                    resolve_configured_jsx_element_type(&element.opening_element, ctx);
                if is_label_react_component_name(&tag_name)
                    && !is_label_control_component(&tag_name, settings)
                {
                    return true;
                }
            }
            element.children.iter().any(|child| {
                search_for_accessible_label(child, current_depth + 1, settings, ctx)
            })
        }
        JSXChild::Spread(_) => false,
    }
}

fn search_for_nested_control<'a>(
    child: &JSXChild<'a>,
    current_depth: u32,
    settings: &LabelHasAssociatedControlSettings,
    ctx: &LintContext<'a>,
) -> bool {
    if f64::from(current_depth) > settings.depth {
        return false;
    }
    match child {
        JSXChild::ExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| {
                expression_may_render_control(expression, current_depth, settings, ctx)
            }),
        JSXChild::Fragment(fragment) => fragment.children.iter().any(|child| {
            search_for_nested_control(child, current_depth + 1, settings, ctx)
        }),
        JSXChild::Element(element) => {
            let tag_name = resolve_configured_jsx_element_type(&element.opening_element, ctx);
            is_label_control_component(&tag_name, settings)
                || element.children.iter().any(|child| {
                    search_for_nested_control(child, current_depth + 1, settings, ctx)
                })
        }
        JSXChild::Text(_) | JSXChild::Spread(_) => false,
    }
}

fn expression_may_render_control<'a>(
    expression: &Expression<'a>,
    current_depth: u32,
    settings: &LabelHasAssociatedControlSettings,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::BinaryExpression(_) => false,
        Expression::ConditionalExpression(conditional) => {
            expression_may_render_control(&conditional.consequent, current_depth, settings, ctx)
                || expression_may_render_control(
                    &conditional.alternate,
                    current_depth,
                    settings,
                    ctx,
                )
        }
        Expression::LogicalExpression(logical) => {
            expression_may_render_control(&logical.left, current_depth, settings, ctx)
                || expression_may_render_control(&logical.right, current_depth, settings, ctx)
        }
        Expression::JSXElement(element) => {
            let tag_name = resolve_configured_jsx_element_type(&element.opening_element, ctx);
            is_label_control_component(&tag_name, settings)
                || element.children.iter().any(|child| {
                    search_for_nested_control(child, current_depth + 1, settings, ctx)
                })
        }
        Expression::JSXFragment(fragment) => fragment
            .children
            .iter()
            .any(|child| search_for_nested_control(child, current_depth + 1, settings, ctx)),
        Expression::Identifier(identifier) => {
            label_control_rendering_name(identifier.name.as_str())
        }
        Expression::StaticMemberExpression(member_expression) => {
            label_control_rendering_name(member_expression.property.name.as_str())
        }
        Expression::ComputedMemberExpression(_) | Expression::PrivateFieldExpression(_) => true,
        Expression::CallExpression(call_expression) => !is_label_translation_call(call_expression),
        _ => true,
    }
}

fn is_label_control_component(
    tag_name: &str,
    settings: &LabelHasAssociatedControlSettings,
) -> bool {
    if DEFAULT_CONTROL_COMPONENTS.contains(&tag_name) {
        return true;
    }
    let lowercase_tag_name = tag_name.to_ascii_lowercase();
    if is_label_react_component_name(tag_name)
        && CONTROL_NAMED_COMPONENT_PARTS
            .iter()
            .any(|part| lowercase_tag_name.contains(part))
    {
        return true;
    }
    settings
        .control_components
        .iter()
        .any(|pattern| simple_glob_matches(pattern, tag_name))
}

fn is_label_react_component_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}

fn label_control_rendering_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    CONTROL_RENDERING_NAME_PARTS
        .iter()
        .any(|part| lowercase_name.contains(part))
}

fn is_label_translation_call(call_expression: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match call_expression.callee.get_inner_expression() {
        Expression::Identifier(identifier) => {
            I18N_TRANSLATION_CALLEE_NAMES.contains(&identifier.name.as_str())
        }
        Expression::StaticMemberExpression(member_expression) => I18N_TRANSLATION_CALLEE_NAMES
            .contains(&member_expression.property.name.as_str()),
        _ => false,
    }
}
