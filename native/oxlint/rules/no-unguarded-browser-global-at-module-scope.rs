use std::path::{Path, PathBuf};

use oxc_allocator::Allocator;
use oxc_ast::{
    AstKind,
    ast::{ExportDefaultDeclarationKind, Expression, Statement},
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_resolver::{ResolveOptions, Resolver, TsconfigDiscovery};
use oxc_semantic::{NodeId, Semantic, SemanticBuilder, SymbolId};
use oxc_span::{GetSpan as _, SourceType, Span};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::{
    context::{ContextHost, LintContext},
    module_record::{ExportExportName, ExportImportName, ImportImportName, ModuleRecord},
    rule::Rule,
};

const BROWSER_GLOBAL_NAMES: [&str; 5] = [
    "window",
    "navigator",
    "localStorage",
    "sessionStorage",
    "matchMedia",
];
const MAX_IMPORTED_GUARD_RESOLUTIONS: usize = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ImportedGuardResolution {
    BrowserWhenTrue,
    BrowserWhenFalse,
    ResolvedNotGuard,
    Unresolved,
}

#[derive(Clone, Copy)]
struct BrowserGlobalCandidate<'a> {
    node_id: NodeId,
    global_name: &'a str,
    diagnostic_span: Span,
}

#[derive(Debug, Default, Clone)]
pub struct NoUnguardedBrowserGlobalAtModuleScope;

declare_oxc_lint!(
    /// Warns about browser globals read while an SSR module is being imported.
    NoUnguardedBrowserGlobalAtModuleScope,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Browser global read at module scope.",
);

impl Rule for NoUnguardedBrowserGlobalAtModuleScope {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        let filename = ctx.file_path().to_string_lossy();
        !is_non_production_file(ctx)
            && !is_relative_dot_tooling_filename(&filename)
            && !is_non_source_file(ctx)
            && !is_declaration_filename(&filename)
            && !is_browser_only_module_filename(&filename)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        let mut candidates = Vec::new();
        for node in ctx.nodes().iter() {
            match node.kind() {
                AstKind::IdentifierReference(identifier)
                    if BROWSER_GLOBAL_NAMES.contains(&identifier.name.as_str())
                        && is_global_reference(identifier, ctx)
                        && is_evaluated_at_import_time(node.id(), ctx)
                        && !is_typeof_operand(node, ctx) =>
                {
                    candidates.push(BrowserGlobalCandidate {
                        node_id: node.id(),
                        global_name: identifier.name.as_str(),
                        diagnostic_span: node.span(),
                    });
                }
                _ => {}
            }
        }
        if candidates.is_empty() {
            return;
        }
        candidates.sort_unstable_by_key(|candidate| candidate.diagnostic_span.start);

        let mut imported_resolution_by_symbol = FxHashMap::default();
        let mut imported_resolution_count = 0;
        let terminating_guards = collect_terminating_guards(
            ctx,
            &mut imported_resolution_by_symbol,
            &mut imported_resolution_count,
        );

        for candidate in candidates {
            if terminating_guards
                .get(candidate.global_name)
                .is_some_and(|end_offsets| {
                    end_offsets
                        .iter()
                        .any(|end| *end <= candidate.diagnostic_span.start)
                })
            {
                continue;
            }
            if is_guarded_against_ssr_crash(
                candidate.node_id,
                candidate.global_name,
                ctx,
                &mut imported_resolution_by_symbol,
                &mut imported_resolution_count,
            ) {
                continue;
            }
            ctx.diagnostic(
                OxcDiagnostic::warn(format!(
                    "Reading `{0}` here crashes with \"ReferenceError: {0} is not defined\" the instant this module is imported during SSR — move the read inside a function or effect, or guard it with `typeof {0} !== \"undefined\"`.",
                    candidate.global_name
                ))
                .with_label(candidate.diagnostic_span),
            );
        }
    }
}

fn is_declaration_filename(filename: &str) -> bool {
    let lowercase = filename.to_ascii_lowercase();
    lowercase.ends_with(".d.ts") || lowercase.ends_with(".d.mts") || lowercase.ends_with(".d.cts")
}

