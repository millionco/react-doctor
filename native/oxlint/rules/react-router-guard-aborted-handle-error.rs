use oxc_ast::{
    ast::{Argument, Expression},
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
    "handleError reports expected abort errors without checking request.signal.aborted.";
const ERROR_REPORTING_EXPORT_NAMES: [&str; 4] = [
    "captureError",
    "captureException",
    "logError",
    "reportError",
];

#[derive(Debug, Default, Clone)]
pub struct ReactRouterGuardAbortedHandleError;

declare_oxc_lint!(
    /// Requires abort guards before reporting React Router handleError failures.
    ReactRouterGuardAbortedHandleError,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Guard expected request aborts before reporting errors.",
);

impl Rule for ReactRouterGuardAbortedHandleError {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
            && is_react_router_file_active(ctx)
            && is_react_router_server_entry_filename(ctx)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        if !has_capability(ctx, "react-router-framework")
            || !matches!(
                node.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
            || !is_react_router_route_function(node, "handleError", ctx)
        {
            return;
        }
        let Some(error_symbol_id) = react_router_route_function_parameters(node)
            .and_then(|parameters| parameters.items.first())
            .and_then(|parameter| parameter.pattern.get_binding_identifier())
            .map(oxc_ast::ast::BindingIdentifier::symbol_id)
        else {
            return;
        };
        for candidate in ctx.nodes().iter() {
            let AstKind::CallExpression(reporting_call) = candidate.kind() else {
                continue;
            };
            if !oxc_span::GetSpan::span(node).contains_inclusive(reporting_call.span)
                || nearest_react_router_reporting_function(candidate, ctx) != Some(node.id())
                || !is_error_reporting_call(reporting_call, error_symbol_id, ctx)
                || is_reporting_call_guarded(candidate, node, ctx)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(reporting_call.span));
        }
    }
}

fn is_react_router_server_entry_filename(ctx: &ContextHost) -> bool {
    let normalized_filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    let basename = normalized_filename.rsplit('/').next().unwrap_or_default();
    [
        "entry.server.js",
        "entry.server.jsx",
        "entry.server.ts",
        "entry.server.tsx",
        "entry.server.mjs",
        "entry.server.mjsx",
        "entry.server.mts",
        "entry.server.mtsx",
        "entry.server.cjs",
        "entry.server.cjsx",
        "entry.server.cts",
        "entry.server.ctsx",
    ]
    .contains(&basename)
}

fn nearest_react_router_reporting_function(
    call_node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> Option<oxc_semantic::NodeId> {
    ctx.nodes()
        .ancestors(call_node.id())
        .find(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        })
        .map(AstNode::id)
}

fn is_error_reporting_call<'a>(
    call_expression: &oxc_ast::ast::CallExpression<'a>,
    error_symbol_id: oxc_semantic::SymbolId,
    ctx: &LintContext<'a>,
) -> bool {
    if !call_expression.arguments.iter().any(|argument| {
        matches!(
            argument,
            Argument::Identifier(identifier)
                if ctx.scoping().get_reference(identifier.reference_id()).symbol_id()
                    == Some(error_symbol_id)
        )
    }) {
        return false;
    }
    if let Expression::Identifier(identifier) = &call_expression.callee {
        return sentry_import_matches(identifier, false, ctx);
    }
    let Some(member_expression) = call_expression.callee.as_member_expression() else {
        return false;
    };
    let Some(method_name) = member_expression.static_property_name() else {
        return false;
    };
    let Expression::Identifier(object_identifier) = member_expression.object() else {
        return false;
    };
    if method_name == "error"
        && object_identifier.name == "console"
        && ctx
            .scoping()
            .get_reference(object_identifier.reference_id())
            .symbol_id()
            .is_none()
    {
        return true;
    }
    ERROR_REPORTING_EXPORT_NAMES.contains(&method_name)
        && sentry_import_matches(object_identifier, true, ctx)
}

fn sentry_import_matches<'a>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    requires_namespace: bool,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        let module_source = entry.module_request.name();
        !entry.is_type
            && (module_source == "sentry" || module_source.starts_with("@sentry/"))
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && if requires_namespace {
                matches!(
                    entry.import_name,
                    crate::module_record::ImportImportName::NamespaceObject
                )
            } else {
                matches!(
                    &entry.import_name,
                    crate::module_record::ImportImportName::Name(imported_name)
                        if ERROR_REPORTING_EXPORT_NAMES.contains(&imported_name.name())
                )
            }
    })
}

fn is_reporting_call_guarded<'a>(
    reporting_call: &AstNode<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(reporting_call.id()) {
        if ancestor.id() == function_node.id() {
            break;
        }
        let AstKind::IfStatement(if_statement) = ancestor.kind() else {
            continue;
        };
        if oxc_span::GetSpan::span(&if_statement.consequent)
            .contains_inclusive(oxc_span::GetSpan::span(reporting_call))
            && is_negated_abort_check(&if_statement.test, function_node, ctx)
        {
            return true;
        }
        if if_statement.alternate.as_ref().is_some_and(|alternate| {
            oxc_span::GetSpan::span(alternate)
                .contains_inclusive(oxc_span::GetSpan::span(reporting_call))
        }) && is_abort_check(&if_statement.test, function_node, ctx)
        {
            return true;
        }
    }
    for ancestor in ctx.nodes().ancestors(reporting_call.id()) {
        if ancestor.id() == function_node.id() {
            break;
        }
        let AstKind::BlockStatement(block_statement) = ancestor.kind() else {
            continue;
        };
        for statement in &block_statement.body {
            if oxc_span::GetSpan::span(statement)
                .contains_inclusive(oxc_span::GetSpan::span(reporting_call))
            {
                break;
            }
            let oxc_ast::ast::Statement::IfStatement(if_statement) = statement else {
                continue;
            };
            if if_statement.alternate.is_none()
                && is_abort_check(&if_statement.test, function_node, ctx)
                && statement_always_exits(&if_statement.consequent)
            {
                return true;
            }
        }
    }
    false
}

fn is_negated_abort_check<'a>(
    expression: &Expression<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::UnaryExpression(unary_expression) = expression else {
        return false;
    };
    unary_expression.operator == oxc_syntax::operator::UnaryOperator::LogicalNot
        && is_abort_check(&unary_expression.argument, function_node, ctx)
}

fn is_abort_check<'a>(
    expression: &Expression<'a>,
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Some(aborted_member) = expression.as_member_expression() else {
        return false;
    };
    if aborted_member.static_property_name() != Some("aborted") {
        return false;
    }
    let Some(signal_member) = aborted_member.object().as_member_expression() else {
        return false;
    };
    signal_member.static_property_name() == Some("signal")
        && is_route_request_expression(signal_member.object(), function_node, ctx)
}
