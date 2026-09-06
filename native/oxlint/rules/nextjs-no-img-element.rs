use oxc_ast::{
    AstKind,
    ast::{Expression, JSXAttribute, JSXAttributeValue},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_span::GetSpan;

use crate::{
    context::{ContextHost, LintContext},
    rule::Rule,
};

const MESSAGE: &str = "Plain <img> ships unoptimized, oversized images.";
const LOCAL_IMAGE_URL_FACTORY_METHODS: [&str; 3] =
    ["createObjectURL", "revokeObjectURL", "toDataURL"];
const EMAIL_TEMPLATE_MODULES: [&str; 4] =
    ["@faire/mjml-react", "mjml-react", "mjml", "react-email"];
const EMAIL_TEMPLATE_MODULE_PREFIXES: [&str; 2] = ["@react-email/", "jsx-email"];

#[derive(Debug, Default, Clone)]
pub struct NextjsNoImgElement;

declare_oxc_lint!(
    /// Disallow unoptimized native images in Next.js.
    NextjsNoImgElement,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Disallow unoptimized native images.",
);

impl Rule for NextjsNoImgElement {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        ctx.source_type().is_jsx()
            && !is_test_noise_file(ctx)
            && !is_generated_image_render_filename(ctx)
            && is_next_file_active(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let generated_image_opening_element_ids = generated_image_jsx_opening_element_ids(ctx);
        let has_email_template_import = ctx.module_record().import_entries.iter().any(|entry| {
            let module_source = entry.module_request.name();
            EMAIL_TEMPLATE_MODULES.contains(&module_source)
                || EMAIL_TEMPLATE_MODULE_PREFIXES
                    .iter()
                    .any(|prefix| module_source.starts_with(prefix))
        });
        if has_email_template_import {
            return;
        }
        let uses_local_image_url_factory = nextjs_uses_local_image_url_factory(ctx);
        let mut generated_image_ownership_project = None;
        let mut generated_image_owned_functions = std::collections::HashMap::new();

        for node in ctx.nodes().iter() {
            let AstKind::JSXOpeningElement(opening_element) = node.kind() else {
                continue;
            };
            if resolve_jsx_element_type(opening_element, ctx)
                .is_none_or(|(element_type, _)| element_type != "img")
                || generated_image_opening_element_ids.contains(&node.id())
            {
                continue;
            }
            let source_attribute = find_jsx_attribute(opening_element, "src");
            if source_attribute.is_some_and(|attribute| {
                nextjs_img_source_is_non_optimizable(attribute, uses_local_image_url_factory)
            }) {
                continue;
            }
            if source_attribute.is_none() && find_jsx_attribute(opening_element, "ref").is_some() {
                continue;
            }
            if nextjs_img_is_markdown_component_override(node, ctx) {
                continue;
            }
            if let Some(function_node_id) =
                nextjs_img_nearest_function_node_id(node, ctx.semantic())
            {
                let is_generated_image_owned = *generated_image_owned_functions
                    .entry(function_node_id)
                    .or_insert_with(|| {
                        let export_names = nextjs_img_function_export_names(
                            function_node_id,
                            ctx.semantic(),
                            ctx.module_record(),
                        );
                        if export_names.is_empty() {
                            return false;
                        }
                        let project = generated_image_ownership_project.get_or_insert_with(|| {
                            NextjsImgOwnershipProject::new(ctx)
                        });
                        project.as_ref().is_some_and(|project| {
                            project.is_exclusively_generated_image_owned(
                                ctx.file_path(),
                                &export_names,
                            )
                        })
                    });
                if is_generated_image_owned {
                    continue;
                }
            }

            ctx.diagnostic(OxcDiagnostic::warn(MESSAGE).with_label(opening_element.span));
        }
    }
}

fn nextjs_uses_local_image_url_factory(ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        let property_name = match node.kind() {
            AstKind::StaticMemberExpression(member_expression) => {
                Some(member_expression.property.name.as_str())
            }
            AstKind::ComputedMemberExpression(member_expression) => {
                match member_expression.expression.get_inner_expression() {
                    Expression::Identifier(identifier) => Some(identifier.name.as_str()),
                    _ => None,
                }
            }
            _ => None,
        };
        property_name
            .is_some_and(|property_name| LOCAL_IMAGE_URL_FACTORY_METHODS.contains(&property_name))
    })
}

fn nextjs_img_source_is_non_optimizable(
    source_attribute: &JSXAttribute<'_>,
    uses_local_image_url_factory: bool,
) -> bool {
    if let Some(source_value) = get_string_literal_attribute_value(source_attribute) {
        return nextjs_img_static_source_is_non_optimizable(source_value);
    }
    let Some(JSXAttributeValue::ExpressionContainer(container)) = source_attribute.value.as_ref()
    else {
        return false;
    };
    let Some(expression) = container.expression.as_expression() else {
        return false;
    };
    if let Some(source_value) = get_static_string_expression(expression) {
        return nextjs_img_static_source_is_non_optimizable(source_value);
    }
    nextjs_img_template_source_is_non_optimizable(expression)
        || nextjs_img_references_generated_url_name(expression)
        || uses_local_image_url_factory
}

fn nextjs_img_static_source_is_non_optimizable(source_value: &str) -> bool {
    let lowercase_source = source_value.to_ascii_lowercase();
    let trimmed_source =
        lowercase_source.trim_start_matches(|character| is_js_whitespace(character));
    if trimmed_source.starts_with("data:") || trimmed_source.starts_with("blob:") {
        return true;
    }
    if nextjs_img_is_tracking_pixel_source(&lowercase_source) {
        return true;
    }
    source_value
        .split(['?', '#'])
        .next()
        .is_some_and(|pathname| pathname.to_ascii_lowercase().ends_with(".svg"))
}

