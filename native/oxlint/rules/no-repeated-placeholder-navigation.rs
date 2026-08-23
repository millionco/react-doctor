use oxc_ast::{AstKind, ast::JSXElementName};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "This navigation contains multiple links with placeholder destinations. Connect them to real routes or use non-interactive previews.";

#[derive(Debug, Default, Clone)]
pub struct NoRepeatedPlaceholderNavigation;

declare_oxc_lint!(
    /// Disallow repeated placeholder links in navigation containers.
    NoRepeatedPlaceholderNavigation,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Disallow repeated placeholder navigation links.",
);

impl Rule for NoRepeatedPlaceholderNavigation {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::JSXElement(element) = node.kind() else {
            return;
        };
        let JSXElementName::Identifier(identifier) = &element.opening_element.name else {
            return;
        };
        if identifier.name != "nav" && identifier.name != "aside" {
            return;
        }
        let mut descendants = Vec::new();
        collect_static_jsx_opening_elements(&element.children, &mut descendants);
        if identifier.name == "aside"
            && descendants.iter().any(|opening_element| {
                matches!(
                    &opening_element.name,
                    JSXElementName::Identifier(identifier) if identifier.name == "nav"
                )
            })
        {
            return;
        }
        let placeholder_count = descendants
            .iter()
            .filter(|opening_element| is_placeholder_anchor(opening_element))
            .take(2)
            .count();
        if placeholder_count < 2 {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(element.opening_element.span));
    }
}

fn is_placeholder_anchor(opening_element: &oxc_ast::ast::JSXOpeningElement) -> bool {
    if !matches!(
        &opening_element.name,
        JSXElementName::Identifier(identifier) if identifier.name == "a"
    ) || opening_element.attributes.iter().any(|attribute| {
        matches!(
            attribute,
            oxc_ast::ast::JSXAttributeItem::SpreadAttribute(_)
        )
    }) {
        return false;
    }
    get_authoritative_jsx_attribute(opening_element, "href", true)
        .and_then(|attribute| get_string_literal_attribute_value(attribute))
        == Some("#")
}
