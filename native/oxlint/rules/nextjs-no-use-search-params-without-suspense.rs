use oxc_ast::{
    AstKind,
    ast::{Expression, JSXElementName, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "useSearchParams() without a <Suspense> boundary forces the whole page into client-side rendering.";
const NEXTJS_SEARCH_PARAMS_CROSS_FILE_PARSE_MAX_BYTES: u64 = 2_000_000;

#[derive(Clone, Copy)]
struct NextjsSearchParamsLayoutCacheEntry {
    modified: std::time::SystemTime,
    size: u64,
    mentions_suspense: bool,
}

static NEXTJS_SEARCH_PARAMS_LAYOUT_CACHE: std::sync::OnceLock<
    std::sync::Mutex<
        std::collections::HashMap<std::path::PathBuf, NextjsSearchParamsLayoutCacheEntry>,
    >,
> = std::sync::OnceLock::new();

#[derive(Debug, Default, Clone)]
pub struct NextjsNoUseSearchParamsWithoutSuspense;

declare_oxc_lint!(
    /// Require Suspense around useSearchParams in Next.js pages and layouts.
    NextjsNoUseSearchParamsWithoutSuspense,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require Suspense around useSearchParams.",
);

impl Rule for NextjsNoUseSearchParamsWithoutSuspense {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_test_noise_file(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if !nextjs_search_params_file_matches(ctx) || !is_next_file_active(ctx) {
            return;
        }
        let has_ancestor_layout_suspense = nextjs_search_params_has_ancestor_layout_suspense(ctx);
        if has_ancestor_layout_suspense {
            return;
        }
        let (imported_components, suspense_local_names) = nextjs_search_params_collect_imports(ctx);
        let has_suspense_in_file =
            !suspense_local_names.is_empty() || nextjs_file_has_suspense(ctx);
        let mut imported_component_hook_cache = std::collections::HashMap::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::CallExpression(call)
                    if !has_suspense_in_file && nextjs_search_params_is_hook_call(call) =>
                {
                    ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(call.span));
                }
                AstKind::JSXOpeningElement(opening) => {
                    nextjs_search_params_check_imported_component(
                        node,
                        opening,
                        ctx,
                        &imported_components,
                        &suspense_local_names,
                        &mut imported_component_hook_cache,
                    );
                }
                _ => {}
            }
        }
    }
}

fn nextjs_search_params_check_imported_component<'a>(
    node: &AstNode<'a>,
    opening: &oxc_ast::ast::JSXOpeningElement<'a>,
    ctx: &LintContext<'a>,
    imported_components: &std::collections::HashMap<String, (String, String)>,
    suspense_local_names: &std::collections::HashSet<String>,
    hook_cache: &mut std::collections::HashMap<(String, String), bool>,
) {
    let JSXElementName::IdentifierReference(identifier) = &opening.name else {
        return;
    };
    let Some((module_source, exported_name)) = imported_components.get(identifier.name.as_str())
    else {
        return;
    };
    if nextjs_search_params_is_inside_suspense(node, ctx, suspense_local_names) {
        return;
    }
    let cache_key = (module_source.to_owned(), exported_name.to_owned());
    let contains_hook = *hook_cache.entry(cache_key).or_insert_with(|| {
        nextjs_search_params_imported_export_contains_hook(
            ctx.file_path(),
            module_source,
            exported_name,
            0,
        )
    });
    if !contains_hook {
        return;
    }
    ctx.diagnostic(
        OxcDiagnostic::warn(format!(
            "<{}> uses useSearchParams() outside <Suspense>, so this page falls back to client-side rendering.",
            identifier.name
        ))
        .with_label(opening.span),
    );
}

fn nextjs_search_params_is_inside_suspense(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
    suspense_local_names: &std::collections::HashSet<String>,
) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        let AstKind::JSXElement(element) = ancestor.kind() else {
            return false;
        };
        nextjs_search_params_is_suspense_name(&element.opening_element.name, suspense_local_names)
    })
}

