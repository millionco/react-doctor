use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use lazy_regex::Regex;
use oxc_ast::{
    AstKind,
    ast::{ImportDeclarationSpecifier, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MODULE_FILE_EXTENSIONS: [&str; 8] = ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];
const PACKAGE_EXPORT_CONDITIONS: [&str; 5] = ["import", "default", "module", "browser", "require"];
const PACKAGE_ENTRY_FIELDS: [&str; 3] = ["module", "main", "browser"];
const GENERIC_MESSAGE: &str = "Importing from an index file pulls in extra code. Import directly from the source file instead.";

#[derive(Debug, Default, Clone)]
pub struct NoBarrelImport;

#[derive(Clone)]
struct BarrelImportRequest {
    imported_name: String,
    symbol_id: oxc_semantic::SymbolId,
}

#[derive(Clone)]
struct BarrelExportTarget {
    imported_name: String,
    source: String,
    is_type_only: bool,
}

#[derive(Default)]
struct BarrelModuleInfo {
    exports_by_name: std::collections::HashMap<String, BarrelExportTarget>,
    star_export_sources: Vec<String>,
}

type BarrelModuleInfoCache =
    std::collections::HashMap<PathBuf, Option<std::sync::Arc<BarrelModuleInfo>>>;

struct BarrelExportNamesCacheEntry {
    modified_milliseconds: f64,
    size: u64,
    names: std::sync::Arc<HashSet<String>>,
}

static BARREL_EXPORT_NAMES_CACHE: OnceLock<
    std::sync::Mutex<std::collections::HashMap<PathBuf, BarrelExportNamesCacheEntry>>,
> = OnceLock::new();

#[derive(Clone)]
struct BarrelImportedBinding {
    imported_name: String,
    source: String,
    is_type_only: bool,
    did_export: bool,
}

declare_oxc_lint!(
    /// Disallow runtime imports from multi-source barrel files.
    NoBarrelImport,
    react_doctor_native,
    perf,
    version = "0.1.0",
    short_description = "Disallow runtime imports from multi-source barrel files.",
);

impl Rule for NoBarrelImport {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        !filename.is_empty()
            && !is_test_noise_file(ctx)
            && !barrel_import_is_declaration_file(&filename)
            && !barrel_import_is_server_only_file(&filename)
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        let AstKind::Program(program) = node.kind() else {
            return;
        };
        if barrel_import_is_aggregation_program(program) {
            return;
        }
        let mut module_info_cache = BarrelModuleInfoCache::default();
        for statement in &program.body {
            let Statement::ImportDeclaration(import_declaration) = statement else {
                continue;
            };
            let source = import_declaration.source.value.as_str();
            if !source.starts_with('.') {
                continue;
            }
            let import_requests = barrel_import_runtime_requests(import_declaration);
            if import_requests.is_empty()
                || !import_requests
                    .iter()
                    .any(|request| barrel_import_request_has_runtime_usage(request, ctx))
            {
                continue;
            }
            let Some(barrel_file_path) =
                barrel_import_resolve_relative_module(ctx.file_path(), source)
            else {
                continue;
            };
            let Some(module_info) =
                barrel_import_module_info(&barrel_file_path, &mut module_info_cache)
            else {
                continue;
            };
            if barrel_import_distinct_source_count(&module_info) <= 1
                || barrel_import_consumes_every_runtime_export(&module_info, &import_requests)
            {
                continue;
            }
            let message = barrel_import_message(
                ctx.file_path(),
                &barrel_file_path,
                &import_requests,
                barrel_import_is_react_native_file_target(ctx),
                &mut module_info_cache,
            );
            ctx.diagnostic(OxcDiagnostic::warn(message).with_label(import_declaration.span));
            return;
        }
    }
}

fn barrel_import_is_react_native_file_target(ctx: &LintContext<'_>) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    if has_platform_file_extension(&filename, &["ios", "android", "native"]) {
        return true;
    }
    if has_platform_file_extension(&filename, &["web"]) {
        return false;
    }
    if let Some(package_summary) = nearest_react_native_package_summary(ctx.file_path()) {
        match package_summary.platform {
            ReactNativePackagePlatform::ReactNative => return true,
            ReactNativePackagePlatform::Web => return false,
            ReactNativePackagePlatform::Neutral
                if barrel_import_root_directory_for_platform(ctx)
                    .as_deref()
                    .is_some_and(|root_directory| {
                        package_is_nested_within_root(&package_summary.directory, root_directory)
                    }) =>
            {
                return false;
            }
            ReactNativePackagePlatform::Neutral | ReactNativePackagePlatform::Unknown => {}
        }
    }
    matches!(
        react_doctor_framework_setting_from_json(ctx.settings().json.as_ref()),
        Some("react-native" | "expo")
    )
}

