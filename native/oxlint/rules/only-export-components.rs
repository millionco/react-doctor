use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

use oxc_allocator::Allocator;
use oxc_ast::{AstKind as OnlyExportAstKind, ast::*};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_semantic::{Semantic, SemanticBuilder, SymbolId};
use oxc_span::{SourceType, Span};
use rustc_hash::FxHashSet;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    module_record::ImportImportName,
    rule::Rule,
};

const NAMED_EXPORT_MESSAGE: &str =
    "This file exports non-components, so Fast Refresh can't safely preserve component state.";
const ANONYMOUS_MESSAGE: &str =
    "This component is unnamed, so Fast Refresh can't track it and falls back to a full reload.";
const EXPORT_ALL_MESSAGE: &str =
    "`export *` hides what's exported, so Fast Refresh can't safely preserve component state.";
const REACT_CONTEXT_MESSAGE: &str = "This file exports a context with components, so Fast Refresh can't safely preserve component state.";
const NAMESPACE_OBJECT_MESSAGE: &str = "This export bundles components inside an object, so Fast Refresh can't track them and falls back to a full reload.";
const LOCAL_COMPONENT_MESSAGE: &str =
    "This file has local components but no component export, so Fast Refresh can't preserve them.";

const DEFAULT_HOC_NAMES: [&str; 3] = ["memo", "forwardRef", "lazy"];
const ONLY_EXPORT_CROSS_FILE_PARSE_MAX_BYTES: u64 = 2_000_000;
const NON_FAST_REFRESH_PATH_SEGMENTS: [&str; 12] = [
    "/test/",
    "/tests/",
    "/__tests__/",
    "/__test__/",
    "/__fixtures__/",
    "/fixtures/",
    "/__mocks__/",
    "/mocks/",
    "/cypress/",
    "/.storybook/",
    "/stories/",
    "/__stories__/",
];
const NEXT_ALLOWED_EXPORT_NAMES: [&str; 20] = [
    "getServerSideProps",
    "getStaticProps",
    "getStaticPaths",
    "getInitialProps",
    "reportWebVitals",
    "metadata",
    "generateMetadata",
    "generateStaticParams",
    "generateImageMetadata",
    "generateSitemaps",
    "viewport",
    "generateViewport",
    "revalidate",
    "dynamic",
    "dynamicParams",
    "fetchCache",
    "runtime",
    "preferredRegion",
    "maxDuration",
    "experimental_ppr",
];
const ROUTER_ALLOWED_EXPORT_NAMES: [&str; 11] = [
    "loader",
    "clientLoader",
    "action",
    "clientAction",
    "headers",
    "meta",
    "links",
    "handle",
    "shouldRevalidate",
    "middleware",
    "unstable_middleware",
];
const TANSTACK_ROUTE_FACTORIES: [&str; 10] = [
    "createFileRoute",
    "createLazyFileRoute",
    "createRootRoute",
    "createRootRouteWithContext",
    "createRoute",
    "createLazyRoute",
    "createAPIFileRoute",
    "createServerFileRoute",
    "createServerRootRoute",
    "createServerRoute",
];
const REACT_ROUTER_FACTORIES: [&str; 5] = [
    "createBrowserRouter",
    "createHashRouter",
    "createMemoryRouter",
    "createStaticRouter",
    "createRouter",
];

static ONLY_EXPORT_STATUS_BY_PACKAGE: LazyLock<Mutex<HashMap<PathBuf, Option<RefreshRuntime>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static ONLY_EXPORT_WORKSPACE_STATUS_BY_FILE: LazyLock<
    Mutex<HashMap<PathBuf, Option<RefreshRuntime>>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));
static ONLY_EXPORT_WORKSPACE_INDEX_BY_ROOT: LazyLock<
    Mutex<HashMap<PathBuf, OnlyExportWorkspaceIndex>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Default, Clone)]
pub struct OnlyExportComponents;

#[derive(Default)]
struct OnlyExportSettings {
    allow_export_names: FxHashSet<String>,
    allow_constant_export: bool,
    custom_hocs: FxHashSet<String>,
    check_js: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RefreshRuntime {
    Generic,
    Next,
    Expo,
    Remix,
    ReactRouter,
    Tanstack,
}

#[derive(Clone, Copy)]
struct OnlyExportIntegration {
    runtime: RefreshRuntime,
    requires_vite_development_server: bool,
}

struct OnlyExportWorkspaceIndex {
    alias_owners: Vec<(PathBuf, RefreshRuntime)>,
    source_entry_owners: Vec<(PathBuf, RefreshRuntime)>,
}

enum OnlyExportEntry {
    ReactComponent,
    NonComponent(Span),
    Allowed,
    ReactContext(Span),
    NamespaceObject(Span),
}

struct OnlyExportState {
    curated: bool,
    runtime: RefreshRuntime,
    settings: OnlyExportSettings,
    local_component_symbols: FxHashSet<SymbolId>,
    import_symbols: FxHashSet<SymbolId>,
    route_factory_symbols: FxHashSet<SymbolId>,
    route_factory_namespaces: FxHashSet<SymbolId>,
    is_router_route_module: bool,
}

declare_oxc_lint!(
    /// Require Fast Refresh modules to export only components and explicitly allowed values.
    OnlyExportComponents,
    react_doctor_native,
    style,
    version = "0.1.0",
    short_description = "Require Fast Refresh modules to export only components.",
);

impl Rule for OnlyExportComponents {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.file_extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "tsx" | "jsx" | "js"
                )
            })
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let curated = should_use_curated_port_behavior(ctx);
        let settings = only_export_settings(ctx, curated);
        let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
        let runtime = if curated {
            let Some(runtime) = only_export_fast_refresh_status(ctx) else {
                return;
            };
            runtime
        } else {
            RefreshRuntime::Generic
        };
        if !only_export_filename_is_allowed(&filename, settings.check_js, curated)
            || curated && only_export_framework_file_is_exempt(&filename, runtime)
        {
            return;
        }
        if !curated && settings.check_js && !only_export_has_react_import(ctx) {
            return;
        }

        let import_symbols = only_export_import_symbols(ctx);
        let (route_factory_symbols, route_factory_namespaces) =
            only_export_route_factory_bindings(ctx, runtime);
        let local_component_symbols = only_export_local_component_symbols(ctx, curated, &settings);
        if curated && only_export_has_root_mount(ctx) {
            return;
        }
        let state = OnlyExportState {
            curated,
            runtime,
            settings,
            local_component_symbols,
            import_symbols,
            route_factory_symbols,
            route_factory_namespaces,
            is_router_route_module: matches!(
                only_export_router_module_kind(&filename),
                Some("route" | "root")
            ),
        };
        only_export_analyze(&state, ctx);
    }
}

fn only_export_settings(ctx: &LintContext<'_>, curated: bool) -> OnlyExportSettings {
    let rule_settings = ctx
        .settings()
        .json
        .as_ref()
        .and_then(|settings| settings.get("react-doctor"))
        .and_then(|settings| settings.get("onlyExportComponents"));
    let mut custom_hocs = DEFAULT_HOC_NAMES
        .into_iter()
        .map(str::to_string)
        .collect::<FxHashSet<_>>();
    if let Some(values) = rule_settings
        .and_then(|settings| settings.get("customHOCs"))
        .and_then(serde_json::Value::as_array)
    {
        custom_hocs.extend(
            values
                .iter()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string),
        );
    }
    OnlyExportSettings {
        allow_export_names: rule_settings
            .and_then(|settings| settings.get("allowExportNames"))
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        allow_constant_export: rule_settings
            .and_then(|settings| settings.get("allowConstantExport"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(curated),
        check_js: rule_settings
            .and_then(|settings| settings.get("checkJS"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        custom_hocs,
    }
}

fn only_export_configured_runtime(ctx: &LintContext<'_>) -> RefreshRuntime {
    match react_doctor_framework_setting_from_json(ctx.settings().json.as_ref()) {
        Some("nextjs") => RefreshRuntime::Next,
        Some("expo" | "react-native") => RefreshRuntime::Expo,
        Some("remix") => RefreshRuntime::Remix,
        Some("tanstack-start") => RefreshRuntime::Tanstack,
        _ => RefreshRuntime::Generic,
    }
}

fn only_export_filename_is_allowed(filename: &str, check_js: bool, curated: bool) -> bool {
    let basename = filename.rsplit('/').next().unwrap_or(filename);
    if [".test.", ".spec.", ".cy.", ".stories."]
        .iter()
        .any(|marker| {
            if curated {
                filename.contains(marker)
            } else {
                basename.contains(marker)
            }
        })
    {
        return false;
    }
    if curated {
        let lowercase_basename = basename.to_ascii_lowercase();
        let stem = lowercase_basename
            .rsplit_once('.')
            .map_or(lowercase_basename.as_str(), |(stem, _)| stem);
        if ["test", "spec"].iter().any(|prefix| {
            stem.strip_prefix(prefix).is_some_and(|suffix| {
                suffix.is_empty()
                    || [
                        "utils", "util", "helpers", "helper", "setup", "fixtures", "fixture",
                    ]
                    .iter()
                    .any(|word| {
                        suffix == *word
                            || ['-', '_', '.']
                                .iter()
                                .any(|separator| suffix.strip_prefix(*separator) == Some(*word))
                    })
            })
        }) || NON_FAST_REFRESH_PATH_SEGMENTS
            .iter()
            .any(|segment| filename.contains(segment))
        {
            return false;
        }
        return filename.ends_with(".tsx")
            || filename.ends_with(".jsx")
            || check_js && filename.ends_with(".js");
    }
    let lowercase = filename.to_ascii_lowercase();
    lowercase.ends_with(".tsx")
        || lowercase.ends_with(".jsx")
        || check_js && lowercase.ends_with(".js")
}

fn only_export_framework_file_is_exempt(filename: &str, runtime: RefreshRuntime) -> bool {
    let basename = filename.rsplit('/').next().unwrap_or(filename);
    let stem = basename.rsplit_once('.').map_or(basename, |(stem, _)| stem);
    match runtime {
        RefreshRuntime::Next => {
            let in_app = filename.starts_with("app/") || filename.contains("/app/");
            let in_pages = filename.starts_with("pages/") || filename.contains("/pages/");
            in_app
                && (matches!(
                    stem,
                    "page"
                        | "layout"
                        | "loading"
                        | "error"
                        | "not-found"
                        | "template"
                        | "default"
                        | "global-error"
                        | "route"
                ) || ["opengraph-image", "twitter-image", "icon", "apple-icon"]
                    .iter()
                    .any(|prefix| {
                        stem.strip_prefix(prefix)
                            .is_some_and(|suffix| suffix.bytes().all(|byte| byte.is_ascii_digit()))
                    }))
                || in_pages && matches!(stem, "_app" | "_document" | "_error" | "_meta")
        }
        RefreshRuntime::Expo => {
            (filename.starts_with("app/")
                || filename.starts_with("src/app/")
                || filename.contains("/app/"))
                && matches!(stem, "_layout" | "+html" | "+not-found" | "+native-intent")
        }
        RefreshRuntime::Tanstack => stem == "__root" || stem.ends_with(".lazy"),
        RefreshRuntime::Remix | RefreshRuntime::ReactRouter => {
            only_export_router_module_kind(filename) == Some("entry")
        }
        RefreshRuntime::Generic => false,
    }
}

fn only_export_router_module_kind(filename: &str) -> Option<&'static str> {
    if filename.contains("/app/routes/") || filename.starts_with("app/routes/") {
        return Some("route");
    }
    if filename.ends_with("/app/root.tsx")
        || filename.ends_with("/app/root.jsx")
        || filename == "app/root.tsx"
        || filename == "app/root.jsx"
    {
        return Some("root");
    }
    let basename = filename.rsplit('/').next().unwrap_or(filename);
    if filename.contains("/app/")
        && [
            "entry.client.tsx",
            "entry.client.jsx",
            "entry.server.tsx",
            "entry.server.jsx",
        ]
        .contains(&basename)
    {
        return Some("entry");
    }
    None
}

fn only_export_fast_refresh_status(ctx: &LintContext<'_>) -> Option<RefreshRuntime> {
    let filename = ctx.file_path();
    if !filename.is_absolute() || !filename.exists() {
        return Some(only_export_configured_runtime(ctx));
    }
    let mut directory = filename.parent();
    while let Some(current) = directory {
        let manifest_path = current.join("package.json");
        if manifest_path.is_file() {
            if let Some(status) = ONLY_EXPORT_STATUS_BY_PACKAGE
                .lock()
                .ok()
                .and_then(|statuses| statuses.get(current).copied())
            {
                return status
                    .or_else(|| only_export_workspace_fast_refresh_status(filename, current));
            }
            let Ok(source) = fs::read_to_string(&manifest_path) else {
                return None;
            };
            let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&source) else {
                return None;
            };
            return only_export_package_fast_refresh_status(current, &manifest)
                .or_else(|| only_export_workspace_fast_refresh_status(filename, current));
        }
        directory = current.parent();
    }
    None
}

fn only_export_package_fast_refresh_status(
    package_directory: &Path,
    manifest: &serde_json::Value,
) -> Option<RefreshRuntime> {
    if let Some(status) = ONLY_EXPORT_STATUS_BY_PACKAGE
        .lock()
        .ok()
        .and_then(|statuses| statuses.get(package_directory).copied())
    {
        return status;
    }
    let status = only_export_local_fast_refresh_status(package_directory, manifest);
    if let Ok(mut statuses) = ONLY_EXPORT_STATUS_BY_PACKAGE.lock() {
        statuses.insert(package_directory.to_path_buf(), status);
    }
    status
}

fn only_export_local_fast_refresh_status(
    package_directory: &Path,
    manifest: &serde_json::Value,
) -> Option<RefreshRuntime> {
    if only_export_owned_dependency_is_at_least(manifest, "next", "next dev", (9, 4)) {
        return Some(RefreshRuntime::Next);
    }
    if only_export_owned_dependency_is_at_least(
        manifest,
        "react-scripts",
        "react-scripts start",
        (4, 0),
    ) {
        return Some(RefreshRuntime::Generic);
    }
    let gatsby_version = only_export_owned_dependency_version(manifest, "gatsby", "gatsby develop")
        .and_then(only_export_parse_version);
    if gatsby_version.is_some_and(|version| {
        version.0 >= 3
            || only_export_version_is_at_least(version, (2, 31))
                && only_export_dependency_version(manifest, "react")
                    .and_then(only_export_parse_version)
                    .is_some_and(|react_version| {
                        only_export_version_is_at_least(react_version, (17, 0))
                    })
    }) {
        return Some(RefreshRuntime::Generic);
    }
    if only_export_dependency_version(manifest, "parcel")
        .and_then(only_export_parse_version)
        .is_some_and(|version| only_export_version_is_at_least(version, (2, 0)))
        && only_export_dependency_version(manifest, "react").is_some()
        && only_export_has_parcel_development_command(manifest)
        && only_export_has_parcel_browser_entry(package_directory, manifest)
    {
        return Some(RefreshRuntime::Generic);
    }
    if only_export_owned_dependency_is_at_least(manifest, "expo", "expo start", (36, 0))
        || only_export_owned_dependency_is_at_least(
            manifest,
            "react-native",
            "react-native start",
            (0, 61),
        )
    {
        return Some(RefreshRuntime::Expo);
    }
    if only_export_owned_dependency_is_at_least(manifest, "dumi", "dumi dev", (2, 0)) {
        return Some(RefreshRuntime::Generic);
    }
    only_export_storybook_integration(package_directory, manifest)
        .or_else(|| only_export_registered_integration(package_directory, manifest))
}

fn only_export_manifest_script_values(manifest: &serde_json::Value) -> impl Iterator<Item = &str> {
    manifest
        .get("scripts")
        .and_then(serde_json::Value::as_object)
        .into_iter()
        .flat_map(|scripts| scripts.values().filter_map(serde_json::Value::as_str))
}

fn only_export_shell_tokens(script: &str) -> Vec<&str> {
    script
        .split(|character: char| {
            character.is_whitespace() || matches!(character, ';' | '&' | '|' | '\'' | '"')
        })
        .filter(|token| !token.is_empty())
        .collect()
}

fn only_export_has_parcel_development_command(manifest: &serde_json::Value) -> bool {
    only_export_manifest_script_values(manifest).any(|script| {
        if only_export_shell_tokens(script)
            .iter()
            .any(|token| *token == "--no-hmr")
        {
            return false;
        }
        let tokens = only_export_shell_tokens(script);
        tokens.iter().enumerate().any(|(index, token)| {
            *token == "parcel"
                && !tokens.get(index + 1).is_some_and(|next| {
                    matches!(
                        *next,
                        "build" | "help" | "watch" | "--help" | "--version" | "-h" | "-V"
                    )
                })
        })
    })
}

fn only_export_has_parcel_browser_entry(
    package_directory: &Path,
    manifest: &serde_json::Value,
) -> bool {
    package_directory.join("index.html").is_file()
        || manifest
            .get("source")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|source| source.ends_with(".html"))
        || only_export_manifest_script_values(manifest).any(|script| {
            let tokens = only_export_shell_tokens(script);
            tokens.iter().enumerate().any(|(index, token)| {
                *token == "parcel"
                    && tokens[index + 1..]
                        .iter()
                        .any(|argument| argument.ends_with(".html"))
            })
        })
}

