use oxc_ast::{
    AstKind,
    ast::{BindingPattern, Expression, JSXElementName, ObjectPropertyKind, TSType, TSTypeName},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_semantic::{NodeId, SymbolId};
use oxc_span::GetSpan;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{context::LintContext, rule::Rule};

const MESSAGE: &str = "Pass Remotion's `abortSignal` to this fetch with `{signal: abortSignal}` so superseded metadata requests are cancelled.";

#[derive(Debug, Default, Clone)]
pub struct RemotionCalculateMetadataFetchSignal;

declare_oxc_lint!(
    /// Require calculateMetadata fetches to forward Remotion's abort signal.
    RemotionCalculateMetadataFetchSignal,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Require calculateMetadata fetches to forward the abort signal.",
);

impl Rule for RemotionCalculateMetadataFetchSignal {
    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if file_is_non_react_jsx_dialect(ctx) {
            return;
        }
        let mut resolution_cache = LocalFunctionResolutionCache::default();
        let mut owned_function_ids = FxHashSet::default();
        let mut fetch_owner_ids = FxHashSet::default();

        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::JSXOpeningElement(opening_element)
                    if resolve_imported_jsx_component_name(opening_element, "remotion", ctx)
                        == Some("Composition") =>
                {
                    let Some(expression) = find_jsx_attribute(opening_element, "calculateMetadata")
                        .and_then(jsx_attribute_expression)
                    else {
                        continue;
                    };
                    if let Some(function_id) = exact_local_function_id_including_generators(
                        expression,
                        ctx,
                        &mut Vec::new(),
                        &mut resolution_cache,
                    ) {
                        owned_function_ids.insert(function_id);
                    }
                }
                AstKind::VariableDeclarator(declarator)
                    if remotion_metadata_has_calculate_metadata_type(declarator, ctx) =>
                {
                    let Some(initializer) = declarator.init.as_ref() else {
                        continue;
                    };
                    if let Some(function_id) = exact_local_function_id_including_generators(
                        initializer,
                        ctx,
                        &mut Vec::new(),
                        &mut resolution_cache,
                    ) {
                        owned_function_ids.insert(function_id);
                    }
                }
                AstKind::CallExpression(call) if remotion_metadata_is_global_fetch(call, ctx) => {
                    if let Some(function) = crate::ast_util::get_enclosing_function(node, ctx) {
                        fetch_owner_ids.insert(function.id());
                    }
                }
                _ => {}
            }
        }

        let exported_fetch_functions = fetch_owner_ids
            .iter()
            .filter(|function_id| !owned_function_ids.contains(function_id))
            .filter_map(|function_id| {
                let export_names = remotion_metadata_function_export_names(*function_id, ctx);
                (!export_names.is_empty()).then_some((*function_id, export_names))
            })
            .collect::<Vec<_>>();
        if !exported_fetch_functions.is_empty()
            && let Some(cross_file_export_names) =
                remotion_metadata_cross_file_owned_export_names(ctx)
        {
            for (function_id, export_names) in exported_fetch_functions {
                if export_names
                    .iter()
                    .any(|export_name| cross_file_export_names.contains(export_name))
                {
                    owned_function_ids.insert(function_id);
                }
            }
        }

        for node in ctx.nodes().iter() {
            let AstKind::CallExpression(call) = node.kind() else {
                continue;
            };
            if !remotion_metadata_is_global_fetch(call, ctx)
                || crate::ast_util::get_enclosing_function(node, ctx)
                    .is_none_or(|function| !owned_function_ids.contains(&function.id()))
                || remotion_metadata_fetch_uses_abort_signal(call, ctx) != Some(false)
            {
                continue;
            }
            ctx.diagnostic(OxcDiagnostic::error(MESSAGE).with_label(call.span));
        }
    }
}

fn remotion_metadata_is_global_fetch(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let Expression::Identifier(callee) = &call.callee else {
        return false;
    };
    callee.name == "fetch"
        && ctx
            .scoping()
            .get_reference(callee.reference_id())
            .symbol_id()
            .is_none()
}

#[derive(Clone, Copy, Default)]
struct RemotionMetadataAbortSignalBinding {
    parameter_symbol_id: Option<SymbolId>,
    signal_symbol_id: Option<SymbolId>,
}

