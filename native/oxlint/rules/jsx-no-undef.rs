use std::collections::HashSet;

use oxc_ast::{
    AstKind,
    ast::{
        CallExpression, ChainElement, Expression, IdentifierReference, JSXElementName,
        JSXMemberExpression, JSXMemberExpressionObject, Program, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const KNOWN_GLOBALS: [&str; 7] = [
    "globalThis",
    "window",
    "document",
    "console",
    "React",
    "self",
    "this",
];

#[derive(Debug, Default, Clone)]
pub struct JsxNoUndef;

struct AutoImportGlobalScope {
    directory: String,
    names: HashSet<String>,
}

struct JsxNoUndefSettings {
    runtime_globals: HashSet<String>,
    auto_import_scopes: Vec<AutoImportGlobalScope>,
    relative_filename: Option<String>,
}

declare_oxc_lint!(
    /// Reports JSX component identifiers that do not have a visible runtime binding.
    JsxNoUndef,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow undefined JSX components.",
);

impl Rule for JsxNoUndef {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let settings = jsx_no_undef_settings(ctx);
        let is_react_live_script = ctx.nodes().iter().find_map(|node| {
            let AstKind::Program(program) = node.kind() else {
                return None;
            };
            Some(jsx_no_undef_is_react_live_script(program, ctx))
        });

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            let Some((name, reference)) = jsx_no_undef_root_identifier(&opening_element.name)
            else {
                continue;
            };
            if KNOWN_GLOBALS.contains(&name)
                || jsx_no_undef_is_injected_global(name, &settings)
                || is_react_live_script == Some(true)
                || reference.is_some_and(|reference| {
                    jsx_no_undef_has_canonical_binding(reference, node, ctx)
                })
            {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "`{name}` crashes at runtime because it isn't defined here."
                ))
                .with_label(opening_element.name.span()),
            );
        }
    }
}

fn jsx_no_undef_root_identifier<'a, 'node>(
    name: &'node JSXElementName<'a>,
) -> Option<(&'node str, Option<&'node IdentifierReference<'a>>)> {
    match name {
        JSXElementName::Identifier(identifier) => {
            let name = identifier.name.as_str();
            (!name.as_bytes().first().is_some_and(u8::is_ascii_lowercase)).then_some((name, None))
        }
        JSXElementName::IdentifierReference(identifier) => {
            Some((identifier.name.as_str(), Some(identifier)))
        }
        JSXElementName::MemberExpression(member) => jsx_no_undef_member_root_identifier(member)
            .map(|identifier| (identifier.name.as_str(), Some(identifier))),
        JSXElementName::NamespacedName(_) | JSXElementName::ThisExpression(_) => None,
    }
}

fn jsx_no_undef_member_root_identifier<'a, 'node>(
    mut member: &'node JSXMemberExpression<'a>,
) -> Option<&'node IdentifierReference<'a>> {
    loop {
        match &member.object {
            JSXMemberExpressionObject::IdentifierReference(identifier) => {
                return Some(identifier);
            }
            JSXMemberExpressionObject::MemberExpression(parent) => member = parent,
            JSXMemberExpressionObject::ThisExpression(_) => return None,
        }
    }
}

fn jsx_no_undef_has_canonical_binding<'a>(
    reference: &IdentifierReference<'a>,
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    if ctx
        .scoping()
        .get_reference(reference.reference_id())
        .symbol_id()
        .is_some()
    {
        return true;
    }
    ctx.scoping()
        .find_binding(node.scope_id(), reference.name.as_str().into())
        .is_some_and(|symbol_id| {
            matches!(
                ctx.symbol_declaration(symbol_id).kind(),
                AstKind::ImportSpecifier(_)
                    | AstKind::ImportDefaultSpecifier(_)
                    | AstKind::ImportNamespaceSpecifier(_)
                    | AstKind::TSNamespaceDeclaration(_)
                    | AstKind::TSExternalModuleDeclaration(_)
            )
        })
}