fn is_browser_only_module_filename(filename: &str) -> bool {
    let normalized = filename.replace('\\', "/").to_ascii_lowercase();
    let basename = normalized.rsplit('/').next().unwrap_or(&normalized);
    let parts = basename.rsplitn(2, '.').collect::<Vec<_>>();
    (parts.len() == 2 && !parts[0].is_empty() && parts[1].ends_with(".client"))
        || format!("/{normalized}").contains("/gatsby/cache-dir/")
}

fn is_relative_dot_tooling_filename(filename: &str) -> bool {
    let normalized = filename.replace('\\', "/");
    normalized.starts_with(".storybook/") || normalized.starts_with(".dumi/")
}

fn is_global_reference(
    identifier: &oxc_ast::ast::IdentifierReference<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    ctx.scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()
        .is_none()
}

fn is_typeof_operand<'a>(node: &crate::AstNode<'a>, ctx: &LintContext<'a>) -> bool {
    let root = transparent_expression_root(node, ctx);
    matches!(ctx.nodes().parent_kind(root.id()), AstKind::UnaryExpression(unary) if unary.operator == UnaryOperator::Typeof)
}

fn is_evaluated_at_import_time(node_id: NodeId, ctx: &LintContext<'_>) -> bool {
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_)
            | AstKind::MethodDefinition(_) => return false,
            AstKind::PropertyDefinition(property) if !property.r#static => return false,
            AstKind::AccessorProperty(property) if !property.r#static => return false,
            AstKind::Program(_) => break,
            _ => {}
        }
    }
    true
}

fn collect_terminating_guards<'a>(
    ctx: &LintContext<'a>,
    imported_resolutions: &mut FxHashMap<SymbolId, ImportedGuardResolution>,
    imported_resolution_count: &mut usize,
) -> FxHashMap<&'static str, Vec<u32>> {
    let mut guards = FxHashMap::<&'static str, Vec<u32>>::default();
    for node in ctx.nodes().iter() {
        let AstKind::IfStatement(statement) = node.kind() else {
            continue;
        };
        if !matches!(ctx.nodes().parent_kind(node.id()), AstKind::Program(_))
            || !flow_terminates(&statement.consequent)
        {
            continue;
        }
        for global_name in BROWSER_GLOBAL_NAMES {
            if browser_available_when_predicate(
                &statement.test,
                false,
                global_name,
                ctx,
                imported_resolutions,
                imported_resolution_count,
                &mut Vec::new(),
            ) == Some(true)
            {
                guards
                    .entry(global_name)
                    .or_default()
                    .push(statement.span.end);
            }
        }
    }
    guards
}

fn flow_terminates(statement: &Statement<'_>) -> bool {
    match statement {
        Statement::ThrowStatement(_) | Statement::ReturnStatement(_) => true,
        Statement::BlockStatement(block) => block.body.last().is_some_and(flow_terminates),
        _ => false,
    }
}

fn is_guarded_against_ssr_crash<'a>(
    node_id: NodeId,
    global_name: &str,
    ctx: &LintContext<'a>,
    imported_resolutions: &mut FxHashMap<SymbolId, ImportedGuardResolution>,
    imported_resolution_count: &mut usize,
) -> bool {
    let mut current = ctx.nodes().get_node(node_id);
    for ancestor in ctx.nodes().ancestors(node_id) {
        match ancestor.kind() {
            AstKind::TryStatement(statement)
                if statement.block.span.contains_inclusive(current.span())
                    && statement
                        .handler
                        .as_ref()
                        .is_some_and(|handler| !catch_clause_can_throw(handler.body.span, ctx)) =>
            {
                return true;
            }
            AstKind::IfStatement(statement) => {
                let predicate_result = if statement.consequent.span() == current.span() {
                    Some(true)
                } else if statement
                    .alternate
                    .as_ref()
                    .is_some_and(|alternate| alternate.span() == current.span())
                {
                    Some(false)
                } else {
                    None
                };
                if predicate_result.is_some_and(|predicate_result| {
                    browser_available_when_predicate(
                        &statement.test,
                        predicate_result,
                        global_name,
                        ctx,
                        imported_resolutions,
                        imported_resolution_count,
                        &mut Vec::new(),
                    ) == Some(true)
                }) {
                    return true;
                }
            }
            AstKind::ConditionalExpression(expression) => {
                let predicate_result = if expression.consequent.span() == current.span() {
                    Some(true)
                } else if expression.alternate.span() == current.span() {
                    Some(false)
                } else {
                    None
                };
                if predicate_result.is_some_and(|predicate_result| {
                    browser_available_when_predicate(
                        &expression.test,
                        predicate_result,
                        global_name,
                        ctx,
                        imported_resolutions,
                        imported_resolution_count,
                        &mut Vec::new(),
                    ) == Some(true)
                }) {
                    return true;
                }
            }
            AstKind::LogicalExpression(expression) if expression.right.span() == current.span() => {
                let predicate_result = expression.operator == LogicalOperator::And;
                if browser_available_when_predicate(
                    &expression.left,
                    predicate_result,
                    global_name,
                    ctx,
                    imported_resolutions,
                    imported_resolution_count,
                    &mut Vec::new(),
                ) == Some(true)
                {
                    return true;
                }
            }
            _ => {}
        }
        current = ancestor;
    }
    false
}