fn remotion_metadata_abort_signal_binding(
    function_node: &crate::AstNode<'_>,
) -> RemotionMetadataAbortSignalBinding {
    let first_parameter = match function_node.kind() {
        AstKind::Function(function) => function.params.items.first(),
        AstKind::ArrowFunctionExpression(function) => function.params.items.first(),
        _ => None,
    };
    let Some(first_parameter) = first_parameter else {
        return RemotionMetadataAbortSignalBinding::default();
    };
    if let Some(parameter_symbol_id) =
        remotion_metadata_direct_or_default_identifier_symbol(&first_parameter.pattern)
    {
        return RemotionMetadataAbortSignalBinding {
            parameter_symbol_id: Some(parameter_symbol_id),
            signal_symbol_id: None,
        };
    }
    let BindingPattern::ObjectPattern(pattern) = &first_parameter.pattern else {
        return RemotionMetadataAbortSignalBinding::default();
    };
    for property in &pattern.properties {
        if property.key.static_name().as_deref() != Some("abortSignal") {
            continue;
        }
        if let Some(signal_symbol_id) =
            remotion_metadata_direct_or_default_identifier_symbol(&property.value)
        {
            return RemotionMetadataAbortSignalBinding {
                parameter_symbol_id: None,
                signal_symbol_id: Some(signal_symbol_id),
            };
        }
    }
    RemotionMetadataAbortSignalBinding::default()
}

fn remotion_metadata_direct_or_default_identifier_symbol(
    pattern: &BindingPattern<'_>,
) -> Option<SymbolId> {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
        BindingPattern::AssignmentPattern(assignment) => match &assignment.left {
            BindingPattern::BindingIdentifier(identifier) => Some(identifier.symbol_id()),
            _ => None,
        },
        _ => None,
    }
}

fn remotion_metadata_fetch_uses_abort_signal(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> Option<bool> {
    let function_node =
        crate::ast_util::get_enclosing_function(ctx.nodes().get_node(call.node_id.get()), ctx)?;
    let binding = remotion_metadata_abort_signal_binding(function_node);
    let Some(options_argument) = call.arguments.get(1) else {
        return Some(false);
    };
    let Some(options_expression) = options_argument.as_expression() else {
        return None;
    };
    let Expression::ObjectExpression(options) = options_expression.get_inner_expression() else {
        return None;
    };
    if options
        .properties
        .iter()
        .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_)))
    {
        return None;
    }
    for property in options.properties.iter().rev() {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        if property.key.static_name().as_deref() == Some("signal") {
            return Some(remotion_metadata_is_abort_signal_expression(
                &property.value,
                binding,
                ctx,
            ));
        }
    }
    Some(false)
}

fn remotion_metadata_is_abort_signal_expression(
    expression: &Expression<'_>,
    binding: RemotionMetadataAbortSignalBinding,
    ctx: &LintContext<'_>,
) -> bool {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression
        && binding.signal_symbol_id.is_some_and(|symbol_id| {
            ctx.scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
                == Some(symbol_id)
        })
    {
        return true;
    }
    let Some(member) = expression.as_member_expression() else {
        return false;
    };
    if member.static_property_name() != Some("abortSignal") {
        return false;
    }
    let Expression::Identifier(receiver) = member.object().get_inner_expression() else {
        return false;
    };
    binding.parameter_symbol_id.is_some_and(|symbol_id| {
        ctx.scoping()
            .get_reference(receiver.reference_id())
            .symbol_id()
            == Some(symbol_id)
    })
}

fn remotion_metadata_has_calculate_metadata_type(
    declarator: &oxc_ast::ast::VariableDeclarator<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if declarator.id.get_binding_identifier().is_none() {
        return false;
    }
    let Some(annotation) = declarator.type_annotation.as_ref() else {
        return false;
    };
    let TSType::TSTypeReference(type_reference) = &annotation.type_annotation else {
        return false;
    };
    let TSTypeName::IdentifierReference(type_identifier) = &type_reference.type_name else {
        return false;
    };
    let Some(symbol_id) = ctx
        .scoping()
        .get_reference(type_identifier.reference_id())
        .symbol_id()
    else {
        return false;
    };
    ctx.module_record().import_entries.iter().any(|entry| {
        entry.module_request.name() == "remotion"
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
            && matches!(
                &entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "CalculateMetadataFunction"
            )
    })
}