fn nextjs_img_is_tracking_pixel_source(source_value: &str) -> bool {
    let Some(remainder) = source_value.strip_prefix("https://") else {
        return false;
    };
    let Some((host, _)) = remainder.split_once('/') else {
        return false;
    };
    let Some(prefix) = host.strip_suffix("scarf.sh") else {
        return false;
    };
    prefix
        .chars()
        .next_back()
        .is_none_or(|character| !character.is_ascii_alphanumeric() && character != '_')
}

fn nextjs_img_template_source_is_non_optimizable(expression: &Expression<'_>) -> bool {
    let Expression::TemplateLiteral(template_literal) = expression.get_inner_expression() else {
        return false;
    };
    let first_quasi = template_literal
        .quasis
        .first()
        .map(|quasi| {
            quasi
                .value
                .cooked
                .as_ref()
                .map_or("", |cooked| cooked.as_str())
        })
        .unwrap_or_default()
        .trim_start_matches(|character| is_js_whitespace(character))
        .to_ascii_lowercase();
    if first_quasi.starts_with("data:") || first_quasi.starts_with("blob:") {
        return true;
    }
    template_literal
        .quasis
        .last()
        .map(|quasi| {
            quasi
                .value
                .cooked
                .as_ref()
                .map_or("", |cooked| cooked.as_str())
        })
        .unwrap_or_default()
        .split(['?', '#'])
        .next()
        .is_some_and(|pathname| pathname.to_ascii_lowercase().ends_with(".svg"))
}

fn nextjs_img_references_generated_url_name(expression: &Expression<'_>) -> bool {
    match expression.get_inner_expression() {
        Expression::Identifier(identifier) => nextjs_img_is_generated_url_name(&identifier.name),
        Expression::StaticMemberExpression(member_expression) => {
            nextjs_img_is_generated_url_name(&member_expression.property.name)
        }
        Expression::ComputedMemberExpression(member_expression) => {
            matches!(
                member_expression.expression.get_inner_expression(),
                Expression::Identifier(identifier)
                    if nextjs_img_is_generated_url_name(&identifier.name)
            )
        }
        Expression::ConditionalExpression(conditional) => {
            nextjs_img_references_generated_url_name(&conditional.consequent)
                || nextjs_img_references_generated_url_name(&conditional.alternate)
        }
        Expression::LogicalExpression(logical) => {
            nextjs_img_references_generated_url_name(&logical.left)
                || nextjs_img_references_generated_url_name(&logical.right)
        }
        Expression::CallExpression(call) => match call.callee.get_inner_expression() {
            Expression::Identifier(identifier) => {
                nextjs_img_is_generated_url_name(&identifier.name)
            }
            Expression::StaticMemberExpression(member_expression) => {
                nextjs_img_is_generated_url_name(&member_expression.property.name)
            }
            Expression::ComputedMemberExpression(member_expression) => {
                matches!(
                    member_expression.expression.get_inner_expression(),
                    Expression::Identifier(identifier)
                        if nextjs_img_is_generated_url_name(&identifier.name)
                )
            }
            _ => false,
        },
        _ => false,
    }
}

fn nextjs_img_is_generated_url_name(name: &str) -> bool {
    let lowercase_name = name.to_ascii_lowercase();
    [
        "dataurl",
        "data_url",
        "objecturl",
        "object_url",
        "bloburl",
        "blob_url",
    ]
    .iter()
    .any(|fragment| lowercase_name.contains(fragment))
}

fn nextjs_img_is_markdown_component_override(
    node: &crate::AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()).skip(1) {
        let AstKind::ObjectProperty(property) = ancestor.kind() else {
            continue;
        };
        if property.key.static_name().as_deref() != Some("img") {
            continue;
        }
        for outer_ancestor in ctx.nodes().ancestors(ancestor.id()).skip(1) {
            let AstKind::JSXAttribute(attribute) = outer_ancestor.kind() else {
                continue;
            };
            return matches!(
                &attribute.name,
                oxc_ast::ast::JSXAttributeName::Identifier(identifier)
                    if identifier.name == "components"
            );
        }
        return false;
    }
    false
}

#[derive(Default)]
struct NextjsImgOwnershipFlow {
    did_reach_renderer: bool,
    is_unsafe: bool,
    was_used: bool,
    forwarded_exports: Vec<(std::path::PathBuf, String)>,
}

struct NextjsImgOwnershipProject {
    resolver: oxc_resolver::Resolver,
    sources: std::collections::HashMap<std::path::PathBuf, String>,
    consumer_file_paths_by_target:
        std::collections::HashMap<std::path::PathBuf, Vec<std::path::PathBuf>>,
    unresolved_runtime_sources: std::collections::HashSet<String>,
}