fn only_export_dependency_version<'a>(
    manifest: &'a serde_json::Value,
    name: &str,
) -> Option<&'a str> {
    [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
    ]
    .into_iter()
    .find_map(|key| manifest.get(key)?.get(name)?.as_str())
}

fn only_export_runtime_dependency_version<'a>(
    manifest: &'a serde_json::Value,
    name: &str,
) -> Option<&'a str> {
    ["dependencies", "optionalDependencies"]
        .into_iter()
        .find_map(|key| manifest.get(key)?.get(name)?.as_str())
}

fn only_export_owned_dependency_version<'a>(
    manifest: &'a serde_json::Value,
    name: &str,
    development_command: &str,
) -> Option<&'a str> {
    only_export_runtime_dependency_version(manifest, name).or_else(|| {
        only_export_manifest_scripts_contain(manifest, development_command)
            .then(|| manifest.get("devDependencies")?.get(name)?.as_str())
            .flatten()
    })
}

fn only_export_owned_dependency_is_at_least(
    manifest: &serde_json::Value,
    name: &str,
    development_command: &str,
    minimum: (u64, u64),
) -> bool {
    only_export_owned_dependency_version(manifest, name, development_command)
        .and_then(only_export_parse_version)
        .is_some_and(|version| only_export_version_is_at_least(version, minimum))
}

fn only_export_parse_version(version: &str) -> Option<(u64, u64)> {
    let mut numbers = version
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty());
    let major = numbers.next()?.parse().ok()?;
    let minor = numbers
        .next()
        .and_then(|part| part.parse().ok())
        .unwrap_or(0);
    Some((major, minor))
}

fn only_export_version_is_at_least(version: (u64, u64), minimum: (u64, u64)) -> bool {
    version.0 > minimum.0 || version.0 == minimum.0 && version.1 >= minimum.1
}

fn only_export_manifest_scripts_contain(manifest: &serde_json::Value, needle: &str) -> bool {
    manifest
        .get("scripts")
        .and_then(serde_json::Value::as_object)
        .is_some_and(|scripts| {
            scripts.values().any(|script| {
                script
                    .as_str()
                    .is_some_and(|script| script.contains(needle))
            })
        })
}

fn only_export_has_vite_development_command(manifest: &serde_json::Value) -> bool {
    only_export_manifest_script_values(manifest).any(|script| {
        script.match_indices("vite").any(|(index, _)| {
            if index > 0
                && !script[..index]
                    .chars()
                    .next_back()
                    .is_some_and(|character| {
                        character.is_whitespace()
                            || matches!(character, ';' | '&' | '|' | '\'' | '\\' | '"')
                    })
            {
                return false;
            }
            let suffix = &script[index + "vite".len()..];
            let argument = suffix.trim_start_matches(char::is_whitespace);
            let has_argument_separator = argument.len() < suffix.len();
            let is_non_development_command = has_argument_separator
                && ["build", "preview", "test"].iter().any(|command| {
                    argument.strip_prefix(command).is_some_and(|remainder| {
                        remainder.chars().next().is_none_or(|character| {
                            !character.is_ascii_alphanumeric() && character != '_'
                        })
                    })
                });
            !is_non_development_command
        })
    })
}

fn only_export_has_vite_browser_entry(
    package_directory: &Path,
    manifest: &serde_json::Value,
) -> bool {
    package_directory.join("index.html").is_file()
        || manifest
            .get("source")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|source| source.ends_with(".html"))
}

fn only_export_config_paths(
    package_directory: &Path,
    manifest: &serde_json::Value,
) -> Vec<PathBuf> {
    let mut paths = [
        "vite.config.ts",
        "vite.config.mts",
        "vite.config.cts",
        "vite.config.js",
        "vite.config.mjs",
        "vite.config.cjs",
        "webpack.config.ts",
        "webpack.config.js",
        "webpack.config.mjs",
        "webpack.config.cjs",
        "rsbuild.config.ts",
        "rsbuild.config.js",
        "rspack.config.ts",
        "rspack.config.js",
    ]
    .into_iter()
    .map(|filename| package_directory.join(filename))
    .collect::<Vec<_>>();
    if let Some(scripts) = manifest
        .get("scripts")
        .and_then(serde_json::Value::as_object)
    {
        for script in scripts.values().filter_map(serde_json::Value::as_str) {
            for relative_path in only_export_script_config_paths(script) {
                if let Some(path) = only_export_resolve_inside(package_directory, relative_path) {
                    paths.push(path);
                }
            }
        }
    }
    paths
}

fn only_export_script_config_paths(script: &str) -> Vec<&str> {
    let bytes = script.as_bytes();
    let mut paths = Vec::new();
    let mut search_start = 0;
    while let Some(relative_index) = script[search_start..].find("--config") {
        let index = search_start + relative_index;
        search_start = index + "--config".len();
        if index > 0
            && !script[..index]
                .chars()
                .next_back()
                .is_some_and(char::is_whitespace)
        {
            continue;
        }
        let mut value_start = search_start;
        if bytes.get(value_start) == Some(&b'=') {
            value_start += 1;
        } else {
            while bytes.get(value_start).is_some_and(u8::is_ascii_whitespace) {
                value_start += 1;
            }
            if value_start == search_start {
                continue;
            }
        }
        let Some(first) = bytes.get(value_start).copied() else {
            continue;
        };
        let (content_start, value_end) = if matches!(first, b'\'' | b'"') {
            let content_start = value_start + 1;
            let Some(end) = bytes[content_start..]
                .iter()
                .position(|byte| *byte == first)
                .map(|end| content_start + end)
            else {
                continue;
            };
            (content_start, end)
        } else {
            let end = bytes[value_start..]
                .iter()
                .position(|byte| byte.is_ascii_whitespace() || matches!(*byte, b';' | b'&' | b'|'))
                .map_or(bytes.len(), |end| value_start + end);
            (value_start, end)
        };
        if content_start < value_end {
            paths.push(&script[content_start..value_end]);
        }
    }
    paths
}

fn only_export_resolve_inside(directory: &Path, relative_path: &str) -> Option<PathBuf> {
    let relative_path = Path::new(relative_path);
    if relative_path.is_absolute() {
        return relative_path
            .starts_with(directory)
            .then(|| relative_path.to_path_buf());
    }
    let mut resolved = directory.to_path_buf();
    for component in relative_path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::Normal(component) => resolved.push(component),
            std::path::Component::ParentDir => {
                if resolved == directory {
                    return None;
                }
                resolved.pop();
            }
            std::path::Component::Prefix(_) | std::path::Component::RootDir => return None,
        }
    }
    resolved.starts_with(directory).then_some(resolved)
}

fn only_export_registered_integration(
    package_directory: &Path,
    manifest: &serde_json::Value,
) -> Option<RefreshRuntime> {
    let has_vite_development_runtime = only_export_has_vite_development_command(manifest)
        || only_export_has_vite_browser_entry(package_directory, manifest);
    for config_path in only_export_config_paths(package_directory, manifest) {
        let Some(integrations) = only_export_config_integrations(&config_path) else {
            continue;
        };
        for runtime in [
            RefreshRuntime::Tanstack,
            RefreshRuntime::Remix,
            RefreshRuntime::ReactRouter,
            RefreshRuntime::Generic,
        ] {
            if integrations.iter().any(|integration| {
                integration.runtime == runtime
                    && (!integration.requires_vite_development_server
                        || has_vite_development_runtime)
            }) {
                return Some(runtime);
            }
        }
    }
    None
}

fn only_export_config_integrations(path: &Path) -> Option<Vec<OnlyExportIntegration>> {
    only_export_with_parsed_semantic(path, |semantic| {
        let integrations = only_export_config_integration_bindings(semantic);
        let exported_symbols = only_export_config_exported_symbols(semantic);
        let mut registered = Vec::new();
        for node in semantic.nodes().iter() {
            let OnlyExportAstKind::ObjectProperty(property) = node.kind() else {
                continue;
            };
            if property.key.static_name().as_deref() != Some("plugins")
                || !only_export_config_property_is_exported(node, &exported_symbols, semantic)
            {
                continue;
            }
            only_export_collect_integrations_from_span(
                property.value.span(),
                semantic,
                &integrations,
                &mut registered,
            );
        }
        registered
    })
}

