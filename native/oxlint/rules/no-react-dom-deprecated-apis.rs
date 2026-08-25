use oxc_ast::{AstKind, ast::ImportDeclarationSpecifier};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const GENERIC_TEST_UTILS_MESSAGE: &str = "react-dom/test-utils is removed in React 19, so your tests break. Use `act` from `react` & `fireEvent` / `render` from `@testing-library/react` instead";
const REACT_DOM_MODULE_SOURCES: [&str; 1] = ["react-dom"];

#[derive(Debug, Default, Clone)]
pub struct NoReactDomDeprecatedApis;

declare_oxc_lint!(
    /// Disallow React DOM APIs removed in React 19.
    NoReactDomDeprecatedApis,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow React DOM APIs removed in React 19.",
);

impl Rule for NoReactDomDeprecatedApis {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        match node.kind() {
            AstKind::ImportDeclaration(import_declaration)
                if import_declaration.source.value == "react-dom/test-utils" =>
            {
                for specifier in import_declaration.specifiers.iter().flatten() {
                    let message = match specifier {
                        ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                            test_utils_message(specifier.imported.name().as_str())
                        }
                        _ => GENERIC_TEST_UTILS_MESSAGE.to_string(),
                    };
                    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(specifier.span()));
                }
            }
            AstKind::ImportDeclaration(import_declaration)
                if import_declaration.source.value == "react-dom"
                    && !import_declaration.import_kind.is_type() =>
            {
                for specifier in import_declaration.specifiers.iter().flatten() {
                    let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                        continue;
                    };
                    if specifier.import_kind.is_type() {
                        continue;
                    }
                    let Some(message) = deprecated_api_message(specifier.imported.name().as_str())
                    else {
                        continue;
                    };
                    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(specifier.span));
                }
            }
            AstKind::StaticMemberExpression(member_expression) => {
                let Some(message) =
                    deprecated_api_message(member_expression.property.name.as_str())
                else {
                    return;
                };
                if module_api_path_matches(
                    &member_expression.object,
                    &[],
                    &REACT_DOM_MODULE_SOURCES,
                    true,
                    ctx,
                ) {
                    ctx.diagnostic(OxcDiagnostic::warn(message).with_label(member_expression.span));
                }
            }
            _ => {}
        }
    }
}

fn deprecated_api_message(api_name: &str) -> Option<&'static str> {
    match api_name {
        "render" => Some(
            "ReactDOM.render crashes your app in React 19 since it's gone, so import `createRoot` from `react-dom/client` & call `createRoot(container).render(...)`.",
        ),
        "hydrate" => Some(
            "ReactDOM.hydrate crashes hydration in React 19 since it's gone, so import `hydrateRoot` from `react-dom/client` & call `hydrateRoot(container, <App />)`.",
        ),
        "unmountComponentAtNode" => Some(
            "ReactDOM.unmountComponentAtNode won't unmount your tree in React 19 since it's gone, so keep the root you created & call `root.unmount()` instead.",
        ),
        "findDOMNode" => Some(
            "ReactDOM.findDOMNode crashes in React 19 since it's gone, & it breaks composition anyway, so pass a ref & read `ref.current` instead.",
        ),
        _ => None,
    }
}

fn test_utils_message(imported_name: &str) -> String {
    let replacement = match imported_name {
        "act" => Some("`import { act } from 'react'` instead"),
        "Simulate" => Some("`fireEvent` from `@testing-library/react` instead"),
        "renderIntoDocument" => Some("`render` from `@testing-library/react` instead"),
        "findRenderedDOMComponentWithTag" => {
            Some("`getByRole` / `getByTestId` from `@testing-library/react`")
        }
        "findRenderedDOMComponentWithClass" => {
            Some("`getByRole` or `container.querySelector` from RTL")
        }
        "scryRenderedDOMComponentsWithTag" => Some("`getAllByRole` from `@testing-library/react`"),
        _ => None,
    };
    let replacement_text = replacement.map_or_else(
        || {
            "Switch to `act` from `react` or the equivalent in `@testing-library/react`."
                .to_string()
        },
        |replacement| format!("Use {replacement}."),
    );
    format!("react-dom/test-utils is removed in React 19, so your tests break. {replacement_text}")
}