impl NextjsImgOwnershipProject {
    fn new(ctx: &LintContext<'_>) -> Option<Self> {
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
        let root_path = nextjs_img_normalize_file_identity(std::path::Path::new(root_directory));
        let current_file_path = nextjs_img_normalize_file_identity(ctx.file_path());
        if !current_file_path.starts_with(&root_path) {
            return None;
        }
        let known_module_sources = settings
            .get("projectIndexModuleSources")
            .and_then(serde_json::Value::as_array);
        if known_module_sources.is_some_and(|module_sources| {
                !module_sources.iter().filter_map(serde_json::Value::as_str).any(
                    |module_source| matches!(module_source, "next/og" | "@vercel/og" | "satori"),
                )
            })
        {
            return None;
        }

        let mut file_paths = Vec::new();
        let mut has_mdx_file = false;
        nextjs_img_collect_project_files(&root_path, &mut file_paths, &mut has_mdx_file)?;
        if has_mdx_file {
            return None;
        }
        for file_path in &mut file_paths {
            *file_path = nextjs_img_normalize_file_identity(file_path);
        }
        file_paths.sort_unstable();
        file_paths.dedup();
        let mut sources = std::collections::HashMap::new();
        for file_path in &file_paths {
            let source = if file_path == &current_file_path {
                ctx.source_text().to_string()
            } else {
                std::fs::read_to_string(file_path).ok()?
            };
            sources.insert(file_path.clone(), source);
        }
        if known_module_sources.is_none()
            && !sources.values().any(|source| {
                ["next/og", "@vercel/og", "satori"].iter().any(|module_source| {
                    source.contains(&format!("\"{module_source}\""))
                        || source.contains(&format!("'{module_source}'"))
                })
            })
        {
            return None;
        }
        let mut unresolved_runtime_sources = std::collections::HashSet::new();
        let mut consumer_file_paths_by_target = std::collections::HashMap::new();
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
        for file_path in &file_paths {
            let source = sources.get(file_path)?;
            nextjs_img_collect_unresolved_runtime_sources(
                &resolver,
                file_path,
                source,
                &mut unresolved_runtime_sources,
                &mut consumer_file_paths_by_target,
            )?;
        }
        Some(Self {
            resolver,
            sources,
            consumer_file_paths_by_target,
            unresolved_runtime_sources,
        })
    }

    fn is_exclusively_generated_image_owned(
        &self,
        initial_file_path: &std::path::Path,
        initial_export_names: &[String],
    ) -> bool {
        let mut pending_exports = initial_export_names
            .iter()
            .map(|exported_name| {
                (
                    nextjs_img_normalize_file_identity(initial_file_path),
                    exported_name.clone(),
                )
            })
            .collect::<Vec<_>>();
        let mut visited_exports = std::collections::HashSet::new();
        let mut did_reach_renderer = false;

        while let Some((file_path, exported_name)) = pending_exports.pop() {
            if !visited_exports.insert((file_path.clone(), exported_name.clone())) {
                continue;
            }
            if self.has_opaque_workspace_package_consumer(&file_path) {
                return false;
            }
            let mut export_was_used = false;
            let Some(owner_source) = self.sources.get(&file_path) else {
                return false;
            };
            let Some(owner_flow) = nextjs_img_classify_local_export_references(
                &file_path,
                owner_source,
                &exported_name,
            ) else {
                return false;
            };
            if owner_flow.is_unsafe {
                return false;
            }
            export_was_used |= owner_flow.was_used;
            did_reach_renderer |= owner_flow.did_reach_renderer;
            pending_exports.extend(owner_flow.forwarded_exports);

            for consumer_path in self
                .consumer_file_paths_by_target
                .get(&file_path)
                .into_iter()
                .flatten()
            {
                if consumer_path == &file_path {
                    continue;
                }
                let Some(consumer_source) = self.sources.get(consumer_path) else {
                    return false;
                };
                let Some(consumer_flow) = nextjs_img_classify_imports_from_export(
                    &self.resolver,
                    consumer_path,
                    consumer_source,
                    &file_path,
                    &exported_name,
                ) else {
                    return false;
                };
                if consumer_flow.is_unsafe {
                    return false;
                }
                export_was_used |= consumer_flow.was_used;
                did_reach_renderer |= consumer_flow.did_reach_renderer;
                pending_exports.extend(consumer_flow.forwarded_exports);
            }
            if !export_was_used {
                return false;
            }
        }
        did_reach_renderer
    }

    fn has_opaque_workspace_package_consumer(&self, file_path: &std::path::Path) -> bool {
        let mut directory = file_path.parent();
        while let Some(current_directory) = directory {
            let manifest_path = current_directory.join("package.json");
            if let Ok(source) = std::fs::read_to_string(manifest_path) {
                let package_name = serde_json::from_str::<serde_json::Value>(&source)
                    .ok()
                    .and_then(|manifest| manifest.get("name")?.as_str().map(str::to_string));
                return package_name.is_some_and(|package_name| {
                    self.unresolved_runtime_sources.iter().any(|module_source| {
                        module_source == &package_name
                            || module_source.starts_with(&format!("{package_name}/"))
                    })
                });
            }
            directory = current_directory.parent();
        }
        false
    }
}

fn nextjs_img_collect_project_files(
    root_directory: &std::path::Path,
    source_file_paths: &mut Vec<std::path::PathBuf>,
    has_mdx_file: &mut bool,
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
            let file_path = entry.path();
            let normalized_path = file_path.to_string_lossy().replace('\\', "/");
            if is_non_production_filename(&normalized_path) {
                continue;
            }
            let lowercase_name = file_name.to_ascii_lowercase();
            if lowercase_name.ends_with(".mdx") {
                *has_mdx_file = true;
                continue;
            }
            if nextjs_img_is_source_file_name(&lowercase_name) {
                source_file_paths.push(file_path);
            }
        }
    }
    Some(())
}