fn only_export_with_parsed_semantic<R>(
    path: &Path,
    analyze: impl FnOnce(&Semantic<'_>) -> R,
) -> Option<R> {
    let source = fs::read_to_string(path).ok()?;
    let source_type = SourceType::from_path(path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let semantic_return =
        SemanticBuilder::new_linter().build(allocator.alloc(parser_return.program));
    Some(analyze(&semantic_return.semantic))
}

fn only_export_config_integration_bindings(
    semantic: &Semantic<'_>,
) -> HashMap<SymbolId, OnlyExportIntegration> {
    let mut integrations = HashMap::new();
    for node in semantic.nodes().iter() {
        match node.kind() {
            OnlyExportAstKind::ImportDeclaration(declaration) => {
                let source = declaration.source.value.as_str();
                for specifier in declaration.specifiers.iter().flatten() {
                    let (symbol_id, imported_name) = match specifier {
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                            (specifier.local.symbol_id(), Some("default"))
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                            (specifier.local.symbol_id(), None)
                        }
                        ImportDeclarationSpecifier::ImportSpecifier(specifier) => (
                            specifier.local.symbol_id(),
                            Some(specifier.imported.name().as_str()),
                        ),
                    };
                    if let Some(integration) =
                        only_export_integration_descriptor(source, imported_name)
                    {
                        integrations.insert(symbol_id, integration);
                    }
                }
            }
            OnlyExportAstKind::VariableDeclarator(declarator) => {
                let Some(Expression::CallExpression(call)) =
                    declarator.init.as_ref().map(only_export_skip_ts)
                else {
                    continue;
                };
                let Expression::Identifier(callee) = only_export_skip_ts(&call.callee) else {
                    continue;
                };
                if callee.name != "require"
                    || semantic
                        .scoping()
                        .get_reference(callee.reference_id())
                        .symbol_id()
                        .is_some()
                {
                    continue;
                }
                let Some(Expression::StringLiteral(source)) =
                    call.arguments.first().and_then(Argument::as_expression)
                else {
                    continue;
                };
                match &declarator.id {
                    BindingPattern::BindingIdentifier(identifier) => {
                        if let Some(integration) =
                            only_export_integration_descriptor(source.value.as_str(), None)
                        {
                            integrations.insert(identifier.symbol_id(), integration);
                        }
                    }
                    BindingPattern::ObjectPattern(object) => {
                        for property in &object.properties {
                            let Some(imported_name) = property.key.static_name() else {
                                continue;
                            };
                            let BindingPattern::BindingIdentifier(identifier) = &property.value
                            else {
                                continue;
                            };
                            if let Some(integration) = only_export_integration_descriptor(
                                source.value.as_str(),
                                Some(imported_name.as_ref()),
                            ) {
                                integrations.insert(identifier.symbol_id(), integration);
                            }
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    integrations
}

fn only_export_integration_descriptor(
    source: &str,
    imported_name: Option<&str>,
) -> Option<OnlyExportIntegration> {
    let descriptor = match source {
        "@vitejs/plugin-react" | "@vitejs/plugin-react-swc" => {
            (None, RefreshRuntime::Generic, true)
        }
        "@pmmmwh/react-refresh-webpack-plugin" => (None, RefreshRuntime::Generic, false),
        "@react-router/dev/vite" => (Some("reactRouter"), RefreshRuntime::ReactRouter, true),
        "@remix-run/dev" => (Some("vitePlugin"), RefreshRuntime::Remix, true),
        "@rsbuild/plugin-react" => (Some("pluginReact"), RefreshRuntime::Generic, false),
        "@rspack/plugin-react-refresh" => (None, RefreshRuntime::Generic, false),
        "@rozenite/vite-plugin" => (Some("rozenitePlugin"), RefreshRuntime::Generic, true),
        "@tanstack/react-start/plugin/vite" => {
            (Some("tanstackStart"), RefreshRuntime::Tanstack, true)
        }
        _ => return None,
    };
    let imported_name_matches = descriptor.0.map_or_else(
        || imported_name.is_none_or(|name| name == "default"),
        |expected| imported_name == Some(expected),
    );
    imported_name_matches.then_some(OnlyExportIntegration {
        runtime: descriptor.1,
        requires_vite_development_server: descriptor.2,
    })
}

fn only_export_config_exported_symbols(semantic: &Semantic<'_>) -> FxHashSet<SymbolId> {
    let mut symbols = FxHashSet::default();
    for node in semantic.nodes().iter() {
        match node.kind() {
            OnlyExportAstKind::ExportDefaultDeclaration(declaration) => {
                if let Some(expression) = declaration.declaration.as_expression() {
                    only_export_collect_expression_symbols(expression, semantic, &mut symbols);
                }
            }
            OnlyExportAstKind::AssignmentExpression(assignment)
                if only_export_is_module_exports_member(&assignment.left) =>
            {
                only_export_collect_expression_symbols(&assignment.right, semantic, &mut symbols);
            }
            _ => {}
        }
    }
    symbols
}

fn only_export_collect_expression_symbols(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
    symbols: &mut FxHashSet<SymbolId>,
) {
    let expression = only_export_skip_ts(expression);
    if matches!(
        expression,
        Expression::ArrowFunctionExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::ObjectExpression(_)
    ) {
        return;
    }
    let span = expression.span();
    for node in semantic.nodes().iter() {
        if !span.contains_inclusive(node.span()) {
            continue;
        }
        let OnlyExportAstKind::IdentifierReference(identifier) = node.kind() else {
            continue;
        };
        if let Some(symbol_id) = semantic
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
        {
            symbols.insert(symbol_id);
        }
    }
}

fn only_export_is_module_exports_member(target: &AssignmentTarget<'_>) -> bool {
    let AssignmentTarget::StaticMemberExpression(member) = target else {
        return false;
    };
    member.property.name == "exports"
        && matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "module")
}

fn only_export_config_property_is_exported(
    property_node: &AstNode<'_>,
    exported_symbols: &FxHashSet<SymbolId>,
    semantic: &Semantic<'_>,
) -> bool {
    let mut did_find_containing_object = false;
    let mut did_cross_nested_property = false;
    let mut containing_function = None;
    let mut containing_return = None;
    for ancestor in semantic.nodes().ancestors(property_node.id()).skip(1) {
        match ancestor.kind() {
            OnlyExportAstKind::ObjectExpression(_) if !did_find_containing_object => {
                did_find_containing_object = true;
            }
            OnlyExportAstKind::ObjectProperty(_) if did_find_containing_object => {
                did_cross_nested_property = true;
            }
            OnlyExportAstKind::ReturnStatement(_) if containing_return.is_none() => {
                containing_return = Some(ancestor);
            }
            OnlyExportAstKind::Function(_) | OnlyExportAstKind::ArrowFunctionExpression(_) => {
                if containing_function.is_some() {
                    return false;
                }
                containing_function = Some(ancestor);
            }
            OnlyExportAstKind::ExportDefaultDeclaration(_) => {
                return !did_cross_nested_property
                    && (containing_function.is_none()
                        || containing_return.is_some()
                        || containing_function
                            .is_some_and(only_export_config_function_has_expression_body));
            }
            OnlyExportAstKind::AssignmentExpression(assignment)
                if only_export_is_module_exports_member(&assignment.left) =>
            {
                return !did_cross_nested_property
                    && (containing_function.is_none()
                        || containing_return.is_some()
                        || containing_function
                            .is_some_and(only_export_config_function_has_expression_body));
            }
            OnlyExportAstKind::VariableDeclarator(declarator) => {
                let Some(identifier) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                if !exported_symbols.contains(&identifier.symbol_id()) || did_cross_nested_property
                {
                    return false;
                }
                let Some(function_node) = containing_function else {
                    return true;
                };
                let callback_returns_object = containing_return.map_or_else(
                    || {
                        matches!(
                            function_node.kind(),
                            OnlyExportAstKind::ArrowFunctionExpression(function)
                                if function.get_expression().is_some_and(|expression| {
                                    matches!(
                                        only_export_skip_ts(expression),
                                        Expression::ObjectExpression(_)
                                    )
                                })
                        )
                    },
                    |return_node| {
                        matches!(
                            return_node.kind(),
                            OnlyExportAstKind::ReturnStatement(statement)
                                if statement.argument.as_ref().is_some_and(|expression| {
                                    matches!(
                                        only_export_skip_ts(expression),
                                        Expression::ObjectExpression(_)
                                    )
                                })
                        )
                    },
                );
                if !callback_returns_object {
                    return false;
                }
                return declarator.init.as_ref().is_some_and(|initializer| {
                    only_export_is_vite_define_config_callback(initializer, function_node, semantic)
                });
            }
            _ => {}
        }
    }
    false
}

fn only_export_config_function_has_expression_body(node: &AstNode<'_>) -> bool {
    matches!(node.kind(), OnlyExportAstKind::ArrowFunctionExpression(function) if function.get_expression().is_some())
}

fn only_export_is_vite_define_config_callback(
    initializer: &Expression<'_>,
    callback: &AstNode<'_>,
    semantic: &Semantic<'_>,
) -> bool {
    let Expression::CallExpression(call) = only_export_skip_ts(initializer) else {
        return false;
    };
    if call
        .arguments
        .first()
        .and_then(Argument::as_expression)
        .is_none_or(|argument| only_export_skip_ts(argument).span() != callback.span())
    {
        return false;
    }
    let Expression::Identifier(callee) = only_export_skip_ts(&call.callee) else {
        return false;
    };
    let Some(symbol_id) = semantic
        .scoping()
        .get_reference(callee.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = semantic.symbol_declaration(symbol_id);
    let OnlyExportAstKind::ImportSpecifier(specifier) = declaration.kind() else {
        return false;
    };
    specifier.imported.name() == "defineConfig"
        && semantic.nodes().ancestors(declaration.id()).any(|ancestor| {
            matches!(ancestor.kind(), OnlyExportAstKind::ImportDeclaration(import) if import.source.value == "vite")
        })
}

fn only_export_collect_integrations_from_span(
    initial_span: Span,
    semantic: &Semantic<'_>,
    integrations: &HashMap<SymbolId, OnlyExportIntegration>,
    registered: &mut Vec<OnlyExportIntegration>,
) {
    let mut spans = vec![initial_span];
    let mut visited_symbols = FxHashSet::default();
    let mut span_index = 0;
    while let Some(span) = spans.get(span_index).copied() {
        span_index += 1;
        for node in semantic.nodes().iter() {
            if !span.contains_inclusive(node.span()) {
                continue;
            }
            let callee_symbol = match node.kind() {
                OnlyExportAstKind::CallExpression(call) => {
                    only_export_semantic_identifier_symbol(&call.callee, semantic)
                }
                OnlyExportAstKind::NewExpression(call) => {
                    only_export_semantic_identifier_symbol(&call.callee, semantic)
                }
                _ => None,
            };
            if let Some(integration) = callee_symbol.and_then(|symbol| integrations.get(&symbol)) {
                registered.push(*integration);
            }
            let OnlyExportAstKind::IdentifierReference(identifier) = node.kind() else {
                continue;
            };
            let Some(symbol_id) = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                continue;
            };
            if integrations.contains_key(&symbol_id) || !visited_symbols.insert(symbol_id) {
                continue;
            }
            let declaration = semantic.symbol_declaration(symbol_id);
            let OnlyExportAstKind::VariableDeclarator(declarator) = declaration.kind() else {
                continue;
            };
            if semantic
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| reference.is_write())
            {
                continue;
            }
            if let Some(initializer) = &declarator.init {
                spans.push(initializer.span());
            }
        }
    }
}

fn only_export_semantic_identifier_symbol(
    expression: &Expression<'_>,
    semantic: &Semantic<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = only_export_skip_ts(expression) else {
        return None;
    };
    semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn only_export_storybook_integration(
    package_directory: &Path,
    manifest: &serde_json::Value,
) -> Option<RefreshRuntime> {
    let has_nx_storybook_target = fs::read_to_string(package_directory.join("project.json"))
        .ok()
        .and_then(|source| serde_json::from_str::<serde_json::Value>(&source).ok())
        .and_then(|project| project.get("targets").cloned())
        .and_then(|targets| targets.as_object().cloned())
        .is_some_and(|targets| targets.contains_key("storybook:serve:dev"));
    let has_storybook_development_command = only_export_has_storybook_development_command(manifest);
    let storybook_version = ["@storybook/react", "@storybook/react-webpack5"]
        .into_iter()
        .find_map(|name| {
            only_export_runtime_dependency_version(manifest, name).or_else(|| {
                has_storybook_development_command
                    .then(|| manifest.get("devDependencies")?.get(name)?.as_str())
                    .flatten()
            })
        })
        .and_then(only_export_parse_version);
    for filename in ["main.ts", "main.js", "main.mjs", "main.cjs"] {
        let path = package_directory.join(".storybook").join(filename);
        let Some((has_react_vite_framework, has_webpack_fast_refresh)) =
            only_export_storybook_config_status(&path)
        else {
            continue;
        };
        if has_react_vite_framework
            && (has_storybook_development_command || has_nx_storybook_target)
            || has_webpack_fast_refresh
                && has_storybook_development_command
                && storybook_version
                    .is_some_and(|version| only_export_version_is_at_least(version, (6, 1)))
        {
            return Some(RefreshRuntime::Generic);
        }
    }
    None
}

fn only_export_has_storybook_development_command(manifest: &serde_json::Value) -> bool {
    only_export_manifest_script_values(manifest).any(|script| {
        let tokens = only_export_shell_tokens(script);
        tokens
            .windows(2)
            .any(|tokens| tokens == ["storybook", "dev"])
            || tokens.iter().any(|token| *token == "start-storybook")
    })
}

fn only_export_storybook_config_status(path: &Path) -> Option<(bool, bool)> {
    only_export_with_parsed_semantic(path, |semantic| {
        let exported_symbols = only_export_config_exported_symbols(semantic);
        let mut has_react_vite_framework = false;
        let mut has_webpack_fast_refresh = false;
        for node in semantic.nodes().iter() {
            let OnlyExportAstKind::ObjectProperty(property) = node.kind() else {
                continue;
            };
            if !only_export_config_property_is_exported(node, &exported_symbols, semantic) {
                continue;
            }
            match property.key.static_name().as_deref() {
                Some("framework") => {
                    has_react_vite_framework |= semantic.nodes().iter().any(|candidate| {
                        property.value.span().contains_inclusive(candidate.span())
                            && matches!(candidate.kind(), OnlyExportAstKind::StringLiteral(literal) if literal.value == "@storybook/react-vite")
                    });
                }
                Some("reactOptions")
                    if only_export_config_property_is_last(node, "reactOptions", semantic) =>
                {
                    has_webpack_fast_refresh |= only_export_read_static_boolean_property(
                        &property.value,
                        "fastRefresh",
                        semantic,
                        &mut FxHashSet::default(),
                    ) == Some(true);
                }
                _ => {}
            }
        }
        (has_react_vite_framework, has_webpack_fast_refresh)
    })
}

fn only_export_config_property_is_last(
    property_node: &AstNode<'_>,
    property_name: &str,
    semantic: &Semantic<'_>,
) -> bool {
    let parent = semantic.nodes().parent_node(property_node.id());
    let OnlyExportAstKind::ObjectExpression(object) = parent.kind() else {
        return false;
    };
    let Some(index) = object
        .properties
        .iter()
        .position(|property| property.span() == property_node.span())
    else {
        return false;
    };
    object.properties[index + 1..].iter().all(|property| {
        matches!(property, ObjectPropertyKind::ObjectProperty(property)
            if property.key.static_name().as_deref() != Some(property_name))
    })
}

fn only_export_read_static_boolean_property<'a>(
    expression: &'a Expression<'a>,
    property_name: &str,
    semantic: &Semantic<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> Option<bool> {
    let expression = only_export_resolve_config_expression(expression, semantic, visited_symbols);
    let Expression::ObjectExpression(object) = expression else {
        return None;
    };
    let mut result = None;
    for property in &object.properties {
        match property {
            ObjectPropertyKind::SpreadProperty(_) => result = None,
            ObjectPropertyKind::ObjectProperty(property)
                if property.key.static_name().as_deref() == Some(property_name) =>
            {
                result = match only_export_resolve_config_expression(
                    &property.value,
                    semantic,
                    visited_symbols,
                ) {
                    Expression::BooleanLiteral(literal) => Some(literal.value),
                    _ => None,
                };
            }
            ObjectPropertyKind::ObjectProperty(_) => {}
        }
    }
    result
}

fn only_export_resolve_config_expression<'a>(
    expression: &'a Expression<'a>,
    semantic: &Semantic<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> &'a Expression<'a> {
    let expression = only_export_skip_ts(expression);
    let Expression::Identifier(identifier) = expression else {
        return expression;
    };
    let Some(symbol_id) = semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return expression;
    };
    if !visited_symbols.insert(symbol_id)
        || semantic
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| reference.is_write())
    {
        return expression;
    }
    let declaration = semantic.symbol_declaration(symbol_id);
    let OnlyExportAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return expression;
    };
    let Some(initializer) = &declarator.init else {
        return expression;
    };
    only_export_resolve_config_expression(initializer, semantic, visited_symbols)
}

fn only_export_workspace_fast_refresh_status(
    filename: &Path,
    package_directory: &Path,
) -> Option<RefreshRuntime> {
    if let Some(status) = ONLY_EXPORT_WORKSPACE_STATUS_BY_FILE
        .lock()
        .ok()
        .and_then(|statuses| statuses.get(filename).copied())
    {
        return status;
    }
    let status = only_export_find_workspace_root(package_directory).and_then(|workspace_root| {
        let status_for_index = |index: &OnlyExportWorkspaceIndex| {
            index
                .alias_owners
                .iter()
                .find_map(|(root, runtime)| {
                    only_export_path_is_inside(filename, root).then_some(*runtime)
                })
                .or_else(|| {
                    index
                        .source_entry_owners
                        .iter()
                        .find_map(|(root, runtime)| {
                            only_export_path_is_inside(filename, root).then_some(*runtime)
                        })
                })
        };
        if let Some(status) = ONLY_EXPORT_WORKSPACE_INDEX_BY_ROOT
            .lock()
            .ok()
            .and_then(|indexes| indexes.get(&workspace_root).map(status_for_index))
        {
            return status;
        }
        let index = only_export_build_workspace_index(&workspace_root);
        let status = status_for_index(&index);
        if let Ok(mut indexes) = ONLY_EXPORT_WORKSPACE_INDEX_BY_ROOT.lock() {
            indexes.insert(workspace_root, index);
        }
        status
    });
    if let Ok(mut statuses) = ONLY_EXPORT_WORKSPACE_STATUS_BY_FILE.lock() {
        statuses.insert(filename.to_path_buf(), status);
    }
    status
}

fn only_export_build_workspace_index(workspace_root: &Path) -> OnlyExportWorkspaceIndex {
    let packages = only_export_workspace_packages(workspace_root);
    let active_packages = packages
        .iter()
        .filter_map(|(directory, manifest)| {
            only_export_package_fast_refresh_status(directory, manifest)
                .map(|runtime| (directory, manifest, runtime))
        })
        .collect::<Vec<_>>();
    let mut alias_owners = Vec::new();
    for (directory, manifest, runtime) in &active_packages {
        alias_owners.extend(
            only_export_active_package_alias_roots(directory, manifest)
                .into_iter()
                .map(|root| (root, *runtime)),
        );
    }
    let mut source_entry_owners = Vec::new();
    for (producer_directory, producer_manifest) in &packages {
        let Some(package_name) = producer_manifest
            .get("name")
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        if !only_export_manifest_has_source_runtime_entry(producer_manifest) {
            continue;
        }
        if let Some(runtime) = active_packages.iter().find_map(|(_, manifest, runtime)| {
            only_export_workspace_dependency_version(manifest, package_name)
                .is_some_and(|version| version.starts_with("workspace:"))
                .then_some(*runtime)
        }) {
            source_entry_owners.push((producer_directory.clone(), runtime));
        }
    }
    OnlyExportWorkspaceIndex {
        alias_owners,
        source_entry_owners,
    }
}

fn only_export_find_workspace_root(package_directory: &Path) -> Option<PathBuf> {
    let mut current = Some(package_directory);
    while let Some(directory) = current {
        let manifest = fs::read_to_string(directory.join("package.json"))
            .ok()
            .and_then(|source| serde_json::from_str::<serde_json::Value>(&source).ok());
        if manifest
            .as_ref()
            .is_some_and(|manifest| manifest.get("workspaces").is_some())
            || ["pnpm-workspace.yaml", "pnpm-workspace.yml", "nx.json"]
                .iter()
                .any(|filename| directory.join(filename).is_file())
        {
            return Some(directory.to_path_buf());
        }
        current = directory.parent();
    }
    None
}

fn only_export_workspace_packages(workspace_root: &Path) -> Vec<(PathBuf, serde_json::Value)> {
    let root_manifest = fs::read_to_string(workspace_root.join("package.json"))
        .ok()
        .and_then(|source| serde_json::from_str::<serde_json::Value>(&source).ok());
    let patterns = only_export_workspace_patterns(workspace_root, root_manifest.as_ref());
    let mut packages = Vec::new();
    let mut pending = vec![workspace_root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        if let Ok(source) = fs::read_to_string(directory.join("package.json"))
            && let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&source)
        {
            let relative = directory
                .strip_prefix(workspace_root)
                .unwrap_or(&directory)
                .to_string_lossy()
                .replace('\\', "/");
            if directory == workspace_root
                || patterns.is_empty()
                || only_export_workspace_path_matches(&relative, &patterns)
            {
                packages.push((directory.clone(), manifest));
            }
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.')
                || ["node_modules", "build", "coverage", "dist", "out", ".next"]
                    .contains(&name.as_ref())
            {
                continue;
            }
            pending.push(entry.path());
        }
    }
    packages
}

fn only_export_workspace_patterns(
    workspace_root: &Path,
    manifest: Option<&serde_json::Value>,
) -> Vec<String> {
    let mut patterns = Vec::new();
    if let Some(workspaces) = manifest.and_then(|manifest| manifest.get("workspaces")) {
        let values = match workspaces {
            serde_json::Value::Array(values) => Some(values),
            serde_json::Value::Object(workspaces) => workspaces
                .get("packages")
                .and_then(serde_json::Value::as_array),
            _ => None,
        };
        patterns.extend(
            values
                .into_iter()
                .flatten()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_string),
        );
    }
    for filename in ["pnpm-workspace.yaml", "pnpm-workspace.yml"] {
        let Ok(source) = fs::read_to_string(workspace_root.join(filename)) else {
            continue;
        };
        patterns.extend(source.lines().filter_map(|line| {
            let pattern = line.trim().strip_prefix('-')?.trim();
            let pattern = pattern.trim_matches(['\'', '"']);
            (!pattern.is_empty()).then(|| pattern.to_string())
        }));
    }
    patterns
}

fn only_export_workspace_path_matches(relative_path: &str, patterns: &[String]) -> bool {
    let mut included = false;
    for pattern in patterns {
        let (is_excluded, pattern) = pattern
            .strip_prefix('!')
            .map_or((false, pattern.as_str()), |pattern| (true, pattern));
        if only_export_glob_matches(pattern.trim_end_matches('/'), relative_path) {
            included = !is_excluded;
        }
    }
    included
}

fn only_export_glob_matches(pattern: &str, value: &str) -> bool {
    if let Some(open) = pattern.find('{')
        && let Some(relative_close) = pattern[open + 1..].find('}')
    {
        let close = open + 1 + relative_close;
        return pattern[open + 1..close].split(',').any(|alternative| {
            let expanded = format!(
                "{}{}{}",
                &pattern[..open],
                alternative,
                &pattern[close + 1..]
            );
            only_export_glob_matches(&expanded, value)
        });
    }
    fn matches_segments(pattern: &[&str], value: &[&str]) -> bool {
        let Some((first, remaining_pattern)) = pattern.split_first() else {
            return value.is_empty();
        };
        if *first == "**" {
            return matches_segments(remaining_pattern, value)
                || !value.is_empty() && matches_segments(pattern, &value[1..]);
        }
        let Some((value_first, remaining_value)) = value.split_first() else {
            return false;
        };
        only_export_glob_segment_matches(first, value_first)
            && matches_segments(remaining_pattern, remaining_value)
    }
    matches_segments(
        &pattern
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>(),
        &value
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect::<Vec<_>>(),
    )
}

fn only_export_glob_segment_matches(pattern: &str, value: &str) -> bool {
    let pattern = pattern.as_bytes();
    let value = value.as_bytes();
    let mut reachable = vec![false; value.len() + 1];
    reachable[0] = true;
    for byte in pattern {
        if *byte == b'*' {
            for index in 1..=value.len() {
                reachable[index] |= reachable[index - 1];
            }
        } else {
            for index in (1..=value.len()).rev() {
                reachable[index] =
                    reachable[index - 1] && (*byte == b'?' || *byte == value[index - 1]);
            }
            reachable[0] = false;
        }
    }
    reachable[value.len()]
}

fn only_export_active_package_alias_roots(
    package_directory: &Path,
    manifest: &serde_json::Value,
) -> Vec<PathBuf> {
    let mut config_paths = only_export_config_paths(package_directory, manifest);
    config_paths.extend(
        ["main.ts", "main.js", "main.mjs", "main.cjs"]
            .into_iter()
            .map(|filename| package_directory.join(".storybook").join(filename)),
    );
    let mut roots = Vec::new();
    for config_path in config_paths {
        let Some(mut config_roots) = only_export_config_alias_roots(&config_path) else {
            continue;
        };
        roots.append(&mut config_roots);
    }
    roots
}

fn only_export_config_alias_roots(path: &Path) -> Option<Vec<PathBuf>> {
    only_export_with_parsed_semantic(path, |semantic| {
        let exported_symbols = only_export_config_exported_symbols(semantic);
        let mut roots = Vec::new();
        for node in semantic.nodes().iter() {
            let OnlyExportAstKind::ObjectProperty(property) = node.kind() else {
                continue;
            };
            if !matches!(
                property.key.static_name().as_deref(),
                Some("resolve" | "viteFinal")
            ) || !only_export_config_property_is_exported(node, &exported_symbols, semantic)
            {
                continue;
            }
            for alias_node in semantic.nodes().iter() {
                let OnlyExportAstKind::ObjectProperty(alias_property) = alias_node.kind() else {
                    continue;
                };
                if alias_property.key.static_name().as_deref() != Some("alias")
                    || !property.value.span().contains_inclusive(alias_node.span())
                {
                    continue;
                }
                for candidate in semantic.nodes().iter() {
                    let OnlyExportAstKind::StringLiteral(literal) = candidate.kind() else {
                        continue;
                    };
                    if !alias_property
                        .value
                        .span()
                        .contains_inclusive(candidate.span())
                    {
                        continue;
                    }
                    let alias = literal.value.as_str();
                    if !alias.starts_with('.') && !Path::new(alias).is_absolute() {
                        continue;
                    }
                    let placeholder = alias
                        .char_indices()
                        .find(|(index, character)| {
                            *character == '*'
                                || *character == '$'
                                    && alias[*index + 1..]
                                        .chars()
                                        .next()
                                        .is_some_and(|digit| digit.is_ascii_digit())
                        })
                        .map_or(alias.len(), |(index, _)| index);
                    let alias = alias[..placeholder].trim_end_matches('/');
                    let config_directory = path.parent().unwrap_or(Path::new("."));
                    if let Some(root) = only_export_resolve_relative(config_directory, alias) {
                        roots.push(root);
                    }
                }
            }
        }
        roots
    })
}

fn only_export_resolve_relative(directory: &Path, relative_path: &str) -> Option<PathBuf> {
    let relative_path = Path::new(relative_path);
    if relative_path.is_absolute() {
        return Some(relative_path.to_path_buf());
    }
    let mut resolved = directory.to_path_buf();
    for component in relative_path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::Normal(component) => resolved.push(component),
            std::path::Component::ParentDir => {
                if !resolved.pop() {
                    return None;
                }
            }
            std::path::Component::Prefix(_) | std::path::Component::RootDir => return None,
        }
    }
    Some(resolved)
}

