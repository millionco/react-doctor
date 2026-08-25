use oxc_ast::{AstKind, ast::PropertyKey};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct NoLegacyClassLifecycles;

declare_oxc_lint!(
    /// Disallow legacy React class lifecycle methods.
    NoLegacyClassLifecycles,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow legacy React class lifecycle methods.",
);

impl Rule for NoLegacyClassLifecycles {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let (key, is_static) = match node.kind() {
            AstKind::MethodDefinition(method) => (&method.key, method.r#static),
            AstKind::PropertyDefinition(property) => (&property.key, property.r#static),
            _ => return,
        };
        if is_static || !is_inside_class_with_superclass(node, ctx) {
            return;
        }
        let PropertyKey::StaticIdentifier(identifier) = key else {
            return;
        };
        let Some(message) = legacy_lifecycle_message(identifier.name.as_str()) else {
            return;
        };
        ctx.diagnostic(OxcDiagnostic::error(message).with_label(identifier.span));
    }
}

fn is_inside_class_with_superclass<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .find_map(|ancestor| match ancestor.kind() {
            AstKind::Class(class) => Some(class.heritage_expression().is_some()),
            _ => None,
        })
        .unwrap_or(false)
}

fn legacy_lifecycle_message(method_name: &str) -> Option<&'static str> {
    match method_name {
        "componentWillMount" => Some(
            "`componentWillMount` breaks under concurrent rendering, warns in React 18 & is gone in React 19. Put side effects in `componentDidMount` & initial state in the `constructor`.",
        ),
        "componentWillReceiveProps" => Some(
            "`componentWillReceiveProps` breaks under concurrent rendering, warns in React 18 & is gone in React 19. Put side effects in `componentDidUpdate` & derived state in the static `getDerivedStateFromProps`.",
        ),
        "componentWillUpdate" => Some(
            "`componentWillUpdate` breaks under concurrent rendering, warns in React 18 & is gone in React 19. Read the DOM in `getSnapshotBeforeUpdate` & do other work in `componentDidUpdate`.",
        ),
        "UNSAFE_componentWillMount" => Some(
            "`UNSAFE_componentWillMount` breaks under concurrent rendering & is gone in React 19, & the UNSAFE_ prefix only hides the warning. Put side effects in `componentDidMount` & initial state in the `constructor`.",
        ),
        "UNSAFE_componentWillReceiveProps" => Some(
            "`UNSAFE_componentWillReceiveProps` breaks under concurrent rendering & is gone in React 19, & the UNSAFE_ prefix only hides the warning. Put side effects in `componentDidUpdate` & derived state in the static `getDerivedStateFromProps`.",
        ),
        "UNSAFE_componentWillUpdate" => Some(
            "`UNSAFE_componentWillUpdate` breaks under concurrent rendering & is gone in React 19, & the UNSAFE_ prefix only hides the warning. Read the DOM in `getSnapshotBeforeUpdate` & do other work in `componentDidUpdate`.",
        ),
        _ => None,
    }
}