fn nextjs_img_is_source_file_name(file_name: &str) -> bool {
    let is_source = [
        ".js", ".jsx", ".ts", ".tsx", ".cjs", ".cjsx", ".cts", ".ctsx", ".mjs",
        ".mjsx", ".mts", ".mtsx",
    ]
    .iter()
    .any(|extension| file_name.ends_with(extension));
    is_source
        && ![".d.js", ".d.ts", ".d.cjs", ".d.cts", ".d.mjs", ".d.mts"]
            .iter()
            .any(|extension| file_name.ends_with(extension))
}

fn nextjs_img_collect_unresolved_runtime_sources(
    resolver: &oxc_resolver::Resolver,
    file_path: &std::path::Path,
    source: &str,
    unresolved_sources: &mut std::collections::HashSet<String>,
    consumer_file_paths_by_target: &mut std::collections::HashMap<
        std::path::PathBuf,
        Vec<std::path::PathBuf>,
    >,
) -> Option<()> {
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
    for node in semantic.nodes().iter() {
        let module_source = match node.kind() {
            AstKind::ImportDeclaration(declaration) if !is_type_only_import(declaration) => {
                Some(declaration.source.value.as_str())
            }
            AstKind::ExportFromDeclaration(declaration)
                if !declaration.export_kind.is_type()
                    && (declaration.specifiers.is_empty()
                        || declaration
                            .specifiers
                            .iter()
                            .any(|specifier| !specifier.export_kind.is_type())) =>
            {
                Some(declaration.source.value.as_str())
            }
            AstKind::ExportAllDeclaration(declaration)
                if !declaration.export_kind.is_type() =>
            {
                Some(declaration.source.value.as_str())
            }
            AstKind::ImportExpression(import_expression) => {
                match &import_expression.source {
                    Expression::StringLiteral(source) => Some(source.value.as_str()),
                    _ => None,
                }
            }
            AstKind::CallExpression(call)
                if call.arguments.len() == 1
                    && matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "require") =>
            {
                call.arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .and_then(|expression| match expression.get_inner_expression() {
                        Expression::StringLiteral(source) => Some(source.value.as_str()),
                        _ => None,
                    })
            }
            _ => None,
        };
        if let Some(module_source) = module_source {
            if let Some(target_path) =
                nextjs_img_resolve_first_party_module_path(resolver, file_path, module_source)
            {
                consumer_file_paths_by_target
                    .entry(target_path)
                    .or_default()
                    .push(file_path.to_path_buf());
            } else {
                unresolved_sources.insert(module_source.to_string());
            }
        }
    }
    Some(())
}

