use oxc_ast::{
    AstKind,
    ast::{AssignmentTarget, Expression, MemberExpression, VariableDeclarationKind},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::Span;
use oxc_syntax::node::NodeId;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    utils::is_react_hook_name,
};

const MESSAGE: &str = "This component is defined inline inside an HOC call, so rules-of-hooks and exhaustive-deps stop analyzing it and it has no stable display name; extract it as a named base component and pass the reference to the HOC.";
const WHITELISTED_CALLEE_NAMES: [&str; 12] = [
    "useCallback",
    "useMemo",
    "forwardRef",
    "memo",
    "observer",
    "track",
    "styled",
    "map",
    "filter",
    "forEach",
    "times",
    "when",
];
const RELAY_CONTAINER_CREATOR_NAMES: [&str; 3] = [
    "createFragmentContainer",
    "createPaginationContainer",
    "createRefetchContainer",
];
const TRANSPARENT_WRAPPER_CALLEE_NAMES: [&str; 3] = ["memo", "forwardRef", "observer"];

#[derive(Debug, Default, Clone)]
pub struct NoInlineHocOnComponent;

declare_oxc_lint!(
    /// Disallow hook-calling function components defined inline inside HOC calls.
    NoInlineHocOnComponent,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow function components defined inline inside HOC calls.",
);

impl Rule for NoInlineHocOnComponent {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        for function_node in ctx.nodes().iter().filter(|node| {
            matches!(
                node.kind(),
                AstKind::ArrowFunctionExpression(_) | AstKind::Function(_)
            )
        }) {
            let passed_expression = transparent_expression_root(function_node, ctx);
            let wrapping_node = ctx.nodes().parent_node(passed_expression.id());
            let AstKind::CallExpression(wrapping_call) = wrapping_node.kind() else {
                continue;
            };
            if !expression_is_argument_at(&wrapping_call.arguments, 0, passed_expression.span()) {
                continue;
            }
            let Some(callee_name) = resolve_inline_hoc_callee_name(&wrapping_call.callee) else {
                continue;
            };
            if WHITELISTED_CALLEE_NAMES.contains(&callee_name)
                || RELAY_CONTAINER_CREATOR_NAMES.contains(&callee_name)
                || is_component_factory_name(callee_name)
                || is_named_component_function_expression(function_node)
                || !function_return_value_is_jsx(function_node, ctx)
                || !calls_hook_in_own_scope(function_node, ctx)
                || !produces_component_value(wrapping_node, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(function_node.span()));
        }
    }
}

fn resolve_inline_hoc_callee_name<'a>(callee: &'a Expression<'a>) -> Option<&'a str> {
    match callee.get_inner_expression() {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        Expression::CallExpression(call_expression) => {
            let Expression::Identifier(identifier) = call_expression.callee.get_inner_expression()
            else {
                return None;
            };
            Some(identifier.name.as_str())
        }
        _ => None,
    }
}

fn is_component_factory_name(callee_name: &str) -> bool {
    let lowercase_name = callee_name.to_ascii_lowercase();
    lowercase_name.ends_with("factory")
        || lowercase_name.ends_with("forwardref")
        || matches!(lowercase_name.as_str(), "genericmemo" | "typedmemo")
}

fn is_named_component_function_expression(function_node: &AstNode<'_>) -> bool {
    matches!(
        function_node.kind(),
        AstKind::Function(function)
            if function
                .id
                .as_ref()
                .is_some_and(|identifier| is_uppercase_name(identifier.name.as_str()))
    )
}

fn function_return_value_is_jsx<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if let AstKind::ArrowFunctionExpression(function) = function_node.kind()
        && let Some(expression) = function.get_expression()
    {
        return return_value_contains_jsx(
            expression,
            function_node,
            ctx,
            &mut Vec::new(),
        );
    }
    ctx.nodes().iter().any(|candidate| {
        let AstKind::ReturnStatement(return_statement) = candidate.kind() else {
            return false;
        };
        nearest_enclosing_function_node_id(candidate.id(), ctx) == Some(function_node.id())
            && return_statement.argument.as_ref().is_some_and(|argument| {
                return_value_contains_jsx(argument, function_node, ctx, &mut Vec::new())
            })
    })
}

fn return_value_contains_jsx<'a>(
    expression: &Expression<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if contains_jsx_in_own_expression(expression.span(), ctx) {
        return true;
    }
    let Expression::Identifier(identifier) = expression else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    let AstKind::VariableDeclaration(variable_declaration) = parent.kind() else {
        return false;
    };
    let is_stable_binding = variable_declaration.kind.is_const()
        || matches!(variable_declaration.kind, VariableDeclarationKind::Let)
            && ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .all(|reference| !reference.is_write());
    is_stable_binding
        && declarator
            .id
            .get_binding_identifier()
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && nearest_enclosing_function_node_id(declaration.id(), ctx) == Some(function_node.id())
        && declarator.init.as_ref().is_some_and(|initializer| {
            return_value_contains_jsx(initializer, function_node, ctx, visited_symbol_ids)
        })
}

fn contains_jsx_in_own_expression(expression_span: Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        expression_span.contains_inclusive(candidate.span())
            && matches!(candidate.kind(), AstKind::JSXElement(_) | AstKind::JSXFragment(_))
            && jsx_reaches_expression(candidate, expression_span, ctx)
    })
}