fn barrel_import_root_directory_for_platform(ctx: &LintContext<'_>) -> Option<PathBuf> {
    ctx.settings()
        .json
        .as_ref()?
        .get("react-doctor")?
        .as_object()?
        .get("rootDirectory")?
        .as_str()
        .filter(|root_directory| !root_directory.is_empty())
        .map(PathBuf::from)
}

fn barrel_import_is_declaration_file(filename: &str) -> bool {
    [".d.ts", ".d.mts", ".d.cts"]
        .iter()
        .any(|suffix| filename.ends_with(suffix))
}

fn barrel_import_is_server_only_file(filename: &str) -> bool {
    [
        ".server.js",
        ".server.jsx",
        ".server.ts",
        ".server.tsx",
        ".server.mjs",
        ".server.mjsx",
        ".server.mts",
        ".server.mtsx",
        ".server.cjs",
        ".server.cjsx",
        ".server.cts",
        ".server.ctsx",
    ]
    .iter()
    .any(|suffix| filename.ends_with(suffix))
}

fn barrel_import_is_aggregation_program(program: &oxc_ast::ast::Program<'_>) -> bool {
    let mut has_export_statement = false;
    for statement in &program.body {
        match statement {
            Statement::ImportDeclaration(_) => {}
            Statement::ExportAllDeclaration(_)
            | Statement::ExportFromDeclaration(_)
            | Statement::ExportNamedDeclaration(_) => has_export_statement = true,
            _ => return false,
        }
    }
    has_export_statement
}

fn barrel_import_runtime_requests(
    import_declaration: &oxc_ast::ast::ImportDeclaration<'_>,
) -> Vec<BarrelImportRequest> {
    if import_declaration.import_kind.is_type() {
        return Vec::new();
    }
    import_declaration
        .specifiers
        .iter()
        .flatten()
        .filter_map(|specifier| match specifier {
            ImportDeclarationSpecifier::ImportSpecifier(specifier)
                if !specifier.import_kind.is_type() =>
            {
                Some(BarrelImportRequest {
                    imported_name: specifier.imported.name().to_string(),
                    symbol_id: specifier.local.symbol_id(),
                })
            }
            ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                Some(BarrelImportRequest {
                    imported_name: "default".to_string(),
                    symbol_id: specifier.local.symbol_id(),
                })
            }
            _ => None,
        })
        .collect()
}

fn barrel_import_request_has_runtime_usage(
    request: &BarrelImportRequest,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_resolved_references(request.symbol_id)
        .any(|reference| {
            reference.is_value()
                && !reference.is_type()
                && !ctx
                    .nodes()
                    .ancestors(reference.node_id())
                    .any(|ancestor| matches!(ancestor.kind(), AstKind::ExportFromDeclaration(_)))
        })
}

fn barrel_import_distinct_source_count(module_info: &BarrelModuleInfo) -> usize {
    module_info
        .star_export_sources
        .iter()
        .chain(
            module_info
                .exports_by_name
                .values()
                .map(|target| &target.source),
        )
        .collect::<HashSet<_>>()
        .len()
}

fn barrel_import_consumes_every_runtime_export(
    module_info: &BarrelModuleInfo,
    import_requests: &[BarrelImportRequest],
) -> bool {
    module_info.star_export_sources.is_empty()
        && module_info
            .exports_by_name
            .iter()
            .all(|(exported_name, target)| {
                target.is_type_only
                    || import_requests
                        .iter()
                        .any(|request| request.imported_name == exported_name.as_str())
            })
}