fn nextjs_img_parse_module<'a>(
    allocator: &'a oxc_allocator::Allocator,
    file_path: &std::path::Path,
    source: &'a str,
) -> Option<(
    &'a oxc_ast::ast::Program<'a>,
    oxc_semantic::Semantic<'a>,
    crate::module_record::ModuleRecord,
)> {
    let source_type = oxc_span::SourceType::from_path(file_path)
        .ok()?
        .with_jsx(true);
    let parser_return = oxc_parser::Parser::new(allocator, source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = oxc_semantic::SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = crate::module_record::ModuleRecord::new(
        file_path,
        &parser_return.module_record,
        &semantic,
    );
    Some((program, semantic, module_record))
}

fn nextjs_img_classify_imports_from_export(
    resolver: &oxc_resolver::Resolver,
    consumer_file_path: &std::path::Path,
    consumer_source: &str,
    owner_file_path: &std::path::Path,
    exported_name: &str,
) -> Option<NextjsImgOwnershipFlow> {
    let allocator = oxc_allocator::Allocator::default();
    let (program, semantic, module_record) =
        nextjs_img_parse_module(&allocator, consumer_file_path, consumer_source)?;
    let mut flow = NextjsImgOwnershipFlow::default();

    for node in semantic.nodes().iter() {
        let module_source = match node.kind() {
            AstKind::ImportExpression(import_expression) => match &import_expression.source {
                Expression::StringLiteral(source) => Some(source.value.as_str()),
                _ => None,
            },
            AstKind::CallExpression(call)
                if call.arguments.len() == 1
                    && matches!(&call.callee, Expression::Identifier(identifier) if identifier.name == "require") =>
            {
                call.arguments
                    .first()
                    .and_then(oxc_ast::ast::Argument::as_expression)
                    .and_then(|expression| match expression.get_inner_expression() {
                        Expression::StringLiteral(source) => Some(source.value.as_str()),
                        _ => None,
                    })
            }
            _ => None,
        };
        if module_source.is_some_and(|module_source| {
            nextjs_img_resolve_first_party_module_path(
                resolver,
                consumer_file_path,
                module_source,
            )
            .as_deref()
                == Some(owner_file_path)
        }) {
            flow.is_unsafe = true;
            return Some(flow);
        }
    }

    for statement in &program.body {
        match statement {
            oxc_ast::ast::Statement::ImportDeclaration(declaration)
                if !is_type_only_import(declaration)
                    && nextjs_img_resolve_first_party_module_path(
                        resolver,
                        consumer_file_path,
                        declaration.source.value.as_str(),
                    )
                    .as_deref()
                        == Some(owner_file_path) =>
            {
                for specifier in declaration.specifiers.iter().flatten() {
                    match specifier {
                        oxc_ast::ast::ImportDeclarationSpecifier::ImportNamespaceSpecifier(
                            specifier,
                        ) => {
                            let namespace_flow = nextjs_img_classify_namespace_references(
                                specifier.local.symbol_id(),
                                exported_name,
                                consumer_file_path,
                                &semantic,
                                &module_record,
                            );
                            nextjs_img_merge_flow(&mut flow, namespace_flow);
                        }
                        oxc_ast::ast::ImportDeclarationSpecifier::ImportDefaultSpecifier(
                            specifier,
                        ) if exported_name == "default" => {
                            let imported_flow = nextjs_img_classify_symbol_references(
                                specifier.local.symbol_id(),
                                consumer_file_path,
                                &semantic,
                                &module_record,
                                &mut std::collections::HashSet::new(),
                            );
                            nextjs_img_merge_flow(&mut flow, imported_flow);
                        }
                        oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(specifier)
                            if !specifier.import_kind.is_type()
                                && specifier.imported.name() == exported_name =>
                        {
                            let imported_flow = nextjs_img_classify_symbol_references(
                                specifier.local.symbol_id(),
                                consumer_file_path,
                                &semantic,
                                &module_record,
                                &mut std::collections::HashSet::new(),
                            );
                            nextjs_img_merge_flow(&mut flow, imported_flow);
                        }
                        _ => {}
                    }
                    if flow.is_unsafe {
                        return Some(flow);
                    }
                }
            }
            oxc_ast::ast::Statement::ExportFromDeclaration(declaration)
                if !declaration.export_kind.is_type()
                    && nextjs_img_resolve_first_party_module_path(
                        resolver,
                        consumer_file_path,
                        declaration.source.value.as_str(),
                    )
                    .as_deref()
                        == Some(owner_file_path) =>
            {
                for specifier in &declaration.specifiers {
                    if specifier.export_kind.is_type()
                        || nextjs_img_module_export_name(&specifier.local) != Some(exported_name)
                    {
                        continue;
                    }
                    let Some(forwarded_name) =
                        nextjs_img_module_export_name(&specifier.exported)
                    else {
                        flow.is_unsafe = true;
                        return Some(flow);
                    };
                    flow.was_used = true;
                    flow.forwarded_exports.push((
                        consumer_file_path.to_path_buf(),
                        forwarded_name.to_string(),
                    ));
                }
            }
            oxc_ast::ast::Statement::ExportAllDeclaration(declaration)
                if !declaration.export_kind.is_type()
                    && nextjs_img_resolve_first_party_module_path(
                        resolver,
                        consumer_file_path,
                        declaration.source.value.as_str(),
                    )
                    .as_deref()
                        == Some(owner_file_path) =>
            {
                if declaration.exported.is_some() {
                    flow.is_unsafe = true;
                    return Some(flow);
                }
                flow.was_used = true;
                flow.forwarded_exports.push((
                    consumer_file_path.to_path_buf(),
                    exported_name.to_string(),
                ));
            }
            _ => {}
        }
    }
    Some(flow)
}

fn nextjs_img_classify_namespace_references(
    symbol_id: oxc_semantic::SymbolId,
    exported_name: &str,
    file_path: &std::path::Path,
    semantic: &oxc_semantic::Semantic<'_>,
    module_record: &crate::module_record::ModuleRecord,
) -> NextjsImgOwnershipFlow {
    let mut flow = NextjsImgOwnershipFlow::default();
    for reference in semantic.scoping().get_resolved_references(symbol_id) {
        if !reference.is_read() || reference.is_write() {
            flow.is_unsafe = true;
            return flow;
        }
        let reference_node = semantic.nodes().get_node(reference.node_id());
        let root_id = nextjs_img_transparent_root_node_id(reference_node.id(), semantic);
        let root_node = semantic.nodes().get_node(root_id);
        let parent = semantic.nodes().parent_node(root_id);
        let property_matches = match parent.kind() {
            AstKind::StaticMemberExpression(member)
                if member.object.span() == root_node.span() =>
            {
                member.property.name == exported_name
            }
            AstKind::ComputedMemberExpression(member)
                if member.object.span() == root_node.span() =>
            {
                let Some(property_name) = member.static_property_name() else {
                    flow.is_unsafe = true;
                    return flow;
                };
                property_name == exported_name
            }
            _ => {
                flow.is_unsafe = true;
                return flow;
            }
        };
        if !property_matches {
            continue;
        }
        flow.was_used = true;
        let Some(invoked_node_id) = nextjs_img_invoked_node_id(parent.id(), semantic) else {
            flow.is_unsafe = true;
            return flow;
        };
        let invoked_flow = nextjs_img_classify_invoked_expression(
            invoked_node_id,
            file_path,
            semantic,
            module_record,
        );
        nextjs_img_merge_flow(&mut flow, invoked_flow);
        if flow.is_unsafe {
            return flow;
        }
    }
    flow
}

fn nextjs_img_function_export_names(
    function_node_id: oxc_semantic::NodeId,
    semantic: &oxc_semantic::Semantic<'_>,
    module_record: &crate::module_record::ModuleRecord,
) -> Vec<String> {
    let function_node = semantic.nodes().get_node(function_node_id);
    let mut export_names = std::collections::HashSet::new();
    let function_root_id = nextjs_img_transparent_root_node_id(function_node_id, semantic);
    if matches!(
        semantic.nodes().parent_node(function_root_id).kind(),
        AstKind::ExportDefaultDeclaration(_)
    ) {
        export_names.insert("default".to_string());
    }
    let symbol_id = match function_node.kind() {
        AstKind::Function(function)
            if function.r#type == oxc_ast::ast::FunctionType::FunctionDeclaration =>
        {
            function.id.as_ref().map(|identifier| identifier.symbol_id())
        }
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => {
            let root = semantic.nodes().get_node(function_root_id);
            match semantic.nodes().parent_node(root.id()).kind() {
                AstKind::VariableDeclarator(declarator) => {
                    declarator.id.get_binding_identifier().map(|identifier| identifier.symbol_id())
                }
                _ => None,
            }
        }
        _ => None,
    };
    if let Some(symbol_id) = symbol_id {
        for entry in &module_record.local_export_entries {
            let Some(local_name) = entry.local_name.name() else {
                continue;
            };
            if semantic.scoping().get_root_binding(local_name.into()) != Some(symbol_id) {
                continue;
            }
            if let Some(export_name) = nextjs_img_export_name(&entry.export_name) {
                export_names.insert(export_name.to_string());
            }
        }
    }
    export_names.into_iter().collect()
}

fn nextjs_img_export_name(
    export_name: &crate::module_record::ExportExportName,
) -> Option<&str> {
    match export_name {
        crate::module_record::ExportExportName::Name(name) => Some(name.name()),
        crate::module_record::ExportExportName::Default(_) => Some("default"),
        crate::module_record::ExportExportName::Null => None,
    }
}

fn nextjs_img_transparent_root_node_id(
    node_id: oxc_semantic::NodeId,
    semantic: &oxc_semantic::Semantic<'_>,
) -> oxc_semantic::NodeId {
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

fn nextjs_img_classify_local_export_references(
    file_path: &std::path::Path,
    source: &str,
    exported_name: &str,
) -> Option<NextjsImgOwnershipFlow> {
    let allocator = oxc_allocator::Allocator::default();
    let (_program, semantic, module_record) =
        nextjs_img_parse_module(&allocator, file_path, source)?;
    let Some(symbol_id) =
        nextjs_img_exported_component_symbol_id(exported_name, &semantic, &module_record)
    else {
        return Some(NextjsImgOwnershipFlow::default());
    };
    if !nextjs_img_symbol_is_function(symbol_id, &semantic) {
        return Some(NextjsImgOwnershipFlow::default());
    }
    Some(nextjs_img_classify_symbol_references(
        symbol_id,
        file_path,
        &semantic,
        &module_record,
        &mut std::collections::HashSet::new(),
    ))
}

fn nextjs_img_symbol_is_function(
    symbol_id: oxc_semantic::SymbolId,
    semantic: &oxc_semantic::Semantic<'_>,
) -> bool {
    let declaration = semantic.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(_) | AstKind::ArrowFunctionExpression(_) => true,
        AstKind::VariableDeclarator(declarator) => declarator.init.as_ref().is_some_and(
            |initializer| {
                matches!(
                    initializer.get_inner_expression(),
                    Expression::ArrowFunctionExpression(_) | Expression::FunctionExpression(_)
                )
            },
        ),
        _ => false,
    }
}

fn nextjs_img_classify_symbol_references(
    symbol_id: oxc_semantic::SymbolId,
    file_path: &std::path::Path,
    semantic: &oxc_semantic::Semantic<'_>,
    module_record: &crate::module_record::ModuleRecord,
    visited_symbols: &mut std::collections::HashSet<oxc_semantic::SymbolId>,
) -> NextjsImgOwnershipFlow {
    let mut flow = NextjsImgOwnershipFlow::default();
    if !visited_symbols.insert(symbol_id) {
        return flow;
    }
    for reference in semantic.scoping().get_resolved_references(symbol_id) {
        if !reference.is_read() || reference.is_write() {
            flow.is_unsafe = true;
            return flow;
        }
        flow.was_used = true;
        let reference_node = semantic.nodes().get_node(reference.node_id());
        let root_id = nextjs_img_transparent_root_node_id(reference_node.id(), semantic);
        if let Some(invoked_node_id) = nextjs_img_invoked_node_id(root_id, semantic) {
            let invoked_flow = nextjs_img_classify_invoked_expression(
                invoked_node_id,
                file_path,
                semantic,
                module_record,
            );
            nextjs_img_merge_flow(&mut flow, invoked_flow);
            if flow.is_unsafe {
                return flow;
            }
            continue;
        }
        let root_node = semantic.nodes().get_node(root_id);
        let parent = semantic.nodes().parent_node(root_id);
        match parent.kind() {
            AstKind::ExportSpecifier(specifier)
                if specifier.local.span() == root_node.span() =>
            {
                let Some(exported_name) = nextjs_img_module_export_name(&specifier.exported) else {
                    flow.is_unsafe = true;
                    return flow;
                };
                flow.forwarded_exports
                    .push((file_path.to_path_buf(), exported_name.to_string()));
            }
            AstKind::ExportDefaultDeclaration(_) => flow
                .forwarded_exports
                .push((file_path.to_path_buf(), "default".to_string())),
            AstKind::VariableDeclarator(declarator)
                if declarator
                    .init
                    .as_ref()
                    .is_some_and(|initializer| initializer.span() == root_node.span())
                    && matches!(
                        semantic.nodes().parent_node(parent.id()).kind(),
                        AstKind::VariableDeclaration(declaration) if declaration.kind.is_const()
                    ) =>
            {
                let Some(alias) = declarator.id.get_binding_identifier() else {
                    flow.is_unsafe = true;
                    return flow;
                };
                let alias_flow = nextjs_img_classify_symbol_references(
                    alias.symbol_id(),
                    file_path,
                    semantic,
                    module_record,
                    visited_symbols,
                );
                nextjs_img_merge_flow(&mut flow, alias_flow);
                if flow.is_unsafe {
                    return flow;
                }
            }
            _ => {
                flow.is_unsafe = true;
                return flow;
            }
        }
    }
    flow
}

fn nextjs_img_merge_flow(
    target: &mut NextjsImgOwnershipFlow,
    source: NextjsImgOwnershipFlow,
) {
    target.was_used |= source.was_used;
    target.did_reach_renderer |= source.did_reach_renderer;
    target.is_unsafe |= source.is_unsafe;
    target.forwarded_exports.extend(source.forwarded_exports);
}

fn nextjs_img_module_export_name<'a>(
    name: &'a oxc_ast::ast::ModuleExportName<'a>,
) -> Option<&'a str> {
    match name {
        oxc_ast::ast::ModuleExportName::IdentifierName(identifier) => {
            Some(identifier.name.as_str())
        }
        oxc_ast::ast::ModuleExportName::IdentifierReference(identifier) => {
            Some(identifier.name.as_str())
        }
        oxc_ast::ast::ModuleExportName::StringLiteral(value) => Some(value.value.as_str()),
    }
}

