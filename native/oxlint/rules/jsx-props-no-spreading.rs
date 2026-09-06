use oxc_ast::{
    AstKind,
    ast::{Expression, JSXElementName, JSXMemberExpression, JSXMemberExpressionObject},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "You can't tell what props reach this element when you spread them.";

#[derive(Debug, Default, Clone)]
pub struct JsxPropsNoSpreading;

declare_oxc_lint!(
    /// Disallow spreading props onto JSX elements.
    JsxPropsNoSpreading,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow spreading props onto JSX elements.",
);

impl Rule for JsxPropsNoSpreading {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = jsx_props_no_spreading_settings(ctx);
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening) = node.kind() else {
                continue;
            };
            let Some(tag_name) = jsx_props_no_spreading_element_name(&opening.name) else {
                continue;
            };
            let is_custom = tag_name.contains('.')
                || tag_name
                    .as_bytes()
                    .first()
                    .is_some_and(u8::is_ascii_uppercase);
            let is_exception = settings
                .exceptions
                .iter()
                .any(|exception| exception == &tag_name);
            for attribute in &opening.attributes {
                let oxc_ast::ast::JSXAttributeItem::SpreadAttribute(spread) = attribute else {
                    continue;
                };
                if settings.explicit_spread_ignore
                    && matches!(spread.argument.get_inner_expression(), Expression::ObjectExpression(object)
                        if !object.properties.iter().any(|property| matches!(property, oxc_ast::ast::ObjectPropertyKind::SpreadProperty(_))))
                {
                    continue;
                }
                let should_enforce = if is_custom {
                    settings.custom_ignore == is_exception
                } else {
                    settings.html_ignore == is_exception
                };
                if !should_enforce {
                    continue;
                }
                ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(spread.span));
                return;
            }
        }
    }
}

fn jsx_props_no_spreading_element_name(name: &JSXElementName<'_>) -> Option<String> {
    match name {
        JSXElementName::Identifier(identifier) => Some(identifier.name.to_string()),
        JSXElementName::IdentifierReference(identifier) => Some(identifier.name.to_string()),
        JSXElementName::MemberExpression(member) => jsx_props_no_spreading_member_name(member),
        JSXElementName::ThisExpression(_) => Some("this".to_string()),
        JSXElementName::NamespacedName(_) => None,
    }
}

fn jsx_props_no_spreading_member_name(member: &JSXMemberExpression<'_>) -> Option<String> {
    let object = match &member.object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => identifier.name.to_string(),
        JSXMemberExpressionObject::MemberExpression(parent) => {
            jsx_props_no_spreading_member_name(parent)?
        }
        JSXMemberExpressionObject::ThisExpression(_) => "this".to_string(),
    };
    Some(format!("{object}.{}", member.property.name))
}

struct JsxPropsNoSpreadingSettings<'a> {
    html_ignore: bool,
    custom_ignore: bool,
    explicit_spread_ignore: bool,
    exceptions: Vec<&'a str>,
}

fn jsx_props_no_spreading_settings<'a>(
    ctx: &'a LintContext<'_>,
) -> JsxPropsNoSpreadingSettings<'a> {
    let settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("jsxPropsNoSpreading"))
        .and_then(serde_json::Value::as_object);
    let setting_is_ignore = |name| {
        settings
            .and_then(|settings| settings.get(name))
            .and_then(serde_json::Value::as_str)
            == Some("ignore")
    };
    let exceptions = settings
        .and_then(|settings| settings.get("exceptions"))
        .and_then(serde_json::Value::as_array)
        .map(|exceptions| {
            exceptions
                .iter()
                .filter_map(serde_json::Value::as_str)
                .collect()
        })
        .unwrap_or_default();
    JsxPropsNoSpreadingSettings {
        html_ignore: setting_is_ignore("html"),
        custom_ignore: setting_is_ignore("custom"),
        explicit_spread_ignore: setting_is_ignore("explicitSpread"),
        exceptions,
    }
}