fn barrel_import_message(
    filename: &Path,
    barrel_file_path: &Path,
    import_requests: &[BarrelImportRequest],
    is_react_native_target: bool,
    module_info_cache: &mut BarrelModuleInfoCache,
) -> String {
    let cost_sentence = if is_react_native_target {
        "This ships extra code in your app bundle & slows startup."
    } else {
        "This ships extra code to your users & slows page load."
    };
    let mut direct_sources = Vec::new();
    for request in import_requests {
        let Some(direct_file_path) = barrel_import_resolve_export_file_path(
            barrel_file_path,
            &request.imported_name,
            &mut HashSet::new(),
            module_info_cache,
        ) else {
            continue;
        };
        let direct_source = barrel_import_create_relative_source(filename, &direct_file_path);
        if !direct_sources.contains(&direct_source) {
            direct_sources.push(direct_source);
        }
    }
    match direct_sources.as_slice() {
        [] => GENERIC_MESSAGE.to_string(),
        [direct_source] => {
            format!("{cost_sentence} Import directly from \"{direct_source}\".")
        }
        _ => format!(
            "{cost_sentence} Import directly from: {}.",
            direct_sources
                .iter()
                .map(|source| format!("\"{source}\""))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

fn barrel_import_resolve_relative_module(filename: &Path, source: &str) -> Option<PathBuf> {
    let import_path = barrel_import_normalize_path(&filename.parent()?.join(source));
    barrel_import_resolve_absolute_module(&import_path)
}

fn barrel_import_resolve_absolute_module(import_path: &Path) -> Option<PathBuf> {
    if let Some(file_path) = barrel_import_existing_file(import_path) {
        return Some(file_path);
    }
    for candidate in barrel_import_module_file_candidates(import_path) {
        if let Some(file_path) = barrel_import_existing_file(&candidate) {
            return Some(file_path);
        }
    }
    if import_path.is_dir()
        && let Some(package_entry) = barrel_import_package_entry(import_path)
        && let Some(file_path) = barrel_import_resolve_module_with_index(&package_entry)
    {
        return Some(file_path);
    }
    barrel_import_resolve_module_file(&import_path.join("index"))
}

fn barrel_import_resolve_module_with_index(module_path: &Path) -> Option<PathBuf> {
    barrel_import_resolve_module_file(module_path)
        .or_else(|| barrel_import_resolve_module_file(&module_path.join("index")))
}

fn barrel_import_resolve_module_file(module_path: &Path) -> Option<PathBuf> {
    barrel_import_existing_file(module_path).or_else(|| {
        barrel_import_module_file_candidates(module_path)
            .into_iter()
            .find_map(|candidate| barrel_import_existing_file(&candidate))
    })
}

fn barrel_import_existing_file(file_path: &Path) -> Option<PathBuf> {
    file_path
        .is_file()
        .then(|| barrel_import_normalize_path(file_path))
}

fn barrel_import_module_file_candidates(module_path: &Path) -> Vec<PathBuf> {
    let extension = module_path.extension().and_then(|value| value.to_str());
    if extension.is_none_or(|extension| !MODULE_FILE_EXTENSIONS.contains(&extension)) {
        return MODULE_FILE_EXTENSIONS
            .iter()
            .map(|extension| {
                PathBuf::from(format!("{}.{}", module_path.to_string_lossy(), extension))
            })
            .collect();
    }
    let mut path_without_extension = module_path.to_path_buf();
    path_without_extension.set_extension("");
    match extension {
        Some("js") => ["ts", "tsx", "jsx"]
            .iter()
            .map(|extension| path_without_extension.with_extension(extension))
            .collect(),
        Some("jsx") => vec![path_without_extension.with_extension("tsx")],
        Some("mjs") => vec![path_without_extension.with_extension("mts")],
        Some("cjs") => vec![path_without_extension.with_extension("cts")],
        _ => Vec::new(),
    }
}

fn barrel_import_package_entry(directory: &Path) -> Option<PathBuf> {
    let manifest = serde_json::from_str::<serde_json::Value>(
        &std::fs::read_to_string(directory.join("package.json")).ok()?,
    )
    .ok()?;
    let entry = manifest
        .get("exports")
        .and_then(barrel_import_conditional_export_entry)
        .or_else(|| {
            manifest
                .get("exports")
                .and_then(|exports| exports.get("."))
                .and_then(barrel_import_conditional_export_entry)
        })
        .or_else(|| {
            PACKAGE_ENTRY_FIELDS
                .iter()
                .find_map(|field| manifest.get(field).and_then(serde_json::Value::as_str))
        })?;
    Some(barrel_import_normalize_path(&directory.join(entry)))
}

fn barrel_import_conditional_export_entry(value: &serde_json::Value) -> Option<&str> {
    match value {
        serde_json::Value::String(entry) => Some(entry),
        serde_json::Value::Array(entries) => entries
            .iter()
            .find_map(barrel_import_conditional_export_entry),
        serde_json::Value::Object(entries) => {
            PACKAGE_EXPORT_CONDITIONS.iter().find_map(|condition| {
                entries
                    .get(*condition)
                    .and_then(barrel_import_conditional_export_entry)
            })
        }
        _ => None,
    }
}

fn barrel_import_module_info(
    file_path: &Path,
    module_info_cache: &mut BarrelModuleInfoCache,
) -> Option<std::sync::Arc<BarrelModuleInfo>> {
    let normalized_file_path = barrel_import_normalize_path(file_path);
    if let Some(module_info) = module_info_cache.get(&normalized_file_path) {
        return module_info.clone();
    }
    let module_info =
        barrel_import_read_module_info(&normalized_file_path).map(std::sync::Arc::new);
    module_info_cache.insert(normalized_file_path, module_info.clone());
    module_info
}

fn barrel_import_read_module_info(file_path: &Path) -> Option<BarrelModuleInfo> {
    if !barrel_import_is_index_module(file_path) {
        return None;
    }
    let source_text = std::fs::read_to_string(file_path).ok()?;
    barrel_import_classify_source(&source_text)
}

fn barrel_import_is_index_module(file_path: &Path) -> bool {
    let Some(filename) = file_path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    [
        "index.js",
        "index.jsx",
        "index.ts",
        "index.tsx",
        "index.mjs",
        "index.mjsx",
        "index.mts",
        "index.mtsx",
        "index.cjs",
        "index.cjsx",
        "index.cts",
        "index.ctsx",
    ]
    .contains(&filename)
}

fn barrel_import_classify_source(source_text: &str) -> Option<BarrelModuleInfo> {
    let stripped_source = barrel_import_strip_comments(source_text);
    if stripped_source.trim().is_empty() {
        return None;
    }
    let mut imported_bindings = std::collections::HashMap::<String, BarrelImportedBinding>::new();
    let mut module_info = BarrelModuleInfo::default();
    let without_imports = barrel_import_binding_declaration_pattern()
        .replace_all(&stripped_source, |captures: &lazy_regex::Captures<'_>| {
            let import_clause = captures.get(2).map_or("", |capture| capture.as_str());
            if import_clause.trim_start().starts_with(['\'', '"']) {
                return captures[0].to_string();
            }
            let source = captures.get(3).map_or("", |capture| capture.as_str());
            barrel_import_collect_bindings(
                import_clause,
                source,
                captures.get(1).is_some(),
                &mut imported_bindings,
            );
            String::new()
        })
        .into_owned();
    let without_reexports = barrel_import_reexport_declaration_pattern()
        .replace_all(&without_imports, |captures: &lazy_regex::Captures<'_>| {
            let is_type_only = captures.get(1).is_some();
            let source = captures.get(4).map_or("", |capture| capture.as_str());
            if let Some(namespace_export_name) = captures.get(2) {
                module_info.exports_by_name.insert(
                    namespace_export_name.as_str().to_string(),
                    BarrelExportTarget {
                        imported_name: "*".to_string(),
                        source: source.to_string(),
                        is_type_only,
                    },
                );
            } else if let Some(specifiers_text) = captures.get(3) {
                for specifier in
                    barrel_import_parse_export_specifiers(specifiers_text.as_str(), is_type_only)
                {
                    module_info.exports_by_name.insert(
                        specifier.exported_name,
                        BarrelExportTarget {
                            imported_name: specifier.local_name,
                            source: source.to_string(),
                            is_type_only: specifier.is_type_only,
                        },
                    );
                }
            } else {
                module_info.star_export_sources.push(source.to_string());
            }
            String::new()
        })
        .into_owned();
    let remaining_source = barrel_import_local_export_declaration_pattern()
        .replace_all(&without_reexports, |captures: &lazy_regex::Captures<'_>| {
            let specifiers = barrel_import_parse_export_specifiers(
                captures.get(2).map_or("", |capture| capture.as_str()),
                captures.get(1).is_some(),
            );
            if specifiers
                .iter()
                .any(|specifier| !imported_bindings.contains_key(&specifier.local_name))
            {
                return captures[0].to_string();
            }
            for specifier in specifiers {
                let Some(binding) = imported_bindings.get_mut(&specifier.local_name) else {
                    continue;
                };
                binding.did_export = true;
                module_info.exports_by_name.insert(
                    specifier.exported_name,
                    BarrelExportTarget {
                        imported_name: binding.imported_name.clone(),
                        source: binding.source.clone(),
                        is_type_only: specifier.is_type_only || binding.is_type_only,
                    },
                );
            }
            String::new()
        })
        .into_owned();
    if !remaining_source.trim().is_empty()
        || imported_bindings
            .values()
            .any(|binding| !binding.is_type_only && !binding.did_export)
        || (module_info.exports_by_name.is_empty() && module_info.star_export_sources.is_empty())
    {
        return None;
    }
    Some(module_info)
}

