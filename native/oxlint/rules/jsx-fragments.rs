use oxc_ast::{
    AstKind,
    ast::{JSXElementName, JSXMemberExpressionObject},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const SYNTAX_MESSAGE: &str = "`<React.Fragment>` is used where shorthand fragments are configured, so similar wrappers look different across the codebase.";
const ELEMENT_MESSAGE: &str = "Fragment shorthand is used where explicit fragments are configured, so similar wrappers look different across the codebase.";

#[derive(Debug, Default, Clone)]
pub struct JsxFragments;

declare_oxc_lint!(
    /// Enforce the configured React fragment form.
    JsxFragments,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce the configured React fragment form.",
);

impl Rule for JsxFragments {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::JSXElement(element) if fragment_mode(ctx) == "syntax" => {
                if element.closing_element.is_none()
                    || !element.opening_element.attributes.is_empty()
                    || !is_react_fragment(&element.opening_element.name, ctx)
                {
                    return;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(SYNTAX_MESSAGE).with_label(element.opening_element.span),
                );
            }
            AstKind::JSXFragment(fragment) if fragment_mode(ctx) == "element" => {
                ctx.diagnostic(
                    OxcDiagnostic::warn(ELEMENT_MESSAGE)
                        .with_label(fragment.opening_fragment.span()),
                );
            }
            _ => {}
        }
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }
}

fn fragment_mode<'a>(ctx: &'a LintContext<'_>) -> &'a str {
    ctx.settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("jsxFragments"))
        .and_then(|settings| settings.get("mode"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("syntax")
}

fn is_react_fragment<'a>(name: &JSXElementName<'a>, ctx: &LintContext<'a>) -> bool {
    match name {
        JSXElementName::IdentifierReference(identifier) => {
            let Some(import_entry) = resolve_identifier_import(identifier, ctx) else {
                return identifier.name == "Fragment"
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none();
            };
            import_entry.module_request.name() == "react"
                && matches!(
                    &import_entry.import_name,
                    ImportImportName::Name(imported_name) if imported_name.name() == "Fragment"
                )
        }
        JSXElementName::MemberExpression(member_expression) => {
            if member_expression.property.name != "Fragment" {
                return false;
            }
            let JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member_expression.object
            else {
                return false;
            };
            let Some(import_entry) = resolve_identifier_import(identifier, ctx) else {
                return identifier.name == "React"
                    && ctx
                        .scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id()
                        .is_none();
            };
            import_entry.module_request.name() == "react"
                && match &import_entry.import_name {
                    ImportImportName::Default(_) | ImportImportName::NamespaceObject => true,
                    ImportImportName::Name(imported_name) => imported_name.name() == "default",
                }
        }
        _ => false,
    }
}