fn catch_clause_can_throw(span: oxc_span::Span, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().iter().any(|node| {
        if !span.contains_inclusive(node.span())
            || !matches!(node.kind(), AstKind::ThrowStatement(_))
        {
            return false;
        }
        ctx.nodes()
            .ancestors(node.id())
            .skip(1)
            .take_while(|ancestor| span.contains_inclusive(ancestor.span()))
            .all(|ancestor| {
                !matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
    })
}

#[allow(clippy::too_many_arguments)]
fn browser_available_when_predicate<'a>(
    expression: &Expression<'a>,
    predicate_result: bool,
    global_name: &str,
    ctx: &LintContext<'a>,
    imported_resolutions: &mut FxHashMap<SymbolId, ImportedGuardResolution>,
    imported_resolution_count: &mut usize,
    visited_symbols: &mut Vec<SymbolId>,
) -> Option<bool> {
    let expression = expression.get_inner_expression();
    match expression {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            browser_available_when_predicate(
                &unary.argument,
                !predicate_result,
                global_name,
                ctx,
                imported_resolutions,
                imported_resolution_count,
                visited_symbols,
            )
        }
        Expression::LogicalExpression(logical)
            if (logical.operator == LogicalOperator::And && predicate_result)
                || (logical.operator == LogicalOperator::Or && !predicate_result) =>
        {
            let left = browser_available_when_predicate(
                &logical.left,
                predicate_result,
                global_name,
                ctx,
                imported_resolutions,
                imported_resolution_count,
                &mut visited_symbols.clone(),
            );
            let right = browser_available_when_predicate(
                &logical.right,
                predicate_result,
                global_name,
                ctx,
                imported_resolutions,
                imported_resolution_count,
                &mut visited_symbols.clone(),
            );
            merge_availability(left, right)
        }
        Expression::BinaryExpression(binary) => {
            literal_browser_availability(binary, predicate_result, global_name, ctx)
        }
        Expression::StaticMemberExpression(member) if is_import_meta_env_ssr_member(member) => {
            Some(!predicate_result)
        }
        Expression::StaticMemberExpression(member) if is_process_browser_member(member, ctx) => {
            Some(predicate_result)
        }
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if let Some(symbol_id) = symbol_id {
                if visited_symbols.contains(&symbol_id) {
                    return None;
                }
                if let Some(initializer) = direct_unreassigned_const_initializer(symbol_id, ctx) {
                    visited_symbols.push(symbol_id);
                    let result = browser_available_when_predicate(
                        initializer,
                        predicate_result,
                        global_name,
                        ctx,
                        imported_resolutions,
                        imported_resolution_count,
                        visited_symbols,
                    );
                    visited_symbols.pop();
                    if result.is_some() {
                        return result;
                    }
                }
                match classify_imported_guard(
                    symbol_id,
                    ctx,
                    imported_resolutions,
                    imported_resolution_count,
                ) {
                    Some(ImportedGuardResolution::BrowserWhenTrue) => Some(predicate_result),
                    Some(ImportedGuardResolution::BrowserWhenFalse) => Some(!predicate_result),
                    Some(ImportedGuardResolution::ResolvedNotGuard) => None,
                    Some(ImportedGuardResolution::Unresolved)
                        if is_dom_guard_identifier_name(identifier.name.as_str()) =>
                    {
                        Some(predicate_result)
                    }
                    _ => None,
                }
            } else if is_dom_guard_identifier_name(identifier.name.as_str()) {
                Some(predicate_result)
            } else {
                None
            }
        }
        Expression::CallExpression(call) => {
            let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
                return None;
            };
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id();
            if let Some(symbol_id) = symbol_id {
                match classify_imported_guard(
                    symbol_id,
                    ctx,
                    imported_resolutions,
                    imported_resolution_count,
                ) {
                    Some(ImportedGuardResolution::BrowserWhenTrue) => Some(predicate_result),
                    Some(ImportedGuardResolution::BrowserWhenFalse) => Some(!predicate_result),
                    Some(ImportedGuardResolution::ResolvedNotGuard) => None,
                    Some(ImportedGuardResolution::Unresolved)
                        if is_dom_guard_identifier_name(identifier.name.as_str()) =>
                    {
                        Some(predicate_result)
                    }
                    _ if call.arguments.is_empty() => {
                        local_zero_argument_guard_return(symbol_id, ctx).and_then(|returned| {
                            browser_available_when_predicate(
                                returned,
                                predicate_result,
                                global_name,
                                ctx,
                                imported_resolutions,
                                imported_resolution_count,
                                visited_symbols,
                            )
                        })
                    }
                    _ => None,
                }
            } else if is_dom_guard_identifier_name(identifier.name.as_str()) {
                Some(predicate_result)
            } else {
                None
            }
        }
        _ => None,
    }
}