#[derive(Clone)]
struct BarrelExportSpecifier {
    local_name: String,
    exported_name: String,
    is_type_only: bool,
}

fn barrel_import_collect_bindings(
    import_clause: &str,
    source: &str,
    declaration_is_type_only: bool,
    imported_bindings: &mut std::collections::HashMap<String, BarrelImportedBinding>,
) {
    if let Some(captures) = barrel_import_namespace_binding_pattern().captures(import_clause)
        && let Some(local_name) = captures.get(1)
    {
        barrel_import_add_binding(
            local_name.as_str(),
            "*",
            source,
            declaration_is_type_only,
            imported_bindings,
        );
    }
    if let Some(captures) = barrel_import_named_binding_pattern().captures(import_clause)
        && let Some(specifiers_text) = captures.get(1)
    {
        for specifier in barrel_import_parse_export_specifiers(
            specifiers_text.as_str(),
            declaration_is_type_only,
        ) {
            barrel_import_add_binding(
                &specifier.exported_name,
                &specifier.local_name,
                source,
                specifier.is_type_only,
                imported_bindings,
            );
        }
    }
    let default_import_name = import_clause.split(',').next().unwrap_or_default().trim();
    if !default_import_name.is_empty()
        && !default_import_name.starts_with('{')
        && !default_import_name.starts_with('*')
    {
        barrel_import_add_binding(
            default_import_name,
            "default",
            source,
            declaration_is_type_only,
            imported_bindings,
        );
    }
}