fn nextjs_img_invoked_node_id(
    expression_node_id: oxc_semantic::NodeId,
    semantic: &oxc_semantic::Semantic<'_>,
) -> Option<oxc_semantic::NodeId> {
    let expression = semantic.nodes().get_node(expression_node_id);
    let parent = semantic.nodes().parent_node(expression_node_id);
    match parent.kind() {
        AstKind::CallExpression(call) if call.callee.span() == expression.span() => {
            Some(parent.id())
        }
        AstKind::TaggedTemplateExpression(template)
            if template.tag.span() == expression.span() =>
        {
            Some(parent.id())
        }
        AstKind::JSXOpeningElement(opening) if opening.name.span() == expression.span() => {
            let element = semantic.nodes().parent_node(parent.id());
            matches!(element.kind(), AstKind::JSXElement(_)).then(|| element.id())
        }
        AstKind::JSXClosingElement(closing) if closing.name.span() == expression.span() => {
            let element = semantic.nodes().parent_node(parent.id());
            matches!(element.kind(), AstKind::JSXElement(_)).then(|| element.id())
        }
        _ => None,
    }
}

fn nextjs_img_classify_invoked_expression(
    invoked_node_id: oxc_semantic::NodeId,
    file_path: &std::path::Path,
    semantic: &oxc_semantic::Semantic<'_>,
    module_record: &crate::module_record::ModuleRecord,
) -> NextjsImgOwnershipFlow {
    if nextjs_img_is_inside_renderer_argument(invoked_node_id, semantic, module_record) {
        return NextjsImgOwnershipFlow {
            did_reach_renderer: true,
            ..Default::default()
        };
    }
    let Some(function_node_id) = nextjs_img_forwarding_function_node_id(invoked_node_id, semantic)
    else {
        return NextjsImgOwnershipFlow {
            is_unsafe: true,
            ..Default::default()
        };
    };
    let export_names = nextjs_img_function_export_names(function_node_id, semantic, module_record);
    if export_names.is_empty() {
        return NextjsImgOwnershipFlow {
            is_unsafe: true,
            ..Default::default()
        };
    }
    NextjsImgOwnershipFlow {
        forwarded_exports: export_names
            .into_iter()
            .map(|exported_name| (file_path.to_path_buf(), exported_name))
            .collect(),
        ..Default::default()
    }
}

