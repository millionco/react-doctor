use oxc_ast::{
    ast::{BindingPattern, Expression, JSXAttributeItem, JSXAttributeValue, JSXElementName},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str = "This transition callback drops the promise returned by navigation.";
const REACT_ROUTER_RUNTIME_PACKAGE_NAMES: [&str; 5] = [
    "@react-router/cloudflare",
    "@react-router/node",
    "react-router/dom",
    "react-router-dom",
    "react-router",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterReturnNavigationPromiseInTransition;

declare_oxc_lint!(
    /// Requires transition callbacks to return navigation promises.
    ReactRouterReturnNavigationPromiseInTransition,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require transition callbacks to return navigation promises.",
);

impl Rule for ReactRouterReturnNavigationPromiseInTransition {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run_once(&self, ctx: &LintContext<'_>) {
        let has_stable_transition_attribute = has_capability(ctx, "react-router:7.15");
        let mut router_provider_count = 0;
        let mut transition_enabled_router_count = 0;
        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let JSXElementName::IdentifierReference(_) = &opening_element.name else {
                continue;
            };
            if !REACT_ROUTER_RUNTIME_PACKAGE_NAMES
                .iter()
                .any(|module_source| {
                    resolve_imported_jsx_component_name(opening_element, module_source, ctx)
                        == Some("RouterProvider")
                })
            {
                continue;
            }
            router_provider_count += 1;
            if opening_element.attributes.iter().any(|attribute| {
                transition_attribute_is_enabled(attribute, has_stable_transition_attribute)
            }) {
                transition_enabled_router_count += 1;
            }
        }
        if router_provider_count != 1 || transition_enabled_router_count != 1 {
            return;
        }

        for node in ctx.nodes().iter() {
            let AstKind::VariableDeclarator(declarator) = node.kind() else {
                continue;
            };
            let BindingPattern::BindingIdentifier(navigate_binding) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(use_navigate_call)) = &declarator.init else {
                continue;
            };
            let Expression::Identifier(use_navigate_callee) = &use_navigate_call.callee else {
                continue;
            };
            if !direct_named_import_matches(
                use_navigate_callee,
                &["useNavigate"],
                &REACT_ROUTER_RUNTIME_PACKAGE_NAMES,
                ctx,
            ) {
                continue;
            }
            for reference in ctx
                .scoping()
                .get_resolved_references(navigate_binding.symbol_id())
            {
                let reference_node = ctx.nodes().get_node(reference.node_id());
                let navigation_call_node = ctx.nodes().parent_node(reference_node.id());
                let AstKind::CallExpression(navigation_call) = navigation_call_node.kind() else {
                    continue;
                };
                if navigation_call.callee.span() != reference_node.span()
                    || !is_result_discarded_call(navigation_call_node, false, ctx)
                    || !is_navigation_call_in_start_transition(navigation_call_node, ctx)
                {
                    continue;
                }
                ctx.diagnostic(
                    OxcDiagnostic::warn(MESSAGE).with_label(navigation_call_node.span()),
                );
            }
        }
    }
}

fn transition_attribute_is_enabled(
    attribute: &JSXAttributeItem<'_>,
    has_stable_transition_attribute: bool,
) -> bool {
    let JSXAttributeItem::Attribute(attribute) = attribute else {
        return false;
    };
    let oxc_ast::ast::JSXAttributeName::Identifier(attribute_name) = &attribute.name else {
        return false;
    };
    if attribute_name.name != "unstable_useTransitions"
        && (attribute_name.name != "useTransitions" || !has_stable_transition_attribute)
    {
        return false;
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
        return true;
    };
    !matches!(
        container
            .expression
            .as_expression()
            .map(Expression::get_inner_expression),
        Some(Expression::BooleanLiteral(literal)) if !literal.value
    )
}

fn is_navigation_call_in_start_transition<'a>(
    navigation_call_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(callback) = crate::ast_util::get_enclosing_function(navigation_call_node, ctx) else {
        return false;
    };
    let callback_root = parenthesized_expression_root(callback, ctx);
    let transition_call_node = ctx.nodes().parent_node(callback_root.id());
    let AstKind::CallExpression(transition_call) = transition_call_node.kind() else {
        return false;
    };
    if !transition_call
        .arguments
        .first()
        .and_then(oxc_ast::ast::Argument::as_expression)
        .is_some_and(|argument| argument.span() == callback_root.span())
    {
        return false;
    }
    let Expression::Identifier(transition_callee) = &transition_call.callee else {
        return false;
    };
    direct_named_import_matches(transition_callee, &["startTransition"], &["react"], ctx)
}