fn barrel_import_add_binding(
    local_name: &str,
    imported_name: &str,
    source: &str,
    is_type_only: bool,
    imported_bindings: &mut std::collections::HashMap<String, BarrelImportedBinding>,
) {
    imported_bindings.insert(
        local_name.to_string(),
        BarrelImportedBinding {
            imported_name: imported_name.to_string(),
            source: source.to_string(),
            is_type_only,
            did_export: false,
        },
    );
}

fn barrel_import_parse_export_specifiers(
    specifiers_text: &str,
    declaration_is_type_only: bool,
) -> Vec<BarrelExportSpecifier> {
    specifiers_text
        .split(',')
        .filter_map(|specifier_text| {
            let specifier_text = specifier_text.trim();
            if specifier_text.is_empty() {
                return None;
            }
            let is_type_only = declaration_is_type_only || specifier_text.starts_with("type ");
            let names = barrel_import_specifier_alias_pattern()
                .split(specifier_text)
                .collect::<Vec<_>>();
            let local_name = barrel_import_trim_type_keyword(names[0]);
            let exported_name = names.get(1).map_or_else(
                || local_name.clone(),
                |name| barrel_import_trim_type_keyword(name),
            );
            Some(BarrelExportSpecifier {
                local_name,
                exported_name,
                is_type_only,
            })
        })
        .collect()
}

fn barrel_import_trim_type_keyword(name: &str) -> String {
    name.strip_prefix("type ")
        .unwrap_or(name)
        .trim()
        .to_string()
}

fn barrel_import_strip_comments(source_text: &str) -> String {
    let without_block_comments = barrel_import_block_comment_pattern().replace_all(source_text, "");
    barrel_import_line_comment_pattern()
        .replace_all(&without_block_comments, "")
        .into_owned()
}

fn barrel_import_binding_declaration_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r#"(?m)^\s*import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']\s*;?\s*(?:(?://[^\n]*)?\s*)"#,
        )
        .unwrap()
    })
}

fn barrel_import_reexport_declaration_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r#"(?m)^\s*export\s+(type\s+)?(?:\*(?:\s+as\s+([\w$]+))?|\{([\s\S]*?)\})\s+from\s+["']([^"']+)["']\s*;?\s*(?:(?://[^\n]*)?\s*)"#,
        )
        .unwrap()
    })
}

fn barrel_import_local_export_declaration_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?m)^\s*export\s+(type\s+)?\{([\s\S]*?)\}\s*;?\s*(?:(?://[^\n]*)?\s*)")
            .unwrap()
    })
}

fn barrel_import_namespace_binding_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?:^|,\s*)\*\s+as\s+([\w$]+)").unwrap())
}

fn barrel_import_named_binding_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\{([\s\S]*?)\}").unwrap())
}

fn barrel_import_specifier_alias_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\s+as\s+").unwrap())
}

fn barrel_import_block_comment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?s)/\*.*?\*/").unwrap())
}

fn barrel_import_line_comment_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"(?m)^\s*//.*$").unwrap())
}

fn barrel_import_resolve_export_file_path(
    barrel_file_path: &Path,
    exported_name: &str,
    visited_file_paths: &mut HashSet<PathBuf>,
    module_info_cache: &mut BarrelModuleInfoCache,
) -> Option<PathBuf> {
    let normalized_barrel_path = barrel_import_normalize_path(barrel_file_path);
    if !visited_file_paths.insert(normalized_barrel_path.clone()) {
        return None;
    }
    let module_info = barrel_import_module_info(&normalized_barrel_path, module_info_cache)?;
    if let Some(target) = module_info.exports_by_name.get(exported_name) {
        let target_path =
            barrel_import_resolve_relative_module(&normalized_barrel_path, &target.source)?;
        return barrel_import_resolve_export_file_path(
            &target_path,
            &target.imported_name,
            visited_file_paths,
            module_info_cache,
        )
        .or(Some(target_path));
    }
    if exported_name == "default" {
        return None;
    }
    let mut resolved_paths = Vec::new();
    for source in &module_info.star_export_sources {
        let Some(target_path) =
            barrel_import_resolve_relative_module(&normalized_barrel_path, source)
        else {
            continue;
        };
        let resolved_path = barrel_import_resolve_export_file_path(
            &target_path,
            exported_name,
            &mut visited_file_paths.clone(),
            module_info_cache,
        )
        .or_else(|| {
            barrel_import_module_exports_name(&target_path, exported_name).then_some(target_path)
        });
        if let Some(resolved_path) = resolved_path
            && !resolved_paths.contains(&resolved_path)
        {
            resolved_paths.push(resolved_path);
        }
    }
    matches!(resolved_paths.as_slice(), [_]).then(|| resolved_paths.remove(0))
}

fn barrel_import_module_exports_name(file_path: &Path, exported_name: &str) -> bool {
    barrel_import_module_export_names(file_path).is_some_and(|names| names.contains(exported_name))
}