fn nextjs_search_params_is_suspense_name(
    name: &JSXElementName<'_>,
    suspense_local_names: &std::collections::HashSet<String>,
) -> bool {
    match name {
        JSXElementName::Identifier(identifier) => {
            identifier.name == "Suspense" || suspense_local_names.contains(identifier.name.as_str())
        }
        JSXElementName::IdentifierReference(identifier) => {
            identifier.name == "Suspense" || suspense_local_names.contains(identifier.name.as_str())
        }
        JSXElementName::MemberExpression(member) => member.property.name == "Suspense",
        JSXElementName::ThisExpression(_) | JSXElementName::NamespacedName(_) => false,
    }
}

fn nextjs_search_params_collect_imports(
    ctx: &LintContext<'_>,
) -> (
    std::collections::HashMap<String, (String, String)>,
    std::collections::HashSet<String>,
) {
    let mut imported_components = std::collections::HashMap::new();
    let mut suspense_local_names = std::collections::HashSet::new();
    for entry in &ctx.module_record().import_entries {
        let exported_name = match &entry.import_name {
            crate::module_record::ImportImportName::Name(name) => name.name(),
            crate::module_record::ImportImportName::Default(_) => "default",
            crate::module_record::ImportImportName::NamespaceObject => continue,
        };
        let local_name = entry.local_name.name();
        if entry.module_request.name() == "react" && exported_name == "Suspense" {
            suspense_local_names.insert(local_name.to_owned());
        }
        imported_components.insert(
            local_name.to_owned(),
            (
                entry.module_request.name().to_owned(),
                exported_name.to_owned(),
            ),
        );
    }
    (imported_components, suspense_local_names)
}

fn nextjs_search_params_imported_export_contains_hook(
    from_file_path: &std::path::Path,
    module_source: &str,
    exported_name: &str,
    depth: usize,
) -> bool {
    if depth >= 4 {
        return false;
    }
    let Some(file_path) =
        nextjs_search_params_resolve_first_party_module_path(from_file_path, module_source)
    else {
        return false;
    };
    nextjs_search_params_file_export_contains_hook(&file_path, exported_name, depth)
        .unwrap_or(false)
}

fn nextjs_search_params_file_export_contains_hook(
    file_path: &std::path::Path,
    exported_name: &str,
    depth: usize,
) -> Option<bool> {
    let filename = file_path.to_string_lossy();
    if filename.ends_with(".d.ts") || filename.ends_with(".d.mts") || filename.ends_with(".d.cts") {
        return None;
    }
    let Ok(metadata) = std::fs::metadata(file_path) else {
        return None;
    };
    if !metadata.is_file() || metadata.len() > NEXTJS_SEARCH_PARAMS_CROSS_FILE_PARSE_MAX_BYTES {
        return None;
    }
    let Ok(source) = std::fs::read_to_string(file_path) else {
        return None;
    };
    let Ok(source_type) = oxc_span::SourceType::from_path(file_path) else {
        return None;
    };
    let allocator = oxc_allocator::Allocator::default();
    let parser_return = oxc_parser::Parser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = oxc_semantic::SemanticBuilder::new_linter().build(program);
    let semantic = semantic_return.semantic;
    let module_record =
        crate::module_record::ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    if let Some(function_span) =
        nextjs_search_params_exported_function_span(exported_name, &semantic, &module_record)
    {
        return Some(semantic.nodes().iter().any(|node| {
            matches!(node.kind(), AstKind::CallExpression(call)
                if function_span.contains_inclusive(call.span)
                    && nextjs_search_params_is_hook_call(call))
        }));
    }
    if let Some((next_source, next_exported_name)) =
        nextjs_search_params_reexport_target(exported_name, &module_record)
    {
        return nextjs_search_params_resolve_export_hook(
            file_path,
            next_source,
            next_exported_name,
            depth + 1,
        );
    }
    let mut resolved_export_all = None;
    for statement in &program.body {
        let Statement::ExportAllDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.export_kind.is_type() || declaration.exported.is_some() {
            continue;
        }
        let Some(candidate) = nextjs_search_params_resolve_export_hook(
            file_path,
            declaration.source.value.as_str(),
            exported_name,
            depth + 1,
        ) else {
            continue;
        };
        if resolved_export_all.is_some() {
            return None;
        }
        resolved_export_all = Some(candidate);
    }
    resolved_export_all
}