fn merge_availability(left: Option<bool>, right: Option<bool>) -> Option<bool> {
    match (left, right) {
        (None, other) | (other, None) => other,
        (Some(left), Some(right)) if left == right => Some(left),
        _ => None,
    }
}

fn literal_browser_availability<'a>(
    binary: &oxc_ast::ast::BinaryExpression<'a>,
    predicate_result: bool,
    global_name: &str,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    let left_guard = typeof_guard_global_name(&binary.left, ctx);
    let right_guard = typeof_guard_global_name(&binary.right, ctx);
    let left_string = static_string(&binary.left);
    let right_string = static_string(&binary.right);
    let (guard_name, compared_type) = match (left_guard, right_string, right_guard, left_string) {
        (Some(guard), Some(compared), _, _) => (guard, compared),
        (_, _, Some(guard), Some(compared)) => (guard, compared),
        _ => return None,
    };
    if guard_name != global_name && guard_name != "window" && guard_name != "document" {
        return None;
    }
    let equality = matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    );
    let inequality = matches!(
        binary.operator,
        BinaryOperator::Inequality | BinaryOperator::StrictInequality
    );
    if !equality && !inequality {
        return None;
    }
    let browser_type = if guard_name == "matchMedia" {
        "function"
    } else {
        "object"
    };
    let browser_result = if equality {
        browser_type == compared_type
    } else {
        browser_type != compared_type
    };
    let server_result = if equality {
        compared_type == "undefined"
    } else {
        compared_type != "undefined"
    };
    (browser_result != server_result).then_some(predicate_result == browser_result)
}

fn typeof_guard_global_name<'expression, 'ast>(
    expression: &'expression Expression<'ast>,
    ctx: &LintContext<'ast>,
) -> Option<&'expression str> {
    let Expression::UnaryExpression(unary) = expression.get_inner_expression() else {
        return None;
    };
    if unary.operator != UnaryOperator::Typeof {
        return None;
    }
    match unary.argument.get_inner_expression() {
        Expression::Identifier(identifier)
            if is_guard_global_name(identifier.name.as_str())
                && is_global_reference(identifier, ctx) =>
        {
            Some(identifier.name.as_str())
        }
        Expression::StaticMemberExpression(member)
            if is_guard_global_name(member.property.name.as_str())
                && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "globalThis" && is_global_reference(identifier, ctx)) =>
        {
            Some(member.property.name.as_str())
        }
        _ => None,
    }
}

