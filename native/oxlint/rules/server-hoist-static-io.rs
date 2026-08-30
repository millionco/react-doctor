use oxc_ast::{
    AstKind,
    ast::{Argument, ExportDefaultDeclarationKind, Expression, FormalParameters, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::NodeId;
use oxc_span::{GetSpan, Span};
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const ROUTE_HANDLER_HTTP_METHODS: [&str; 7] =
    ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
const STATIC_IO_FUNCTIONS: [&str; 8] = [
    "readFileSync",
    "readFile",
    "readdir",
    "readdirSync",
    "stat",
    "statSync",
    "access",
    "accessSync",
];
const DIRECTORY_LISTING_FUNCTIONS: [&str; 2] = ["readdir", "readdirSync"];
const FS_MUTATION_FUNCTIONS: [&str; 16] = [
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
    "unlink",
    "unlinkSync",
    "rm",
    "rmSync",
    "rmdir",
    "rmdirSync",
    "rename",
    "renameSync",
    "copyFile",
    "copyFileSync",
    "mkdir",
    "mkdirSync",
];

#[derive(Debug, Default, Clone)]
pub struct ServerHoistStaticIo;

struct ServerStaticIoReference {
    node_id: NodeId,
    span: Span,
    name: String,
}

declare_oxc_lint!(
    /// Warns when a route handler repeatedly reads request-independent static data.
    ServerHoistStaticIo,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Static file read on every request.",
);

impl Rule for ServerHoistStaticIo {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        for statement in &ctx.nodes().program().body {
            match statement {
                Statement::ExportDeclaration(export) => {
                    let oxc_ast::ast::Declaration::FunctionDeclaration(function) =
                        &export.declaration
                    else {
                        continue;
                    };
                    let Some(handler_name) =
                        function.id.as_ref().map(|identifier| &identifier.name)
                    else {
                        continue;
                    };
                    let Some(body) = &function.body else {
                        continue;
                    };
                    if ROUTE_HANDLER_HTTP_METHODS.contains(&handler_name.as_str()) {
                        server_static_io_inspect_handler(
                            body.span,
                            &function.params,
                            &format!("{handler_name} route handler"),
                            ctx,
                        );
                    }
                }
                Statement::ExportDefaultDeclaration(export)
                    if is_in_project_directory(ctx, "pages/api") =>
                {
                    match &export.declaration {
                        ExportDefaultDeclarationKind::FunctionDeclaration(function)
                            if function.r#async =>
                        {
                            if let Some(body) = &function.body {
                                server_static_io_inspect_handler(
                                    body.span,
                                    &function.params,
                                    "pages/api handler",
                                    ctx,
                                );
                            }
                        }
                        ExportDefaultDeclarationKind::ArrowFunctionExpression(function)
                            if function.r#async =>
                        {
                            if let Some(body) = function.get_function_body() {
                                server_static_io_inspect_handler(
                                    body.span,
                                    &function.params,
                                    "pages/api handler",
                                    ctx,
                                );
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

fn server_static_io_inspect_handler(
    body_span: Span,
    parameters: &FormalParameters<'_>,
    handler_label: &str,
    ctx: &LintContext<'_>,
) {
    let mut request_tainted_names = FxHashSet::default();
    for parameter in &parameters.items {
        collect_binding_pattern_names(&parameter.pattern, &mut request_tainted_names);
    }
    let handler_nodes = ctx
        .nodes()
        .iter()
        .filter(|node| body_span.contains_inclusive(node.span()))
        .collect::<Vec<_>>();
    let reference_names = handler_nodes
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::IdentifierReference(identifier) => Some(ServerStaticIoReference {
                node_id: node.id(),
                span: node.span(),
                name: identifier.name.to_string(),
            }),
            _ => None,
        })
        .collect::<Vec<_>>();
    let all_identifier_names = handler_nodes
        .iter()
        .filter_map(|node| {
            let name = match node.kind() {
                AstKind::BindingIdentifier(identifier) => identifier.name.as_str(),
                AstKind::IdentifierName(identifier) => identifier.name.as_str(),
                AstKind::IdentifierReference(identifier) => identifier.name.as_str(),
                _ => return None,
            };
            Some((node.span(), name.to_string()))
        })
        .collect::<Vec<_>>();
    let mut declarators = handler_nodes
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::VariableDeclarator(declarator) => Some(declarator),
            _ => None,
        })
        .collect::<Vec<_>>();
    declarators.sort_unstable_by_key(|declarator| declarator.span.start);
    for declarator in declarators {
        let Some(initializer) = &declarator.init else {
            continue;
        };
        if server_static_io_initializer_reads_names(
            initializer.span(),
            &request_tainted_names,
            &reference_names,
            ctx,
        ) {
            collect_binding_pattern_names(&declarator.id, &mut request_tainted_names);
        }
    }
    let mut calls = handler_nodes
        .iter()
        .filter_map(|node| match node.kind() {
            AstKind::CallExpression(call) => Some((*node, call)),
            _ => None,
        })
        .collect::<Vec<_>>();
    calls.sort_unstable_by_key(|(_, call)| call.span.start);
    let mutates_filesystem = calls.iter().any(|(_, call)| {
        server_static_io_callee_name(call).is_some_and(|name| FS_MUTATION_FUNCTIONS.contains(&name))
    });
    for (node, call) in calls {
        let Some(call_name) = server_static_io_callee_name(call) else {
            continue;
        };
        if !STATIC_IO_FUNCTIONS.contains(&call_name) && !server_static_io_is_import_meta_fetch(call)
        {
            continue;
        }
        if server_static_io_span_reads_names(
            call.span,
            &request_tainted_names,
            &all_identifier_names,
        ) || DIRECTORY_LISTING_FUNCTIONS.contains(&call_name) && mutates_filesystem
        {
            continue;
        }
        let callee_text = server_static_io_callee_text(call);
        let diagnostic = || {
            OxcDiagnostic::warn(format!(
                "{callee_text}() runs on every request in {handler_label}, re-reading the same file each time."
            ))
            .with_label(call.span)
        };
        if matches!(ctx.nodes().parent_kind(node.id()), AstKind::AwaitExpression(awaited)
            if awaited.argument.span() == call.span)
        {
            ctx.diagnostic(diagnostic());
        }
        ctx.diagnostic(diagnostic());
    }
}

fn server_static_io_initializer_reads_names(
    span: Span,
    names: &FxHashSet<String>,
    references: &[ServerStaticIoReference],
    ctx: &LintContext<'_>,
) -> bool {
    !names.is_empty()
        && references.iter().any(|reference| {
            span.contains_inclusive(reference.span)
                && names.contains(&reference.name)
                && !ctx.nodes().ancestors(reference.node_id).any(|ancestor| {
                    if !span.contains_inclusive(ancestor.span()) {
                        return false;
                    }
                    let parameters = match ancestor.kind() {
                        AstKind::Function(function) => &function.params,
                        AstKind::ArrowFunctionExpression(function) => &function.params,
                        _ => return false,
                    };
                    let mut parameter_names = FxHashSet::default();
                    for parameter in &parameters.items {
                        collect_binding_pattern_names(&parameter.pattern, &mut parameter_names);
                    }
                    parameter_names.contains(&reference.name)
                })
        })
}

fn server_static_io_span_reads_names(
    span: Span,
    names: &FxHashSet<String>,
    identifiers: &[(Span, String)],
) -> bool {
    !names.is_empty()
        && identifiers
            .iter()
            .any(|(identifier_span, identifier_name)| {
                span.contains_inclusive(*identifier_span) && names.contains(identifier_name)
            })
}

fn server_static_io_callee_name<'a>(call: &'a oxc_ast::ast::CallExpression<'_>) -> Option<&'a str> {
    match &call.callee {
        Expression::Identifier(identifier) => Some(identifier.name.as_str()),
        expression => match expression.as_member_expression()? {
            oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
                Some(member.property.name.as_str())
            }
            oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
                match &member.expression {
                    Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                    _ => None,
                }
            }
            oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => None,
        },
    }
}

fn server_static_io_callee_text(call: &oxc_ast::ast::CallExpression<'_>) -> String {
    if let Expression::Identifier(identifier) = &call.callee {
        return identifier.name.to_string();
    }
    let Some(member) = call.callee.as_member_expression() else {
        return "io".to_string();
    };
    let object_name = match member.object() {
        Expression::Identifier(identifier) => identifier.name.as_str(),
        _ => "?",
    };
    let property_name = server_static_io_callee_name(call).unwrap_or("io");
    format!("{object_name}.{property_name}")
}

fn server_static_io_is_import_meta_fetch(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    if !matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "fetch") {
        return false;
    }
    let Some(Expression::NewExpression(construction)) =
        call.arguments.first().and_then(Argument::as_expression)
    else {
        return false;
    };
    if !matches!(&construction.callee, Expression::Identifier(identifier) if identifier.name == "URL")
    {
        return false;
    }
    construction
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
        .and_then(Expression::as_member_expression)
        .is_some_and(|member| match member {
            oxc_ast::ast::MemberExpression::StaticMemberExpression(member) => {
                matches!(&member.object, Expression::ImportMeta(_)) && member.property.name == "url"
            }
            oxc_ast::ast::MemberExpression::ComputedMemberExpression(member) => {
                matches!(&member.object, Expression::ImportMeta(_))
                    && matches!(&member.expression, Expression::Identifier(identifier) if identifier.name == "url")
            }
            oxc_ast::ast::MemberExpression::PrivateFieldExpression(_) => false,
        })
}
