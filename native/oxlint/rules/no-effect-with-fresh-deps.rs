use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{AstNode, context::LintContext, rule::Rule};

const FRESH_DEPENDENCY_HOOKS: [&str; 4] =
    ["useEffect", "useLayoutEffect", "useMemo", "useCallback"];

#[derive(Debug, Default, Clone)]
pub struct NoEffectWithFreshDeps;

declare_oxc_lint!(
    /// Disallow freshly allocated values in React dependency arrays.
    NoEffectWithFreshDeps,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow freshly allocated values in React dependency arrays.",
);

impl Rule for NoEffectWithFreshDeps {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if has_capability(ctx, "react-compiler") {
            return;
        }
        let AstKind::CallExpression(hook_call) = node.kind() else {
            return;
        };
        if !is_react_hook_call(hook_call, &FRESH_DEPENDENCY_HOOKS, ctx) {
            return;
        }
        let Some(dependencies_expression) = hook_call
            .arguments
            .get(1)
            .and_then(oxc_ast::ast::Argument::as_expression)
        else {
            return;
        };
        let Expression::ArrayExpression(dependencies) =
            dependencies_expression.get_inner_expression()
        else {
            return;
        };
        let hook_name = fresh_dependency_hook_name(&hook_call.callee);
        for dependency in dependencies
            .elements
            .iter()
            .filter_map(oxc_ast::ast::ArrayExpressionElement::as_expression)
        {
            let Some((fresh_kind, binding_name)) = resolve_fresh_dependency(dependency, ctx) else {
                continue;
            };
            let message = binding_name.map_or_else(
                || {
                    format!(
                        "Your {hook_name} runs every render because its deps include a new {fresh_kind} built fresh each time, so `===` always fails."
                    )
                },
                |binding_name| {
                    format!(
                        "Your {hook_name} runs every render because dep `{binding_name}` is a new {fresh_kind} built fresh each time, so `===` always fails."
                    )
                },
            );
            ctx.diagnostic(OxcDiagnostic::error(message).with_label(dependency.span()));
        }
    }
}

fn classify_fresh_dependency(expression: &Expression<'_>) -> Option<&'static str> {
    match expression.get_inner_expression() {
        Expression::ObjectExpression(_) => Some("object"),
        Expression::ArrayExpression(_) => Some("array"),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_) => {
            Some("function")
        }
        Expression::JSXElement(_) | Expression::JSXFragment(_) => Some("JSX"),
        Expression::NewExpression(_) => Some("instance"),
        _ => None,
    }
}

fn resolve_fresh_dependency<'a>(
    dependency: &'a Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<(&'static str, Option<&'a str>)> {
    if let Some(fresh_kind) = classify_fresh_dependency(dependency) {
        return Some((fresh_kind, None));
    }
    let Expression::Identifier(identifier) = dependency.get_inner_expression() else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if ctx
        .scoping()
        .scope_flags(ctx.scoping().symbol_scope_id(symbol_id))
        .is_top()
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::BindingIdentifier(binding) = &declarator.id else {
        return None;
    };
    if binding.symbol_id() != symbol_id {
        return None;
    }
    let initializer = declarator.init.as_ref()?;
    classify_fresh_dependency(initializer)
        .map(|fresh_kind| (fresh_kind, Some(identifier.name.as_str())))
}

fn fresh_dependency_hook_name<'a>(expression: &'a Expression<'a>) -> &'a str {
    match expression {
        Expression::Identifier(identifier) => identifier.name.as_str(),
        Expression::StaticMemberExpression(member) => member.property.name.as_str(),
        _ => "hook",
    }
}