fn jsx_no_undef_is_react_live_script(program: &Program<'_>, ctx: &LintContext<'_>) -> bool {
    let mut render_reference = None;
    for statement in &program.body {
        if matches!(
            statement,
            Statement::ImportDeclaration(_)
                | Statement::ExportNamedDeclaration(_)
                | Statement::ExportDefaultDeclaration(_)
                | Statement::ExportAllDeclaration(_)
                | Statement::ExportFromDeclaration(_)
                | Statement::ExportDeclaration(_)
                | Statement::TSExportAssignment(_)
        ) {
            return false;
        }
        let Statement::ExpressionStatement(statement) = statement else {
            continue;
        };
        let Some(call) = jsx_no_undef_call_expression(&statement.expression) else {
            continue;
        };
        let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
            continue;
        };
        if identifier.name == "render" {
            render_reference = Some(identifier);
        }
    }
    render_reference.is_some_and(|reference| {
        ctx.scoping()
            .get_reference(reference.reference_id())
            .symbol_id()
            .is_none()
            && !ctx
                .scoping()
                .find_binding(
                    ctx.scoping().root_scope_id(),
                    reference.name.as_str().into(),
                )
                .is_some_and(|symbol_id| {
                    matches!(
                        ctx.symbol_declaration(symbol_id).kind(),
                        AstKind::ImportSpecifier(_)
                            | AstKind::ImportDefaultSpecifier(_)
                            | AstKind::ImportNamespaceSpecifier(_)
                            | AstKind::TSNamespaceDeclaration(_)
                            | AstKind::TSExternalModuleDeclaration(_)
                    )
                })
    })
}

fn jsx_no_undef_call_expression<'a, 'node>(
    expression: &'node Expression<'a>,
) -> Option<&'node CallExpression<'a>> {
    match expression.get_inner_expression() {
        Expression::CallExpression(call) => Some(call),
        Expression::ChainExpression(chain) => match &chain.expression {
            ChainElement::CallExpression(call) => Some(call),
            ChainElement::TSNonNullExpression(non_null) => {
                jsx_no_undef_call_expression(&non_null.expression)
            }
            _ => None,
        },
        _ => None,
    }
}

fn jsx_no_undef_settings(ctx: &LintContext<'_>) -> JsxNoUndefSettings {
    let react_doctor_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object);
    let runtime_globals =
        jsx_no_undef_string_array_setting(react_doctor_settings, "runtimeGlobals")
            .into_iter()
            .collect();
    let auto_import_scopes = react_doctor_settings
        .and_then(|settings| settings.get("unpluginAutoImportGlobalScopes"))
        .and_then(serde_json::Value::as_array)
        .map_or_else(Vec::new, |scopes| {
            scopes
                .iter()
                .filter_map(|scope| {
                    let scope = scope.as_object()?;
                    let directory = scope.get("directory")?.as_str()?.to_owned();
                    let names = scope
                        .get("names")?
                        .as_array()?
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .filter(|name| !name.is_empty())
                        .map(str::to_owned)
                        .collect();
                    Some(AutoImportGlobalScope { directory, names })
                })
                .collect()
        });
    let configured_roots = jsx_no_undef_string_array_setting(
        react_doctor_settings,
        "unpluginAutoImportRootDirectories",
    );
    let fallback_root = react_doctor_settings
        .and_then(|settings| settings.get("rootDirectory"))
        .and_then(serde_json::Value::as_str)
        .filter(|root_directory| !root_directory.is_empty())
        .map(str::to_owned);
    let root_directories = if configured_roots.is_empty() {
        fallback_root.into_iter().collect()
    } else {
        configured_roots
    };
    JsxNoUndefSettings {
        runtime_globals,
        auto_import_scopes,
        relative_filename: jsx_no_undef_relative_filename(ctx.file_path(), &root_directories),
    }
}

fn jsx_no_undef_string_array_setting(
    settings: Option<&serde_json::Map<String, serde_json::Value>>,
    name: &str,
) -> Vec<String> {
    settings
        .and_then(|settings| settings.get(name))
        .and_then(serde_json::Value::as_array)
        .map_or_else(Vec::new, |values| {
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
                .collect()
        })
}

fn jsx_no_undef_relative_filename(
    file_path: &std::path::Path,
    root_directories: &[String],
) -> Option<String> {
    let filename = file_path.to_string_lossy().replace('\\', "/");
    if filename.is_empty() {
        return None;
    }
    if !file_path.is_absolute() {
        return Some(filename);
    }
    root_directories.iter().find_map(|root_directory| {
        let normalized_root = root_directory.replace('\\', "/");
        let normalized_root = normalized_root.trim_end_matches('/');
        filename
            .strip_prefix(normalized_root)
            .and_then(|relative| relative.strip_prefix('/'))
            .map(str::to_owned)
    })
}

fn jsx_no_undef_is_injected_global(name: &str, settings: &JsxNoUndefSettings) -> bool {
    if settings.runtime_globals.contains(name) {
        return true;
    }
    let Some(relative_filename) = settings.relative_filename.as_deref() else {
        return false;
    };
    settings
        .auto_import_scopes
        .iter()
        .filter(|scope| {
            scope.directory.is_empty()
                || relative_filename
                    .strip_prefix(&scope.directory)
                    .is_some_and(|relative| relative.starts_with('/'))
        })
        .max_by_key(|scope| scope.directory.len())
        .is_some_and(|scope| scope.names.contains(name))
}