fn nextjs_search_params_resolve_export_hook(
    from_file_path: &std::path::Path,
    module_source: &str,
    exported_name: &str,
    depth: usize,
) -> Option<bool> {
    if depth >= 4 {
        return None;
    }
    let file_path =
        nextjs_search_params_resolve_first_party_module_path(from_file_path, module_source)?;
    nextjs_search_params_file_export_contains_hook(&file_path, exported_name, depth)
}

fn nextjs_search_params_is_hook_call(call: &oxc_ast::ast::CallExpression<'_>) -> bool {
    match &call.callee {
        Expression::Identifier(identifier) => identifier.name == "useSearchParams",
        Expression::StaticMemberExpression(member) => member.property.name == "useSearchParams",
        Expression::ComputedMemberExpression(member) => {
            matches!(&member.expression, Expression::Identifier(identifier)
                if identifier.name == "useSearchParams")
        }
        _ => false,
    }
}

fn nextjs_search_params_exported_function_span(
    exported_name: &str,
    semantic: &oxc_semantic::Semantic<'_>,
    module_record: &crate::module_record::ModuleRecord,
) -> Option<oxc_span::Span> {
    if let Some(symbol_id) =
        nextjs_search_params_exported_symbol_id(exported_name, semantic, module_record)
    {
        let declaration = semantic.symbol_declaration(symbol_id);
        match declaration.kind() {
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
                return Some(declaration.span());
            }
            AstKind::VariableDeclarator(declarator) => {
                let initializer =
                    nextjs_search_params_strip_transparent_wrappers(declarator.init.as_ref()?);
                if matches!(
                    initializer,
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                ) {
                    return Some(initializer.span());
                }
            }
            _ => {}
        }
    }
    if exported_name != "default" {
        return None;
    }
    if let Some(function_span) = semantic.nodes().iter().find_map(|node| {
        matches!(node.kind(), AstKind::Function(_))
            .then(|| semantic.nodes().parent_node(node.id()))
            .filter(|parent| matches!(parent.kind(), AstKind::ExportDefaultDeclaration(_)))
            .map(|_| node.span())
    }) {
        return Some(function_span);
    }
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        let expression = nextjs_search_params_strip_transparent_wrappers(
            declaration.declaration.as_expression()?,
        );
        matches!(
            expression,
            Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
        )
        .then(|| expression.span())
    })
}

fn nextjs_search_params_strip_transparent_wrappers<'a>(
    expression: &'a Expression<'a>,
) -> &'a Expression<'a> {
    expression.get_inner_expression()
}

fn nextjs_search_params_exported_symbol_id(
    exported_name: &str,
    semantic: &oxc_semantic::Semantic<'_>,
    module_record: &crate::module_record::ModuleRecord,
) -> Option<oxc_semantic::SymbolId> {
    let local_name = module_record
        .local_export_entries
        .iter()
        .find_map(|entry| {
            let matches_export = match &entry.export_name {
                crate::module_record::ExportExportName::Name(name) => name.name() == exported_name,
                crate::module_record::ExportExportName::Default(_) => exported_name == "default",
                crate::module_record::ExportExportName::Null => false,
            };
            matches_export.then(|| entry.local_name.name()).flatten()
        })?;
    semantic.scoping().get_root_binding(local_name.into())
}

