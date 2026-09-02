use oxc_ast::{
    AstKind,
    ast::{
        ArrowFunctionBody, BindingPattern, BindingProperty, Expression, FunctionType,
        MemberExpression, PropertyKey,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{Reference, SymbolId};
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const ANALYTICS_DEFERRABLE_OBJECTS: [&str; 7] = [
    "analytics",
    "posthog",
    "mixpanel",
    "segment",
    "amplitude",
    "datadog",
    "sentry",
];
const ANALYTICS_DEFERRABLE_METHODS: [&str; 7] = [
    "track",
    "identify",
    "page",
    "capture",
    "captureMessage",
    "captureException",
    "log",
];
const CONSOLE_DEFERRABLE_METHODS: [&str; 3] = ["log", "info", "warn"];
const NEXT_AFTER_EXPORT_NAMES: [&str; 2] = ["after", "unstable_after"];
const NEXT_SERVER_SOURCE: &str = "next/server";

#[derive(Debug, Default, Clone)]
pub struct ServerAfterNonblocking;

declare_oxc_lint!(
    /// Defer response-independent server side effects with next/server after.
    ServerAfterNonblocking,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Defer response-independent server side effects with next/server after.",
);

impl Rule for ServerAfterNonblocking {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let file_has_use_server_directive = ctx.nodes().iter().any(|node| {
            matches!(node.kind(), AstKind::Program(program)
                if program.directives.iter().any(|directive| directive.directive == "use server"))
        });
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call_expression) = node.kind() else {
                continue;
            };
            if !file_has_use_server_directive
                && !ctx
                    .nodes()
                    .ancestors(node.id())
                    .any(server_after_function_has_use_server_directive)
            {
                continue;
            }
            let Some(member_expression) = call_expression.callee.as_member_expression() else {
                continue;
            };
            let Expression::Identifier(receiver) =
                member_expression.object().get_inner_expression()
            else {
                continue;
            };
            let object_name = receiver.name.as_str();
            let Some(method_name) = server_after_identifier_member_property_name(member_expression)
            else {
                continue;
            };
            if !server_after_is_deferrable_side_effect_call(object_name, method_name)
                || server_after_is_inside_next_after_callback(node, ctx, &mut Vec::new())
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "{object_name}.{method_name}() runs before the response, so your users wait longer for it."
                ))
                .with_label(call_expression.span),
            );
        }
    }
}

fn server_after_identifier_member_property_name<'a, 'b>(
    member_expression: &'b MemberExpression<'a>,
) -> Option<&'b str> {
    match member_expression {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => match &member.expression {
            Expression::Identifier(identifier) => Some(identifier.name.as_str()),
            _ => None,
        },
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn server_after_is_deferrable_side_effect_call(object_name: &str, method_name: &str) -> bool {
    if object_name == "console" {
        return CONSOLE_DEFERRABLE_METHODS.contains(&method_name);
    }
    ANALYTICS_DEFERRABLE_OBJECTS.contains(&object_name)
        && ANALYTICS_DEFERRABLE_METHODS.contains(&method_name)
}

fn server_after_function_has_use_server_directive(node: &AstNode<'_>) -> bool {
    match node.kind() {
        AstKind::Function(function) => function.body.as_ref().is_some_and(|body| {
            body.directives
                .iter()
                .any(|directive| directive.directive == "use server")
        }),
        AstKind::ArrowFunctionExpression(function) => matches!(
            &function.body,
            ArrowFunctionBody::FunctionBody(body)
                if body
                    .directives
                    .iter()
                    .any(|directive| directive.directive == "use server")
        ),
        _ => false,
    }
}

fn server_after_is_inside_next_after_callback<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_function_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        ) && server_after_is_exclusively_scheduled_by_next_after(
            ancestor,
            ctx,
            visited_function_symbol_ids,
        )
    })
}

fn server_after_is_exclusively_scheduled_by_next_after<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
    visited_function_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    if server_after_is_scheduled_by_next_after(function_node, ctx) {
        return true;
    }
    let Some(function_symbol_id) = server_after_function_binding_symbol(function_node, ctx) else {
        return false;
    };
    if visited_function_symbol_ids.contains(&function_symbol_id)
        || server_after_symbol_is_directly_exported(function_symbol_id, ctx)
    {
        return false;
    }
    visited_function_symbol_ids.push(function_symbol_id);
    let references = ctx
        .scoping()
        .get_resolved_references(function_symbol_id)
        .collect::<Vec<_>>();
    let mut has_after_use = false;
    for reference in references {
        if !server_after_reference_is_read_only(reference) {
            visited_function_symbol_ids.pop();
            return false;
        }
        let reference_node = ctx.nodes().get_node(reference.node_id());
        if function_node
            .span()
            .contains_inclusive(reference_node.span())
        {
            continue;
        }
        if server_after_is_scheduled_by_next_after(reference_node, ctx) {
            has_after_use = true;
            continue;
        }
        if !server_after_is_inside_next_after_callback(
            reference_node,
            ctx,
            visited_function_symbol_ids,
        ) {
            visited_function_symbol_ids.pop();
            return false;
        }
        has_after_use = true;
    }
    visited_function_symbol_ids.pop();
    has_after_use
}

fn server_after_reference_is_read_only(reference: &Reference) -> bool {
    reference.is_read() && !reference.is_write()
}