fn only_export_manifest_has_source_runtime_entry(manifest: &serde_json::Value) -> bool {
    fn has_source_entry(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::String(entry) => {
                let Some(entry) = entry.strip_prefix("./").or_else(|| entry.strip_prefix('.'))
                else {
                    return false;
                };
                entry == "src" || entry.starts_with("src/") || entry.starts_with("src.")
            }
            serde_json::Value::Array(entries) => entries.iter().any(has_source_entry),
            serde_json::Value::Object(entries) => entries.values().any(has_source_entry),
            _ => false,
        }
    }
    ["exports", "main", "module"]
        .iter()
        .any(|key| manifest.get(*key).is_some_and(has_source_entry))
}

fn only_export_workspace_dependency_version<'a>(
    manifest: &'a serde_json::Value,
    package_name: &str,
) -> Option<&'a str> {
    ["dependencies", "optionalDependencies"]
        .into_iter()
        .find_map(|key| manifest.get(key)?.get(package_name)?.as_str())
}

fn only_export_path_is_inside(path: &Path, root: &Path) -> bool {
    path == root
        || path
            .strip_prefix(root)
            .is_ok_and(|relative| !relative.as_os_str().is_empty())
}

fn only_export_has_react_import(ctx: &LintContext<'_>) -> bool {
    ctx.module_record()
        .import_entries
        .iter()
        .any(|entry| entry.module_request.name() == "react")
}