fn static_string<'expression>(expression: &'expression Expression<'_>) -> Option<&'expression str> {
    match expression.get_inner_expression() {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        _ => None,
    }
}

fn is_guard_global_name(name: &str) -> bool {
    BROWSER_GLOBAL_NAMES.contains(&name) || name == "document"
}

fn is_dom_guard_identifier_name(name: &str) -> bool {
    let normalized = name
        .chars()
        .filter(|character| !matches!(character, '_' | '$'))
        .flat_map(char::to_lowercase)
        .collect::<String>();
    matches!(
        normalized.as_str(),
        "canusedom"
            | "ismounted"
            | "mounted"
            | "isbrowser"
            | "isbrowserenv"
            | "isclient"
            | "haswindow"
            | "ssr"
            | "isssr"
            | "isserver"
    )
}

fn is_import_meta_env_ssr_member(member: &oxc_ast::ast::StaticMemberExpression<'_>) -> bool {
    member.property.name == "SSR"
        && matches!(member.object.get_inner_expression(), Expression::StaticMemberExpression(env)
            if env.property.name == "env" && matches!(env.object.get_inner_expression(), Expression::ImportMeta(_)))
}

fn is_process_browser_member(
    member: &oxc_ast::ast::StaticMemberExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    member.property.name == "browser"
        && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "process" && is_global_reference(identifier, ctx))
}

fn direct_unreassigned_const_initializer<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let AstKind::VariableDeclaration(variable_declaration) =
        ctx.nodes().parent_kind(declaration.id())
    else {
        return None;
    };
    variable_declaration
        .kind
        .is_const()
        .then(|| declarator.init.as_ref())
        .flatten()
}

fn local_zero_argument_guard_return<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'a Expression<'a>> {
    if ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .any(oxc_semantic::Reference::is_write)
    {
        return None;
    }
    let declaration = ctx.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::Function(function)
            if !function.r#async && !function.generator && function.params.items.is_empty() =>
        {
            direct_single_return_expression(function.body.as_deref()?)
        }
        AstKind::VariableDeclarator(declarator) => {
            let AstKind::VariableDeclaration(variable_declaration) =
                ctx.nodes().parent_kind(declaration.id())
            else {
                return None;
            };
            if !variable_declaration.kind.is_const() {
                return None;
            }
            let expression = declarator.init.as_ref()?.get_inner_expression();
            match expression {
                Expression::ArrowFunctionExpression(function)
                    if !function.r#async && function.params.items.is_empty() =>
                {
                    function.get_expression().or_else(|| {
                        function
                            .body
                            .as_function_body()
                            .and_then(direct_single_return_expression)
                    })
                }
                Expression::FunctionExpression(function)
                    if !function.r#async
                        && !function.generator
                        && function.params.items.is_empty() =>
                {
                    direct_single_return_expression(function.body.as_deref()?)
                }
                _ => return None,
            }
        }
        _ => return None,
    }
}

fn direct_single_return_expression<'a>(
    body: &'a oxc_ast::ast::FunctionBody<'a>,
) -> Option<&'a Expression<'a>> {
    if !body.directives.is_empty() {
        return None;
    }
    let [Statement::ReturnStatement(statement)] = body.statements.as_slice() else {
        return None;
    };
    statement.argument.as_ref()
}

fn classify_imported_guard<'a>(
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
    cache: &mut FxHashMap<SymbolId, ImportedGuardResolution>,
    resolution_count: &mut usize,
) -> Option<ImportedGuardResolution> {
    let import_entry = ctx.module_record().import_entries.iter().find(|entry| {
        !entry.is_type
            && ctx
                .scoping()
                .get_root_binding(entry.local_name.name().into())
                == Some(symbol_id)
    })?;
    let exported_name = match &import_entry.import_name {
        ImportImportName::Name(name) => name.name(),
        ImportImportName::Default(_) => "default",
        ImportImportName::NamespaceObject => return None,
    };
    if let Some(cached) = cache.get(&symbol_id) {
        return Some(*cached);
    }
    if *resolution_count >= MAX_IMPORTED_GUARD_RESOLUTIONS || !ctx.file_path().is_absolute() {
        return Some(ImportedGuardResolution::Unresolved);
    }
    *resolution_count += 1;
    let resolution =
        resolve_first_party_module_path(ctx.file_path(), import_entry.module_request.name())
            .and_then(|file_path| classify_foreign_export(&file_path, exported_name))
            .unwrap_or(ImportedGuardResolution::Unresolved);
    cache.insert(symbol_id, resolution);
    Some(resolution)
}