fn server_after_is_scheduled_by_next_after<'a>(
    expression_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression_root = transparent_expression_root(expression_node, ctx);
    let parent = ctx.nodes().parent_node(expression_root.id());
    let AstKind::CallExpression(call_expression) = parent.kind() else {
        return false;
    };
    call_expression
        .arguments
        .first()
        .is_some_and(|argument| argument.span() == expression_root.span())
        && server_after_is_next_after_callee(&call_expression.callee, ctx, &mut Vec::new())
}

fn server_after_is_next_after_callee<'a>(
    callee: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
    let callee = callee.get_inner_expression();
    if let Some(member_expression) = callee.as_member_expression() {
        return server_after_static_member_property_name(member_expression)
            .is_some_and(|property_name| NEXT_AFTER_EXPORT_NAMES.contains(&property_name))
            && server_after_is_next_server_namespace(
                member_expression.object(),
                ctx,
                &mut Vec::new(),
            );
    }
    let Expression::Identifier(identifier) = callee else {
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
    if server_after_symbol_is_next_after_import(symbol_id, ctx) {
        return true;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) {
        return false;
    }
    if declarator
        .id
        .get_binding_identifier()
        .is_some_and(|binding| binding.symbol_id() == symbol_id)
    {
        return declarator.init.as_ref().is_some_and(|initializer| {
            server_after_is_next_after_callee(initializer, ctx, visited_symbol_ids)
        });
    }
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    let has_direct_after_binding = pattern.properties.iter().any(|property| {
        server_after_binding_property_name(property)
            .is_some_and(|property_name| NEXT_AFTER_EXPORT_NAMES.contains(&property_name))
            && match &property.value {
                BindingPattern::BindingIdentifier(binding) => binding.symbol_id() == symbol_id,
                BindingPattern::AssignmentPattern(assignment) => assignment
                    .left
                    .get_binding_identifier()
                    .is_some_and(|binding| binding.symbol_id() == symbol_id),
                _ => false,
            }
    });
    has_direct_after_binding
        && declarator.init.as_ref().is_some_and(|initializer| {
            server_after_is_next_server_namespace(initializer, ctx, &mut Vec::new())
        })
}

fn server_after_static_member_property_name<'a, 'b>(
    member_expression: &'b MemberExpression<'a>,
) -> Option<&'b str> {
    match member_expression {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => match &member.expression {
            Expression::StringLiteral(literal) => Some(literal.value.as_str()),
            Expression::TemplateLiteral(template) if template.expressions.is_empty() => {
                template.quasis.first().map(|quasi| {
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |value| value.as_str())
                })
            }
            _ => None,
        },
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn server_after_binding_property_name<'a, 'b>(
    property: &'b BindingProperty<'a>,
) -> Option<&'b str> {
    if property.computed {
        return match &property.key {
            PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            PropertyKey::TemplateLiteral(template) if template.expressions.is_empty() => {
                template.quasis.first().map(|quasi| {
                    quasi
                        .value
                        .cooked
                        .as_ref()
                        .map_or(quasi.value.raw.as_str(), |value| value.as_str())
                })
            }
            _ => None,
        };
    }
    match &property.key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::Identifier(identifier) => Some(identifier.name.as_str()),
        PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn server_after_is_next_server_namespace<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut Vec<SymbolId>,
) -> bool {
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
    if visited_symbol_ids.contains(&symbol_id) {
        return false;
    }
    if server_after_symbol_is_next_server_namespace_import(symbol_id, ctx) {
        return true;
    }
    visited_symbol_ids.push(symbol_id);
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if !matches!(
        ctx.nodes().parent_node(declaration.id()).kind(),
        AstKind::VariableDeclaration(variable_declaration) if variable_declaration.kind.is_const()
    ) || declarator
        .id
        .get_binding_identifier()
        .is_none_or(|binding| binding.symbol_id() != symbol_id)
    {
        return false;
    }
    declarator.init.as_ref().is_some_and(|initializer| {
        server_after_is_next_server_namespace(initializer, ctx, visited_symbol_ids)
    })
}

fn server_after_symbol_is_next_after_import(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == NEXT_SERVER_SOURCE
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if NEXT_AFTER_EXPORT_NAMES.contains(&imported_name.name())
            )
    })
}

fn server_after_symbol_is_next_server_namespace_import(
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        !entry.is_type
            && entry.module_request.name() == NEXT_SERVER_SOURCE
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
    })
}

fn server_after_function_binding_symbol<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    match function_node.kind() {
        AstKind::Function(function) if function.r#type == FunctionType::FunctionDeclaration => {
            function
                .id
                .as_ref()
                .map(|identifier| identifier.symbol_id())
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let function_root = transparent_expression_root(function_node, ctx);
            let parent = ctx.nodes().parent_node(function_root.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|binding| binding.symbol_id())
        }
        _ => None,
    }
}

fn server_after_symbol_is_directly_exported(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    let declaration = ctx.symbol_declaration(symbol_id);
    let mut parent = ctx.nodes().parent_node(declaration.id());
    if matches!(declaration.kind(), AstKind::VariableDeclarator(_)) {
        parent = ctx.nodes().parent_node(parent.id());
    }
    matches!(
        parent.kind(),
        AstKind::ExportNamedDeclaration(_) | AstKind::ExportDefaultDeclaration(_)
    )
}