fn only_export_import_symbols(ctx: &LintContext<'_>) -> FxHashSet<SymbolId> {
    ctx.module_record()
        .import_entries
        .iter()
        .filter_map(|entry| {
            ctx.scoping()
                .get_root_binding(entry.local_name.name().into())
        })
        .collect()
}

fn only_export_route_factory_bindings(
    ctx: &LintContext<'_>,
    runtime: RefreshRuntime,
) -> (FxHashSet<SymbolId>, FxHashSet<SymbolId>) {
    let names: &[&str] = match runtime {
        RefreshRuntime::Tanstack => &TANSTACK_ROUTE_FACTORIES,
        RefreshRuntime::Remix | RefreshRuntime::ReactRouter => &REACT_ROUTER_FACTORIES,
        _ => return (FxHashSet::default(), FxHashSet::default()),
    };
    let mut direct_symbols = FxHashSet::default();
    let mut namespace_symbols = FxHashSet::default();
    for entry in &ctx.module_record().import_entries {
        let is_factory_source = {
            let source = entry.module_request.name();
            match runtime {
                RefreshRuntime::Tanstack => {
                    source.starts_with("@tanstack/react-router")
                        || source.starts_with("@tanstack/react-start")
                }
                _ => matches!(
                    source,
                    "react-router" | "react-router-dom" | "@remix-run/react"
                ),
            }
        };
        if !is_factory_source {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
        else {
            continue;
        };
        match &entry.import_name {
            ImportImportName::NamespaceObject => {
                namespace_symbols.insert(symbol_id);
            }
            ImportImportName::Name(imported) if names.contains(&imported.name()) => {
                direct_symbols.insert(symbol_id);
            }
            _ => {}
        }
    }
    (direct_symbols, namespace_symbols)
}

fn only_export_local_component_symbols(
    ctx: &LintContext<'_>,
    curated: bool,
    settings: &OnlyExportSettings,
) -> FxHashSet<SymbolId> {
    let mut symbols = FxHashSet::default();
    for node in ctx.nodes().iter() {
        if only_export_is_inside_function(node, ctx) {
            continue;
        }
        match node.kind() {
            OnlyExportAstKind::Function(function)
                if function.r#type == FunctionType::FunctionDeclaration =>
            {
                let Some(identifier) = &function.id else {
                    continue;
                };
                if only_export_is_component_name(identifier.name.as_str())
                    && (!curated || only_export_function_has_render_semantics(node, ctx))
                {
                    symbols.insert(identifier.symbol_id());
                }
            }
            OnlyExportAstKind::Class(class) => {
                let Some(identifier) = &class.id else {
                    continue;
                };
                if only_export_is_component_name(identifier.name.as_str())
                    && only_export_is_es6_component(class)
                {
                    symbols.insert(identifier.symbol_id());
                }
            }
            OnlyExportAstKind::VariableDeclarator(declarator) => {
                let Some(binding) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                if only_export_is_component_name(binding.name.as_str())
                    && declarator.init.as_ref().is_some_and(|initializer| {
                        only_export_initializer_can_be_component(
                            initializer,
                            curated,
                            settings,
                            ctx,
                        )
                    })
                {
                    symbols.insert(binding.symbol_id());
                }
            }
            _ => {}
        }
    }
    symbols
}

fn only_export_function_has_render_semantics<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    function_contains_react_render_output(node, ctx)
        || function_returns_only_null(node, ctx)
        || only_export_function_has_react_return_type(node, ctx)
}

fn only_export_function_has_react_return_type(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    let return_type = match node.kind() {
        OnlyExportAstKind::Function(function) => function.return_type.as_ref(),
        OnlyExportAstKind::ArrowFunctionExpression(function) => function.return_type.as_ref(),
        _ => None,
    };
    let Some(annotation) = return_type else {
        return false;
    };
    only_export_type_contains_react_element(&annotation.type_annotation, ctx)
}

fn only_export_type_contains_react_element(type_node: &TSType<'_>, ctx: &LintContext<'_>) -> bool {
    match type_node {
        TSType::TSUnionType(union) => union
            .types
            .iter()
            .any(|member| only_export_type_contains_react_element(member, ctx)),
        TSType::TSTypeReference(reference) => {
            only_export_type_name_is_react_element(&reference.type_name, ctx)
        }
        _ => false,
    }
}

fn only_export_type_name_is_react_element(
    type_name: &TSTypeName<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    match type_name {
        TSTypeName::IdentifierReference(identifier) => {
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            only_export_is_react_named_import(symbol_id, "ReactElement", ctx)
        }
        TSTypeName::QualifiedName(qualified) if qualified.right.name == "ReactElement" => {
            let TSTypeName::IdentifierReference(namespace) = &qualified.left else {
                return false;
            };
            only_export_type_namespace_is_react(namespace, ctx)
        }
        TSTypeName::QualifiedName(qualified) if qualified.right.name == "Element" => {
            match &qualified.left {
                TSTypeName::IdentifierReference(namespace) if namespace.name == "JSX" => {
                    let symbol_id = ctx
                        .scoping()
                        .get_reference(namespace.reference_id())
                        .symbol_id();
                    if let Some(symbol_id) = symbol_id {
                        return only_export_is_react_named_import(symbol_id, "JSX", ctx);
                    }
                    !ctx.nodes().iter().any(|node| {
                        matches!(node.kind(), OnlyExportAstKind::TSNamespaceDeclaration(declaration) if declaration.id.name == "JSX")
                    })
                }
                TSTypeName::QualifiedName(namespace)
                    if namespace.right.name == "JSX"
                        && matches!(&namespace.left, TSTypeName::IdentifierReference(identifier)
                            if only_export_type_namespace_is_react(identifier, ctx)) =>
                {
                    true
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn only_export_type_namespace_is_react(
    namespace: &IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(namespace.reference_id())
        .symbol_id()
    else {
        return false;
    };
    only_export_is_react_namespace_import(symbol_id, ctx)
}

fn only_export_is_react_named_import(
    symbol_id: SymbolId,
    imported_name: &str,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "react"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(&entry.import_name, ImportImportName::Name(name) if name.name() == imported_name)
    })
}

fn only_export_is_react_namespace_import(symbol_id: SymbolId, ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "react"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                ImportImportName::Default(_) | ImportImportName::NamespaceObject
            )
    })
}

fn only_export_initializer_can_be_component<'a>(
    initializer: &'a Expression<'a>,
    curated: bool,
    settings: &OnlyExportSettings,
    ctx: &LintContext<'a>,
) -> bool {
    match only_export_skip_ts(initializer) {
        Expression::ArrowFunctionExpression(function) => {
            !curated
                || only_export_function_has_render_semantics(
                    ctx.nodes().get_node(function.node_id.get()),
                    ctx,
                )
        }
        Expression::FunctionExpression(function) => {
            curated
                && only_export_function_has_render_semantics(
                    ctx.nodes().get_node(function.node_id.get()),
                    ctx,
                )
        }
        Expression::ClassExpression(class) => only_export_is_es6_component(class),
        Expression::CallExpression(call) => only_export_is_hoc_callee(&call.callee, settings),
        _ => false,
    }
}

fn only_export_is_inside_function(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).skip(1).any(|ancestor| {
        matches!(
            ancestor.kind(),
            OnlyExportAstKind::Function(_) | OnlyExportAstKind::ArrowFunctionExpression(_)
        )
    })
}

fn only_export_has_root_mount(ctx: &LintContext<'_>) -> bool {
    let mut create_root_symbols = FxHashSet::default();
    let mut mount_symbols = FxHashSet::default();
    let mut react_dom_namespaces = FxHashSet::default();
    for entry in &ctx.module_record().import_entries {
        if !matches!(
            entry.module_request.name(),
            "react-dom" | "react-dom/client"
        ) {
            continue;
        }
        let Some(symbol_id) = ctx
            .scoping()
            .get_root_binding(entry.local_name.name().into())
        else {
            continue;
        };
        match &entry.import_name {
            ImportImportName::NamespaceObject | ImportImportName::Default(_) => {
                react_dom_namespaces.insert(symbol_id);
            }
            ImportImportName::Name(name) if name.name() == "createRoot" => {
                create_root_symbols.insert(symbol_id);
            }
            ImportImportName::Name(name)
                if matches!(name.name(), "render" | "hydrate" | "hydrateRoot") =>
            {
                mount_symbols.insert(symbol_id);
            }
            _ => {}
        }
    }
    let mut root_symbols = FxHashSet::default();
    for node in ctx.nodes().iter() {
        if only_export_is_inside_function(node, ctx) {
            continue;
        }
        if let OnlyExportAstKind::VariableDeclarator(declarator) = node.kind()
            && let Some(binding) = declarator.id.get_binding_identifier()
            && declarator.init.as_ref().is_some_and(|initializer| {
                only_export_call_targets_symbol(
                    initializer,
                    &create_root_symbols,
                    &react_dom_namespaces,
                    "createRoot",
                    ctx,
                )
            })
            && !ctx
                .scoping()
                .get_resolved_references(binding.symbol_id())
                .any(oxc_semantic::Reference::is_write)
        {
            root_symbols.insert(binding.symbol_id());
        }
        let OnlyExportAstKind::CallExpression(call) = node.kind() else {
            continue;
        };
        if only_export_expression_symbol(&call.callee, ctx)
            .is_some_and(|symbol| mount_symbols.contains(&symbol))
        {
            return true;
        }
        let Some(member) = call.callee.as_member_expression() else {
            continue;
        };
        let Some(method) = member.static_property_name() else {
            continue;
        };
        if matches!(method, "render" | "hydrate" | "hydrateRoot")
            && only_export_expression_symbol(member.object(), ctx)
                .is_some_and(|symbol| react_dom_namespaces.contains(&symbol))
        {
            return true;
        }
        if method == "render" {
            if only_export_expression_symbol(member.object(), ctx)
                .is_some_and(|symbol| root_symbols.contains(&symbol))
                || matches!(member.object().get_inner_expression(), Expression::CallExpression(root_call)
                if only_export_call_callee_targets(
                    &root_call.callee,
                    &create_root_symbols,
                    &react_dom_namespaces,
                    "createRoot",
                    ctx,
                ))
            {
                return true;
            }
        }
    }
    false
}

fn only_export_call_targets_symbol<'a>(
    expression: &'a Expression<'a>,
    direct_symbols: &FxHashSet<SymbolId>,
    namespace_symbols: &FxHashSet<SymbolId>,
    member_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call) = expression.get_inner_expression() else {
        return false;
    };
    only_export_call_callee_targets(
        &call.callee,
        direct_symbols,
        namespace_symbols,
        member_name,
        ctx,
    )
}