fn remotion_metadata_function_export_names(
    function_node_id: NodeId,
    ctx: &LintContext<'_>,
) -> FxHashSet<String> {
    let function_node = ctx.nodes().get_node(function_node_id);
    let function_root_id =
        remotion_metadata_transparent_root_node_id(function_node_id, ctx.semantic());
    let mut export_names = FxHashSet::default();
    if matches!(
        ctx.nodes().parent_node(function_root_id).kind(),
        AstKind::ExportDefaultDeclaration(_)
    ) {
        export_names.insert("default".to_string());
    }
    let symbol_id = match function_node.kind() {
        AstKind::Function(function)
            if function.r#type == oxc_ast::ast::FunctionType::FunctionDeclaration =>
        {
            function
                .id
                .as_ref()
                .map(|identifier| identifier.symbol_id())
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let root = ctx.nodes().get_node(function_root_id);
            match ctx.nodes().parent_node(root.id()).kind() {
                AstKind::VariableDeclarator(declarator) => declarator
                    .id
                    .get_binding_identifier()
                    .map(|identifier| identifier.symbol_id()),
                _ => None,
            }
        }
        _ => None,
    };
    let Some(symbol_id) = symbol_id else {
        return export_names;
    };
    for entry in &ctx.module_record().local_export_entries {
        let Some(local_name) = entry.local_name.name() else {
            continue;
        };
        if ctx.scoping().get_root_binding(local_name.into()) != Some(symbol_id) {
            continue;
        }
        let export_name = match &entry.export_name {
            crate::module_record::ExportExportName::Name(name) => Some(name.name()),
            crate::module_record::ExportExportName::Default(_) => Some("default"),
            crate::module_record::ExportExportName::Null => None,
        };
        if let Some(export_name) = export_name {
            export_names.insert(export_name.to_string());
        }
    }
    export_names
}

fn remotion_metadata_transparent_root_node_id(
    node_id: NodeId,
    semantic: &oxc_semantic::Semantic<'_>,
) -> NodeId {
    let mut current_id = node_id;
    loop {
        let parent = semantic.nodes().parent_node(current_id);
        if matches!(
            parent.kind(),
            AstKind::ParenthesizedExpression(_)
                | AstKind::TSAsExpression(_)
                | AstKind::TSSatisfiesExpression(_)
                | AstKind::TSTypeAssertion(_)
                | AstKind::TSNonNullExpression(_)
                | AstKind::TSInstantiationExpression(_)
                | AstKind::ChainExpression(_)
        ) {
            current_id = parent.id();
        } else {
            return current_id;
        }
    }
}

fn remotion_metadata_cross_file_owned_export_names(
    ctx: &LintContext<'_>,
) -> Option<FxHashSet<String>> {
    let settings = ctx
        .settings()
        .json
        .as_ref()?
        .get("react-doctor")?
        .as_object()?;
    let root_directory = settings.get("rootDirectory")?.as_str()?;
    if root_directory.is_empty() {
        return None;
    }
    if settings
        .get("projectIndexModuleSources")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|sources| {
            !sources
                .iter()
                .any(|source| source.as_str() == Some("remotion"))
        })
    {
        return None;
    }
    let root_path = remotion_metadata_normalize_file_path(std::path::Path::new(root_directory));
    let current_file_path = remotion_metadata_normalize_file_path(ctx.file_path());
    if !current_file_path.starts_with(&root_path) {
        return None;
    }
    let has_known_module_sources = settings.get("projectIndexModuleSources").is_some();
    let cache_key = (root_path.clone(), has_known_module_sources);
    let cache = REMOTION_METADATA_OWNERSHIP_INDEX_BY_ROOT
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Some(cached_index) = cache.lock().ok()?.get(&cache_key).cloned() {
        return cached_index
            .map(|index| index.get(&current_file_path).cloned().unwrap_or_default());
    }
    let ownership_index =
        remotion_metadata_build_ownership_index(&root_path, has_known_module_sources)
            .map(std::sync::Arc::new);
    cache
        .lock()
        .ok()?
        .insert(cache_key, ownership_index.clone());
    ownership_index.map(|index| index.get(&current_file_path).cloned().unwrap_or_default())
}

type RemotionMetadataOwnershipIndex = FxHashMap<std::path::PathBuf, FxHashSet<String>>;

static REMOTION_METADATA_OWNERSHIP_INDEX_BY_ROOT: std::sync::OnceLock<
    std::sync::Mutex<
        std::collections::HashMap<
            (std::path::PathBuf, bool),
            Option<std::sync::Arc<RemotionMetadataOwnershipIndex>>,
        >,
    >,
