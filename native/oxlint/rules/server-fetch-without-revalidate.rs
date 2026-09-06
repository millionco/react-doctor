use oxc_ast::{
    AstKind,
    ast::{
        Argument, BindingPattern, Expression, ImportDeclarationSpecifier, ObjectExpression,
        ObjectPropertyKind, PropertyKey, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::SymbolId;
use rustc_hash::FxHashSet;

use crate::{context::LintContext, rule::Rule};

const APP_ROUTER_FILENAMES: [&str; 7] = [
    "route", "page", "layout", "template", "loading", "error", "default",
];
const NEXTJS_SOURCE_FILE_EXTENSIONS: [&str; 6] = ["ts", "tsx", "js", "jsx", "mts", "mjs"];
const MUTATING_HTTP_METHODS: [&str; 4] = ["POST", "PUT", "PATCH", "DELETE"];

#[derive(Debug, Default, Clone)]
pub struct ServerFetchWithoutRevalidate;

declare_oxc_lint!(
    /// Warns when a Next.js App Router fetch can stay cached forever.
    ServerFetchWithoutRevalidate,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Fetch without revalidate.",
);

impl Rule for ServerFetchWithoutRevalidate {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if has_capability(ctx, "nextjs:15")
            || has_capability(ctx, "nextjs:static-export")
            || !server_fetch_is_app_router_file(ctx)
        {
            return;
        }
        let Some(program) = ctx.nodes().iter().find_map(|node| match node.kind() {
            AstKind::Program(program) => Some(program),
            _ => None,
        }) else {
            return;
        };
        if server_fetch_program_has_use_client(program)
            || server_fetch_program_imports_remix_router(program)
        {
            return;
        }
        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if !server_fetch_is_fetch_call(call, ctx) || server_fetch_is_mutating_fetch_call(call) {
                continue;
            }
            if let Some(options_argument) = call.arguments.get(1) {
                let Argument::ObjectExpression(options) = options_argument else {
                    continue;
                };
                if server_fetch_object_has_caching_config(options)
                    || server_fetch_object_has_spread(options)
                {
                    continue;
                }
            }
            let url_argument = call.arguments.first().and_then(Argument::as_expression);
            if url_argument.is_some_and(server_fetch_is_import_meta_url_asset_argument) {
                continue;
            }
            let url_text = match url_argument {
                Some(Expression::StringLiteral(literal)) => format!("\"{}\"", literal.value),
                _ => "url".to_string(),
            };
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "fetch({url_text}) is cached forever by default, so your users can see stale data."
                ))
                .with_label(call.span),
            );
        }
    }
}

fn server_fetch_is_app_router_file(ctx: &LintContext<'_>) -> bool {
    if !is_in_project_directory(ctx, "app") {
        return false;
    }
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    if ["node_modules", "dist", "build", ".next"]
        .iter()
        .any(|directory| filename.contains(&format!("/{directory}/")))
    {
        return false;
    }
    let Some((path_without_extension, extension)) = filename.rsplit_once('.') else {
        return false;
    };
    if !NEXTJS_SOURCE_FILE_EXTENSIONS.contains(&extension) {
        return false;
    }
    let Some(file_stem) = path_without_extension.rsplit('/').next() else {
        return false;
    };
    if !APP_ROUTER_FILENAMES.contains(&file_stem) {
        return false;
    }
    let Some((_, app_relative_path)) = filename.rsplit_once("/app/") else {
        return false;
    };
    !app_relative_path.split('/').any(str::is_empty)
}

fn server_fetch_program_has_use_client(program: &oxc_ast::ast::Program<'_>) -> bool {
    program
        .directives
        .iter()
        .any(|directive| directive.directive == "use client")
}

fn server_fetch_program_imports_remix_router(program: &oxc_ast::ast::Program<'_>) -> bool {
    program.body.iter().any(|statement| {
        let Statement::ImportDeclaration(declaration) = statement else {
            return false;
        };
        !server_fetch_is_type_only_import(declaration)
            && server_fetch_is_remix_router_source(declaration.source.value.as_str())
    })
}

fn server_fetch_is_type_only_import(declaration: &oxc_ast::ast::ImportDeclaration<'_>) -> bool {
    if declaration.import_kind.is_type() {
        return true;
    }
    let Some(specifiers) = &declaration.specifiers else {
        return false;
    };
    !specifiers.is_empty()
        && specifiers.iter().all(|specifier| {
            matches!(specifier, ImportDeclarationSpecifier::ImportSpecifier(specifier)
                if specifier.import_kind.is_type())
        })
}

