use oxc_ast::{
    ast::{Argument, BindingPattern, Expression},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule, AstNode};

const REACTIVE_HOOK_NAMES: [&str; 2] = ["useReducer", "useState"];
const RESIZE_LISTENER_METHOD_NAMES: [&str; 3] = ["addListener", "on", "once"];

#[derive(Debug, Default, Clone)]
pub struct InkUseReactiveWindowSize;

declare_oxc_lint!(
    /// Require reactive terminal dimensions in Ink components.
    InkUseReactiveWindowSize,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require reactive terminal dimensions in Ink components.",
);

impl Rule for InkUseReactiveWindowSize {
    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let Some((stdout_expression, dimension_name, dimension_span)) =
            stdout_dimension_member(node.kind())
        else {
            return;
        };
        if !is_process_stdout_member(stdout_expression, ctx)
            || !is_render_phase_component_or_hook(node, ctx)
        {
            return;
        }
        let Some(component_node) = render_phase_component_node(node, ctx) else {
            return;
        };
        if !component_renders_ink(component_node, ctx)
            || has_stdout_resize_listener(component_node, ctx)
        {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "`process.stdout.{dimension_name}` does not make an Ink component react to resize."
            ))
            .with_label(dimension_span),
        );
    }
}

fn stdout_dimension_member<'a>(
    kind: AstKind<'a>,
) -> Option<(&'a Expression<'a>, &'static str, oxc_span::Span)> {
    match kind {
        AstKind::StaticMemberExpression(member_expression) => {
            let dimension_name = match member_expression.property.name.as_str() {
                "columns" => "columns",
                "rows" => "rows",
                _ => return None,
            };
            Some((
                &member_expression.object,
                dimension_name,
                member_expression.span,
            ))
        }
        AstKind::ComputedMemberExpression(member_expression) => {
            let Expression::StringLiteral(property) =
                member_expression.expression.get_inner_expression()
            else {
                return None;
            };
            let dimension_name = match property.value.as_str() {
                "columns" => "columns",
                "rows" => "rows",
                _ => return None,
            };
            Some((
                &member_expression.object,
                dimension_name,
                member_expression.span,
            ))
        }
        _ => None,
    }
}

fn render_phase_component_node<'a, 'b>(
    node: &AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && component_or_hook_function_name(ancestor, ctx).is_some()
    })
}

fn has_stdout_resize_listener<'a>(component_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !component_node.span().contains_inclusive(candidate.span())
            || !listener_registration_belongs_to_component(candidate, component_node, ctx)
        {
            return false;
        }
        let AstKind::CallExpression(listener_call) = candidate.kind() else {
            return false;
        };
        let Some(member_expression) = listener_call.callee.as_member_expression() else {
            return false;
        };
        if !member_expression
            .static_property_name()
            .is_some_and(|method_name| RESIZE_LISTENER_METHOD_NAMES.contains(&method_name))
            || !is_process_stdout_member(member_expression.object(), ctx)
            || !listener_call
                .arguments
                .first()
                .and_then(Argument::as_expression)
                .is_some_and(|event_name| {
                    matches!(
                        event_name.get_inner_expression(),
                        Expression::StringLiteral(value) if value.value == "resize"
                    )
                })
        {
            return false;
        }
        let Some(listener) = listener_call
            .arguments
            .get(1)
            .and_then(Argument::as_expression)
        else {
            return false;
        };
        is_react_state_updater(listener, ctx)
            || resolve_listener_function(listener, ctx, &mut FxHashSet::default())
                .is_some_and(|listener_function| listener_triggers_render(listener_function, ctx))
    })
}

fn listener_registration_belongs_to_component<'a>(
    node: &AstNode<'a>,
    component_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut enclosing_function = crate::ast_util::get_enclosing_function(node, ctx);
    while let Some(function_node) = enclosing_function {
        if function_node.id() == component_node.id() {
            return true;
        }
        if component_or_hook_function_name(function_node, ctx).is_some() {
            return false;
        }
        enclosing_function = ctx.nodes().ancestors(function_node.id()).find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        });
    }
    false
}

fn resolve_listener_function<'a, 'b>(
    expression: &Expression<'a>,
    ctx: &'b LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<oxc_semantic::SymbolId>,
) -> Option<&'b AstNode<'a>> {
    let expression = expression.get_inner_expression();
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return ctx
            .nodes()
            .iter()
            .find(|candidate| candidate.span() == expression.span());
    }
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !visited_symbol_ids.insert(symbol_id) {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if matches!(declaration.kind(), AstKind::Function(_)) {
        return Some(declaration);
    }
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    resolve_listener_function(declarator.init.as_ref()?, ctx, visited_symbol_ids)
}

fn listener_triggers_render<'a>(listener_function: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        if !listener_function
            .span()
            .contains_inclusive(candidate.span())
            || nearest_resize_listener_function_node_id(candidate, ctx)
                != Some(listener_function.id())
        {
            return false;
        }
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        is_react_state_updater(&call_expression.callee, ctx)
    })
}

fn is_react_state_updater<'a>(expression: &Expression<'a>, ctx: &LintContext<'a>) -> bool {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let BindingPattern::ArrayPattern(pattern) = &declarator.id else {
        return false;
    };
    if pattern
        .elements
        .get(1)
        .and_then(Option::as_ref)
        .and_then(BindingPattern::get_binding_identifier)
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    let Some(Expression::CallExpression(hook_call)) = declarator.init.as_ref() else {
        return false;
    };
    REACTIVE_HOOK_NAMES
        .iter()
        .any(|hook_name| is_react_api_call(hook_call, hook_name, ctx))
}

fn nearest_resize_listener_function_node_id(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}
