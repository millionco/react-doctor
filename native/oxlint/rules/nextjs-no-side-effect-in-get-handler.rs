use oxc_ast::{
    AstKind,
    ast::{Argument, Declaration, Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::{GetSpan, Span};

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

#[derive(Debug, Default, Clone)]
pub struct NextjsNoSideEffectInGetHandler;

declare_oxc_lint!(
    /// Disallow side effects in Next.js GET route handlers.
    NextjsNoSideEffectInGetHandler,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow side effects in GET handlers.",
);

impl Rule for NextjsNoSideEffectInGetHandler {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !nextjs_get_route_file_matches(ctx)
            || nextjs_get_route_is_token_exchange(ctx)
            || nextjs_get_route_is_cron(ctx)
            || !is_next_file_active(ctx)
        {
            return;
        }
        let Some((export_span, handler_bodies)) =
            ctx.nodes().program().body.iter().find_map(|statement| {
                let Statement::ExportDeclaration(export) = statement else {
                    return None;
                };
                match &export.declaration {
                    Declaration::FunctionDeclaration(function)
                        if function
                            .id
                            .as_ref()
                            .is_some_and(|identifier| identifier.name == "GET") =>
                    {
                        Some((
                            export.span,
                            function
                                .body
                                .as_ref()
                                .map(|body| vec![(function.node_id.get(), body.span)])
                                .unwrap_or_default(),
                        ))
                    }
                    Declaration::VariableDeclaration(declaration) => declaration
                        .declarations
                        .iter()
                        .find(|declarator| {
                            declarator
                                .id
                                .get_binding_identifier()
                                .is_some_and(|identifier| identifier.name == "GET")
                        })
                        .map(|declarator| {
                            (
                                export.span,
                                declarator
                                    .init
                                    .as_ref()
                                    .map(|initializer| {
                                        nextjs_resolve_get_bodies(initializer, ctx, 3)
                                    })
                                    .unwrap_or_default(),
                            )
                        }),
                    _ => None,
                }
            })
        else {
            return;
        };
        if handler_bodies.is_empty() {
            return;
        }
        let side_effect =
            handler_bodies
                .into_iter()
                .find_map(|(function_node_id, function_span)| {
                    let (safe_bindings, cookie_bindings) =
                        collect_side_effect_bindings(function_node_id, function_span, ctx);
                    find_side_effect_with_bindings(
                        function_span,
                        &safe_bindings,
                        &cookie_bindings,
                        ctx,
                    )
                    .or_else(|| {
                        nextjs_get_one_hop_side_effect(
                            function_node_id,
                            function_span,
                            &safe_bindings,
                            &cookie_bindings,
                            ctx,
                        )
                    })
                });
        let Some(side_effect) = side_effect else {
            return;
        };
        let message = if let Some(segment) = nextjs_get_mutating_route_segment(ctx) {
            format!(
                "This GET handler on the \"/{segment}\" route performs a side effect ({side_effect}) and is prone to CSRF vulnerabilities, since prefetching or a forged request can trigger it."
            )
        } else {
            format!(
                "This GET handler's side effect ({side_effect}) is prone to CSRF vulnerabilities, since prefetching or a forged request can trigger it."
            )
        };
        ctx.diagnostic(OxcDiagnostic::error(message).with_label(export_span));
    }
}

fn nextjs_get_route_file_matches(ctx: &LintContext<'_>) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    let Some((without_extension, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    without_extension.ends_with("/route")
        && matches!(extension, "js" | "jsx" | "ts" | "tsx" | "mjs" | "mts")
}

fn nextjs_get_route_is_token_exchange(ctx: &LintContext<'_>) -> bool {
    ctx.file_path()
        .to_string_lossy()
        .replace('\\', "/")
        .split('/')
        .any(|segment| {
            matches!(
                segment.to_ascii_lowercase().as_str(),
                "callback" | "verify" | "verify-email" | "confirm" | "confirm-email" | "magic-link"
            )
        })
}

fn nextjs_get_route_is_cron(ctx: &LintContext<'_>) -> bool {
    let normalized = ctx.file_path().to_string_lossy().replace('\\', "/");
    let segments = normalized.split('/').collect::<Vec<_>>();
    segments
        .iter()
        .any(|segment| segment.eq_ignore_ascii_case("cron"))
        || segments.windows(2).any(|segments| {
            segments[0].eq_ignore_ascii_case("jobs") && segments[1].eq_ignore_ascii_case("cron")
        })
}

fn nextjs_resolve_get_bodies<'a>(
    expression: &'a Expression<'a>,
    ctx: &LintContext<'a>,
    remaining_depth: usize,
) -> Vec<(oxc_semantic::NodeId, Span)> {
    if remaining_depth == 0 {
        return Vec::new();
    }
    match expression {
        Expression::FunctionExpression(function) => function
            .body
            .as_ref()
            .map(|body| vec![(function.node_id.get(), body.span)])
            .unwrap_or_default(),
        Expression::ArrowFunctionExpression(function) => nextjs_arrow_body(function)
            .map(|body| vec![body])
            .unwrap_or_default(),
        Expression::CallExpression(call) => {
            for argument in &call.arguments {
                let Some(argument_expression) = argument.as_expression() else {
                    continue;
                };
                if let Some(body) = nextjs_function_expression_body(argument_expression) {
                    return vec![body];
                }
                let Expression::Identifier(identifier) = argument_expression else {
                    continue;
                };
                let bodies = nextjs_program_binding_bodies(identifier, ctx, remaining_depth - 1);
                if !bodies.is_empty() {
                    return bodies;
                }
                if let Some(initializer) = nextjs_program_binding_expression(identifier, ctx) {
                    let chained_bodies = nextjs_chained_get_bodies(initializer);
                    if !chained_bodies.is_empty() {
                        return chained_bodies;
                    }
                }
            }
            Vec::new()
        }
        Expression::Identifier(identifier) => {
            nextjs_program_binding_bodies(identifier, ctx, remaining_depth - 1)
        }
        _ => Vec::new(),
    }
}

