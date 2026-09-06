use std::ffi::OsStr;

use oxc_ast::AstKind;
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{context::LintContext, rule::Rule};

#[derive(Debug, Default, Clone)]
pub struct JsxFilenameExtension;

#[derive(Debug)]
struct JsxFilenameExtensionSettings {
    allowed_extensions: Vec<String>,
    allow_as_needed: bool,
    ignore_files_without_code: bool,
}

declare_oxc_lint!(
    /// Enforce configured filename extensions for files containing JSX.
    JsxFilenameExtension,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Enforce configured filename extensions for files containing JSX.",
);

impl Rule for JsxFilenameExtension {
    fn run_once(&self, ctx: &LintContext<'_>) {
        let settings = resolve_jsx_filename_extension_settings(ctx);
        let extension = ctx.file_extension().and_then(OsStr::to_str).unwrap_or("");
        let has_allowed_extension = settings
            .allowed_extensions
            .iter()
            .any(|allowed_extension| allowed_extension == extension);
        let first_jsx_node = ctx.nodes().iter().find(|&&node| {
            matches!(
                node.kind(),
                AstKind::JSXElement(_) | AstKind::JSXFragment(_)
            )
        });

        if !has_allowed_extension {
            if let Some(jsx_node) = first_jsx_node {
                ctx.diagnostic(
                    OxcDiagnostic::warn(format!(
                        "This file contains JSX but uses a `.{extension}` name, so the filename no longer signals JSX to readers or tooling conventions."
                    ))
                    .with_label(jsx_node.span()),
                );
            }
            return;
        }
        if !settings.allow_as_needed || first_jsx_node.is_some() {
            return;
        }
        let Some(program) = ctx.nodes().iter().find_map(|node| match node.kind() {
            AstKind::Program(program) => Some(program),
            _ => None,
        }) else {
            return;
        };
        if settings.ignore_files_without_code && program.body.is_empty() {
            return;
        }
        ctx.diagnostic(
            OxcDiagnostic::warn(format!(
                "`.{extension}` files are reserved for JSX here, so using that extension without JSX makes file-type conventions less useful."
            ))
            .with_label(program_estree_span(program)),
        );
    }
}

fn resolve_jsx_filename_extension_settings(ctx: &LintContext<'_>) -> JsxFilenameExtensionSettings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(serde_json::Value::as_object)
        .and_then(|settings| settings.get("jsxFilenameExtension"))
        .and_then(serde_json::Value::as_object);
    let allowed_extensions = rule_settings
        .and_then(|settings| settings.get("extensions"))
        .and_then(serde_json::Value::as_array)
        .map(|extensions| {
            extensions
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(|extension| extension.strip_prefix('.').unwrap_or(extension).to_string())
                .collect()
        })
        .unwrap_or_else(|| vec!["jsx".to_string(), "tsx".to_string()]);
    JsxFilenameExtensionSettings {
        allowed_extensions,
        allow_as_needed: rule_settings
            .and_then(|settings| settings.get("allow"))
            .and_then(serde_json::Value::as_str)
            == Some("as-needed"),
        ignore_files_without_code: rule_settings
            .and_then(|settings| settings.get("ignoreFilesWithoutCode"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    }
}