fn barrel_import_modified_milliseconds(modified: SystemTime) -> f64 {
    let (seconds, nanoseconds) = match modified.duration_since(UNIX_EPOCH) {
        Ok(duration) => (
            duration.as_secs() as f64,
            f64::from(duration.subsec_nanos()),
        ),
        Err(error) => {
            let duration = error.duration();
            if duration.subsec_nanos() == 0 {
                (-(duration.as_secs() as f64), 0.0)
            } else {
                (
                    -(duration.as_secs() as f64) - 1.0,
                    1_000_000_000.0 - f64::from(duration.subsec_nanos()),
                )
            }
        }
    };
    seconds * 1_000.0 + nanoseconds / 1_000_000.0
}

fn barrel_import_module_export_names(file_path: &Path) -> Option<std::sync::Arc<HashSet<String>>> {
    let metadata = std::fs::metadata(file_path).ok()?;
    let modified_milliseconds = barrel_import_modified_milliseconds(metadata.modified().ok()?);
    let size = metadata.len();
    let cache = BARREL_EXPORT_NAMES_CACHE
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(cache) = cache.lock()
        && let Some(entry) = cache.get(file_path)
        && entry.modified_milliseconds == modified_milliseconds
        && entry.size == size
    {
        return Some(std::sync::Arc::clone(&entry.names));
    }
    let names = std::sync::Arc::new(barrel_import_read_export_names(file_path)?);
    if let Ok(mut cache) = cache.lock() {
        cache.insert(
            file_path.to_path_buf(),
            BarrelExportNamesCacheEntry {
                modified_milliseconds,
                size,
                names: std::sync::Arc::clone(&names),
            },
        );
    }
    Some(names)
}

fn barrel_import_read_export_names(file_path: &Path) -> Option<HashSet<String>> {
    let source = std::fs::read(file_path).ok()?;
    Some(barrel_import_collect_source_export_names(
        &String::from_utf8_lossy(&source),
    ))
}

fn barrel_import_leaf_regex(pattern: &str) -> Regex {
    Regex::new(&pattern.replace(
        r"\s",
        r"[\t\n\x0B\x0C\r \u{00A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}]",
    ))
    .unwrap()
}

