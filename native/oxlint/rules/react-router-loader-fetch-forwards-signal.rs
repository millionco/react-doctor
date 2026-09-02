use oxc_ast::{
    ast::{Argument, BindingPattern, Expression, ObjectPropertyKind},
    AstKind,
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
    AstNode,
};

const MESSAGE: &str =
    "fetch() in this loader does not receive request.signal, so abandoned navigation work continues.";

#[derive(Debug, Default, Clone)]
pub struct ReactRouterLoaderFetchForwardsSignal;

declare_oxc_lint!(
    /// Requires React Router loader fetches to forward the navigation signal.
    ReactRouterLoaderFetchForwardsSignal,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Forward request.signal from React Router loaders.",
);

impl Rule for ReactRouterLoaderFetchForwardsSignal {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx) && is_react_router_file_active(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::CallExpression(call_expression) = node.kind() else {
            return;
        };
        let Expression::Identifier(callee) = &call_expression.callee else {
            return;
        };
        if callee.name != "fetch"
            || ctx
                .scoping()
                .get_reference(callee.reference_id())
                .symbol_id()
                .is_some()
        {
            return;
        }
        let Some(loader_function) = crate::ast_util::get_enclosing_function(node, ctx) else {
            return;
        };
        if !is_loader_function(loader_function, ctx)
            || !has_route_request_parameter(loader_function)
        {
            return;
        }
        if request_input_forwards_signal(
            call_expression.arguments.first(),
            loader_function,
            ctx,
        ) || options_forward_request_signal(
            call_expression.arguments.get(1),
            loader_function,
            ctx,
        ) {
            return;
        }
        ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call_expression.span));
    }
}

fn is_loader_function(function_node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    is_react_router_route_function(function_node, "loader", ctx)
        || is_react_router_route_function(function_node, "clientLoader", ctx)
}

fn has_route_request_parameter(function_node: &AstNode<'_>) -> bool {
    let Some(first_parameter) = react_router_route_function_parameters(function_node)
        .and_then(|parameters| parameters.items.first())
    else {
        return false;
    };
    match &first_parameter.pattern {
        BindingPattern::BindingIdentifier(_) => true,
        BindingPattern::ObjectPattern(pattern) => pattern
            .properties
            .iter()
            .any(|property| property.key.static_name().as_deref() == Some("request")),
        _ => false,
    }
}

fn is_request_signal<'a>(
    expression: &Expression<'a>,
    loader_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<oxc_semantic::SymbolId>,
) -> bool {
    let candidate = expression.get_inner_expression();
    if let Some(member_expression) = candidate.as_member_expression()
        && member_expression.static_property_name() == Some("signal")
        && is_route_request_expression(member_expression.object(), loader_function, ctx)
    {
        return true;
    }
    let Expression::Identifier(identifier) = candidate else {
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
    if let Some(initializer) = destructured_signal_initializer(symbol_id, ctx) {
        return is_route_request_expression(initializer, loader_function, ctx);
    }
    resolve_direct_unreassigned_initializer(identifier, ctx).is_some_and(|initializer| {
        is_request_signal(initializer, loader_function, ctx, visited_symbol_ids)
    })
}

fn destructured_signal_initializer<'a>(
    symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return None;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(
        parent.kind(),
        AstKind::VariableDeclaration(variable_declaration)
            if variable_declaration.kind.is_const()
    ) || !pattern.properties.iter().any(|property| {
        property.key.static_name().as_deref() == Some("signal")
            && binding_pattern_has_symbol(&property.value, symbol_id)
    }) {
        return None;
    }
    declarator.init.as_ref()
}

fn options_forward_request_signal<'a>(
    options: Option<&Argument<'a>>,
    loader_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(options) = options else {
        return false;
    };
    let Some(candidate) = options.as_expression().map(Expression::get_inner_expression) else {
        return true;
    };
    if matches!(candidate, Expression::NullLiteral(_))
        || matches!(
            candidate,
            Expression::UnaryExpression(unary_expression)
                if unary_expression.operator == oxc_syntax::operator::UnaryOperator::Void
        )
        || matches!(
            candidate,
            Expression::Identifier(identifier)
                if identifier.name == "undefined"
                    && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none()
        )
    {
        return false;
    }
    let Expression::ObjectExpression(object_expression) = candidate else {
        return true;
    };
    for property in &object_expression.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return true;
        };
        if property.key.static_name().as_deref() != Some("signal") {
            continue;
        }
        return is_request_signal(
            &property.value,
            loader_function,
            ctx,
            &mut Vec::new(),
        );
    }
    false
}

fn request_input_forwards_signal<'a>(
    input: Option<&Argument<'a>>,
    loader_function: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(candidate) = input
        .and_then(Argument::as_expression)
        .map(Expression::get_inner_expression)
    else {
        return false;
    };
    if is_route_request_expression(candidate, loader_function, ctx) {
        return true;
    }
    let Expression::NewExpression(new_expression) = candidate else {
        return false;
    };
    let Expression::Identifier(callee) = &new_expression.callee else {
        return false;
    };
    callee.name == "Request"
        && ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
            .is_none()
        && options_forward_request_signal(
            new_expression.arguments.get(1),
            loader_function,
            ctx,
        )
}