fn nextjs_function_expression_body<'a>(
    expression: &'a Expression<'a>,
) -> Option<(oxc_semantic::NodeId, Span)> {
    match expression {
        Expression::FunctionExpression(function) => function
            .body
            .as_ref()
            .map(|body| (function.node_id.get(), body.span)),
        Expression::ArrowFunctionExpression(function) => nextjs_arrow_body(function),
        _ => None,
    }
}

fn nextjs_arrow_body(
    function: &oxc_ast::ast::ArrowFunctionExpression<'_>,
) -> Option<(oxc_semantic::NodeId, Span)> {
    function
        .get_expression()
        .map(GetSpan::span)
        .or_else(|| function.get_function_body().map(|body| body.span))
        .map(|span| (function.node_id.get(), span))
}

fn nextjs_program_binding_expression<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    let symbol_id = ctx.scoping().get_root_binding(identifier.name)?;
    if !is_program_owned_variable_declarator(symbol_id, ctx) {
        return None;
    }
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return None;
    };
    declarator.init.as_ref()
}

fn nextjs_program_binding_bodies<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    ctx: &LintContext<'a>,
    remaining_depth: usize,
) -> Vec<(oxc_semantic::NodeId, Span)> {
    if remaining_depth == 0 {
        return Vec::new();
    }
    let Some(symbol_id) = ctx.scoping().get_root_binding(identifier.name) else {
        return Vec::new();
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(_) if is_program_owned_variable_declarator(symbol_id, ctx) => {
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                return Vec::new();
            };
            declarator
                .init
                .as_ref()
                .map(|initializer| nextjs_resolve_get_bodies(initializer, ctx, remaining_depth))
                .unwrap_or_default()
        }
        AstKind::Function(function) if nextjs_program_owned_function(function, ctx) => function
            .body
            .as_ref()
            .map(|body| vec![(function.node_id.get(), body.span)])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn nextjs_program_owned_function(
    function: &oxc_ast::ast::Function<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(function.node_id.get());
    match parent.kind() {
        AstKind::Program(_) => true,
        AstKind::ExportNamedDeclaration(_) => {
            matches!(
                ctx.nodes().parent_node(parent.id()).kind(),
                AstKind::Program(_)
            )
        }
        _ => false,
    }
}

fn nextjs_chained_get_bodies(initializer: &Expression<'_>) -> Vec<(oxc_semantic::NodeId, Span)> {
    let mut bodies = Vec::new();
    let mut cursor = initializer;
    while let Expression::CallExpression(call) = cursor {
        let Expression::StaticMemberExpression(member) = &call.callee else {
            break;
        };
        if member.property.name == "get"
            && call.arguments.len() >= 2
            && call
                .arguments
                .first()
                .is_some_and(nextjs_get_string_like_argument)
            && let Some(body) = call
                .arguments
                .last()
                .and_then(Argument::as_expression)
                .and_then(nextjs_function_expression_body)
        {
            bodies.push(body);
        }
        cursor = member.object.get_inner_expression();
    }
    bodies
}

fn nextjs_get_string_like_argument(argument: &Argument<'_>) -> bool {
    matches!(
        argument.as_expression(),
        Some(Expression::StringLiteral(_) | Expression::TemplateLiteral(_))
    )
}

fn nextjs_get_one_hop_side_effect(
    function_node_id: oxc_semantic::NodeId,
    function_span: Span,
    safe_bindings: &rustc_hash::FxHashSet<String>,
    cookie_bindings: &rustc_hash::FxHashSet<String>,
    ctx: &LintContext<'_>,
) -> Option<String> {
    ctx.nodes().iter().find_map(|candidate| {
        let AstKind::CallExpression(call) = candidate.kind() else {
            return None;
        };
        if !function_span.contains_inclusive(call.span) {
            return None;
        }
        let Expression::Identifier(identifier) = &call.callee else {
            return None;
        };
        let symbol_id = ctx.scoping().get_root_binding(identifier.name)?;
        let declaration = ctx.symbol_declaration(symbol_id);
        let (helper_span, parameters) = match declaration.kind() {
            AstKind::Function(function)
                if nextjs_program_owned_function(function, ctx)
                    && function.node_id.get() != function_node_id =>
            {
                (function.body.as_ref()?.span, &function.params)
            }
            AstKind::VariableDeclarator(declarator)
                if is_program_owned_variable_declarator(symbol_id, ctx) =>
            {
                match declarator.init.as_ref()? {
                    Expression::FunctionExpression(function) => {
                        if function.node_id.get() == function_node_id {
                            return None;
                        }
                        (function.body.as_ref()?.span, &function.params)
                    }
                    Expression::ArrowFunctionExpression(arrow) => {
                        if arrow.node_id.get() == function_node_id {
                            return None;
                        }
                        let span = arrow
                            .get_expression()
                            .map(GetSpan::span)
                            .or_else(|| arrow.get_function_body().map(|body| body.span))?;
                        (span, &arrow.params)
                    }
                    _ => return None,
                }
            }
            _ => return None,
        };
        let mut effective_safe_bindings = safe_bindings.clone();
        for (argument, parameter) in call.arguments.iter().zip(&parameters.items) {
            if parameter.initializer.is_some() {
                continue;
            }
            let Some(Expression::Identifier(argument)) = argument.as_expression() else {
                continue;
            };
            let oxc_ast::ast::BindingPattern::BindingIdentifier(parameter) = &parameter.pattern
            else {
                continue;
            };
            if safe_bindings.contains(argument.name.as_str()) {
                effective_safe_bindings.insert(parameter.name.to_string());
            }
        }
        find_side_effect_with_bindings(helper_span, &effective_safe_bindings, cookie_bindings, ctx)
    })
}

fn nextjs_get_mutating_route_segment(ctx: &LintContext<'_>) -> Option<&'static str> {
    let filename = ctx
        .file_path()
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    [
        "logout",
        "log-out",
        "signout",
        "sign-out",
        "unsubscribe",
        "delete",
        "remove",
        "revoke",
        "cancel",
        "deactivate",
    ]
    .into_iter()
    .find(|segment| {
        filename.split('/').any(|part| {
            let cleaned = if part.starts_with('[') && part.ends_with(']') {
                ""
            } else {
                part
            };
            cleaned == *segment
        })
    })
}