fn nextjs_search_params_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a crate::module_record::ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            let entry_exported_name = match &entry.export_name {
                crate::module_record::ExportExportName::Name(name) => name.name(),
                crate::module_record::ExportExportName::Default(_) => "default",
                crate::module_record::ExportExportName::Null => return None,
            };
            if entry_exported_name != exported_name {
                return None;
            }
            let source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                crate::module_record::ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((source, imported_name))
        })
}

fn nextjs_search_params_resolve_first_party_module_path(
    from_file_path: &std::path::Path,
    module_source: &str,
) -> Option<std::path::PathBuf> {
    if std::path::Path::new(module_source).is_absolute() {
        return None;
    }
    let resolver = oxc_resolver::Resolver::new(oxc_resolver::ResolveOptions {
        extensions: oxc_span::VALID_EXTENSIONS
            .iter()
            .map(|extension| format!(".{extension}"))
            .collect(),
        main_fields: vec!["module".into(), "main".into()],
        condition_names: vec!["module".into(), "import".into()],
        extension_alias: vec![
            (".js".into(), vec![".js".into(), ".ts".into()]),
            (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
            (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
        ],
        tsconfig: Some(oxc_resolver::TsconfigDiscovery::Auto),
        ..oxc_resolver::ResolveOptions::default()
    });
    let resolved_path = resolver
        .resolve_file(from_file_path, module_source)
        .ok()
        .map(|resolution| resolution.path().to_path_buf())
        .or_else(|| nextjs_search_params_resolve_module_fallback(from_file_path, module_source))?;
    let resolved_path =
        std::fs::canonicalize(&resolved_path).unwrap_or_else(|_| resolved_path.to_path_buf());
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn nextjs_search_params_resolve_module_fallback(
    from_file_path: &std::path::Path,
    module_source: &str,
) -> Option<std::path::PathBuf> {
    if module_source.starts_with('.') {
        return nextjs_search_params_resolve_module_file(
            &from_file_path.parent()?.join(module_source),
        );
    }
    let mut directory = from_file_path.parent();
    for _ in 0..30 {
        let current_directory = directory?;
        for config_name in ["tsconfig.json", "jsconfig.json"] {
            let config_path = current_directory.join(config_name);
            let Some(config) = std::fs::read_to_string(&config_path)
                .ok()
                .and_then(|source| {
                    serde_json::from_str::<serde_json::Value>(&nextjs_search_params_strip_jsonc(
                        &source,
                    ))
                    .ok()
                })
            else {
                continue;
            };
            let Some(compiler_options) = config
                .get("compilerOptions")
                .and_then(serde_json::Value::as_object)
            else {
                continue;
            };
            let base_directory = compiler_options
                .get("baseUrl")
                .and_then(serde_json::Value::as_str)
                .map_or_else(
                    || current_directory.to_path_buf(),
                    |base_url| current_directory.join(base_url),
                );
            if let Some(paths) = compiler_options
                .get("paths")
                .and_then(serde_json::Value::as_object)
            {
                let mut best_match = None;
                for (pattern, targets) in paths {
                    let Some(capture) =
                        nextjs_search_params_match_path_pattern(module_source, pattern)
                    else {
                        continue;
                    };
                    let prefix_length = pattern.find('*').unwrap_or(pattern.len());
                    if best_match
                        .as_ref()
                        .is_none_or(|(best_prefix_length, _, _)| {
                            prefix_length > *best_prefix_length
                        })
                    {
                        best_match = Some((prefix_length, capture, targets));
                    }
                }
                if let Some((_, capture, targets)) = best_match {
                    for target in targets.as_array().into_iter().flatten() {
                        let Some(target) = target.as_str() else {
                            continue;
                        };
                        let substituted = target.replace('*', &capture);
                        if let Some(resolved) = nextjs_search_params_resolve_module_file(
                            &base_directory.join(substituted),
                        ) {
                            return Some(resolved);
                        }
                    }
                }
            }
            if compiler_options
                .get("baseUrl")
                .and_then(serde_json::Value::as_str)
                .is_some()
            {
                return nextjs_search_params_resolve_module_file(
                    &base_directory.join(module_source),
                );
            }
        }
        directory = current_directory.parent();
    }
    None
}

fn nextjs_search_params_match_path_pattern(source: &str, pattern: &str) -> Option<String> {
    let Some(star_index) = pattern.find('*') else {
        return (source == pattern).then(String::new);
    };
    let prefix = &pattern[..star_index];
    let suffix = &pattern[star_index + 1..];
    source
        .strip_prefix(prefix)?
        .strip_suffix(suffix)
        .map(str::to_owned)
}

fn nextjs_search_params_resolve_module_file(path: &std::path::Path) -> Option<std::path::PathBuf> {
    if path.is_file() {
        return Some(path.to_path_buf());
    }
    let extension = path.extension().and_then(|extension| extension.to_str());
    let extension_candidates: &[&str] = match extension {
        Some("js") => &["js", "ts", "tsx", "jsx"],
        Some("jsx") => &["jsx", "tsx"],
        Some("mjs") => &["mjs", "mts"],
        Some("cjs") => &["cjs", "cts"],
        Some("ts" | "tsx" | "mts" | "cts") => &[],
        _ => &["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"],
    };
    for candidate_extension in extension_candidates {
        let candidate = if extension.is_some() {
            path.with_extension(candidate_extension)
        } else {
            std::path::PathBuf::from(format!("{}.{}", path.display(), candidate_extension))
        };
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    for candidate_extension in ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"] {
        let candidate = path.join(format!("index.{candidate_extension}"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn nextjs_search_params_strip_jsonc(source: &str) -> String {
    let mut without_comments = String::with_capacity(source.len());
    let mut characters = source.chars().peekable();
    let mut is_inside_string = false;
    while let Some(character) = characters.next() {
        if is_inside_string {
            without_comments.push(character);
            if character == '\\' {
                if let Some(escaped) = characters.next() {
                    without_comments.push(escaped);
                }
            } else if character == '"' {
                is_inside_string = false;
            }
            continue;
        }
        if character == '"' {
            is_inside_string = true;
            without_comments.push(character);
            continue;
        }
        if character == '/' && characters.peek() == Some(&'/') {
            characters.next();
            for comment_character in characters.by_ref() {
                if comment_character == '\n' {
                    without_comments.push('\n');
                    break;
                }
            }
            continue;
        }
        if character == '/' && characters.peek() == Some(&'*') {
            characters.next();
            let mut previous = '\0';
            for comment_character in characters.by_ref() {
                if previous == '*' && comment_character == '/' {
                    break;
                }
                previous = comment_character;
            }
            continue;
        }
        without_comments.push(character);
    }
    let mut without_trailing_commas = String::with_capacity(without_comments.len());
    let mut characters = without_comments.chars().peekable();
    let mut is_inside_string = false;
    while let Some(character) = characters.next() {
        if character == '"' {
            let mut slash_count = 0;
            for previous in without_trailing_commas.chars().rev() {
                if previous != '\\' {
                    break;
                }
                slash_count += 1;
            }
            if slash_count % 2 == 0 {
                is_inside_string = !is_inside_string;
            }
        }
        if character == ',' && !is_inside_string {
            let mut lookahead = characters.clone();
            while lookahead.peek().is_some_and(|next| next.is_whitespace()) {
                lookahead.next();
            }
            if matches!(lookahead.peek(), Some('}' | ']')) {
                continue;
            }
        }
        without_trailing_commas.push(character);
    }
    without_trailing_commas
}

fn nextjs_search_params_file_matches(ctx: &LintContext<'_>) -> bool {
    let filename = ctx.file_path().to_string_lossy().replace('\\', "/");
    let Some(file_name) = filename.rsplit('/').next() else {
        return false;
    };
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return false;
    };
    matches!(stem, "page" | "layout")
        && matches!(extension, "js" | "jsx" | "ts" | "tsx" | "mjs" | "mts")
}

fn nextjs_file_has_suspense(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|candidate| match candidate.kind() {
        AstKind::JSXOpeningElement(opening) => match &opening.name {
            JSXElementName::Identifier(identifier) => identifier.name == "Suspense",
            JSXElementName::IdentifierReference(identifier) => identifier.name == "Suspense",
            JSXElementName::MemberExpression(member) => member.property.name == "Suspense",
            JSXElementName::ThisExpression(_) | JSXElementName::NamespacedName(_) => false,
        },
        AstKind::ImportDeclaration(declaration) if declaration.source.value == "react" => {
            declaration.specifiers.iter().flatten().any(|specifier| {
                matches!(
                    specifier,
                    oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(specifier)
                        if specifier.imported.name() == "Suspense"
                )
            })
        }
        _ => false,
    })
}

fn nextjs_search_params_has_ancestor_layout_suspense(ctx: &LintContext<'_>) -> bool {
    let mut directory = ctx.file_path().parent();
    for _ in 0..30 {
        let Some(current_directory) = directory else {
            return false;
        };
        for extension in ["tsx", "jsx", "ts", "js", "mts", "mjs"] {
            let layout_path = current_directory.join(format!("layout.{extension}"));
            if layout_path == ctx.file_path() {
                continue;
            }
            if nextjs_search_params_layout_mentions_suspense(&layout_path) {
                return true;
            }
        }
        let Some(parent_directory) = current_directory.parent() else {
            return false;
        };
        if current_directory.file_name().and_then(|name| name.to_str()) == Some("app")
            && parent_directory.file_name().and_then(|name| name.to_str()) != Some("app")
        {
            return false;
        }
        directory = Some(parent_directory);
    }
    false
}

fn nextjs_search_params_layout_mentions_suspense(path: &std::path::Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() > NEXTJS_SEARCH_PARAMS_CROSS_FILE_PARSE_MAX_BYTES {
        return false;
    }
    let modified = metadata.modified().ok();
    let cache = NEXTJS_SEARCH_PARAMS_LAYOUT_CACHE
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Some(modified) = modified
        && let Ok(cache) = cache.lock()
        && let Some(entry) = cache.get(path)
        && entry.modified == modified
        && entry.size == metadata.len()
    {
        return entry.mentions_suspense;
    }
    let mentions_suspense = std::fs::read_to_string(path)
        .ok()
        .is_some_and(|source| nextjs_search_params_source_mentions_suspense(path, &source));
    if let Some(modified) = modified
        && let Ok(mut cache) = cache.lock()
    {
        cache.insert(
            path.to_path_buf(),
            NextjsSearchParamsLayoutCacheEntry {
                modified,
                size: metadata.len(),
                mentions_suspense,
            },
        );
    }
    mentions_suspense
}

fn nextjs_search_params_source_mentions_suspense(path: &std::path::Path, source: &str) -> bool {
    let Ok(source_type) = oxc_span::SourceType::from_path(path) else {
        return false;
    };
    let allocator = oxc_allocator::Allocator::default();
    let parser_return = oxc_parser::Parser::new(&allocator, source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return false;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = oxc_semantic::SemanticBuilder::new_linter().build(program);
    semantic_return
        .semantic
        .nodes()
        .iter()
        .any(|node| match node.kind() {
            AstKind::JSXOpeningElement(opening) => match &opening.name {
                JSXElementName::Identifier(identifier) => identifier.name == "Suspense",
                JSXElementName::IdentifierReference(identifier) => identifier.name == "Suspense",
                JSXElementName::MemberExpression(member) => member.property.name == "Suspense",
                JSXElementName::ThisExpression(_) | JSXElementName::NamespacedName(_) => false,
            },
            AstKind::ImportDeclaration(declaration) if declaration.source.value == "react" => {
                declaration.specifiers.iter().flatten().any(|specifier| {
                    matches!(
                        specifier,
                        oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(specifier)
                            if specifier.imported.name() == "Suspense"
                    )
                })
            }
            _ => false,
        })
}