fn resolve_first_party_module_path(from_file_path: &Path, module_source: &str) -> Option<PathBuf> {
    if Path::new(module_source).is_absolute() {
        return None;
    }
    let resolver = Resolver::new(ResolveOptions {
        extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
            .into_iter()
            .map(String::from)
            .collect(),
        main_fields: vec!["module".into(), "main".into(), "browser".into()],
        condition_names: vec![
            "import".into(),
            "default".into(),
            "module".into(),
            "browser".into(),
            "require".into(),
        ],
        extension_alias: vec![
            (
                ".js".into(),
                vec![".js".into(), ".ts".into(), ".tsx".into(), ".jsx".into()],
            ),
            (".jsx".into(), vec![".jsx".into(), ".tsx".into()]),
            (".mjs".into(), vec![".mjs".into(), ".mts".into()]),
            (".cjs".into(), vec![".cjs".into(), ".cts".into()]),
        ],
        tsconfig: Some(TsconfigDiscovery::Auto),
        ..ResolveOptions::default()
    });
    let resolved_path = resolver
        .resolve_file(from_file_path, module_source)
        .ok()?
        .path()
        .to_path_buf();
    (!resolved_path
        .components()
        .any(|component| component.as_os_str() == "node_modules"))
    .then_some(resolved_path)
}

fn classify_foreign_export(
    file_path: &Path,
    exported_name: &str,
) -> Option<ImportedGuardResolution> {
    classify_foreign_export_internal(file_path, exported_name, 0, &mut FxHashSet::default())
}