fn only_export_call_callee_targets<'a>(
    callee: &'a Expression<'a>,
    direct_symbols: &FxHashSet<SymbolId>,
    namespace_symbols: &FxHashSet<SymbolId>,
    member_name: &str,
    ctx: &LintContext<'a>,
) -> bool {
    if only_export_expression_symbol(callee, ctx)
        .is_some_and(|symbol| direct_symbols.contains(&symbol))
    {
        return true;
    }
    callee.as_member_expression().is_some_and(|member| {
        member.static_property_name() == Some(member_name)
            && only_export_expression_symbol(member.object(), ctx)
                .is_some_and(|symbol| namespace_symbols.contains(&symbol))
    })
}

fn only_export_expression_symbol(
    expression: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> Option<SymbolId> {
    let Expression::Identifier(identifier) = expression.get_inner_expression() else {
        return None;
    };
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn only_export_analyze(state: &OnlyExportState, ctx: &LintContext<'_>) {
    let mut entries = Vec::new();
    let mut export_all_spans = Vec::new();
    let mut upstream_local_component_spans = Vec::new();
    let mut has_any_exports = false;

    if !state.curated {
        for node in ctx.nodes().iter() {
            if only_export_node_is_exported(node, ctx) {
                continue;
            }
            match node.kind() {
                OnlyExportAstKind::Function(function) => {
                    if let Some(identifier) = &function.id
                        && only_export_is_component_name(identifier.name.as_str())
                    {
                        upstream_local_component_spans.push(identifier.span);
                    }
                }
                OnlyExportAstKind::VariableDeclarator(declarator) => {
                    if let Some(binding) = declarator.id.get_binding_identifier()
                        && only_export_is_component_name(binding.name.as_str())
                        && declarator.init.as_ref().is_some_and(|initializer| {
                            only_export_initializer_can_be_component(
                                initializer,
                                false,
                                &state.settings,
                                ctx,
                            )
                        })
                    {
                        upstream_local_component_spans.push(binding.span);
                    }
                }
                _ => {}
            }
        }
    }

    for node in ctx.nodes().iter() {
        match node.kind() {
            OnlyExportAstKind::ExportAllDeclaration(export_all)
                if export_all.export_kind.is_value() =>
            {
                has_any_exports = true;
                if !state.curated {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(EXPORT_ALL_MESSAGE).with_label(export_all.span),
                    );
                } else if only_export_star_adds_runtime_values(ctx.file_path(), export_all) {
                    export_all_spans.push(export_all.span);
                }
            }
            OnlyExportAstKind::ExportDefaultDeclaration(export_default) => {
                has_any_exports = true;
                only_export_default(export_default, state, &mut entries, ctx);
            }
            OnlyExportAstKind::ExportDeclaration(export_declaration) => {
                has_any_exports = true;
                only_export_declaration(&export_declaration.declaration, state, &mut entries, ctx);
            }
            OnlyExportAstKind::ExportNamedDeclaration(export_named)
                if export_named.export_kind.is_value() =>
            {
                has_any_exports = true;
                only_export_specifiers(&export_named.specifiers, false, state, &mut entries, ctx);
            }
            OnlyExportAstKind::ExportFromDeclaration(export_from)
                if export_from.export_kind.is_value() =>
            {
                has_any_exports = true;
                only_export_specifiers(&export_from.specifiers, true, state, &mut entries, ctx);
            }
            _ => {}
        }
    }

    let has_react_export = entries
        .iter()
        .any(|entry| matches!(entry, OnlyExportEntry::ReactComponent));
    for entry in &entries {
        if let OnlyExportEntry::NamespaceObject(span) = entry {
            ctx.diagnostic(OxcDiagnostic::warn(NAMESPACE_OBJECT_MESSAGE).with_label(*span));
        }
    }
    if has_any_exports && has_react_export {
        for span in export_all_spans {
            ctx.diagnostic(OxcDiagnostic::warn(EXPORT_ALL_MESSAGE).with_label(span));
        }
        for entry in entries {
            match entry {
                OnlyExportEntry::NonComponent(span) => {
                    ctx.diagnostic(OxcDiagnostic::warn(NAMED_EXPORT_MESSAGE).with_label(span));
                }
                OnlyExportEntry::ReactContext(span) => {
                    ctx.diagnostic(OxcDiagnostic::warn(REACT_CONTEXT_MESSAGE).with_label(span));
                }
                _ => {}
            }
        }
    } else if !state.curated {
        for span in upstream_local_component_spans {
            ctx.diagnostic(OxcDiagnostic::warn(LOCAL_COMPONENT_MESSAGE).with_label(span));
        }
    }
}

fn only_export_default<'a>(
    export_default: &'a ExportDefaultDeclaration<'a>,
    state: &OnlyExportState,
    entries: &mut Vec<OnlyExportEntry>,
    ctx: &LintContext<'a>,
) {
    match &export_default.declaration {
        ExportDefaultDeclarationKind::TSInterfaceDeclaration(_) => {}
        ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
            if function.body.is_none() {
                ctx.diagnostic(
                    OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(export_default.span),
                );
                return;
            }
            if let Some(identifier) = &function.id {
                if state.curated
                    && !only_export_function_has_render_semantics(
                        ctx.nodes().get_node(function.node_id.get()),
                        ctx,
                    )
                {
                    entries.push(OnlyExportEntry::NonComponent(identifier.span));
                } else {
                    let is_known_local_component =
                        state.local_component_symbols.iter().any(|symbol| {
                            ctx.scoping().symbol_name(*symbol) == identifier.name.as_str()
                        });
                    entries.push(if is_known_local_component {
                        OnlyExportEntry::ReactComponent
                    } else {
                        only_export_classify(
                            identifier.name.as_str(),
                            identifier.span,
                            true,
                            None,
                            state,
                            ctx,
                        )
                    });
                }
            } else {
                let renders = only_export_function_has_render_semantics(
                    ctx.nodes().get_node(function.node_id.get()),
                    ctx,
                );
                if !state.curated || renders {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(function.span),
                    );
                    entries.push(OnlyExportEntry::ReactComponent);
                } else {
                    entries.push(OnlyExportEntry::NonComponent(function.span));
                }
            }
        }
        ExportDefaultDeclarationKind::ClassDeclaration(class) => {
            if let Some(identifier) = &class.id {
                entries.push(
                    if only_export_is_component_name(identifier.name.as_str())
                        && only_export_is_es6_component(class)
                    {
                        OnlyExportEntry::ReactComponent
                    } else {
                        OnlyExportEntry::NonComponent(identifier.span)
                    },
                );
            } else {
                ctx.diagnostic(OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(class.span));
            }
        }
        declaration => {
            let Some(expression) = declaration.as_expression() else {
                ctx.diagnostic(
                    OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(export_default.span),
                );
                return;
            };
            only_export_default_expression(expression, export_default.span, state, entries, ctx);
        }
    }
}

fn only_export_default_expression<'a>(
    expression: &'a Expression<'a>,
    export_span: Span,
    state: &OnlyExportState,
    entries: &mut Vec<OnlyExportEntry>,
    ctx: &LintContext<'a>,
) {
    let expression = only_export_skip_ts(expression);
    match expression {
        Expression::Identifier(identifier) => entries.push(if state.curated {
            only_export_identifier_component(identifier, state, ctx)
                .then_some(OnlyExportEntry::ReactComponent)
                .unwrap_or(OnlyExportEntry::NonComponent(identifier.span))
        } else {
            only_export_classify(
                identifier.name.as_str(),
                identifier.span,
                false,
                None,
                state,
                ctx,
            )
        }),
        Expression::CallExpression(call) => {
            if !state.curated {
                if only_export_is_upstream_hoc_call(call, state) {
                    entries.push(OnlyExportEntry::ReactComponent);
                } else {
                    ctx.diagnostic(OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(call.span));
                }
            } else if only_export_is_route_factory_call(call, state, ctx) {
                entries.push(OnlyExportEntry::ReactComponent);
            } else if only_export_is_create_context(call) {
                entries.push(OnlyExportEntry::ReactContext(call.span));
            } else if only_export_is_direct_refresh_wrapper(call, state, ctx) {
                entries.push(OnlyExportEntry::ReactComponent);
            } else if only_export_is_config_only_factory(call) {
                entries.push(OnlyExportEntry::NonComponent(call.span));
            } else {
                ctx.diagnostic(OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(call.span));
            }
        }
        Expression::ObjectExpression(object) => {
            if state.curated {
                entries.push(
                    if only_export_object_bundles_components(object, state, ctx) {
                        OnlyExportEntry::NamespaceObject(object.span)
                    } else {
                        OnlyExportEntry::NonComponent(object.span)
                    },
                );
            } else {
                ctx.diagnostic(OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(object.span));
            }
        }
        Expression::ArrowFunctionExpression(function) => {
            let renders = only_export_function_has_render_semantics(
                ctx.nodes().get_node(function.node_id.get()),
                ctx,
            );
            if !state.curated || renders {
                ctx.diagnostic(OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(function.span));
                entries.push(OnlyExportEntry::ReactComponent);
            } else {
                entries.push(OnlyExportEntry::NonComponent(function.span));
            }
        }
        Expression::FunctionExpression(function) => {
            if let Some(identifier) = &function.id {
                let renders = only_export_function_has_render_semantics(
                    ctx.nodes().get_node(function.node_id.get()),
                    ctx,
                );
                let classified = only_export_classify(
                    identifier.name.as_str(),
                    identifier.span,
                    true,
                    None,
                    state,
                    ctx,
                );
                entries.push(if !state.curated || renders {
                    classified
                } else {
                    OnlyExportEntry::NonComponent(identifier.span)
                });
            } else {
                let renders = only_export_function_has_render_semantics(
                    ctx.nodes().get_node(function.node_id.get()),
                    ctx,
                );
                if !state.curated || renders {
                    ctx.diagnostic(
                        OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(function.span),
                    );
                    entries.push(OnlyExportEntry::ReactComponent);
                } else {
                    entries.push(OnlyExportEntry::NonComponent(function.span));
                }
            }
        }
        Expression::ClassExpression(class) => {
            if let Some(identifier) = &class.id {
                entries.push(
                    if only_export_is_component_name(identifier.name.as_str())
                        && only_export_is_es6_component(class)
                    {
                        OnlyExportEntry::ReactComponent
                    } else {
                        OnlyExportEntry::NonComponent(identifier.span)
                    },
                );
            } else {
                ctx.diagnostic(OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(class.span));
            }
        }
        Expression::StaticMemberExpression(_)
        | Expression::ComputedMemberExpression(_)
        | Expression::PrivateFieldExpression(_) => {
            if state.curated {
                entries.push(
                    only_export_expression_is_component(expression, state, ctx)
                        .then_some(OnlyExportEntry::ReactComponent)
                        .unwrap_or(OnlyExportEntry::NonComponent(expression.span())),
                );
            } else {
                ctx.diagnostic(
                    OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(expression.span()),
                );
            }
        }
        Expression::BooleanLiteral(_)
        | Expression::NullLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::NewExpression(_) => {
            if state.curated {
                entries.push(OnlyExportEntry::NonComponent(expression.span()));
            } else {
                ctx.diagnostic(
                    OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(expression.span()),
                );
            }
        }
        _ => ctx.diagnostic(OxcDiagnostic::warn(ANONYMOUS_MESSAGE).with_label(export_span)),
    }
}

fn only_export_declaration<'a>(
    declaration: &'a Declaration<'a>,
    state: &OnlyExportState,
    entries: &mut Vec<OnlyExportEntry>,
    ctx: &LintContext<'a>,
) {
    match declaration {
        Declaration::VariableDeclaration(variable) => {
            for declarator in &variable.declarations {
                let Some(binding) = declarator.id.get_binding_identifier() else {
                    continue;
                };
                let is_function = declarator.init.as_ref().is_some_and(|initializer| {
                    only_export_initializer_can_be_component(
                        initializer,
                        state.curated,
                        &state.settings,
                        ctx,
                    )
                });
                entries.push(only_export_classify(
                    binding.name.as_str(),
                    declarator
                        .type_annotation
                        .as_ref()
                        .map_or(binding.span, |annotation| {
                            Span::new(binding.span.start, annotation.span.end)
                        }),
                    is_function,
                    declarator.init.as_ref(),
                    state,
                    ctx,
                ));
            }
        }
        Declaration::FunctionDeclaration(function) => {
            if let Some(identifier) = &function.id {
                let renders = only_export_function_has_render_semantics(
                    ctx.nodes().get_node(function.node_id.get()),
                    ctx,
                );
                let classified = only_export_classify(
                    identifier.name.as_str(),
                    identifier.span,
                    true,
                    None,
                    state,
                    ctx,
                );
                let is_known_local_component = state
                    .local_component_symbols
                    .iter()
                    .any(|symbol| ctx.scoping().symbol_name(*symbol) == identifier.name.as_str());
                entries.push(if is_known_local_component {
                    OnlyExportEntry::ReactComponent
                } else if state.curated
                    && !renders
                    && !matches!(classified, OnlyExportEntry::Allowed)
                {
                    OnlyExportEntry::NonComponent(identifier.span)
                } else {
                    classified
                });
            }
        }
        Declaration::ClassDeclaration(class) => {
            if let Some(identifier) = &class.id {
                entries.push(
                    if only_export_is_component_name(identifier.name.as_str())
                        && only_export_is_es6_component(class)
                    {
                        OnlyExportEntry::ReactComponent
                    } else {
                        OnlyExportEntry::NonComponent(identifier.span)
                    },
                );
            }
        }
        Declaration::TSEnumDeclaration(enumeration) => {
            entries.push(OnlyExportEntry::NonComponent(enumeration.span));
        }
        _ => {}
    }
}