fn nextjs_img_is_inside_renderer_argument(
    expression_node_id: oxc_semantic::NodeId,
    semantic: &oxc_semantic::Semantic<'_>,
    module_record: &crate::module_record::ModuleRecord,
) -> bool {
    let mut current_id = nextjs_img_transparent_root_node_id(expression_node_id, semantic);
    loop {
        let current = semantic.nodes().get_node(current_id);
        let parent = semantic.nodes().parent_node(current_id);
        let renderer_arguments = match parent.kind() {
            AstKind::CallExpression(call)
                if nextjs_img_is_renderer_callee(&call.callee, semantic, module_record) =>
            {
                Some(&call.arguments)
            }
            AstKind::NewExpression(call)
                if nextjs_img_is_renderer_callee(&call.callee, semantic, module_record) =>
            {
                Some(&call.arguments)
            }
            _ => None,
        };
        if let Some(arguments) = renderer_arguments {
            return arguments.first().is_some_and(|argument| {
                argument
                    .as_expression()
                    .is_some_and(|argument| argument.span() == current.span())
            });
        }
        if matches!(parent.kind(), AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)) {
            return false;
        }
        if !nextjs_img_is_transparent_value_parent(current, parent) {
            return false;
        }
        current_id = nextjs_img_transparent_root_node_id(parent.id(), semantic);
    }
}

fn nextjs_img_is_renderer_callee<'a>(
    callee: &Expression<'a>,
    semantic: &oxc_semantic::Semantic<'a>,
    module_record: &crate::module_record::ModuleRecord,
) -> bool {
    let callee = callee.get_inner_expression();
    if let Expression::Identifier(identifier) = callee {
        let Some(import_entry) =
            nextjs_img_resolve_identifier_module_import(identifier, semantic, module_record)
        else {
            return false;
        };
        return match import_entry.module_request.name() {
            "next/og" | "@vercel/og" => matches!(
                &import_entry.import_name,
                crate::module_record::ImportImportName::Name(imported_name)
                    if imported_name.name() == "ImageResponse"
            ),
            "satori" => match &import_entry.import_name {
                crate::module_record::ImportImportName::Default(_) => true,
                crate::module_record::ImportImportName::Name(imported_name) => {
                    imported_name.name() == "satori"
                }
                crate::module_record::ImportImportName::NamespaceObject => false,
            },
            _ => false,
        };
    }
    let Some(member) = callee.as_member_expression() else {
        return false;
    };
    if member.static_property_name().as_deref() != Some("ImageResponse") {
        return false;
    }
    let Expression::Identifier(namespace) = member.object().get_inner_expression() else {
        return false;
    };
    nextjs_img_resolve_identifier_module_import(namespace, semantic, module_record).is_some_and(
        |entry| {
        matches!(entry.module_request.name(), "next/og" | "@vercel/og")
            && matches!(
                entry.import_name,
                crate::module_record::ImportImportName::NamespaceObject
            )
        },
    )
}