fn server_fetch_is_remix_router_source(source: &str) -> bool {
    source.starts_with("@remix-run/")
        || source.starts_with("@react-router/")
        || matches!(source, "react-router" | "react-router-dom")
}

fn server_fetch_is_fetch_call<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::Identifier(callee) = call.callee.get_inner_expression() else {
        return false;
    };
    callee.name == "fetch"
        && server_fetch_is_exact_global_fetch_value(&call.callee, ctx, &mut FxHashSet::default())
}

fn server_fetch_is_exact_global_fetch_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbol_ids: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if server_fetch_is_global_this_fetch_member(expression, ctx) {
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
        return identifier.name == "fetch";
    };
    if !visited_symbol_ids.insert(symbol_id) {
        return false;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    let parent = ctx.nodes().parent_node(declaration.id());
    if !matches!(parent.kind(), AstKind::VariableDeclaration(declaration) if declaration.kind.is_const())
    {
        return false;
    }
    let Some(initializer) = &declarator.init else {
        return false;
    };
    if let Some(binding) = declarator.id.get_binding_identifier() {
        return binding.symbol_id() == symbol_id
            && server_fetch_is_exact_global_fetch_value(initializer, ctx, visited_symbol_ids);
    }
    let BindingPattern::ObjectPattern(pattern) = &declarator.id else {
        return false;
    };
    pattern.properties.iter().any(|property| {
        property.key.static_name().as_deref() == Some("fetch")
            && matches!(&property.value, BindingPattern::BindingIdentifier(binding)
                if binding.symbol_id() == symbol_id)
            && server_fetch_is_global_this_identifier(initializer, ctx)
    })
}

fn server_fetch_is_global_this_fetch_member(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    expression.as_member_expression().is_some_and(|member| {
        member.static_property_name() == Some("fetch")
            && server_fetch_is_global_this_identifier(member.object(), ctx)
    })
}

fn server_fetch_is_global_this_identifier(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    matches!(expression.get_inner_expression(), Expression::Identifier(identifier)
        if identifier.name == "globalThis"
            && ctx.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}

fn server_fetch_is_mutating_fetch_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    if !matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "fetch") {
        return false;
    }
    let Some(Argument::ObjectExpression(options)) = call.arguments.get(1) else {
        return false;
    };
    options.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        let is_method_property = match &property.key {
            PropertyKey::StaticIdentifier(identifier) => identifier.name == "method",
            PropertyKey::Identifier(identifier) => identifier.name == "method",
            _ => false,
        };
        if !is_method_property {
            return false;
        }
        matches!(&property.value, Expression::StringLiteral(literal)
            if MUTATING_HTTP_METHODS.contains(&literal.value.as_str().to_ascii_uppercase().as_str()))
    })
}

fn server_fetch_object_has_caching_config(options: &ObjectExpression<'_>) -> bool {
    options.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        let key_name = match &property.key {
            PropertyKey::StaticIdentifier(identifier) if !property.computed => {
                Some(identifier.name.as_str())
            }
            PropertyKey::Identifier(identifier) if !property.computed => {
                Some(identifier.name.as_str())
            }
            PropertyKey::StringLiteral(literal) => Some(literal.value.as_str()),
            _ => None,
        };
        matches!(key_name, Some("cache" | "next"))
    })
}

fn server_fetch_object_has_spread(options: &ObjectExpression<'_>) -> bool {
    options
        .properties
        .iter()
        .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_)))
}

fn server_fetch_is_import_meta_url_asset_argument(expression: &Expression<'_>) -> bool {
    let Expression::NewExpression(construction) = expression else {
        return false;
    };
    if !matches!(&construction.callee, Expression::Identifier(identifier) if identifier.name == "URL")
    {
        return false;
    }
    let Some(base_argument) = construction
        .arguments
        .get(1)
        .and_then(Argument::as_expression)
    else {
        return false;
    };
    base_argument.as_member_expression().is_some_and(|member| {
        matches!(member.object(), Expression::ImportMeta(_))
            && member_expression_identifier_property_name(member) == Some("url")
    })
}