fn barrel_import_for_each_leaf_line_match(
    source: &str,
    pattern: &Regex,
    last_possible_start: usize,
    mut visit: impl FnMut(usize, &lazy_regex::Captures<'_>),
) {
    let line_starts =
        std::iter::once(0).chain(source.char_indices().filter_map(|(index, character)| {
            matches!(character, '\n' | '\r' | '\u{2028}' | '\u{2029}')
                .then_some(index + character.len_utf8())
        }));
    let mut search_start = 0;
    for start in line_starts.take_while(|start| *start <= last_possible_start) {
        if start < search_start {
            continue;
        }
        let tail = &source[start..];
        search_start = source.len() - tail.trim_start_matches(is_js_whitespace).len();
        if let Some(captures) = pattern.captures(tail) {
            search_start = start + captures.get(0).unwrap().end();
            visit(start, &captures);
        }
    }
}

fn barrel_import_collect_source_export_names(source: &str) -> HashSet<String> {
    static LINE_COMMENT: OnceLock<Regex> = OnceLock::new();
    static DEFAULT_EXPORT: OnceLock<Regex> = OnceLock::new();
    static NAMED_EXPORT: OnceLock<Regex> = OnceLock::new();
    static LOCAL_EXPORT: OnceLock<Regex> = OnceLock::new();
    static ALIAS: OnceLock<Regex> = OnceLock::new();
    let without_blocks = barrel_import_block_comment_pattern().replace_all(source, "");
    let mut stripped = String::new();
    let mut copied_until = 0;
    barrel_import_for_each_leaf_line_match(
        &without_blocks,
        LINE_COMMENT.get_or_init(|| barrel_import_leaf_regex(r"\A\s*//[^\r\n\u{2028}\u{2029}]*")),
        without_blocks.len(),
        |start, captures| {
            stripped.push_str(&without_blocks[copied_until..start]);
            copied_until = start + captures.get(0).unwrap().end();
        },
    );
    stripped.push_str(&without_blocks[copied_until..]);
    let mut names = HashSet::new();
    barrel_import_for_each_leaf_line_match(
        &stripped,
        DEFAULT_EXPORT.get_or_init(|| barrel_import_leaf_regex(r"\A\s*export\s+default(?-u:\b)")),
        stripped.len(),
        |_, _| {
            names.insert("default".to_string());
        },
    );
    let named_export_pattern = NAMED_EXPORT.get_or_init(|| barrel_import_leaf_regex(r"\A\s*export\s+(?:declare\s+)?(?:(?:async\s+)?function|(?:abstract\s+)?class|const|let|var|enum|interface|type)\s+([A-Za-z0-9_$]+)"));
    barrel_import_for_each_leaf_line_match(
        &stripped,
        named_export_pattern,
        stripped.len(),
        |_, captures| {
            names.insert(captures[1].to_string());
        },
    );
    if let Some(last_closing_brace) = stripped.rfind('}') {
        let local_export_pattern = LOCAL_EXPORT.get_or_init(|| barrel_import_leaf_regex(r#"\A\s*export\s+(?:type\s+)?\{((?s:.*?))\}(?:\s+from\s+["'][^"']+["'])?\s*;?\s*(?:(?://[^\n]*)?\s*)"#));
        barrel_import_for_each_leaf_line_match(
            &stripped,
            local_export_pattern,
            last_closing_brace,
            |_, captures| {
                for raw_specifier in captures[1].split(',') {
                    let specifier = raw_specifier.trim_matches(is_js_whitespace);
                    if specifier.is_empty() {
                        continue;
                    }
                    let mut parts = ALIAS
                        .get_or_init(|| barrel_import_leaf_regex(r"\s+as\s+"))
                        .split(specifier);
                    let local = barrel_import_leaf_specifier_name(parts.next().unwrap_or_default());
                    let exported = barrel_import_leaf_specifier_name(parts.next().unwrap_or(local));
                    names.insert(exported.to_string());
                }
            },
        );
    }
    names
}

fn barrel_import_leaf_specifier_name(name: &str) -> &str {
    let name = name
        .strip_prefix("type")
        .filter(|tail| tail.chars().next().is_some_and(is_js_whitespace))
        .map_or(name, |tail| tail.trim_start_matches(is_js_whitespace));
    name.trim_matches(is_js_whitespace)
}

fn barrel_import_create_relative_source(filename: &Path, target_file_path: &Path) -> String {
    let mut target_module_path = target_file_path.to_path_buf();
    target_module_path.set_extension("");
    if target_module_path
        .file_name()
        .is_some_and(|name| name == "index")
    {
        target_module_path.pop();
    }
    let relative_path = barrel_import_relative_path(
        filename.parent().unwrap_or_else(|| Path::new(".")),
        &target_module_path,
    );
    let relative_source = relative_path.to_string_lossy().replace('\\', "/");
    if relative_source.starts_with('.') {
        relative_source
    } else {
        format!("./{relative_source}")
    }
}

fn barrel_import_relative_path(from_directory: &Path, target: &Path) -> PathBuf {
    let from_components = from_directory.components().collect::<Vec<_>>();
    let target_components = target.components().collect::<Vec<_>>();
    let common_length = from_components
        .iter()
        .zip(&target_components)
        .take_while(|(left, right)| left == right)
        .count();
    let mut relative_path = PathBuf::new();
    for _ in common_length..from_components.len() {
        relative_path.push("..");
    }
    for component in &target_components[common_length..] {
        relative_path.push(component.as_os_str());
    }
    relative_path
}

fn barrel_import_normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::{self, File, FileTimes},
        sync::atomic::{AtomicUsize, Ordering},
        time::Duration,
    };

    struct TemporaryModule {
        directory: PathBuf,
        path: PathBuf,
    }

    impl TemporaryModule {
        fn new() -> Self {
            static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
            let directory = std::env::temp_dir().join(format!(
                "react-doctor-barrel-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&directory).unwrap();
            let path = directory.join("module.ts");
            Self { directory, path }
        }

        fn write(&self, source: &str, modified: SystemTime) {
            fs::write(&self.path, source).unwrap();
            File::options()
                .write(true)
                .open(&self.path)
                .unwrap()
                .set_times(FileTimes::new().set_modified(modified))
                .unwrap();
        }
    }

    impl Drop for TemporaryModule {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.directory);
        }
    }

    #[test]
    fn reuses_all_export_names_for_unchanged_module() {
        let module = TemporaryModule::new();
        module.write(
            "export const first = 1;\nexport const second = 2;",
            UNIX_EPOCH + Duration::from_secs(2_000_000_000),
        );
        let first = barrel_import_module_export_names(&module.path).unwrap();
        let second = barrel_import_module_export_names(&module.path).unwrap();
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        assert!(first.contains("first") && first.contains("second"));
        assert!(!first.contains("missing"));
    }

    #[test]
    fn invalidates_on_modified_time_or_size() {
        let module = TemporaryModule::new();
        let initial_time = UNIX_EPOCH + Duration::from_secs(2_000_000_000);
        module.write("export const first = 1;", initial_time);
        let first = barrel_import_module_export_names(&module.path).unwrap();
        module.write(
            "export const later = 1;",
            initial_time + Duration::from_secs(1),
        );
        let later = barrel_import_module_export_names(&module.path).unwrap();
        assert!(!std::sync::Arc::ptr_eq(&first, &later));
        assert!(later.contains("later") && !later.contains("first"));
        module.write(
            "export const longer_name = 1;",
            initial_time + Duration::from_secs(1),
        );
        let resized = barrel_import_module_export_names(&module.path).unwrap();
        assert!(!std::sync::Arc::ptr_eq(&later, &resized));
        assert!(resized.contains("longer_name") && !resized.contains("later"));
    }

    #[test]
    fn retries_missing_modules_and_caches_malformed_exports() {
        let module = TemporaryModule::new();
        assert!(barrel_import_module_export_names(&module.path).is_none());
        let modified = UNIX_EPOCH + Duration::from_secs(2_000_000_000);
        module.write("export const value = ;", modified);
        let first = barrel_import_module_export_names(&module.path).unwrap();
        assert!(first.contains("value"));
        let second = barrel_import_module_export_names(&module.path).unwrap();
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        fs::remove_file(&module.path).unwrap();
        assert!(barrel_import_module_export_names(&module.path).is_none());
        module.write("export const second=2;", modified + Duration::from_secs(1));
        assert!(
            barrel_import_module_export_names(&module.path)
                .unwrap()
                .contains("second")
        );
    }

    #[test]
    fn follows_canonical_regex_export_collection() {
        let names = barrel_import_collect_source_export_names(
            "export default 1;\nexport const plain=1, another=2;\nexport const { hidden }={hidden:1};\nexport function normal(){}\nexport function* generated(){}\nexport class View{}\nexport type Shape=number;\nexport interface Contract{}\nexport enum Mode{One}\nconst local=1;\nexport {local as renamed};\nexport {remote as forwarded} from './other';\nexport * from './star';\nexport const value = ;",
        );
        for name in [
            "default",
            "plain",
            "normal",
            "View",
            "Shape",
            "Contract",
            "Mode",
            "renamed",
            "forwarded",
            "value",
        ] {
            assert!(names.contains(name), "{name}");
        }
        for name in [
            "another",
            "hidden",
            "generated",
            "local",
            "remote",
            "missing",
        ] {
            assert!(!names.contains(name), "{name}");
        }
    }

    #[test]
    fn preserves_javascript_line_and_whitespace_semantics() {
        let names = barrel_import_collect_source_export_names(
            "// comment\rexport const first = 1;\u{2028}// comment\u{2029}export const second=2;\n\u{FEFF}export const third=3;\n\u{0085}export const ignored=4;\nexport const café=1;\nexport {type\tShape, value as \u{FEFF}renamed\u{FEFF}};",
        );
        for name in ["first", "second", "third", "caf", "Shape", "renamed"] {
            assert!(names.contains(name), "{name}");
        }
        for name in ["ignored", "café", "type\tShape"] {
            assert!(!names.contains(name), "{name}");
        }
    }

    #[test]
    fn collects_exports_from_javascript_with_jsx() {
        let mut module = TemporaryModule::new();
        module.path.set_extension("js");
        module.write("export const View = () => <section />;", UNIX_EPOCH);
        assert!(
            barrel_import_module_export_names(&module.path)
                .unwrap()
                .contains("View")
        );
    }

    #[test]
    fn normalizes_unaliased_export_specifiers_twice() {
        for (source, expected_name) in [
            ("export { type type Wanted };", "Wanted"),
            ("export { type type type Wanted };", "type Wanted"),
            ("export { local as type type Wanted };", "type Wanted"),
            ("export { type\u{FEFF}type\tWanted };", "Wanted"),
        ] {
            assert_eq!(
                barrel_import_collect_source_export_names(source),
                HashSet::from([expected_name.to_string()]),
            );
        }
    }

    #[test]
    fn replaces_invalid_utf8_before_collecting_export_names() {
        let module = TemporaryModule::new();
        fs::write(&module.path, b"export const value = '\xff';").unwrap();
        let first = barrel_import_module_export_names(&module.path).unwrap();
        assert!(first.contains("value"));
        assert!(std::sync::Arc::ptr_eq(
            &first,
            &barrel_import_module_export_names(&module.path).unwrap()
        ));
    }

    #[test]
    fn skips_unterminated_local_export_tail() {
        let mut source = "export {before};\n".to_string();
        for _ in 0..100 {
            source.push_str("export { unfinished\n");
        }
        let names = barrel_import_collect_source_export_names(&source);
        assert_eq!(names, HashSet::from(["before".to_string()]));
        assert!(
            barrel_import_collect_source_export_names("export { unfinished\nexport { other")
                .is_empty()
        );
    }

    #[test]
    fn modified_time_uses_fractional_javascript_milliseconds() {
        assert_eq!(
            barrel_import_modified_milliseconds(UNIX_EPOCH + Duration::new(2, 123_456_789)),
            2_000.0 + 123.456789
        );
        assert_eq!(
            barrel_import_modified_milliseconds(UNIX_EPOCH - Duration::new(2, 123_456_789)),
            -3_000.0 + 876.543211
        );
        assert_eq!(
            barrel_import_modified_milliseconds(UNIX_EPOCH - Duration::from_secs(2)),
            -2_000.0
        );
        let distant = UNIX_EPOCH + Duration::from_secs(2_000_000_000);
        assert_eq!(
            barrel_import_modified_milliseconds(distant),
            barrel_import_modified_milliseconds(distant + Duration::from_nanos(1))
        );
    }
}