fn nextjs_img_is_transparent_value_parent(
    current: &crate::AstNode<'_>,
    parent: &crate::AstNode<'_>,
) -> bool {
    match parent.kind() {
        AstKind::JSXExpressionContainer(container) => container
            .expression
            .as_expression()
            .is_some_and(|expression| expression.span() == current.span()),
        AstKind::JSXSpreadChild(spread) => spread.expression.span() == current.span(),
        AstKind::JSXElement(_) | AstKind::JSXFragment(_) => true,
        AstKind::ConditionalExpression(conditional) => {
            conditional.consequent.span() == current.span()
                || conditional.alternate.span() == current.span()
        }
        AstKind::LogicalExpression(logical) => {
            logical.left.span() == current.span() || logical.right.span() == current.span()
        }
        AstKind::ArrayExpression(array) => array.elements.iter().any(|element| {
            oxc_ast::ast::ArrayExpressionElement::as_expression(element)
                .is_some_and(|expression| expression.span() == current.span())
        }),
        AstKind::SequenceExpression(sequence) => sequence
            .expressions
            .last()
            .is_some_and(|expression| expression.span() == current.span()),
        AstKind::AwaitExpression(await_expression) => {
            await_expression.argument.span() == current.span()
        }
        _ => false,
    }
}

fn nextjs_img_forwarding_function_node_id(
    expression_node_id: oxc_semantic::NodeId,
    semantic: &oxc_semantic::Semantic<'_>,
) -> Option<oxc_semantic::NodeId> {
    let function_node_id = nextjs_img_nearest_function_node_id(
        semantic.nodes().get_node(expression_node_id),
        semantic,
    )?;
    let mut current_id = nextjs_img_transparent_root_node_id(expression_node_id, semantic);
    loop {
        let current = semantic.nodes().get_node(current_id);
        let parent = semantic.nodes().parent_node(current_id);
        if parent.id() == function_node_id {
            return matches!(parent.kind(), AstKind::ArrowFunctionExpression(function)
                if function.get_expression().is_some_and(|body| body.span() == current.span()))
            .then_some(function_node_id);
        }
        if let AstKind::ReturnStatement(statement) = parent.kind()
            && statement
                .argument
                .as_ref()
                .is_some_and(|argument| argument.span() == current.span())
            && nextjs_img_nearest_function_node_id(parent, semantic) == Some(function_node_id)
        {
            return Some(function_node_id);
        }
        if matches!(parent.kind(), AstKind::Function(_) | AstKind::ArrowFunctionExpression(_))
            || !nextjs_img_is_transparent_value_parent(current, parent)
        {
            return None;
        }
        current_id = nextjs_img_transparent_root_node_id(parent.id(), semantic);
    }
}

fn nextjs_img_nearest_function_node_id(
    node: &crate::AstNode<'_>,
    semantic: &oxc_semantic::Semantic<'_>,
) -> Option<oxc_semantic::NodeId> {
    semantic.nodes().ancestors(node.id()).find_map(|ancestor| {
        matches!(
            ancestor.kind(),
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
        )
        .then(|| ancestor.id())
    })
}

fn nextjs_img_exported_component_symbol_id(
    exported_name: &str,
    semantic: &oxc_semantic::Semantic<'_>,
    module_record: &crate::module_record::ModuleRecord,
) -> Option<oxc_semantic::SymbolId> {
    let local_name = module_record
        .local_export_entries
        .iter()
        .find_map(|entry| {
            let does_export_match = match &entry.export_name {
                crate::module_record::ExportExportName::Name(name) => {
                    name.name() == exported_name
                }
                crate::module_record::ExportExportName::Default(_) => exported_name == "default",
                crate::module_record::ExportExportName::Null => false,
            };
            does_export_match.then(|| entry.local_name.name()).flatten()
        })?;
    semantic.scoping().get_root_binding(local_name.into())
}

fn nextjs_img_reference_symbol_id(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    semantic: &oxc_semantic::Semantic<'_>,
) -> Option<oxc_semantic::SymbolId> {
    semantic
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
}

fn nextjs_img_resolve_identifier_module_import<'a, 'b>(
    identifier: &oxc_ast::ast::IdentifierReference<'a>,
    semantic: &oxc_semantic::Semantic<'a>,
    module_record: &'b crate::module_record::ModuleRecord,
) -> Option<&'b crate::module_record::ImportEntry> {
    let symbol_id = nextjs_img_reference_symbol_id(identifier, semantic)?;
    module_record.import_entries.iter().find(|entry| {
        !entry.is_type
            && semantic
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })
}

fn nextjs_img_resolve_first_party_module_path(
    resolver: &oxc_resolver::Resolver,
    from_file_path: &std::path::Path,
    module_source: &str,
) -> Option<std::path::PathBuf> {
    let resolution = resolver.resolve_file(from_file_path, module_source).ok()?;
    let resolved_path = nextjs_img_normalize_file_identity(resolution.path());
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn nextjs_img_normalize_file_identity(file_path: &std::path::Path) -> std::path::PathBuf {
    std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf())
}