fn classify_foreign_export_internal(
    file_path: &Path,
    exported_name: &str,
    depth: usize,
    visited_paths: &mut FxHashSet<PathBuf>,
) -> Option<ImportedGuardResolution> {
    if depth >= 4 {
        return None;
    }
    let canonical_path =
        std::fs::canonicalize(file_path).unwrap_or_else(|_| file_path.to_path_buf());
    if !visited_paths.insert(canonical_path) {
        return None;
    }
    let source = std::fs::read_to_string(file_path).ok()?;
    let source_type = SourceType::from_path(file_path).ok()?;
    let allocator = Allocator::default();
    let parser_return = Parser::new(&allocator, &source, source_type).parse();
    if parser_return.panicked || !parser_return.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parser_return.program);
    let semantic_return = SemanticBuilder::new_linter().build(program);
    if !semantic_return.diagnostics.is_empty() {
        return None;
    }
    let semantic = semantic_return.semantic;
    let module_record = ModuleRecord::new(file_path, &parser_return.module_record, &semantic);
    if let Some(availability) = foreign_exported_symbol_id(exported_name, &semantic, &module_record)
        .and_then(|symbol_id| foreign_exported_value_availability(symbol_id, &semantic))
    {
        return Some(match availability {
            Some(true) => ImportedGuardResolution::BrowserWhenTrue,
            Some(false) => ImportedGuardResolution::BrowserWhenFalse,
            None => ImportedGuardResolution::ResolvedNotGuard,
        });
    }

    if exported_name == "default"
        && let Some(availability) = foreign_default_export_availability(&semantic)
    {
        return Some(match availability {
            Some(true) => ImportedGuardResolution::BrowserWhenTrue,
            Some(false) => ImportedGuardResolution::BrowserWhenFalse,
            None => ImportedGuardResolution::ResolvedNotGuard,
        });
    }

    if let Some((module_source, imported_name)) =
        foreign_reexport_target(exported_name, &module_record)
        && let Some(reexport_path) = resolve_first_party_module_path(file_path, module_source)
    {
        return classify_foreign_export_internal(
            &reexport_path,
            imported_name,
            depth + 1,
            &mut visited_paths.clone(),
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
        let Some(reexport_path) =
            resolve_first_party_module_path(file_path, declaration.source.value.as_str())
        else {
            continue;
        };
        let Some(candidate) = classify_foreign_export_internal(
            &reexport_path,
            exported_name,
            depth + 1,
            &mut visited_paths.clone(),
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

fn foreign_reexport_target<'a>(
    exported_name: &str,
    module_record: &'a ModuleRecord,
) -> Option<(&'a str, &'a str)> {
    module_record
        .indirect_export_entries
        .iter()
        .find_map(|entry| {
            let entry_exported_name = match &entry.export_name {
                ExportExportName::Name(name) => name.name(),
                ExportExportName::Default(_) => "default",
                ExportExportName::Null => return None,
            };
            if entry_exported_name != exported_name {
                return None;
            }
            let source = entry.module_request.as_ref()?.name();
            let imported_name = match &entry.import_name {
                ExportImportName::Name(name) => name.name(),
                _ => return None,
            };
            Some((source, imported_name))
        })
}

fn foreign_default_export_availability(semantic: &Semantic<'_>) -> Option<Option<bool>> {
    semantic.nodes().iter().find_map(|node| {
        let AstKind::ExportDefaultDeclaration(declaration) = node.kind() else {
            return None;
        };
        match &declaration.declaration {
            ExportDefaultDeclarationKind::FunctionDeclaration(function) => Some(
                foreign_function_availability(function.node_id.get(), function.span, semantic),
            ),
            ExportDefaultDeclarationKind::ArrowFunctionExpression(function) => Some(
                function
                    .get_expression()
                    .and_then(|expression| foreign_expression_availability(expression, semantic))
                    .or_else(|| {
                        foreign_function_availability(
                            function.node_id.get(),
                            function.span,
                            semantic,
                        )
                    }),
            ),
            ExportDefaultDeclarationKind::ClassDeclaration(_) => Some(None),
            declaration => {
                let expression = declaration.as_expression()?;
                let Expression::Identifier(identifier) = expression.get_inner_expression() else {
                    return Some(foreign_expression_availability(expression, semantic));
                };
                let symbol_id = semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()?;
                foreign_exported_value_availability(symbol_id, semantic)
            }
        }
    })
}

fn foreign_exported_value_availability(
    symbol_id: SymbolId,
    semantic: &Semantic<'_>,
) -> Option<Option<bool>> {
    let declaration = semantic.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator)
            if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && declarator.init.is_some() =>
        {
            Some(foreign_symbol_availability(symbol_id, semantic))
        }
        AstKind::Function(_)
        | AstKind::ImportSpecifier(_)
        | AstKind::ImportDefaultSpecifier(_)
        | AstKind::ImportNamespaceSpecifier(_) => {
            Some(foreign_symbol_availability(symbol_id, semantic))
        }
        _ => None,
    }
}

fn foreign_symbol_availability(symbol_id: SymbolId, semantic: &Semantic<'_>) -> Option<bool> {
    let declaration = semantic.symbol_declaration(symbol_id);
    match declaration.kind() {
        AstKind::VariableDeclarator(declarator) => {
            match declarator.init.as_ref()?.get_inner_expression() {
                Expression::ArrowFunctionExpression(function) => function
                    .get_expression()
                    .and_then(|expression| foreign_expression_availability(expression, semantic))
                    .or_else(|| {
                        foreign_function_availability(
                            function.node_id.get(),
                            function.span,
                            semantic,
                        )
                    }),
                Expression::FunctionExpression(function) => {
                    foreign_function_availability(function.node_id.get(), function.span, semantic)
                }
                initializer => foreign_expression_availability(initializer, semantic),
            }
        }
        AstKind::Function(function) => {
            foreign_function_availability(declaration.id(), function.span, semantic)
        }
        _ => None,
    }
}

fn foreign_exported_symbol_id(
    exported_name: &str,
    semantic: &Semantic<'_>,
    module_record: &ModuleRecord,
) -> Option<SymbolId> {
    let local_name = module_record
        .local_export_entries
        .iter()
        .find_map(|entry| {
            let matches = match &entry.export_name {
                ExportExportName::Name(name) => name.name() == exported_name,
                ExportExportName::Default(_) => exported_name == "default",
                ExportExportName::Null => false,
            };
            matches.then(|| entry.local_name.name()).flatten()
        })?;
    semantic.scoping().get_root_binding(local_name.into())
}

