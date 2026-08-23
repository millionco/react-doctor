use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, FunctionType},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{AstNode, context::LintContext, rule::Rule};

const EFFECT_EVENT_DEPENDENCY_HOOKS: [&str; 4] =
    ["useEffect", "useLayoutEffect", "useMemo", "useCallback"];

#[derive(Debug, Default, Clone)]
pub struct NoEffectEventInDeps;

declare_oxc_lint!(
    /// Warns when a React Effect Event is listed in a dependency array.
    NoEffectEventInDeps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Warns when a React Effect Event is listed in a dependency array.",
);

impl Rule for NoEffectEventInDeps {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(hook_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(hook_call, &EFFECT_EVENT_DEPENDENCY_HOOKS, ctx)
            || !is_inside_component(node, ctx)
        {
            return;
        }
        let Some(Expression::ArrayExpression(dependencies)) = hook_call
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        for dependency in dependencies
            .elements
            .iter()
            .filter_map(oxc_ast::ast::ArrayExpressionElement::as_expression)
        {
            let Expression::Identifier(dependency_identifier) = dependency else {
                continue;
            };
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(dependency_identifier.reference_id())
                .symbol_id()
            else {
                continue;
            };
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                continue;
            };
            let BindingPattern::BindingIdentifier(binding_identifier) = &declarator.id else {
                continue;
            };
            let Some(Expression::CallExpression(effect_event_call)) = &declarator.init else {
                continue;
            };
            if binding_identifier.symbol_id() != symbol_id
                || !is_inside_component(declaration, ctx)
                || !is_react_hook_call(effect_event_call, &["useEffectEvent"], ctx)
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Listing \"{}\" in the deps defeats useEffectEvent — Effect Events are non-reactive and must be omitted from deps.",
                    dependency_identifier.name,
                ))
                .with_label(dependency_identifier.span),
            );
        }
    }
}

fn is_inside_component<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes()
        .ancestors(node.id())
        .any(|ancestor| is_component_function(ancestor, ctx))
}

fn is_component_function<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    match node.kind() {
        AstKind::Function(function) => {
            if function.r#type == FunctionType::FunctionDeclaration {
                return function.id.as_ref().is_some_and(|identifier| {
                    is_effect_event_uppercase_name(identifier.name.as_str())
                });
            }
            is_uppercase_function_variable(node, ctx)
        }
        AstKind::ArrowFunctionExpression(_) => is_uppercase_function_variable(node, ctx),
        _ => false,
    }
}

fn is_uppercase_function_variable<'a>(node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let parent = ctx.nodes().parent_node(node.id());
    let AstKind::VariableDeclarator(declarator) = parent.kind() else {
        return false;
    };
    matches!(
        &declarator.id,
        BindingPattern::BindingIdentifier(identifier)
            if is_effect_event_uppercase_name(identifier.name.as_str())
    )
}

fn is_effect_event_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