fn only_export_specifiers<'a>(
    specifiers: &'a [ExportSpecifier<'a>],
    is_reexport: bool,
    state: &OnlyExportState,
    entries: &mut Vec<OnlyExportEntry>,
    ctx: &LintContext<'a>,
) {
    for specifier in specifiers {
        if specifier.export_kind.is_type() {
            continue;
        }
        let exported_name = match &specifier.exported {
            ModuleExportName::IdentifierName(identifier) => Some(identifier.name.as_str()),
            ModuleExportName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
            ModuleExportName::StringLiteral(_) => None,
        };
        let local_name = specifier.local.name().as_str();
        let local_symbol = match &specifier.local {
            ModuleExportName::IdentifierReference(identifier) => ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id(),
            _ => None,
        };
        if state.curated && is_reexport {
            if exported_name.is_some_and(only_export_is_component_name) {
                entries.push(OnlyExportEntry::ReactComponent);
            }
            continue;
        }
        if (state.curated || exported_name.is_some())
            && local_symbol.is_some_and(|symbol| state.local_component_symbols.contains(&symbol))
        {
            entries.push(OnlyExportEntry::ReactComponent);
            continue;
        }
        if exported_name == Some("default")
            && local_symbol.is_some_and(|symbol| {
                only_export_proven_component_symbol(
                    symbol,
                    specifier.span.start,
                    state,
                    ctx,
                    &mut Vec::new(),
                )
            })
        {
            entries.push(OnlyExportEntry::ReactComponent);
            continue;
        }
        let entry = if let Some(exported_name) = exported_name {
            if state.curated {
                if state.settings.allow_export_names.contains(exported_name)
                    || only_export_framework_export_is_allowed(exported_name, state)
                    || only_export_is_hook_name(exported_name)
                {
                    OnlyExportEntry::Allowed
                } else if local_symbol.is_some_and(|symbol| {
                    only_export_proven_component_symbol(
                        symbol,
                        specifier.span.start,
                        state,
                        ctx,
                        &mut Vec::new(),
                    )
                }) {
                    OnlyExportEntry::ReactComponent
                } else {
                    OnlyExportEntry::NonComponent(specifier.span)
                }
            } else {
                only_export_classify(exported_name, specifier.span, false, None, state, ctx)
            }
        } else {
            OnlyExportEntry::NonComponent(specifier.span)
        };
        entries.push(entry);
        if exported_name == Some(local_name) && only_export_is_component_name(local_name) {
            let last = entries.len() - 1;
            entries[last] = OnlyExportEntry::ReactComponent;
        } else if exported_name.is_none() && only_export_is_component_name(local_name) {
            entries.push(OnlyExportEntry::ReactComponent);
        }
    }
}

fn only_export_classify<'a>(
    name: &str,
    span: Span,
    is_function: bool,
    initializer: Option<&'a Expression<'a>>,
    state: &OnlyExportState,
    ctx: &LintContext<'a>,
) -> OnlyExportEntry {
    if let Some(initializer) = initializer {
        let expression = only_export_skip_ts(initializer);
        if only_export_is_route_factory_expression(expression, state, ctx) {
            return OnlyExportEntry::ReactComponent;
        }
        if let Expression::CallExpression(call) = expression {
            if only_export_is_component_name(name)
                && (only_export_is_component_factory_call(call, ctx)
                    || only_export_is_hoc_callee(&call.callee, &state.settings)
                        && !call.arguments.is_empty())
            {
                return OnlyExportEntry::ReactComponent;
            }
        }
        if let Expression::ConditionalExpression(conditional) = expression
            && only_export_is_component_name(name)
            && only_export_component_initializer(&conditional.consequent, state)
            && only_export_component_initializer(&conditional.alternate, state)
        {
            return OnlyExportEntry::ReactComponent;
        }
        if is_function && only_export_is_component_name(name) {
            return OnlyExportEntry::ReactComponent;
        }
        if matches!(
            expression,
            Expression::Identifier(_)
                | Expression::StaticMemberExpression(_)
                | Expression::ComputedMemberExpression(_)
        ) && only_export_expression_is_component(expression, state, ctx)
        {
            return OnlyExportEntry::ReactComponent;
        }
    }
    if state.settings.allow_export_names.contains(name)
        || only_export_framework_export_is_allowed(name, state)
        || state.curated && only_export_is_hook_name(name)
    {
        return OnlyExportEntry::Allowed;
    }
    if let Some(initializer) = initializer {
        let expression = only_export_skip_ts(initializer);
        if state.settings.allow_constant_export && only_export_is_allowed_constant(expression) {
            return OnlyExportEntry::Allowed;
        }
        if is_function {
            return if only_export_is_component_name(name) {
                OnlyExportEntry::ReactComponent
            } else {
                OnlyExportEntry::NonComponent(span)
            };
        }
        if let Expression::CallExpression(call) = expression {
            return if only_export_is_create_context(call) {
                OnlyExportEntry::ReactContext(span)
            } else {
                OnlyExportEntry::NonComponent(span)
            };
        }
        if let Expression::ObjectExpression(object) = expression
            && only_export_object_bundles_components(object, state, ctx)
        {
            return OnlyExportEntry::NamespaceObject(span);
        }
        if state.curated
            && matches!(
                expression,
                Expression::Identifier(_)
                    | Expression::StaticMemberExpression(_)
                    | Expression::ComputedMemberExpression(_)
            )
        {
            return if only_export_expression_is_component(expression, state, ctx) {
                OnlyExportEntry::ReactComponent
            } else {
                OnlyExportEntry::NonComponent(span)
            };
        }
        if state.curated
            && matches!(
                expression,
                Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
            )
        {
            return if is_function {
                OnlyExportEntry::ReactComponent
            } else {
                OnlyExportEntry::NonComponent(span)
            };
        }
        if only_export_is_definite_non_component(expression) {
            return OnlyExportEntry::NonComponent(span);
        }
    }
    if only_export_is_component_name(name) {
        OnlyExportEntry::ReactComponent
    } else {
        OnlyExportEntry::NonComponent(span)
    }
}

fn only_export_framework_export_is_allowed(name: &str, state: &OnlyExportState) -> bool {
    match state.runtime {
        RefreshRuntime::Next => NEXT_ALLOWED_EXPORT_NAMES.contains(&name),
        RefreshRuntime::Expo => name == "unstable_settings",
        RefreshRuntime::Remix | RefreshRuntime::ReactRouter if state.is_router_route_module => {
            ROUTER_ALLOWED_EXPORT_NAMES.contains(&name)
        }
        _ => false,
    }
}

fn only_export_is_hook_name(name: &str) -> bool {
    let Some(suffix) = name.strip_prefix("use") else {
        return false;
    };
    suffix
        .bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_uppercase())
}

fn only_export_is_component_name(name: &str) -> bool {
    name.bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_uppercase())
}

fn only_export_is_es6_component(class: &Class<'_>) -> bool {
    let Some(super_class) = class.heritage_expression() else {
        return false;
    };
    match only_export_skip_ts(super_class) {
        Expression::Identifier(identifier) => {
            matches!(identifier.name.as_str(), "Component" | "PureComponent")
        }
        Expression::StaticMemberExpression(member) => {
            matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "React")
                && matches!(member.property.name.as_str(), "Component" | "PureComponent")
        }
        Expression::ComputedMemberExpression(member) => {
            matches!(&member.object, Expression::Identifier(identifier) if identifier.name == "React")
                && matches!(&member.expression, Expression::Identifier(identifier)
                    if matches!(identifier.name.as_str(), "Component" | "PureComponent"))
        }
        _ => false,
    }
}

fn only_export_skip_ts<'a>(mut expression: &'a Expression<'a>) -> &'a Expression<'a> {
    loop {
        expression = match expression {
            Expression::TSAsExpression(wrapper) => &wrapper.expression,
            Expression::TSSatisfiesExpression(wrapper) => &wrapper.expression,
            Expression::TSNonNullExpression(wrapper) => &wrapper.expression,
            Expression::ParenthesizedExpression(wrapper) => &wrapper.expression,
            _ => return expression,
        };
    }
}

fn only_export_is_allowed_constant(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
            | Expression::TemplateLiteral(_)
            | Expression::BinaryExpression(_)
    ) || matches!(expression, Expression::UnaryExpression(unary)
        if matches!(&unary.argument,
            Expression::BooleanLiteral(_)
                | Expression::NullLiteral(_)
                | Expression::NumericLiteral(_)
                | Expression::StringLiteral(_)
                | Expression::BigIntLiteral(_)
                | Expression::RegExpLiteral(_)))
}

fn only_export_is_definite_non_component(expression: &Expression<'_>) -> bool {
    matches!(
        expression,
        Expression::ArrayExpression(_)
            | Expression::AwaitExpression(_)
            | Expression::BinaryExpression(_)
            | Expression::ChainExpression(_)
            | Expression::ConditionalExpression(_)
            | Expression::LogicalExpression(_)
            | Expression::NewExpression(_)
            | Expression::ObjectExpression(_)
            | Expression::TemplateLiteral(_)
            | Expression::ThisExpression(_)
            | Expression::UnaryExpression(_)
            | Expression::UpdateExpression(_)
            | Expression::BooleanLiteral(_)
            | Expression::NullLiteral(_)
            | Expression::NumericLiteral(_)
            | Expression::StringLiteral(_)
            | Expression::BigIntLiteral(_)
            | Expression::RegExpLiteral(_)
    )
}

fn only_export_is_hoc_callee(callee: &Expression<'_>, settings: &OnlyExportSettings) -> bool {
    match only_export_skip_ts(callee) {
        Expression::Identifier(identifier) => {
            settings.custom_hocs.contains(identifier.name.as_str())
        }
        Expression::StaticMemberExpression(member) => {
            settings.custom_hocs.contains(member.property.name.as_str())
                || matches!(&member.object, Expression::Identifier(identifier)
                    if settings.custom_hocs.contains(identifier.name.as_str()))
                || matches!(&member.object, Expression::CallExpression(call)
                    if only_export_is_hoc_callee(&call.callee, settings))
        }
        Expression::ComputedMemberExpression(member) => {
            matches!(&member.expression, Expression::Identifier(identifier)
                if settings.custom_hocs.contains(identifier.name.as_str()))
                || matches!(&member.object, Expression::Identifier(identifier)
                    if settings.custom_hocs.contains(identifier.name.as_str()))
                || matches!(&member.object, Expression::CallExpression(call)
                    if only_export_is_hoc_callee(&call.callee, settings))
        }
        Expression::PrivateFieldExpression(member) => {
            matches!(&member.object, Expression::Identifier(identifier)
                if settings.custom_hocs.contains(identifier.name.as_str()))
                || matches!(&member.object, Expression::CallExpression(call)
                    if only_export_is_hoc_callee(&call.callee, settings))
        }
        Expression::CallExpression(call) => {
            matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "connect")
                || only_export_is_hoc_callee(&call.callee, settings)
        }
        _ => false,
    }
}

fn only_export_component_initializer(expression: &Expression<'_>, state: &OnlyExportState) -> bool {
    match only_export_skip_ts(expression) {
        Expression::ArrowFunctionExpression(_) => true,
        Expression::FunctionExpression(function) => function.id.is_some(),
        Expression::Identifier(identifier) => {
            only_export_is_component_name(identifier.name.as_str())
        }
        Expression::CallExpression(call) => {
            only_export_is_hoc_callee(&call.callee, &state.settings) && !call.arguments.is_empty()
        }
        _ => false,
    }
}

fn only_export_is_create_context(call: &CallExpression<'_>) -> bool {
    match only_export_skip_ts(&call.callee) {
        Expression::Identifier(identifier) => identifier.name == "createContext",
        Expression::StaticMemberExpression(member) => member.property.name == "createContext",
        Expression::ComputedMemberExpression(member) => {
            matches!(&member.expression, Expression::Identifier(identifier) if identifier.name == "createContext")
        }
        _ => false,
    }
}

fn only_export_is_route_factory_expression<'a>(
    expression: &'a Expression<'a>,
    state: &OnlyExportState,
    ctx: &LintContext<'a>,
) -> bool {
    let Expression::CallExpression(call) = only_export_skip_ts(expression) else {
        return false;
    };
    only_export_is_route_factory_call(call, state, ctx)
}