fn foreign_function_availability(
    function_id: NodeId,
    function_span: oxc_span::Span,
    semantic: &Semantic<'_>,
) -> Option<bool> {
    let mut result = None;
    for node in semantic.nodes().iter() {
        let AstKind::ReturnStatement(statement) = node.kind() else {
            continue;
        };
        if !function_span.contains_inclusive(node.span())
            || foreign_nearest_function_id(node.id(), semantic) != Some(function_id)
        {
            continue;
        }
        let availability = foreign_expression_availability(statement.argument.as_ref()?, semantic)?;
        if result.is_some_and(|result| result != availability) {
            return None;
        }
        result = Some(availability);
    }
    result
}

fn foreign_nearest_function_id(node_id: NodeId, semantic: &Semantic<'_>) -> Option<NodeId> {
    semantic
        .nodes()
        .ancestors(node_id)
        .skip(1)
        .find_map(|ancestor| {
            matches!(
                ancestor.kind(),
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
            .then_some(ancestor.id())
        })
}

fn foreign_expression_availability<'a>(
    expression: &Expression<'a>,
    semantic: &Semantic<'a>,
) -> Option<bool> {
    match expression.get_inner_expression() {
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            foreign_expression_availability(&unary.argument, semantic).map(|value| !value)
        }
        Expression::BinaryExpression(binary) => {
            let left_guard = foreign_typeof_guard_global_name(&binary.left, semantic);
            let right_guard = foreign_typeof_guard_global_name(&binary.right, semantic);
            let left_string = static_string(&binary.left);
            let right_string = static_string(&binary.right);
            let (guard_name, compared_type) =
                match (left_guard, right_string, right_guard, left_string) {
                    (Some(guard), Some(compared), _, _) => (guard, compared),
                    (_, _, Some(guard), Some(compared)) => (guard, compared),
                    _ => return None,
                };
            let equality = matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::StrictEquality
            );
            let inequality = matches!(
                binary.operator,
                BinaryOperator::Inequality | BinaryOperator::StrictInequality
            );
            if !equality && !inequality {
                return None;
            }
            let browser_type = if guard_name == "matchMedia" {
                "function"
            } else {
                "object"
            };
            let browser_result = if equality {
                browser_type == compared_type
            } else {
                browser_type != compared_type
            };
            let server_result = if equality {
                compared_type == "undefined"
            } else {
                compared_type != "undefined"
            };
            (browser_result != server_result).then_some(browser_result)
        }
        Expression::StaticMemberExpression(member) if foreign_import_meta_env_ssr(member) => {
            Some(false)
        }
        Expression::StaticMemberExpression(member) if foreign_process_browser(member, semantic) => {
            Some(true)
        }
        _ => None,
    }
}

fn foreign_typeof_guard_global_name<'expression, 'ast>(
    expression: &'expression Expression<'ast>,
    semantic: &Semantic<'ast>,
) -> Option<&'expression str> {
    let Expression::UnaryExpression(unary) = expression.get_inner_expression() else {
        return None;
    };
    if unary.operator != UnaryOperator::Typeof {
        return None;
    }
    match unary.argument.get_inner_expression() {
        Expression::Identifier(identifier)
            if is_guard_global_name(identifier.name.as_str())
                && semantic
                    .scoping()
                    .get_reference(identifier.reference_id())
                    .symbol_id()
                    .is_none() =>
        {
            Some(identifier.name.as_str())
        }
        _ => None,
    }
}

fn foreign_import_meta_env_ssr(member: &oxc_ast::ast::StaticMemberExpression<'_>) -> bool {
    is_import_meta_env_ssr_member(member)
}

fn foreign_process_browser(
    member: &oxc_ast::ast::StaticMemberExpression<'_>,
    semantic: &Semantic<'_>,
) -> bool {
    member.property.name == "browser"
        && matches!(member.object.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "process"
                && semantic.scoping().get_reference(identifier.reference_id()).symbol_id().is_none())
}
