use oxc_ast::{
    ast::{JSXChild, JSXExpression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{context::LintContext, rule::Rule, AstNode};

const MESSAGE: &str = "React Native's <Image> does not render children, so this content silently disappears. Use <ImageBackground> to layer content over an image.";
const REACT_NATIVE_MODULE_SOURCE: &str = "react-native";

#[derive(Debug, Default, Clone)]
pub struct RnNoImageChildren;

declare_oxc_lint!(
    /// Disallow children inside React Native Image components.
    RnNoImageChildren,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow children inside React Native Image components.",
);

impl Rule for RnNoImageChildren {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let Some(local_name) = resolve_jsx_element_name(&element.opening_element) else {
            return;
        };
        if !is_named_react_native_image_import(local_name, ctx)
            || !element.children.iter().any(is_meaningful_image_child)
        {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_named_react_native_image_import(local_name: &str, ctx: &LintContext) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == REACT_NATIVE_MODULE_SOURCE
            && entry.local_name.name() == local_name
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "Image"
            )
    })
}

fn is_meaningful_image_child(child: &JSXChild) -> bool {
    match child {
        JSXChild::Element(_) | JSXChild::Fragment(_) => true,
        JSXChild::Text(text) => !text
            .value
            .chars()
            .all(|character| is_js_whitespace(character)),
        JSXChild::ExpressionContainer(container) => match &container.expression {
            JSXExpression::EmptyExpression(_) | JSXExpression::NullLiteral(_) => false,
            JSXExpression::BooleanLiteral(boolean) => boolean.value,
            JSXExpression::Identifier(identifier) if identifier.name == "undefined" => false,
            _ => true,
        },
        JSXChild::Spread(_) => false,
    }
}
