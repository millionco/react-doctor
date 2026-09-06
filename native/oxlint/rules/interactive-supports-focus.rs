use oxc_ast::{
    AstKind,
    ast::{JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXExpression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    globals::HTML_TAG,
    rule::Rule,
    utils::{
        has_jsx_prop_ignore_case, is_interactive_element, is_interactive_role,
        is_non_interactive_element, is_non_interactive_role, is_presentation_role,
    },
};

const DEFAULT_TABBABLE_ROLES: [&str; 7] = [
    "button",
    "checkbox",
    "link",
    "searchbox",
    "spinbutton",
    "switch",
    "textbox",
];
const COMPOSITE_CONTAINER_ROLES: [&str; 9] = [
    "toolbar",
    "listbox",
    "menu",
    "menubar",
    "radiogroup",
    "tablist",
    "tree",
    "treegrid",
    "grid",
];
const COMPOSITE_ITEM_ROLES: [&str; 8] = [
    "option",
    "menuitem",
    "menuitemcheckbox",
    "menuitemradio",
    "treeitem",
    "tab",
    "row",
    "gridcell",
];
const INTERACTIVE_HANDLER_NAMES: [&str; 22] = [
    "onclick",
    "oncontextmenu",
    "ondblclick",
    "ondoubleclick",
    "ondrag",
    "ondragend",
    "ondragenter",
    "ondragexit",
    "ondragleave",
    "ondragover",
    "ondragstart",
    "ondrop",
    "onmousedown",
    "onmouseenter",
    "onmouseleave",
    "onmousemove",
    "onmouseout",
    "onmouseover",
    "onmouseup",
    "onkeydown",
    "onkeypress",
    "onkeyup",
];

#[derive(Debug, Default, Clone)]
pub struct InteractiveSupportsFocus;

declare_oxc_lint!(
    /// Require interactive elements to support keyboard focus.
    InteractiveSupportsFocus,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require interactive elements to support keyboard focus.",
);

impl Rule for InteractiveSupportsFocus {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            return;
        };
        if is_local_test_scaffold_jsx(node, ctx)
            || opening_element.attributes.is_empty()
            || has_any_jsx_spread_attribute(opening_element)
        {
            return;
        }
        let Some(role_attribute) = has_jsx_prop_ignore_case(opening_element, "role")
            .and_then(JSXAttributeItem::as_attribute)
        else {
            return;
        };
        let Some(role_candidates) = get_static_jsx_attribute_string_values(role_attribute, ctx)
        else {
            return;
        };
        if role_candidates.is_empty() || !has_interactive_handler(opening_element) {
            return;
        }
        let element_type = resolve_configured_jsx_element_type(opening_element, ctx);
        if !HTML_TAG.contains(element_type.as_str())
            || can_content_editable_be_tabbable(node, opening_element, ctx)
            || is_disabled_element(opening_element)
            || is_statically_hidden_from_screen_reader(opening_element, ctx)
            || is_presentation_role(opening_element)
        {
            return;
        }
        let has_tab_index = has_jsx_prop_ignore_case(opening_element, "tabIndex").is_some();
        let has_id = has_jsx_prop_ignore_case(opening_element, "id").is_some();
        for role in &role_candidates {
            if COMPOSITE_CONTAINER_ROLES.contains(&role.as_str())
                || (COMPOSITE_ITEM_ROLES.contains(&role.as_str()) && has_id)
                || !is_interactive_role(role)
                || is_interactive_element(&element_type, opening_element)
                || is_non_interactive_role(role)
                || is_non_interactive_element(&element_type, opening_element)
                || has_tab_index
            {
                return;
            }
        }
        let tabbable_roles = configured_tabbable_roles(ctx);
        let are_all_candidates_tabbable = role_candidates
            .iter()
            .all(|role| tabbable_roles.iter().any(|tabbable| tabbable == role));
        let role_display = role_candidates.join("' / '");
        let message = if are_all_candidates_tabbable {
            format!(
                "Keyboard users can't tab to this '{role_display}' because it isn't focusable, so add `tabIndex={{0}}`."
            )
        } else {
            format!(
                "Keyboard users can't focus this '{role_display}' because it can't receive focus, so add `tabIndex={{0}}` or `tabIndex={{-1}}`."
            )
        };
        ctx.diagnostic(OxcDiagnostic::warn(message).with_label(opening_element.span));
    }
}

fn has_interactive_handler(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    opening_element.attributes.iter().any(|attribute| {
        let JSXAttributeItem::Attribute(attribute) = attribute else {
            return false;
        };
        let JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
            return false;
        };
        INTERACTIVE_HANDLER_NAMES
            .iter()
            .any(|handler_name| attribute_name.name.eq_ignore_ascii_case(handler_name))
    })
}

fn is_disabled_element(opening_element: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    if has_jsx_prop_ignore_case(opening_element, "disabled").is_some() {
        return true;
    }
    let Some(JSXAttributeItem::Attribute(attribute)) =
        has_jsx_prop_ignore_case(opening_element, "aria-disabled")
    else {
        return false;
    };
    match attribute.value.as_ref() {
        Some(JSXAttributeValue::StringLiteral(string_literal)) => string_literal.value == "true",
        Some(JSXAttributeValue::ExpressionContainer(container)) => matches!(
            &container.expression,
            JSXExpression::BooleanLiteral(boolean_literal) if boolean_literal.value
        ),
        _ => false,
    }
}

fn configured_tabbable_roles<'a>(ctx: &'a LintContext<'_>) -> Vec<&'a str> {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("interactiveSupportsFocus"))
        .and_then(|settings| settings.get("tabbable"))
        .and_then(serde_json::Value::as_array)
        .map(|roles| roles.iter().filter_map(serde_json::Value::as_str).collect())
        .unwrap_or_else(|| DEFAULT_TABBABLE_ROLES.to_vec())
}