fn only_export_is_route_factory_call<'a>(
    mut call: &'a CallExpression<'a>,
    state: &OnlyExportState,
    ctx: &LintContext<'a>,
) -> bool {
    loop {
        if only_export_expression_symbol(&call.callee, ctx)
            .is_some_and(|symbol| state.route_factory_symbols.contains(&symbol))
        {
            return true;
        }
        let namespace_member = match only_export_skip_ts(&call.callee) {
            Expression::StaticMemberExpression(member) => {
                Some((&member.object, member.property.name.as_str()))
            }
            Expression::ComputedMemberExpression(member) => {
                let Expression::Identifier(property) = &member.expression else {
                    return false;
                };
                Some((&member.object, property.name.as_str()))
            }
            _ => None,
        };
        if namespace_member.is_some_and(|(object, name)| {
            (match state.runtime {
                RefreshRuntime::Tanstack => TANSTACK_ROUTE_FACTORIES.contains(&name),
                RefreshRuntime::Remix | RefreshRuntime::ReactRouter => {
                    REACT_ROUTER_FACTORIES.contains(&name)
                }
                _ => false,
            }) && only_export_expression_symbol(object, ctx)
                .is_some_and(|symbol| state.route_factory_namespaces.contains(&symbol))
        }) {
            return true;
        }
        let Expression::CallExpression(inner) = only_export_skip_ts(&call.callee) else {
            return false;
        };
        call = inner;
    }
}

fn only_export_identifier_component(
    identifier: &IdentifierReference<'_>,
    state: &OnlyExportState,
    ctx: &LintContext<'_>,
) -> bool {
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    only_export_proven_component_symbol(
        symbol_id,
        identifier.span.start,
        state,
        ctx,
        &mut Vec::new(),
    )
}

fn only_export_proven_component_symbol<'a>(
    symbol_id: SymbolId,
    _reference_offset: u32,
    state: &OnlyExportState,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    if state.local_component_symbols.contains(&symbol_id) {
        return !ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write);
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    if state.import_symbols.contains(&symbol_id) {
        return only_export_is_component_name(ctx.scoping().symbol_name(symbol_id));
    }
    if visited_symbols.contains(&symbol_id) {
        return false;
    }
    let OnlyExportAstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return false;
    };
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return false;
    }
    let Some(initializer) = declarator.init.as_ref() else {
        return false;
    };
    if matches!(
        only_export_skip_ts(initializer),
        Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
    ) {
        return false;
    }
    visited_symbols.push(symbol_id);
    only_export_proven_component_expression(initializer, state, ctx, visited_symbols)
}

fn only_export_proven_component_expression<'a>(
    expression: &'a Expression<'a>,
    state: &OnlyExportState,
    ctx: &LintContext<'a>,
    visited_symbols: &mut Vec<SymbolId>,
) -> bool {
    let expression = only_export_skip_ts(expression);
    match expression {
        Expression::Identifier(identifier) => ctx
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()
            .is_some_and(|symbol_id| {
                only_export_proven_component_symbol(
                    symbol_id,
                    identifier.span.start,
                    state,
                    ctx,
                    visited_symbols,
                )
            }),
        Expression::StaticMemberExpression(member) => {
            only_export_is_component_name(member.property.name.as_str())
                && only_export_expression_symbol(&member.object, ctx)
                    .is_some_and(|symbol| state.import_symbols.contains(&symbol))
        }
        Expression::ArrowFunctionExpression(function) => only_export_function_has_render_semantics(
            ctx.nodes().get_node(function.node_id.get()),
            ctx,
        ),
        Expression::FunctionExpression(function) => only_export_function_has_render_semantics(
            ctx.nodes().get_node(function.node_id.get()),
            ctx,
        ),
        Expression::CallExpression(call) => {
            only_export_is_hoc_callee(&call.callee, &state.settings)
                && call.arguments.iter().any(|argument| {
                    argument.as_expression().is_some_and(|argument| {
                        only_export_proven_component_expression(
                            argument,
                            state,
                            ctx,
                            visited_symbols,
                        )
                    })
                })
        }
        _ => false,
    }
}

fn only_export_expression_is_component<'a>(
    expression: &'a Expression<'a>,
    state: &OnlyExportState,
    ctx: &LintContext<'a>,
) -> bool {
    only_export_proven_component_expression(expression, state, ctx, &mut Vec::new())
}

fn only_export_is_direct_refresh_wrapper<'a>(
    call: &'a CallExpression<'a>,
    state: &OnlyExportState,
    ctx: &LintContext<'a>,
) -> bool {
    if only_export_is_hoc_callee(&call.callee, &state.settings) {
        return !call.arguments.is_empty();
    }
    if !matches!(
        only_export_skip_ts(&call.callee),
        Expression::Identifier(_)
            | Expression::StaticMemberExpression(_)
            | Expression::ComputedMemberExpression(_)
            | Expression::PrivateFieldExpression(_)
    ) {
        return false;
    }
    call.arguments.iter().any(|argument| {
        argument.as_expression().is_some_and(|expression| {
            only_export_proven_component_expression(expression, state, ctx, &mut Vec::new())
        })
    })
}

fn only_export_is_upstream_hoc_call(call: &CallExpression<'_>, state: &OnlyExportState) -> bool {
    if !only_export_is_hoc_callee(&call.callee, &state.settings) {
        return false;
    }
    let Some(argument) = call.arguments.first().and_then(Argument::as_expression) else {
        return false;
    };
    match only_export_skip_ts(argument) {
        Expression::Identifier(_) => true,
        Expression::FunctionExpression(function) => function.id.is_some(),
        Expression::CallExpression(call) => only_export_is_upstream_hoc_call(call, state),
        _ => false,
    }
}

fn only_export_is_config_only_factory(call: &CallExpression<'_>) -> bool {
    !call.arguments.is_empty()
        && call.arguments.iter().all(|argument| {
            argument.as_expression().is_some_and(|expression| {
                matches!(
                    only_export_skip_ts(expression),
                    Expression::ObjectExpression(_)
                        | Expression::BooleanLiteral(_)
                        | Expression::NullLiteral(_)
                        | Expression::NumericLiteral(_)
                        | Expression::StringLiteral(_)
                        | Expression::BigIntLiteral(_)
                        | Expression::RegExpLiteral(_)
                        | Expression::TemplateLiteral(_)
                )
            })
        })
}

fn only_export_is_component_factory_call(call: &CallExpression<'_>, ctx: &LintContext<'_>) -> bool {
    let Expression::Identifier(identifier) = only_export_skip_ts(&call.callee) else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    let declaration = ctx.symbol_declaration(symbol_id);
    let function_node = match declaration.kind() {
        OnlyExportAstKind::Function(_) | OnlyExportAstKind::ArrowFunctionExpression(_) => {
            Some(declaration)
        }
        OnlyExportAstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref().map(only_export_skip_ts) {
                Some(Expression::ArrowFunctionExpression(function)) => {
                    Some(ctx.nodes().get_node(function.node_id.get()))
                }
                Some(Expression::FunctionExpression(function)) => {
                    Some(ctx.nodes().get_node(function.node_id.get()))
                }
                _ => None,
            }
        }
        _ => None,
    };
    function_node.is_some_and(|function| {
        only_export_single_function_return(function).is_some_and(|expression| {
            matches!(only_export_skip_ts(expression), Expression::CallExpression(dynamic_call)
                if only_export_expression_symbol(&dynamic_call.callee, ctx).is_some_and(|dynamic_symbol| {
                    ctx.module_record().import_entries.iter().any(|entry| {
                        entry.module_request.name() == "next/dynamic"
                            && matches!(&entry.import_name, ImportImportName::Default(_))
                            && ctx.scoping().get_root_binding(entry.local_name.name().into()) == Some(dynamic_symbol)
                    })
                }))
        }) && !ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(oxc_semantic::Reference::is_write)
    })
}

fn only_export_single_function_return<'a>(node: &AstNode<'a>) -> Option<&'a Expression<'a>> {
    let statements = match node.kind() {
        OnlyExportAstKind::ArrowFunctionExpression(function) => {
            if let Some(expression) = function.get_expression() {
                return Some(expression);
            }
            let body = function.body.as_function_body()?;
            if !body.directives.is_empty() {
                return None;
            }
            body.statements.as_slice()
        }
        OnlyExportAstKind::Function(function) => {
            let body = function.body.as_ref()?;
            if !body.directives.is_empty() {
                return None;
            }
            body.statements.as_slice()
        }
        _ => return None,
    };
    let [Statement::ReturnStatement(statement)] = statements else {
        return None;
    };
    statement.argument.as_ref()
}

fn only_export_object_bundles_components(
    object: &ObjectExpression<'_>,
    state: &OnlyExportState,
    ctx: &LintContext<'_>,
) -> bool {
    object.properties.iter().any(|property| {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return false;
        };
        let value = only_export_skip_ts(&property.value);
        if let Expression::Identifier(identifier) = value {
            return ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                .is_some_and(|symbol| state.local_component_symbols.contains(&symbol));
        }
        let PropertyKey::StaticIdentifier(property_name) = &property.key else {
            return false;
        };
        if property.computed || !only_export_is_component_name(property_name.name.as_str()) {
            return false;
        }
        match value {
            Expression::ArrowFunctionExpression(function) => {
                only_export_function_has_render_semantics(
                    ctx.nodes().get_node(function.node_id.get()),
                    ctx,
                )
            }
            Expression::FunctionExpression(function) => only_export_function_has_render_semantics(
                ctx.nodes().get_node(function.node_id.get()),
                ctx,
            ),
            Expression::CallExpression(call) => {
                only_export_is_hoc_callee(&call.callee, &state.settings)
                    && !call.arguments.is_empty()
            }
            _ => false,
        }
    })
}

fn only_export_node_is_exported(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(
            ancestor.kind(),
            OnlyExportAstKind::ExportDefaultDeclaration(_)
                | OnlyExportAstKind::ExportDeclaration(_)
                | OnlyExportAstKind::ExportFromDeclaration(_)
                | OnlyExportAstKind::ExportNamedDeclaration(_)
        )
    })
}

fn only_export_star_adds_runtime_values(
    filename: &Path,
    export_all: &ExportAllDeclaration<'_>,
) -> bool {
    let source = export_all.source.value.as_str();
    if !source.starts_with('.') {
        return true;
    }
    let Some(target) = only_export_resolve_relative_target(filename, source) else {
        return true;
    };
    only_export_file_has_runtime_named_exports(&target, &mut FxHashSet::default())
}

fn only_export_resolve_relative_target(filename: &Path, source: &str) -> Option<PathBuf> {
    let directory = filename.parent()?;
    let base = directory.join(source);
    let candidates = [
        base.clone(),
        base.with_extension("ts"),
        base.with_extension("tsx"),
        base.with_extension("js"),
        base.with_extension("jsx"),
        base.with_extension("mts"),
        base.with_extension("mjs"),
        base.with_extension("cts"),
        base.with_extension("cjs"),
        base.join("index.ts"),
        base.join("index.tsx"),
        base.join("index.js"),
        base.join("index.jsx"),
        base.join("index.mts"),
        base.join("index.mjs"),
        base.join("index.cts"),
        base.join("index.cjs"),
    ];
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn only_export_file_has_runtime_named_exports(
    filename: &Path,
    visited_files: &mut FxHashSet<PathBuf>,
) -> bool {
    if matches!(
        filename
            .extension()
            .and_then(|extension| extension.to_str()),
        Some("cjs" | "cts")
    ) {
        return true;
    }
    let Ok(filename) = filename.canonicalize() else {
        return true;
    };
    if !visited_files.insert(filename.clone()) {
        return true;
    }
    if filename.to_str().is_some_and(|filename| {
        [".d.ts", ".d.mts", ".d.cts"]
            .iter()
            .any(|extension| filename.ends_with(extension))
    }) || fs::metadata(&filename).map_or(true, |metadata| {
        !metadata.is_file() || metadata.len() > ONLY_EXPORT_CROSS_FILE_PARSE_MAX_BYTES
    }) {
        return true;
    }
    let Ok(source) = fs::read_to_string(&filename) else {
        return true;
    };
    let Ok(source_type) = SourceType::from_path(&filename) else {
        return true;
    };
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &source, source_type).parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return true;
    }
    parsed.program.body.iter().any(|statement| match statement {
        Statement::ExportAllDeclaration(export) if export.export_kind.is_value() => {
            if export.exported.is_some() {
                return true;
            }
            let Some(target) =
                only_export_resolve_relative_target(&filename, export.source.value.as_str())
            else {
                return true;
            };
            only_export_file_has_runtime_named_exports(&target, visited_files)
        }
        Statement::ExportDeclaration(export) => match &export.declaration {
            Declaration::TSInterfaceDeclaration(_) | Declaration::TSTypeAliasDeclaration(_) => {
                false
            }
            Declaration::FunctionDeclaration(function) => {
                function.r#type != FunctionType::TSDeclareFunction
            }
            _ => true,
        },
        Statement::ExportNamedDeclaration(export) if export.export_kind.is_value() => {
            export.specifiers.iter().any(|specifier| {
                specifier.export_kind.is_value() && specifier.exported.name() != "default"
            })
        }
        Statement::ExportFromDeclaration(export) if export.export_kind.is_value() => {
            export.specifiers.iter().any(|specifier| {
                specifier.export_kind.is_value() && specifier.exported.name() != "default"
            })
        }
        _ => false,
    })
}