> = std::sync::OnceLock::new();

#[derive(Default)]
struct RemotionMetadataProjectModule {
    composition_imports: Vec<(String, String)>,
    local_export_names: FxHashSet<String>,
    indirect_exports: Vec<(String, String, String)>,
    star_export_sources: Vec<String>,
}

fn remotion_metadata_build_ownership_index(
    root_path: &std::path::Path,
    has_known_module_sources: bool,
) -> Option<RemotionMetadataOwnershipIndex> {
    let mut source_file_paths = Vec::new();
    remotion_metadata_collect_project_files(root_path, &mut source_file_paths)?;
    if !has_known_module_sources
        && !source_file_paths.iter().any(|file_path| {
            std::fs::read_to_string(file_path).is_ok_and(|source| {
                source.contains("\"remotion\"") || source.contains("'remotion'")
            })
        })
    {
        return None;
    }
    let mut modules_by_file_path = FxHashMap::default();
    for file_path in source_file_paths {
        let file_path = remotion_metadata_normalize_file_path(&file_path);
        let source = std::fs::read_to_string(&file_path).ok()?;
        let project_module = remotion_metadata_parse_project_module(&file_path, &source)?;
        modules_by_file_path.insert(file_path, project_module);
    }
    let mut ownership_index = RemotionMetadataOwnershipIndex::default();
    for (file_path, project_module) in &modules_by_file_path {
        for (module_source, export_name) in &project_module.composition_imports {
            let Some((owned_file_path, owned_export_name)) =
                remotion_metadata_resolve_project_import(
                    file_path,
                    module_source,
                    export_name,
                    &modules_by_file_path,
                    0,
                    &mut FxHashSet::default(),
                )
            else {
                continue;
            };
            ownership_index
                .entry(owned_file_path)
                .or_default()
                .insert(owned_export_name);
        }
    }
    Some(ownership_index)
}