fn jsx_reaches_expression<'a>(
    jsx_node: &AstNode<'a>,
    expression_span: Span,
    ctx: &LintContext<'a>,
) -> bool {
    let mut current = jsx_node;
    let mut did_reach_return = false;
    loop {
        if current.span() == expression_span {
            return true;
        }
        let parent = ctx.nodes().parent_node(current.id());
        if !expression_span.contains_inclusive(parent.span()) {
            return false;
        }
        match parent.kind() {
            AstKind::ReturnStatement(return_statement)
                if return_statement.argument.as_ref().is_some_and(|argument| {
                    argument.span().contains_inclusive(current.span())
                }) =>
            {
                did_reach_return = true;
            }
            AstKind::ArrowFunctionExpression(function) => {
                let returns_current = did_reach_return
                    || function.get_expression().is_some_and(|body| {
                        body.span().contains_inclusive(current.span())
                    });
                if !returns_current || !is_synchronous_render_output_callback(parent, ctx) {
                    return false;
                }
                did_reach_return = false;
            }
            AstKind::Function(_) => {
                if !did_reach_return || !is_synchronous_render_output_callback(parent, ctx) {
                    return false;
                }
                did_reach_return = false;
            }
            _ => {}
        }
        current = parent;
    }
}

fn is_synchronous_render_output_callback<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let callback_expression = transparent_expression_root(function_node, ctx);
    let call_node = ctx.nodes().parent_node(callback_expression.id());
    let AstKind::CallExpression(call_expression) = call_node.kind() else {
        return false;
    };
    if expression_is_argument_at(&call_expression.arguments, 0, callback_expression.span()) {
        if is_react_api_call(call_expression, "useMemo", ctx) {
            return true;
        }
        return matches!(
            call_expression.callee.get_inner_expression(),
            Expression::StaticMemberExpression(member_expression)
                if matches!(member_expression.property.name.as_str(), "map" | "flatMap")
        );
    }
    expression_is_argument_at(&call_expression.arguments, 1, callback_expression.span())
        && function_executes_during_render(function_node, ctx)
}

fn calls_hook_in_own_scope<'a>(function_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    ctx.nodes().iter().any(|candidate| {
        let AstKind::CallExpression(call_expression) = candidate.kind() else {
            return false;
        };
        if !function_node.span().contains_inclusive(candidate.span())
            || nearest_enclosing_function_node_id(candidate.id(), ctx) != Some(function_node.id())
        {
            return false;
        }
        match call_expression.callee.get_inner_expression() {
            Expression::Identifier(identifier) => is_react_hook_name(identifier.name.as_str()),
            callee => callee
                .as_member_expression()
                .and_then(|member_expression| member_expression.static_property_name())
                .is_some_and(|property_name| {
                    is_react_hook_name(property_name)
                        && is_react_api_call(call_expression, property_name, ctx)
                }),
        }
    })
}

fn produces_component_value<'a>(call_node: &AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let expression_root = transparent_expression_root(call_node, ctx);
    let consumer = ctx.nodes().parent_node(expression_root.id());
    match consumer.kind() {
        AstKind::VariableDeclarator(declarator) => declarator
            .id
            .get_binding_identifier()
            .is_some_and(|identifier| is_uppercase_name(identifier.name.as_str())),
        AstKind::ExportDefaultDeclaration(_) => true,
        AstKind::AssignmentExpression(assignment)
            if assignment.right.span() == expression_root.span() =>
        {
            assignment_target_component_name(&assignment.left).is_some_and(is_uppercase_name)
        }
        AstKind::CallExpression(call_expression)
            if expression_is_argument_at(&call_expression.arguments, 0, expression_root.span()) =>
        {
            if matches!(
                call_expression.callee.get_inner_expression(),
                Expression::CallExpression(_)
            ) {
                return produces_component_value(consumer, ctx);
            }
            let is_transparent_wrapper = match call_expression.callee.get_inner_expression() {
                Expression::Identifier(identifier) => {
                    TRANSPARENT_WRAPPER_CALLEE_NAMES.contains(&identifier.name.as_str())
                }
                callee => callee.as_member_expression().is_some_and(|member_expression| {
                    let callee_name = match member_expression {
                        MemberExpression::StaticMemberExpression(member_expression) => {
                            member_expression.property.name.as_str()
                        }
                        MemberExpression::ComputedMemberExpression(member_expression) => {
                            let Expression::Identifier(identifier) = &member_expression.expression
                            else {
                                return false;
                            };
                            identifier.name.as_str()
                        }
                        MemberExpression::PrivateFieldExpression(_) => return false,
                    };
                    TRANSPARENT_WRAPPER_CALLEE_NAMES.contains(&callee_name)
                }),
            };
            is_transparent_wrapper && produces_component_value(consumer, ctx)
        }
        _ => false,
    }
}

fn assignment_target_component_name<'a>(target: &'a AssignmentTarget<'a>) -> Option<&'a str> {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(identifier) => Some(identifier.name.as_str()),
        _ => target
            .as_member_expression()
            .and_then(|member_expression| member_expression.static_property_name()),
    }
}

fn nearest_enclosing_function_node_id(
    node_id: NodeId,
    ctx: &LintContext<'_>,
) -> Option<NodeId> {
    ctx.nodes()
        .ancestors(node_id)
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .map(AstNode::id)
}

fn is_uppercase_name(name: &str) -> bool {
    name.as_bytes().first().is_some_and(u8::is_ascii_uppercase)
}