fn remotion_metadata_collect_project_files(
    root_directory: &std::path::Path,
    source_file_paths: &mut Vec<std::path::PathBuf>,
) -> Option<()> {
    let mut pending_directories = vec![root_directory.to_path_buf()];
    while let Some(directory) = pending_directories.pop() {
        for entry in std::fs::read_dir(directory).ok()? {
            let entry = entry.ok()?;
            let file_type = entry.file_type().ok()?;
            let file_name = entry.file_name();
            let file_name = file_name.to_str()?;
            let is_ignored = matches!(
                file_name,
                ".angular"
                    | ".astro"
                    | ".cache"
                    | ".contentlayer"
                    | ".docusaurus"
                    | ".expo"
                    | ".git"
                    | ".next"
                    | ".nuxt"
                    | ".output"
                    | ".svelte-kit"
                    | ".turbo"
                    | ".vercel"
                    | "build"
                    | "coverage"
                    | "dist"
                    | "node_modules"
                    | "out"
                    | "storybook-static"
            ) || file_name.starts_with('.')
                && !matches!(file_name, ".dumi" | ".storybook");
            if file_type.is_symlink() {
                if is_ignored {
                    continue;
                }
                return None;
            }
            if file_type.is_dir() {
                if !is_ignored {
                    pending_directories.push(entry.path());
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let lowercase_name = file_name.to_ascii_lowercase();
            if remotion_metadata_is_source_file_name(&lowercase_name)
                && !is_non_production_filename(&entry.path().to_string_lossy().replace('\\', "/"))
            {
                source_file_paths.push(entry.path());
            }
        }
    }
    Some(())
}

fn remotion_metadata_is_source_file_name(file_name: &str) -> bool {
    [
        ".js", ".jsx", ".ts", ".tsx", ".cjs", ".cjsx", ".cts", ".ctsx", ".mjs", ".mjsx", ".mts",
        ".mtsx",
    ]
    .iter()
    .any(|extension| file_name.ends_with(extension))
        && ![".d.js", ".d.ts", ".d.cjs", ".d.cts", ".d.mjs", ".d.mts"]
            .iter()
            .any(|extension| file_name.ends_with(extension))
}

fn remotion_metadata_parse_project_module(
    file_path: &std::path::Path,
    source: &str,
) -> Option<RemotionMetadataProjectModule> {
    let allocator = oxc_allocator::Allocator::default();
    let source_type = oxc_span::SourceType::from_path(file_path)
        .ok()?
        .with_jsx(true);
    let parser_return = oxc_parser::Parser::new(&allocator, source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = oxc_semantic::SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record =
        crate::module_record::ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    let import_entries_by_symbol = module_record
        .import_entries
        .iter()
        .filter_map(|entry| {
            let symbol_id = semantic
                .scoping()
                .get_root_binding(entry.local_name.name().into())?;
            Some((symbol_id, entry))
        })
        .collect::<FxHashMap<_, _>>();
    let mut project_module = RemotionMetadataProjectModule {
        local_export_names: module_record
            .local_export_entries
            .iter()
            .filter_map(|entry| remotion_metadata_export_name(&entry.export_name))
            .map(str::to_string)
            .collect(),
        indirect_exports: module_record
            .indirect_export_entries
            .iter()
            .filter_map(|entry| {
                let exported_name = remotion_metadata_export_name(&entry.export_name)?;
                let module_source = entry.module_request.as_ref()?.name();
                let crate::module_record::ExportImportName::Name(imported_name) =
                    &entry.import_name
                else {
                    return None;
                };
                Some((
                    exported_name.to_string(),
                    module_source.to_string(),
                    imported_name.name().to_string(),
                ))
            })
            .collect(),
        star_export_sources: module_record
            .star_export_entries
            .iter()
            .filter_map(|entry| {
                entry
                    .module_request
                    .as_ref()
                    .map(|request| request.name().to_string())
            })
            .collect(),
        ..RemotionMetadataProjectModule::default()
    };
    for node in semantic.nodes().iter() {
        let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
            continue;
        };
        if !remotion_metadata_foreign_is_composition(
            &opening_element.name,
            &semantic,
            &import_entries_by_symbol,
        ) {
            continue;
        }
        let Some(expression) = opening_element.attributes.iter().find_map(|attribute| {
            let oxc_ast::ast::JSXAttributeItem::Attribute(attribute) = attribute else {
                return None;
            };
            if !matches!(&attribute.name, oxc_ast::ast::JSXAttributeName::Identifier(identifier) if identifier.name == "calculateMetadata")
            {
                return None;
            }
            let oxc_ast::ast::JSXAttributeValue::ExpressionContainer(container) =
                attribute.value.as_ref()?
            else {
                return None;
            };
            container.expression.as_expression()
        }) else {
            continue;
        };
        let Some((module_source, export_name)) = remotion_metadata_foreign_imported_function(
            expression,
            &semantic,
            &import_entries_by_symbol,
        ) else {
            continue;
        };
        project_module
            .composition_imports
            .push((module_source.to_string(), export_name.to_string()));
    }
    Some(project_module)
}

fn remotion_metadata_foreign_is_composition<'a>(
    name: &JSXElementName<'a>,
    semantic: &oxc_semantic::Semantic<'a>,
    import_entries_by_symbol: &FxHashMap<SymbolId, &crate::module_record::ImportEntry>,
) -> bool {
    match name {
        JSXElementName::IdentifierReference(identifier) => {
            let Some(symbol_id) = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            import_entries_by_symbol.get(&symbol_id).is_some_and(|entry| {
                !entry.is_type
                    && entry.module_request.name() == "remotion"
                    && matches!(&entry.import_name, crate::module_record::ImportImportName::Name(imported_name) if imported_name.name() == "Composition")
            })
        }
        JSXElementName::MemberExpression(member) => {
            let oxc_ast::ast::JSXMemberExpressionObject::IdentifierReference(identifier) =
                &member.object
            else {
                return false;
            };
            let Some(symbol_id) = semantic
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            member.property.name == "Composition"
                && import_entries_by_symbol
                    .get(&symbol_id)
                    .is_some_and(|entry| {
                        !entry.is_type
                            && entry.module_request.name() == "remotion"
                            && matches!(
                                entry.import_name,
                                crate::module_record::ImportImportName::NamespaceObject
                            )
                    })
        }
        _ => false,
    }
}

fn remotion_metadata_foreign_imported_function<'a, 'b>(
    expression: &'b Expression<'a>,
    semantic: &oxc_semantic::Semantic<'a>,
    import_entries_by_symbol: &FxHashMap<SymbolId, &'b crate::module_record::ImportEntry>,
) -> Option<(&'b str, &'b str)> {
    let expression = expression.get_inner_expression();
    if let Expression::Identifier(identifier) = expression {
        let symbol_id = semantic
            .scoping()
            .get_reference(identifier.reference_id())
            .symbol_id()?;
        let entry = *import_entries_by_symbol.get(&symbol_id)?;
        if entry.is_type {
            return None;
        }
        let export_name = match &entry.import_name {
            crate::module_record::ImportImportName::Name(name) => name.name(),
            crate::module_record::ImportImportName::Default(_) => "default",
            crate::module_record::ImportImportName::NamespaceObject => return None,
        };
        return Some((entry.module_request.name(), export_name));
    }
    let member = expression.as_member_expression()?;
    let export_name = member.static_property_name()?;
    let Expression::Identifier(namespace) = member.object().get_inner_expression() else {
        return None;
    };
    let symbol_id = semantic
        .scoping()
        .get_reference(namespace.reference_id())
        .symbol_id()?;
    let entry = *import_entries_by_symbol.get(&symbol_id)?;
    (!entry.is_type
        && matches!(
            entry.import_name,
            crate::module_record::ImportImportName::NamespaceObject
        ))
    .then_some((entry.module_request.name(), export_name))
}

fn remotion_metadata_resolve_project_import(
    from_file_path: &std::path::Path,
    module_source: &str,
    exported_name: &str,
    modules_by_file_path: &FxHashMap<std::path::PathBuf, RemotionMetadataProjectModule>,
    depth: usize,
    visited_exports: &mut FxHashSet<(std::path::PathBuf, String)>,
) -> Option<(std::path::PathBuf, String)> {
    if depth >= 4 {
        return None;
    }
    let target_file_path = remotion_metadata_resolve_module_path(from_file_path, module_source)?;
    remotion_metadata_resolve_project_export(
        &target_file_path,
        exported_name,
        modules_by_file_path,
        depth,
        visited_exports,
    )
}

fn remotion_metadata_resolve_project_export(
    file_path: &std::path::Path,
    exported_name: &str,
    modules_by_file_path: &FxHashMap<std::path::PathBuf, RemotionMetadataProjectModule>,
    depth: usize,
    visited_exports: &mut FxHashSet<(std::path::PathBuf, String)>,
) -> Option<(std::path::PathBuf, String)> {
    if depth >= 4 {
        return None;
    }
    let file_path = remotion_metadata_normalize_file_path(file_path);
    if !visited_exports.insert((file_path.clone(), exported_name.to_string())) {
        return None;
    }
    let project_module = modules_by_file_path.get(&file_path)?;
    if project_module.local_export_names.contains(exported_name) {
        return Some((file_path, exported_name.to_string()));
    }
    let mut resolved_export_names = FxHashSet::default();
    for (candidate_export_name, module_source, imported_name) in &project_module.indirect_exports {
        if candidate_export_name != exported_name {
            continue;
        }
        if let Some(resolved_export_name) = remotion_metadata_resolve_project_import(
            &file_path,
            module_source,
            imported_name,
            modules_by_file_path,
            depth + 1,
            &mut visited_exports.clone(),
        ) {
            resolved_export_names.insert(resolved_export_name);
        }
    }
    for module_source in &project_module.star_export_sources {
        if let Some(resolved_export_name) = remotion_metadata_resolve_project_import(
            &file_path,
            module_source,
            exported_name,
            modules_by_file_path,
            depth + 1,
            &mut visited_exports.clone(),
        ) {
            resolved_export_names.insert(resolved_export_name);
        }
    }
    (resolved_export_names.len() == 1)
        .then(|| resolved_export_names.into_iter().next())
        .flatten()
}

fn remotion_metadata_export_name(
    export_name: &crate::module_record::ExportExportName,
) -> Option<&str> {
    match export_name {
        crate::module_record::ExportExportName::Name(name) => Some(name.name()),
        crate::module_record::ExportExportName::Default(_) => Some("default"),
        crate::module_record::ExportExportName::Null => None,
    }
}

fn remotion_metadata_resolve_module_path(
    from_file_path: &std::path::Path,
    module_source: &str,
) -> Option<std::path::PathBuf> {
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
    let resolution = resolver.resolve_file(from_file_path, module_source).ok()?;
    let resolved_path = remotion_metadata_normalize_file_path(resolution.path());
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn remotion_metadata_normalize_file_path(file_path: &std::path::Path) -> std::path::PathBuf {
    std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf())
}
