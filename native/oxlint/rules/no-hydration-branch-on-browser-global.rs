use std::{
    path::{Path, PathBuf},
    rc::Rc,
};

use oxc_allocator::Allocator;

use oxc_ast::{
    AstKind,
    ast::{
        BindingPattern, Expression, IfStatement, JSXAttributeItem, JSXAttributeName,
        ObjectPropertyKind, Statement,
    },
};
use oxc_diagnostics::OxcDiagnostic;
use oxc_ecmascript::StringToNumber;
use oxc_macros::declare_oxc_lint;
use oxc_parser::Parser;
use oxc_semantic::{NodeId, SemanticBuilder, SymbolId};
use oxc_span::{SourceType, Span};
use oxc_syntax::operator::{BinaryOperator, LogicalOperator, UnaryOperator};
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Deserialize;

use crate::{
    AllowWarnDeny, AstNode,
    config::LintConfig,
    context::{ContextHost, ContextSubHost, ContextSubHostOptions, LintContext},
    module_record::ModuleRecord,
    options::LintOptions,
    rule::Rule,
    rules::RuleEnum,
};

const EMAIL_TEMPLATE_MODULES: [&str; 4] =
    ["@faire/mjml-react", "mjml-react", "mjml", "react-email"];
const EMAIL_TEMPLATE_MODULE_PREFIXES: [&str; 2] = ["@react-email/", "jsx-email"];
const MAX_IMPORTED_SOURCE_BYTES: u64 = 2_000_000;
const MAX_IMPORTED_BARREL_FILES: usize = 4;
const MAX_HYDRATION_TSCONFIG_DIRECTORY_WALK: usize = 30;
const MAX_HYDRATION_TSCONFIG_EXTENDS_DEPTH: usize = 8;
const HYDRATION_MODULE_EXTENSIONS: [&str; 8] =
    ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];

#[derive(Default)]
struct HydrationStatementResult {
    did_return: bool,
    value: Option<bool>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum HydrationTsconfigField<T> {
    Parsed(T),
    Other(serde_json::Value),
}

#[derive(Default)]
struct HydrationTsconfigFields {
    compiler_options: Option<HydrationTsconfigField<HydrationCompilerOptionsFields>>,
    extends: Option<serde_json::Value>,
}

#[derive(Default)]
struct HydrationCompilerOptionsFields {
    base_url: Option<serde_json::Value>,
    paths: Option<HydrationTsconfigField<HydrationOrderedPathEntries>>,
}

struct HydrationTsconfigFieldsVisitor;

impl<'de> serde::de::Visitor<'de> for HydrationTsconfigFieldsVisitor {
    type Value = HydrationTsconfigFields;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a config object")
    }

    fn visit_map<M: serde::de::MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut fields = HydrationTsconfigFields::default();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "compilerOptions" => fields.compiler_options = map.next_value()?,
                "extends" => fields.extends = map.next_value()?,
                _ => {
                    map.next_value::<serde::de::IgnoredAny>()?;
                }
            }
        }
        Ok(fields)
    }
}

impl<'de> Deserialize<'de> for HydrationTsconfigFields {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(HydrationTsconfigFieldsVisitor)
    }
}

struct HydrationCompilerOptionsFieldsVisitor;

impl<'de> serde::de::Visitor<'de> for HydrationCompilerOptionsFieldsVisitor {
    type Value = HydrationCompilerOptionsFields;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("a compiler options object")
    }

    fn visit_map<M: serde::de::MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut fields = HydrationCompilerOptionsFields::default();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "baseUrl" => fields.base_url = map.next_value()?,
                "paths" => fields.paths = map.next_value()?,
                _ => {
                    map.next_value::<serde::de::IgnoredAny>()?;
                }
            }
        }
        Ok(fields)
    }
}

impl<'de> Deserialize<'de> for HydrationCompilerOptionsFields {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(HydrationCompilerOptionsFieldsVisitor)
    }
}

struct HydrationOrderedPathEntries(Vec<(String, serde_json::Value)>);

struct HydrationPathEntriesVisitor;

impl<'de> serde::de::Visitor<'de> for HydrationPathEntriesVisitor {
    type Value = HydrationOrderedPathEntries;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("an object containing path mappings")
    }

    fn visit_map<M: serde::de::MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
        let mut entries: Vec<(String, serde_json::Value)> = Vec::new();
        let mut entry_positions: FxHashMap<String, usize> = FxHashMap::default();
        while let Some((key, value)) = map.next_entry::<String, serde_json::Value>()? {
            if let Some(&position) = entry_positions.get(&key) {
                entries[position].1 = value;
            } else {
                entry_positions.insert(key.clone(), entries.len());
                entries.push((key, value));
            }
        }
        Ok(HydrationOrderedPathEntries(entries))
    }
}

impl<'de> Deserialize<'de> for HydrationOrderedPathEntries {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_map(HydrationPathEntriesVisitor)
    }
}

struct HydrationResolvedTsconfig {
    base_directory: PathBuf,
    has_explicit_base_url: bool,
    paths: Vec<(String, Vec<String>)>,
}

#[derive(Debug, Default, Clone)]
pub struct NoHydrationBranchOnBrowserGlobal;

declare_oxc_lint!(
    /// Warns when a browser-global predicate selects different server and hydration output.
    NoHydrationBranchOnBrowserGlobal,
    react_doctor_native,
    correctness,
    version = "0.1.0",
    short_description = "Server and client render different branches.",
);

#[derive(Clone)]
struct HydrationBranchMatch {
    browser_global_name: &'static str,
    predicate_span: Span,
    client_result: Option<bool>,
    server_result: Option<bool>,
}

#[derive(Clone, PartialEq)]
enum HydrationPrimitiveValue {
    Boolean(bool),
    Null,
    Number(f64),
    String(String),
    Undefined,
}

#[derive(Clone)]
struct HydrationArgumentResult {
    condition_match: Option<HydrationBranchMatch>,
    client_result: Option<bool>,
    server_result: Option<bool>,
    client_value: Option<HydrationPrimitiveValue>,
    server_value: Option<HydrationPrimitiveValue>,
}

struct HydrationImportedExport {
    file_path: PathBuf,
    value_span: Span,
    condition_match: Option<HydrationBranchMatch>,
}

#[derive(Default, Clone)]
struct HydrationBranchSymbols {
    visited: FxHashSet<SymbolId>,
    arguments: FxHashMap<SymbolId, HydrationArgumentResult>,
    imports: FxHashSet<(PathBuf, String)>,
}

impl HydrationBranchSymbols {
    fn fork(&self) -> Self {
        Self {
            arguments: self.arguments.clone(),
            imports: self.imports.clone(),
            ..Self::default()
        }
    }

    fn insert(&mut self, symbol_id: SymbolId) -> bool {
        self.visited.insert(symbol_id)
    }

    fn remove(&mut self, symbol_id: &SymbolId) {
        self.visited.remove(symbol_id);
    }
}

impl Rule for NoHydrationBranchOnBrowserGlobal {
    fn should_run(&self, ctx: &ContextHost) -> bool {
        !is_non_production_file(ctx)
            && !is_react_native_file_target(ctx)
            && !is_generated_image_render_filename(ctx)
    }

    fn run_once<'a>(&self, ctx: &LintContext<'a>) {
        if hydration_branch_is_email_template(ctx)
            || !hydration_branch_has_client_render_evidence(ctx)
        {
            return;
        }
        let generated_image_opening_ids = generated_image_jsx_opening_element_ids(ctx);
        let mut reported_spans = FxHashSet::default();

        for node in ctx.nodes().iter() {
            let candidate = match node.kind() {
                AstKind::ConditionalExpression(conditional) => {
                    hydration_branch_match(&conditional.test, ctx).map(|condition_match| {
                        (
                            condition_match,
                            &conditional.consequent,
                            Some(&conditional.alternate),
                            true,
                        )
                    })
                }
                AstKind::LogicalExpression(logical)
                    if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or)
                        && hydration_branch_is_potentially_rendered(&logical.right, ctx) =>
                {
                    hydration_branch_match_logical(
                        logical,
                        ctx,
                        &mut HydrationBranchSymbols::default(),
                        &mut FxHashSet::default(),
                    )
                    .map(|condition_match| (condition_match, &logical.right, None, true))
                }
                AstKind::IfStatement(statement) => {
                    if statement.alternate.as_ref().is_some_and(|alternate| {
                        hydration_branch_return_trees_equivalent(
                            &statement.consequent,
                            alternate,
                            ctx,
                        )
                    }) {
                        continue;
                    }
                    let consequent_values = hydration_branch_returned_values(&statement.consequent);
                    let alternate_values = statement.alternate.as_ref().map_or_else(
                        || hydration_branch_following_returns(node, ctx),
                        |alternate| hydration_branch_returned_values(alternate),
                    );
                    let branch_pair = consequent_values.iter().find_map(|consequent| {
                        alternate_values.iter().find_map(|alternate| {
                            (!hydration_branch_rendered_branches_equivalent(
                                consequent, alternate, ctx,
                            ) && (hydration_branch_is_rendered_value(consequent, ctx)
                                || hydration_branch_is_rendered_value(alternate, ctx)))
                            .then_some((*consequent, *alternate))
                        })
                    });
                    branch_pair.and_then(|(consequent, alternate)| {
                        hydration_branch_match(&statement.test, ctx).map(|condition_match| {
                            (condition_match, consequent, Some(alternate), false)
                        })
                    })
                }
                _ => None,
            };
            let Some((condition_match, left_branch, right_branch, requires_rendered_context)) =
                candidate
            else {
                continue;
            };
            if condition_match.client_result.is_some()
                && condition_match.client_result == condition_match.server_result
                || reported_spans.contains(&(
                    condition_match.predicate_span.start,
                    condition_match.predicate_span.end,
                ))
                || right_branch.is_some_and(|right_branch| {
                    hydration_branch_rendered_branches_equivalent(left_branch, right_branch, ctx)
                })
            {
                continue;
            }
            let Some(render_owner) = hydration_branch_render_owner(node, ctx) else {
                continue;
            };
            let is_in_rendered_output =
                hydration_branch_is_in_rendered_output(node, render_owner, ctx);
            let has_rendered_state_consumer = hydration_branch_state_consumer_owner(node, ctx)
                .is_some_and(|consumer_owner| consumer_owner.id() == render_owner.id());
            if requires_rendered_context && !is_in_rendered_output && !has_rendered_state_consumer {
                continue;
            }
            if !has_rendered_state_consumer
                && !hydration_branch_is_potentially_rendered(left_branch, ctx)
                && right_branch
                    .is_none_or(|branch| !hydration_branch_is_potentially_rendered(branch, ctx))
                && !hydration_branch_is_in_non_event_jsx_attribute(node, ctx)
            {
                continue;
            }
            if hydration_branch_is_gated_by_initial_state(node, ctx)
                || hydration_branch_is_after_client_only_early_return(node, render_owner, ctx)
                || hydration_branch_is_generated_image_context(
                    node,
                    left_branch,
                    &generated_image_opening_ids,
                    ctx,
                )
            {
                continue;
            }
            let enclosing_opening_element = hydration_branch_opening_element(node, ctx);
            if enclosing_opening_element.is_some_and(hydration_branch_has_suppress_warning)
                && !hydration_branch_is_structural_rendered_value(left_branch)
                && right_branch
                    .is_none_or(|branch| !hydration_branch_is_structural_rendered_value(branch))
                || right_branch.is_some_and(|right_branch| {
                    hydration_branch_roots_suppress_same_element(left_branch, right_branch, ctx)
                })
            {
                continue;
            }
            reported_spans.insert((
                condition_match.predicate_span.start,
                condition_match.predicate_span.end,
            ));
            ctx.diagnostic(
                OxcDiagnostic::error(format!(
                    "`typeof {}` selects different rendered output on the server and during hydration. Render the same initial output, then switch after mount.",
                    condition_match.browser_global_name
                ))
                .with_label(condition_match.predicate_span),
            );
        }
    }
}

fn hydration_branch_match<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<HydrationBranchMatch> {
    hydration_branch_match_expression(
        expression,
        ctx,
        &mut HydrationBranchSymbols::default(),
        &mut FxHashSet::default(),
    )
}

fn hydration_branch_match_expression<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    let expression = expression.get_inner_expression();
    if let Some(condition_match) = hydration_branch_direct_predicate(expression, ctx) {
        return Some(condition_match);
    }
    if let Some(member) = expression.as_member_expression() {
        let property_name = member.static_property_name()?;
        let Expression::CallExpression(call) = member.object().get_inner_expression() else {
            return None;
        };
        let function_id = if is_react_api_call(call, "useMemo", ctx) {
            let callback = call.arguments.first()?.as_expression()?;
            hydration_branch_resolve_local_function(callback, ctx, visited_symbols)?
        } else {
            if !call.arguments.is_empty() {
                return None;
            }
            hydration_branch_resolve_local_function(&call.callee, ctx, visited_symbols)?
        };
        if !hydration_branch_function_has_no_parameters(function_id, ctx) {
            return None;
        }
        return hydration_branch_match_function_property(
            function_id,
            property_name.as_ref(),
            ctx,
            visited_symbols,
            visited_functions,
        );
    }
    match expression {
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if let Some(argument) = visited_symbols.arguments.get(&symbol_id) {
                return argument.condition_match.clone();
            }
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let result = match declaration.kind() {
                AstKind::VariableDeclarator(declarator) => {
                    if ctx
                        .scoping()
                        .get_resolved_references(symbol_id)
                        .all(|reference| !reference.is_write())
                    {
                        declarator.init.as_ref().and_then(|initializer| {
                            hydration_branch_match_expression(
                                initializer,
                                ctx,
                                visited_symbols,
                                visited_functions,
                            )
                        })
                    } else {
                        hydration_branch_match_mutable_symbol(
                            symbol_id,
                            expression.span(),
                            ctx,
                            visited_symbols,
                            visited_functions,
                        )
                    }
                }
                _ => None,
            };
            visited_symbols.remove(&symbol_id);
            result
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            hydration_branch_match_expression(
                &unary.argument,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .map(|mut condition_match| {
                condition_match.client_result = condition_match.client_result.map(|value| !value);
                condition_match.server_result = condition_match.server_result.map(|value| !value);
                condition_match
            })
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            hydration_branch_match_logical(logical, ctx, visited_symbols, visited_functions)
        }
        Expression::ConditionalExpression(conditional) => {
            if let Some(test_result) =
                hydration_branch_read_initial_state_boolean(&conditional.test, ctx)
            {
                return hydration_branch_match_expression(
                    if test_result {
                        &conditional.consequent
                    } else {
                        &conditional.alternate
                    },
                    ctx,
                    visited_symbols,
                    visited_functions,
                );
            }
            hydration_branch_match_expression(
                &conditional.test,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .or_else(|| {
                hydration_branch_match_expression(
                    &conditional.consequent,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })
            .or_else(|| {
                hydration_branch_match_expression(
                    &conditional.alternate,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })
        }
        Expression::CallExpression(call) => {
            if hydration_branch_is_global_boolean_call(call, ctx) {
                return call
                    .arguments
                    .first()?
                    .as_expression()
                    .and_then(|argument| {
                        hydration_branch_match_expression(
                            argument,
                            ctx,
                            visited_symbols,
                            visited_functions,
                        )
                    });
            }
            if is_react_api_call(call, "useState", ctx) {
                let argument = call.arguments.first()?.as_expression()?;
                if let Some(function_id) =
                    hydration_branch_resolve_local_function(argument, ctx, visited_symbols)
                    && hydration_branch_function_has_no_parameters(function_id, ctx)
                {
                    return hydration_branch_match_function(
                        function_id,
                        ctx,
                        visited_symbols,
                        visited_functions,
                    );
                }
                return hydration_branch_match_expression(
                    argument,
                    ctx,
                    visited_symbols,
                    visited_functions,
                );
            }
            if is_react_api_call(call, "useMemo", ctx) {
                let callback = call.arguments.first()?.as_expression()?;
                let function_id =
                    hydration_branch_resolve_local_function(callback, ctx, visited_symbols)?;
                if !hydration_branch_function_has_no_parameters(function_id, ctx) {
                    return None;
                }
                return hydration_branch_match_function(
                    function_id,
                    ctx,
                    visited_symbols,
                    visited_functions,
                );
            }
            if let Some(imported_match) = hydration_branch_match_imported_helper(
                call,
                ctx,
                visited_symbols,
                visited_functions,
            ) {
                return Some(imported_match);
            }
            let function_id =
                hydration_branch_resolve_local_function(&call.callee, ctx, visited_symbols)?;
            hydration_branch_match_called_function(
                function_id,
                call,
                ctx,
                visited_symbols,
                visited_functions,
            )
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            let condition_match = hydration_branch_match_expression(
                &binary.left,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .or_else(|| {
                hydration_branch_match_expression(
                    &binary.right,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })?;
            let client_result = hydration_branch_read_condition(
                expression,
                true,
                ctx,
                &mut visited_symbols.fork(),
                &mut FxHashSet::default(),
            );
            let server_result = hydration_branch_read_condition(
                expression,
                false,
                ctx,
                &mut visited_symbols.fork(),
                &mut FxHashSet::default(),
            );
            if client_result.is_some() && client_result == server_result
                || hydration_branch_spans_binding_equivalent(
                    binary.left.span(),
                    binary.right.span(),
                    ctx,
                ) && hydration_branch_is_reflexive(&binary.left, ctx, &mut FxHashSet::default())
            {
                return None;
            }
            Some(HydrationBranchMatch {
                client_result,
                server_result,
                ..condition_match
            })
        }
        _ => None,
    }
}

fn hydration_branch_match_logical<'a>(
    logical: &oxc_ast::ast::LogicalExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    let left_match =
        hydration_branch_match_expression(&logical.left, ctx, visited_symbols, visited_functions);
    let right_match =
        hydration_branch_match_expression(&logical.right, ctx, visited_symbols, visited_functions);
    let condition_match = left_match.or(right_match)?;
    let client_result = hydration_branch_combine_logical(
        logical.operator,
        hydration_branch_read_condition(
            &logical.left,
            true,
            ctx,
            &mut visited_symbols.fork(),
            &mut FxHashSet::default(),
        ),
        hydration_branch_read_condition(
            &logical.right,
            true,
            ctx,
            &mut visited_symbols.fork(),
            &mut FxHashSet::default(),
        ),
    );
    let server_result = hydration_branch_combine_logical(
        logical.operator,
        hydration_branch_read_condition(
            &logical.left,
            false,
            ctx,
            &mut visited_symbols.fork(),
            &mut FxHashSet::default(),
        ),
        hydration_branch_read_condition(
            &logical.right,
            false,
            ctx,
            &mut visited_symbols.fork(),
            &mut FxHashSet::default(),
        ),
    );
    if client_result.is_some() && client_result == server_result {
        return None;
    }
    Some(HydrationBranchMatch {
        client_result: client_result.or(condition_match.client_result),
        server_result: server_result.or(condition_match.server_result),
        ..condition_match
    })
}

fn hydration_branch_match_imported_helper<'a>(
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    let Expression::Identifier(identifier) = call.callee.get_inner_expression() else {
        return None;
    };
    if call.arguments.iter().any(|argument| argument.is_spread()) {
        return None;
    }
    let symbol_id = ctx
        .scoping()
        .get_reference(identifier.reference_id())
        .symbol_id()?;
    if !matches!(
        ctx.symbol_declaration(symbol_id).kind(),
        AstKind::ImportSpecifier(_)
            | AstKind::ImportDefaultSpecifier(_)
            | AstKind::ImportNamespaceSpecifier(_)
    ) {
        return None;
    }
    let import_entry = resolve_identifier_import(identifier, ctx)?;
    let imported_name = match &import_entry.import_name {
        crate::module_record::ImportImportName::Name(name) => name.name(),
        crate::module_record::ImportImportName::Default(_) => "default",
        crate::module_record::ImportImportName::NamespaceObject => return None,
    };
    let module_path =
        hydration_branch_resolve_module_path(ctx.file_path(), import_entry.module_request.name())?;
    let arguments = call
        .arguments
        .iter()
        .filter_map(|argument| {
            argument.as_expression().map(|expression| {
                hydration_branch_argument_result(
                    expression,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })
        })
        .collect::<Vec<_>>();
    let mut condition_match = hydration_branch_match_imported_export(
        &module_path,
        imported_name,
        &arguments,
        ctx,
        &visited_symbols.imports,
        &FxHashSet::default(),
    )?
    .condition_match?;
    condition_match.predicate_span = call.span;
    Some(condition_match)
}

fn hydration_branch_resolve_module_path(from_file: &Path, module_source: &str) -> Option<PathBuf> {
    if Path::new(module_source).is_absolute() {
        return None;
    }
    let is_runtime_module = |path: &PathBuf| {
        !path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.ends_with(".d.ts") || name.ends_with(".d.mts") || name.ends_with(".d.cts")
            })
    };
    if module_source.starts_with('.') {
        return hydration_branch_resolve_module_candidate(&from_file.parent()?.join(module_source))
            .filter(is_runtime_module);
    }
    let config = from_file
        .parent()?
        .ancestors()
        .take(MAX_HYDRATION_TSCONFIG_DIRECTORY_WALK)
        .find_map(|directory| {
            ["tsconfig.json", "jsconfig.json"]
                .into_iter()
                .find_map(|filename| hydration_branch_read_tsconfig(&directory.join(filename), 0))
        })?;
    let base_directory = &config.base_directory;
    let mut best_mapping = None;
    for (pattern, targets) in &config.paths {
        let (prefix, suffix) = pattern.split_once('*').unwrap_or((pattern.as_str(), ""));
        let capture = if pattern.contains('*') {
            module_source
                .strip_prefix(prefix)
                .and_then(|remaining| remaining.strip_suffix(suffix))
        } else {
            (module_source == pattern.as_str()).then_some("")
        };
        if let Some(capture) = capture
            && best_mapping
                .as_ref()
                .is_none_or(|(length, _, _)| prefix.len() > *length)
        {
            best_mapping = Some((prefix.len(), capture, targets));
        }
    }
    let mut candidates = best_mapping.map_or_else(Vec::new, |(_, capture, targets)| {
        targets
            .iter()
            .map(|target| base_directory.join(target.replace('*', capture)))
            .collect::<Vec<_>>()
    });
    if config.has_explicit_base_url {
        candidates.push(base_directory.join(module_source));
    }
    candidates
        .into_iter()
        .find_map(|candidate| hydration_branch_resolve_module_candidate(&candidate))
        .filter(is_runtime_module)
}

fn hydration_branch_resolve_file_candidate(candidate: &Path) -> Option<PathBuf> {
    if candidate.is_file() {
        return Some(candidate.to_path_buf());
    }
    let extension = candidate
        .extension()
        .and_then(|extension| extension.to_str());
    let extension_candidates: &[&str] = match extension {
        Some("js") => &["ts", "tsx", "jsx"],
        Some("jsx") => &["tsx"],
        Some("mjs") => &["mts"],
        Some("cjs") => &["cts"],
        Some(extension) if HYDRATION_MODULE_EXTENSIONS.contains(&extension) => &[],
        _ => &HYDRATION_MODULE_EXTENSIONS,
    };
    extension_candidates.iter().find_map(|extension_candidate| {
        let candidate_path = if extension
            .is_some_and(|extension| HYDRATION_MODULE_EXTENSIONS.contains(&extension))
        {
            candidate.with_extension(extension_candidate)
        } else {
            let mut candidate_path = candidate.as_os_str().to_os_string();
            candidate_path.push(".");
            candidate_path.push(extension_candidate);
            PathBuf::from(candidate_path)
        };
        candidate_path.is_file().then_some(candidate_path)
    })
}

fn hydration_branch_package_export_entry(entry: &serde_json::Value) -> Option<&str> {
    match entry {
        serde_json::Value::String(entry) => (!entry.is_empty()).then_some(entry.as_str()),
        serde_json::Value::Array(entries) => entries
            .iter()
            .find_map(hydration_branch_package_export_entry),
        serde_json::Value::Object(entries) => ["import", "default", "module", "browser", "require"]
            .into_iter()
            .find_map(|condition| {
                entries
                    .get(condition)
                    .and_then(hydration_branch_package_export_entry)
            }),
        _ => None,
    }
}

fn hydration_branch_resolve_module_candidate(candidate: &Path) -> Option<PathBuf> {
    if let Some(path) = hydration_branch_resolve_file_candidate(candidate) {
        return Some(path);
    }
    if candidate.is_dir()
        && let Ok(source) = std::fs::read_to_string(candidate.join("package.json"))
        && let Ok(package) = serde_json::from_str::<serde_json::Value>(&source)
    {
        let entry = package
            .get("exports")
            .and_then(|exports| {
                hydration_branch_package_export_entry(exports).or_else(|| {
                    exports
                        .get(".")
                        .and_then(hydration_branch_package_export_entry)
                })
            })
            .or_else(|| {
                ["module", "main", "browser"]
                    .into_iter()
                    .find_map(|field| package.get(field).and_then(serde_json::Value::as_str))
            });
        if let Some(entry) = entry {
            let entry_path = candidate.join(entry);
            if let Some(path) = hydration_branch_resolve_file_candidate(&entry_path)
                .or_else(|| hydration_branch_resolve_file_candidate(&entry_path.join("index")))
            {
                return Some(path);
            }
        }
    }
    hydration_branch_resolve_file_candidate(&candidate.join("index"))
}

fn hydration_branch_read_tsconfig(
    config_path: &Path,
    extends_depth: usize,
) -> Option<HydrationResolvedTsconfig> {
    let source = std::fs::read_to_string(config_path).ok()?;
    let fields = serde_json::from_str::<HydrationTsconfigFields>(
        &super::window_open_without_noopener::window_open_strip_json_comments_and_trailing_commas(
            &source,
        ),
    )
    .ok()?;
    let options = match fields.compiler_options {
        Some(HydrationTsconfigField::Parsed(options)) => Some(options),
        _ => None,
    };
    let base_url = options
        .as_ref()
        .and_then(|options| options.base_url.as_ref())
        .and_then(serde_json::Value::as_str);
    let base_directory = config_path.parent()?.join(base_url.unwrap_or("."));
    let has_explicit_base_url = base_url.is_some();
    let path_entries = options.and_then(|options| match options.paths {
        Some(HydrationTsconfigField::Parsed(HydrationOrderedPathEntries(entries))) => Some(entries),
        Some(HydrationTsconfigField::Other(serde_json::Value::Array(entries))) => Some(
            entries
                .into_iter()
                .enumerate()
                .map(|(index, value)| (index.to_string(), value))
                .collect(),
        ),
        _ => None,
    });
    if let Some(entries) = path_entries {
        let paths = entries
            .into_iter()
            .filter_map(|(pattern, value)| {
                let targets = value
                    .as_array()?
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(String::from)
                    .collect::<Vec<_>>();
                (!targets.is_empty()).then_some((pattern, targets))
            })
            .collect();
        return Some(HydrationResolvedTsconfig {
            base_directory,
            has_explicit_base_url,
            paths,
        });
    }
    if extends_depth < MAX_HYDRATION_TSCONFIG_EXTENDS_DEPTH
        && let Some(extends) = fields.extends.as_ref().and_then(serde_json::Value::as_str)
    {
        let mut extends_path = config_path.parent()?.join(
            if extends.starts_with("./") || extends.starts_with("../") {
                PathBuf::from(extends)
            } else {
                Path::new("node_modules").join(extends)
            },
        );
        if !extends.ends_with(".json") {
            extends_path = PathBuf::from(format!("{}.json", extends_path.display()));
        }
        if let Some(inherited) = hydration_branch_read_tsconfig(&extends_path, extends_depth + 1) {
            return Some(inherited);
        }
    }
    has_explicit_base_url.then_some(HydrationResolvedTsconfig {
        base_directory,
        has_explicit_base_url,
        paths: Vec::new(),
    })
}

fn hydration_branch_match_imported_export(
    module_path: &Path,
    imported_name: &str,
    arguments: &[HydrationArgumentResult],
    caller_ctx: &LintContext<'_>,
    visited_imports: &FxHashSet<(PathBuf, String)>,
    visited_barrel_files: &FxHashSet<PathBuf>,
) -> Option<HydrationImportedExport> {
    let file_path = std::fs::canonicalize(module_path).ok()?;
    if visited_barrel_files.len() >= MAX_IMPORTED_BARREL_FILES
        || visited_barrel_files.contains(&file_path)
    {
        return None;
    }
    let import_key = (file_path.clone(), imported_name.to_owned());
    if visited_imports.contains(&import_key) {
        return None;
    }
    let mut imports = visited_imports.clone();
    imports.insert(import_key);
    let mut barrel_files = visited_barrel_files.clone();
    barrel_files.insert(file_path.clone());
    let metadata = std::fs::metadata(module_path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_IMPORTED_SOURCE_BYTES {
        return None;
    }
    let source = std::fs::read_to_string(module_path).ok()?;
    let allocator = Allocator::default();
    let parsed = Parser::new(
        &allocator,
        &source,
        SourceType::from_path(module_path).ok()?,
    )
    .parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return None;
    }
    let program = allocator.alloc(parsed.program);
    let analyzed = SemanticBuilder::new_linter().with_cfg(true).build(program);
    if !analyzed.diagnostics.is_empty() {
        return None;
    }
    let semantic = analyzed.semantic;
    let module_record = ModuleRecord::new(module_path, &parsed.module_record, &semantic);
    let local_name = module_record.local_export_entries.iter().find_map(|entry| {
        let matches_name = match &entry.export_name {
            crate::module_record::ExportExportName::Name(name) => name.name() == imported_name,
            crate::module_record::ExportExportName::Default(_) => imported_name == "default",
            crate::module_record::ExportExportName::Null => false,
        };
        matches_name.then(|| entry.local_name.name()).flatten()
    });
    let local_declaration = local_name
        .and_then(|name| semantic.scoping().get_root_binding(name.into()))
        .map(|symbol_id| semantic.symbol_declaration(symbol_id));
    let function_id = local_declaration
        .and_then(|declaration| match declaration.kind() {
            AstKind::Function(_) => Some(declaration.id()),
            AstKind::VariableDeclarator(declarator) => {
                match declarator.init.as_ref()?.get_inner_expression() {
                    Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
                    Expression::FunctionExpression(function) => Some(function.node_id.get()),
                    _ => None,
                }
            }
            _ => None,
        })
        .or_else(|| {
            if imported_name != "default" {
                return None;
            }
            semantic.nodes().iter().find_map(|node| {
                let AstKind::ExportDefaultDeclaration(export) = node.kind() else {
                    return None;
                };
                match &export.declaration {
                    oxc_ast::ast::ExportDefaultDeclarationKind::FunctionDeclaration(function) => {
                        Some(function.node_id.get())
                    }
                    oxc_ast::ast::ExportDefaultDeclarationKind::ArrowFunctionExpression(
                        function,
                    ) => Some(function.node_id.get()),
                    _ => None,
                }
            })
        });
    let Some(function_id) = function_id else {
        if let Some(declaration) = local_declaration {
            let value_span = match declaration.kind() {
                AstKind::VariableDeclarator(declarator) => declarator
                    .init
                    .as_ref()
                    .map(|initializer| initializer.span()),
                _ => Some(declaration.span()),
            };
            if let Some(value_span) = value_span {
                return Some(HydrationImportedExport {
                    file_path,
                    value_span,
                    condition_match: None,
                });
            }
        }
        if imported_name == "default"
            && let Some(value_span) = semantic.nodes().iter().find_map(|node| {
                let AstKind::ExportDefaultDeclaration(export) = node.kind() else {
                    return None;
                };
                Some(export.declaration.span())
            })
        {
            return Some(HydrationImportedExport {
                file_path,
                value_span,
                condition_match: None,
            });
        }
        let mut targets = module_record
            .indirect_export_entries
            .iter()
            .filter_map(|entry| {
                let matches_name = match &entry.export_name {
                    crate::module_record::ExportExportName::Name(name) => {
                        name.name() == imported_name
                    }
                    crate::module_record::ExportExportName::Default(_) => {
                        imported_name == "default"
                    }
                    crate::module_record::ExportExportName::Null => false,
                };
                if !matches_name {
                    return None;
                }
                let crate::module_record::ExportImportName::Name(name) = &entry.import_name else {
                    return None;
                };
                Some((entry.module_request.as_ref()?.name(), name.name()))
            })
            .collect::<Vec<_>>();
        if targets.is_empty() {
            targets.extend(semantic.nodes().iter().filter_map(|node| {
                let AstKind::ExportAllDeclaration(export) = node.kind() else {
                    return None;
                };
                if export.export_kind.is_type() || export.exported.is_some() {
                    return None;
                }
                Some((export.source.value.as_str(), imported_name))
            }));
        } else {
            targets.truncate(1);
        }
        let mut resolved_exports = FxHashMap::default();
        for (target_source, target_name) in targets {
            let Some(target_path) =
                hydration_branch_resolve_module_path(module_path, target_source)
            else {
                continue;
            };
            if let Some(resolved) = hydration_branch_match_imported_export(
                &target_path,
                target_name,
                arguments,
                caller_ctx,
                &imports,
                &barrel_files,
            ) {
                resolved_exports.insert(
                    (
                        resolved.file_path.clone(),
                        resolved.value_span.start,
                        resolved.value_span.end,
                    ),
                    resolved,
                );
            }
        }
        return (resolved_exports.len() == 1)
            .then(|| resolved_exports.into_values().next())
            .flatten();
    };
    let value_span = semantic.nodes().get_node(function_id).span();
    let sub_host = ContextSubHost::new(
        semantic,
        std::sync::Arc::new(module_record),
        0,
        ContextSubHostOptions::default(),
    );
    let config = LintConfig {
        settings: caller_ctx.settings().clone(),
        globals: caller_ctx.globals().clone(),
        env: caller_ctx.env().clone(),
        ..LintConfig::default()
    };
    let host = Rc::new(ContextHost::new(
        module_path,
        vec![sub_host],
        &allocator,
        LintOptions::default(),
        std::sync::Arc::new(config),
    ));
    let rule = RuleEnum::ReactDoctorNativeNoHydrationBranchOnBrowserGlobal(
        NoHydrationBranchOnBrowserGlobal,
    );
    let imported_ctx = host.spawn(&rule, AllowWarnDeny::Warn);
    let condition_match = hydration_branch_match_function_with_arguments(
        function_id,
        arguments,
        &imported_ctx,
        &mut HydrationBranchSymbols {
            imports,
            ..HydrationBranchSymbols::default()
        },
        &mut FxHashSet::default(),
    );
    Some(HydrationImportedExport {
        file_path,
        value_span,
        condition_match,
    })
}

fn hydration_branch_match_mutable_symbol<'a>(
    symbol_id: SymbolId,
    read_span: Span,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    let write_nodes = ctx
        .scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| reference.is_write())
        .map(|reference| ctx.nodes().get_node(reference.node_id()))
        .filter(|write_node| write_node.span().start < read_span.start)
        .collect::<Vec<_>>();
    for write_node in write_nodes.iter().rev() {
        let guard = ctx
            .nodes()
            .ancestors(write_node.id())
            .take_while(|ancestor| {
                !matches!(
                    ancestor.kind(),
                    AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                )
            })
            .find_map(|ancestor| {
                let AstKind::IfStatement(if_statement) = ancestor.kind() else {
                    return None;
                };
                (if_statement
                    .consequent
                    .span()
                    .contains_inclusive(write_node.span())
                    || if_statement.alternate.as_ref().is_some_and(|alternate| {
                        alternate.span().contains_inclusive(write_node.span())
                    }))
                .then_some((ancestor.span(), &if_statement.test))
            });
        let Some((guard_span, guard_test)) = guard else {
            continue;
        };
        if hydration_branch_guard_preserves_symbol(symbol_id, guard_span, ctx)
            || write_nodes.iter().any(|later_write| {
                later_write.span().start > guard_span.end
                    && later_write.span().start < read_span.start
            })
        {
            continue;
        }
        if let Some(condition_match) =
            hydration_branch_match_expression(guard_test, ctx, visited_symbols, visited_functions)
        {
            return Some(condition_match);
        }
    }
    None
}

fn hydration_branch_guard_preserves_symbol(
    symbol_id: SymbolId,
    guard_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    let AstKind::VariableDeclarator(declarator) = ctx.symbol_declaration(symbol_id).kind() else {
        return false;
    };
    let Some(initializer) = &declarator.init else {
        return false;
    };
    let mut has_guarded_write = false;
    for reference in ctx.scoping().get_resolved_references(symbol_id) {
        if !reference.is_write() {
            continue;
        }
        let write_node = ctx.nodes().get_node(reference.node_id());
        if !guard_span.contains_inclusive(write_node.span()) {
            continue;
        }
        has_guarded_write = true;
        let AstKind::AssignmentExpression(assignment) = ctx.nodes().parent_kind(write_node.id())
        else {
            return false;
        };
        if assignment.operator != oxc_syntax::operator::AssignmentOperator::Assign
            || assignment.left.span() != write_node.span()
            || !hydration_branch_spans_binding_equivalent(
                initializer.span(),
                assignment.right.span(),
                ctx,
            )
        {
            return false;
        }
    }
    has_guarded_write
}

fn hydration_branch_guard_changes_returned_value(
    statement: &IfStatement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let guard_node = ctx.nodes().get_node(statement.node_id.get());
    let returned_values = hydration_branch_following_returns(guard_node, ctx);
    let guard_function = crate::ast_util::get_enclosing_function(guard_node, ctx).map(AstNode::id);
    ctx.scoping().symbol_ids().any(|symbol_id| {
        let has_guarded_write = ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .any(|reference| {
                let node = ctx.nodes().get_node(reference.node_id());
                reference.is_write()
                    && (statement.consequent.span().contains_inclusive(node.span())
                        || statement.alternate.as_ref().is_some_and(|alternate| {
                            alternate.span().contains_inclusive(node.span())
                        }))
                    && crate::ast_util::get_enclosing_function(node, ctx).map(AstNode::id)
                        == guard_function
            });
        has_guarded_write
            && !hydration_branch_guard_preserves_symbol(symbol_id, statement.span, ctx)
            && ctx
                .scoping()
                .get_resolved_references(symbol_id)
                .any(|reference| {
                    reference.is_read()
                        && returned_values.iter().any(|value| {
                            value.span().contains_inclusive(
                                ctx.nodes().get_node(reference.node_id()).span(),
                            )
                        })
                })
    })
}

fn hydration_branch_match_function_property<'a>(
    function_id: NodeId,
    property_name: &str,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    if !visited_functions.insert(function_id) {
        return None;
    }
    let function_node = ctx.nodes().get_node(function_id);
    let mut returned_values = Vec::new();
    match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) if !function.r#async => {
            if let Some(expression) = function.get_expression() {
                returned_values.push(expression);
            } else if let Some(body) = function.get_function_body() {
                for statement in &body.statements {
                    hydration_branch_collect_returned_values(statement, &mut returned_values);
                    if statement_always_exits(statement) {
                        break;
                    }
                }
            }
        }
        AstKind::Function(function) if !function.r#async && !function.generator => {
            if let Some(body) = &function.body {
                for statement in &body.statements {
                    hydration_branch_collect_returned_values(statement, &mut returned_values);
                    if statement_always_exits(statement) {
                        break;
                    }
                }
            }
        }
        _ => {}
    }
    let result = returned_values.into_iter().find_map(|returned_value| {
        let Expression::ObjectExpression(object) = returned_value.get_inner_expression() else {
            return None;
        };
        object.properties.iter().find_map(|property| {
            let ObjectPropertyKind::ObjectProperty(property) = property else {
                return None;
            };
            (!property.computed && property_key_matches_name(&property.key, property_name))
                .then(|| {
                    hydration_branch_match_expression(
                        &property.value,
                        ctx,
                        visited_symbols,
                        visited_functions,
                    )
                })
                .flatten()
        })
    });
    visited_functions.remove(&function_id);
    result
}

fn hydration_branch_combine_logical(
    operator: LogicalOperator,
    left: Option<bool>,
    right: Option<bool>,
) -> Option<bool> {
    match operator {
        LogicalOperator::And if left == Some(false) || right == Some(false) => Some(false),
        LogicalOperator::And if left == Some(true) && right == Some(true) => Some(true),
        LogicalOperator::Or if left == Some(true) || right == Some(true) => Some(true),
        LogicalOperator::Or if left == Some(false) && right == Some(false) => Some(false),
        _ => None,
    }
}

fn hydration_branch_direct_predicate<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<HydrationBranchMatch> {
    if let Expression::UnaryExpression(unary) = expression
        && unary.operator == UnaryOperator::LogicalNot
    {
        return hydration_branch_direct_predicate(&unary.argument, ctx).map(
            |mut condition_match| {
                condition_match.client_result = condition_match.client_result.map(|value| !value);
                condition_match.server_result = condition_match.server_result.map(|value| !value);
                condition_match.predicate_span = expression.span();
                condition_match
            },
        );
    }
    let Expression::BinaryExpression(binary) = expression else {
        return None;
    };
    if !matches!(
        binary.operator,
        BinaryOperator::Equality
            | BinaryOperator::Inequality
            | BinaryOperator::StrictEquality
            | BinaryOperator::StrictInequality
    ) {
        return None;
    }
    let (browser_global_name, compared_type) =
        if let Some(browser_global_name) = hydration_branch_typeof_global(&binary.left, ctx) {
            (
                browser_global_name,
                hydration_branch_string_literal(&binary.right)?,
            )
        } else {
            (
                hydration_branch_typeof_global(&binary.right, ctx)?,
                hydration_branch_string_literal(&binary.left)?,
            )
        };
    let is_equality = matches!(
        binary.operator,
        BinaryOperator::Equality | BinaryOperator::StrictEquality
    );
    let client_result = (compared_type == "object") == is_equality;
    let server_result = (compared_type == "undefined") == is_equality;
    (client_result != server_result).then_some(HydrationBranchMatch {
        browser_global_name,
        predicate_span: expression.span(),
        client_result: Some(client_result),
        server_result: Some(server_result),
    })
}

fn hydration_branch_typeof_global<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<&'static str> {
    let Expression::UnaryExpression(unary) = expression.get_inner_expression() else {
        return None;
    };
    if unary.operator != UnaryOperator::Typeof {
        return None;
    }
    match unary.argument.get_inner_expression() {
        Expression::Identifier(identifier)
            if ctx.is_reference_to_global_variable(identifier)
                && matches!(identifier.name.as_str(), "window" | "document") =>
        {
            Some(if identifier.name == "window" {
                "window"
            } else {
                "document"
            })
        }
        argument => {
            let member = argument.as_member_expression()?;
            if member.is_computed()
                || !matches!(member.object().get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "globalThis"
                        && ctx.is_reference_to_global_variable(identifier))
            {
                return None;
            }
            match member.static_property_name()?.as_ref() {
                "window" => Some("window"),
                "document" => Some("document"),
                _ => None,
            }
        }
    }
}

fn hydration_branch_string_literal<'a>(expression: &'a Expression<'a>) -> Option<&'a str> {
    let Expression::StringLiteral(literal) = expression.get_inner_expression() else {
        return None;
    };
    Some(literal.value.as_str())
}

fn hydration_branch_primitive_truthiness(value: Option<&HydrationPrimitiveValue>) -> Option<bool> {
    match value? {
        HydrationPrimitiveValue::Boolean(value) => Some(*value),
        HydrationPrimitiveValue::Null | HydrationPrimitiveValue::Undefined => Some(false),
        HydrationPrimitiveValue::Number(value) => Some(*value != 0.0 && !value.is_nan()),
        HydrationPrimitiveValue::String(value) => Some(!value.is_empty()),
    }
}

fn hydration_branch_loosely_equal(
    left: &HydrationPrimitiveValue,
    right: &HydrationPrimitiveValue,
) -> bool {
    match (left, right) {
        (HydrationPrimitiveValue::Null, HydrationPrimitiveValue::Undefined)
        | (HydrationPrimitiveValue::Undefined, HydrationPrimitiveValue::Null) => true,
        (HydrationPrimitiveValue::Boolean(value), other)
            if !matches!(other, HydrationPrimitiveValue::Boolean(_)) =>
        {
            hydration_branch_loosely_equal(
                &HydrationPrimitiveValue::Number(if *value { 1.0 } else { 0.0 }),
                other,
            )
        }
        (other, HydrationPrimitiveValue::Boolean(value))
            if !matches!(other, HydrationPrimitiveValue::Boolean(_)) =>
        {
            hydration_branch_loosely_equal(
                other,
                &HydrationPrimitiveValue::Number(if *value { 1.0 } else { 0.0 }),
            )
        }
        (HydrationPrimitiveValue::Number(number), HydrationPrimitiveValue::String(text))
        | (HydrationPrimitiveValue::String(text), HydrationPrimitiveValue::Number(number)) => {
            *number == text.as_str().string_to_number()
        }
        _ => left == right,
    }
}

fn hydration_branch_read_primitive<'a>(
    expression: &Expression<'a>,
    client_runtime: bool,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationPrimitiveValue> {
    let expression = expression.get_inner_expression();
    if let Some(predicate) = hydration_branch_direct_predicate(expression, ctx) {
        return (if client_runtime {
            predicate.client_result
        } else {
            predicate.server_result
        })
        .map(HydrationPrimitiveValue::Boolean);
    }
    match expression {
        Expression::BooleanLiteral(value) => Some(HydrationPrimitiveValue::Boolean(value.value)),
        Expression::NullLiteral(_) => Some(HydrationPrimitiveValue::Null),
        Expression::NumericLiteral(value) => Some(HydrationPrimitiveValue::Number(value.value)),
        Expression::StringLiteral(value) => {
            Some(HydrationPrimitiveValue::String(value.value.to_string()))
        }
        Expression::Identifier(identifier) => {
            if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier) {
                return Some(HydrationPrimitiveValue::Undefined);
            }
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if let Some(argument) = visited_symbols.arguments.get(&symbol_id) {
                return if client_runtime {
                    argument.client_value.clone()
                } else {
                    argument.server_value.clone()
                };
            }
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let result = match declaration.kind() {
                AstKind::VariableDeclarator(declarator)
                    if hydration_branch_variable_is_immutable(declaration, symbol_id, ctx) =>
                {
                    declarator.init.as_ref().and_then(|initializer| {
                        hydration_branch_read_primitive(
                            initializer,
                            client_runtime,
                            ctx,
                            visited_symbols,
                            visited_functions,
                        )
                    })
                }
                _ => None,
            };
            visited_symbols.remove(&symbol_id);
            result
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            hydration_branch_read_condition(
                &unary.argument,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .map(|value| HydrationPrimitiveValue::Boolean(!value))
        }
        Expression::BinaryExpression(binary)
            if matches!(
                binary.operator,
                BinaryOperator::Equality
                    | BinaryOperator::Inequality
                    | BinaryOperator::StrictEquality
                    | BinaryOperator::StrictInequality
            ) =>
        {
            let left = hydration_branch_read_primitive(
                &binary.left,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            )?;
            let right = hydration_branch_read_primitive(
                &binary.right,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            )?;
            let equal = if matches!(
                binary.operator,
                BinaryOperator::Equality | BinaryOperator::Inequality
            ) {
                hydration_branch_loosely_equal(&left, &right)
            } else {
                left == right
            };
            Some(HydrationPrimitiveValue::Boolean(
                if matches!(
                    binary.operator,
                    BinaryOperator::Inequality | BinaryOperator::StrictInequality
                ) {
                    !equal
                } else {
                    equal
                },
            ))
        }
        Expression::CallExpression(call) if hydration_branch_is_global_boolean_call(call, ctx) => {
            hydration_branch_read_condition(
                call.arguments.first()?.as_expression()?,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .map(HydrationPrimitiveValue::Boolean)
        }
        _ => None,
    }
}

fn hydration_branch_is_reflexive<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
) -> bool {
    let expression = expression.get_inner_expression();
    if hydration_branch_direct_predicate(expression, ctx).is_some() {
        return true;
    }
    match expression {
        Expression::NumericLiteral(value) => !value.value.is_nan(),
        Expression::NullLiteral(_)
        | Expression::BooleanLiteral(_)
        | Expression::StringLiteral(_)
        | Expression::BigIntLiteral(_)
        | Expression::RegExpLiteral(_)
        | Expression::ArrayExpression(_)
        | Expression::ObjectExpression(_)
        | Expression::FunctionExpression(_)
        | Expression::ArrowFunctionExpression(_)
        | Expression::TemplateLiteral(_) => true,
        Expression::Identifier(identifier) => {
            if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier) {
                return true;
            }
            let Some(symbol_id) = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()
            else {
                return false;
            };
            if !visited_symbols.insert(symbol_id) {
                return false;
            }
            let result = if let AstKind::VariableDeclarator(declarator) =
                ctx.symbol_declaration(symbol_id).kind()
            {
                declarator.init.as_ref().is_some_and(|initializer| {
                    hydration_branch_is_reflexive(initializer, ctx, visited_symbols)
                }) && ctx
                    .scoping()
                    .get_resolved_references(symbol_id)
                    .filter(|reference| reference.is_write())
                    .all(|reference| {
                        let node = ctx.nodes().get_node(reference.node_id());
                        let AstKind::AssignmentExpression(assignment) =
                            ctx.nodes().parent_node(node.id()).kind()
                        else {
                            return false;
                        };
                        hydration_branch_is_reflexive(&assignment.right, ctx, visited_symbols)
                    })
            } else {
                false
            };
            visited_symbols.remove(&symbol_id);
            result
        }
        Expression::ConditionalExpression(conditional) => {
            hydration_branch_is_reflexive(&conditional.consequent, ctx, visited_symbols)
                && hydration_branch_is_reflexive(&conditional.alternate, ctx, visited_symbols)
        }
        Expression::UnaryExpression(unary) => matches!(
            unary.operator,
            UnaryOperator::LogicalNot | UnaryOperator::Typeof | UnaryOperator::Void
        ),
        Expression::BinaryExpression(binary) => matches!(
            binary.operator,
            BinaryOperator::Equality
                | BinaryOperator::Inequality
                | BinaryOperator::StrictEquality
                | BinaryOperator::StrictInequality
        ),
        Expression::CallExpression(call) => hydration_branch_is_global_boolean_call(call, ctx),
        _ => false,
    }
}

fn hydration_branch_read_condition<'a>(
    expression: &Expression<'a>,
    client_runtime: bool,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<bool> {
    let expression = expression.get_inner_expression();
    if let Some(condition_match) = hydration_branch_direct_predicate(expression, ctx) {
        return if client_runtime {
            condition_match.client_result
        } else {
            condition_match.server_result
        };
    }
    if let Some(static_result) = static_literal_truthiness(expression) {
        return Some(static_result);
    }
    match expression {
        Expression::Identifier(identifier) => {
            if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier) {
                return Some(false);
            }
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if let Some(argument) = visited_symbols.arguments.get(&symbol_id) {
                return if client_runtime {
                    argument.client_result
                } else {
                    argument.server_result
                };
            }
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let result = match declaration.kind() {
                AstKind::VariableDeclarator(declarator)
                    if hydration_branch_variable_is_immutable(declaration, symbol_id, ctx) =>
                {
                    hydration_branch_state_initializer(declarator, symbol_id, ctx).and_then(
                        |initializer| {
                            hydration_branch_read_condition(
                                initializer,
                                client_runtime,
                                ctx,
                                visited_symbols,
                                visited_functions,
                            )
                        },
                    )
                }
                _ => None,
            };
            visited_symbols.remove(&symbol_id);
            result
        }
        Expression::BinaryExpression(_) => hydration_branch_primitive_truthiness(
            hydration_branch_read_primitive(
                expression,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .as_ref(),
        ),
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            hydration_branch_read_condition(
                &unary.argument,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .map(|value| !value)
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            let left = hydration_branch_read_condition(
                &logical.left,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            );
            let right = hydration_branch_read_condition(
                &logical.right,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            );
            match logical.operator {
                LogicalOperator::And if left == Some(false) || right == Some(false) => Some(false),
                LogicalOperator::And if left == Some(true) && right == Some(true) => Some(true),
                LogicalOperator::Or if left == Some(true) || right == Some(true) => Some(true),
                LogicalOperator::Or if left == Some(false) && right == Some(false) => Some(false),
                _ => None,
            }
        }
        Expression::CallExpression(call) => {
            if hydration_branch_is_global_boolean_call(call, ctx) {
                return hydration_branch_read_condition(
                    call.arguments.first()?.as_expression()?,
                    client_runtime,
                    ctx,
                    visited_symbols,
                    visited_functions,
                );
            }
            let function_expression = if is_react_api_call(call, "useMemo", ctx)
                || is_react_api_call(call, "useState", ctx)
            {
                call.arguments.first()?.as_expression()?
            } else {
                &call.callee
            };
            let function_id =
                hydration_branch_resolve_local_function(function_expression, ctx, visited_symbols)?;
            if visited_functions.contains(&function_id) {
                return None;
            }
            let arguments = if is_react_api_call(call, "useMemo", ctx)
                || is_react_api_call(call, "useState", ctx)
            {
                Vec::new()
            } else {
                if call.arguments.iter().any(|argument| argument.is_spread()) {
                    return None;
                }
                call.arguments
                    .iter()
                    .filter_map(|argument| {
                        argument.as_expression().map(|expression| {
                            hydration_branch_argument_result(
                                expression,
                                ctx,
                                visited_symbols,
                                visited_functions,
                            )
                        })
                    })
                    .collect()
            };
            hydration_branch_with_function_arguments(
                function_id,
                &arguments,
                ctx,
                visited_symbols,
                |symbols| {
                    hydration_branch_read_function_result(
                        function_id,
                        client_runtime,
                        ctx,
                        symbols,
                        visited_functions,
                    )
                },
            )
        }
        _ => None,
    }
}

fn hydration_branch_variable_is_immutable(
    declaration: &AstNode<'_>,
    symbol_id: SymbolId,
    ctx: &LintContext<'_>,
) -> bool {
    let parent = ctx.nodes().parent_node(declaration.id());
    matches!(parent.kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
        && ctx
            .scoping()
            .get_resolved_references(symbol_id)
            .all(|reference| !reference.is_write())
}

fn hydration_branch_state_initializer<'a, 'b>(
    declarator: &'b oxc_ast::ast::VariableDeclarator<'a>,
    symbol_id: SymbolId,
    ctx: &LintContext<'a>,
) -> Option<&'b Expression<'a>> {
    if let BindingPattern::ArrayPattern(pattern) = &declarator.id
        && pattern
            .elements
            .first()
            .and_then(Option::as_ref)
            .and_then(BindingPattern::get_binding_identifier)
            .is_some_and(|binding| binding.symbol_id() == symbol_id)
        && let Expression::CallExpression(call) = declarator.init.as_ref()?.get_inner_expression()
        && is_react_api_call(call, "useState", ctx)
    {
        return call.arguments.first()?.as_expression();
    }
    declarator.init.as_ref()
}

fn hydration_branch_is_global_boolean_call(
    call: &oxc_ast::ast::CallExpression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    call.arguments.len() == 1
        && matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
            if identifier.name == "Boolean" && ctx.is_reference_to_global_variable(identifier))
}

fn hydration_branch_resolve_local_function<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
) -> Option<NodeId> {
    match expression.get_inner_expression() {
        Expression::ArrowFunctionExpression(function) => Some(function.node_id.get()),
        Expression::FunctionExpression(function) => Some(function.node_id.get()),
        Expression::Identifier(identifier) => {
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let result = match declaration.kind() {
                AstKind::Function(function) => Some(function.node_id.get()),
                AstKind::VariableDeclarator(declarator)
                    if hydration_branch_variable_is_immutable(declaration, symbol_id, ctx) =>
                {
                    declarator.init.as_ref().and_then(|initializer| {
                        hydration_branch_resolve_local_function(initializer, ctx, visited_symbols)
                    })
                }
                _ => None,
            };
            visited_symbols.remove(&symbol_id);
            result
        }
        _ => None,
    }
}

fn hydration_branch_function_has_no_parameters(function_id: NodeId, ctx: &LintContext<'_>) -> bool {
    match ctx.nodes().get_node(function_id).kind() {
        AstKind::ArrowFunctionExpression(function) => {
            function.params.items.is_empty() && function.params.rest.is_none()
        }
        AstKind::Function(function) => {
            function.params.items.is_empty() && function.params.rest.is_none()
        }
        _ => false,
    }
}

fn hydration_branch_match_function<'a>(
    function_id: NodeId,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    if !visited_functions.insert(function_id) {
        return None;
    }
    let function_node = ctx.nodes().get_node(function_id);
    let result = match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) if !function.r#async => function
            .get_expression()
            .and_then(|expression| {
                hydration_branch_match_expression(
                    expression,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })
            .or_else(|| {
                function.get_function_body().and_then(|body| {
                    hydration_branch_match_statements(
                        &body.statements,
                        ctx,
                        visited_symbols,
                        visited_functions,
                    )
                })
            }),
        AstKind::Function(function) if !function.r#async && !function.generator => {
            function.body.as_ref().and_then(|body| {
                hydration_branch_match_statements(
                    &body.statements,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })
        }
        _ => None,
    };
    visited_functions.remove(&function_id);
    let mut condition_match = result?;
    let client_result = hydration_branch_read_function_result(
        function_id,
        true,
        ctx,
        &mut visited_symbols.fork(),
        &mut FxHashSet::default(),
    );
    let server_result = hydration_branch_read_function_result(
        function_id,
        false,
        ctx,
        &mut visited_symbols.fork(),
        &mut FxHashSet::default(),
    );
    if client_result.is_some() && client_result == server_result {
        return None;
    }
    condition_match.client_result = client_result;
    condition_match.server_result = server_result;
    Some(condition_match)
}

fn hydration_branch_argument_result<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> HydrationArgumentResult {
    let client_value =
        hydration_branch_read_primitive(expression, true, ctx, visited_symbols, visited_functions);
    let server_value =
        hydration_branch_read_primitive(expression, false, ctx, visited_symbols, visited_functions);
    HydrationArgumentResult {
        condition_match: hydration_branch_match_expression(
            expression,
            ctx,
            visited_symbols,
            visited_functions,
        ),
        client_result: hydration_branch_primitive_truthiness(client_value.as_ref()).or_else(|| {
            hydration_branch_read_condition(
                expression,
                true,
                ctx,
                visited_symbols,
                visited_functions,
            )
        }),
        server_result: hydration_branch_primitive_truthiness(server_value.as_ref()).or_else(|| {
            hydration_branch_read_condition(
                expression,
                false,
                ctx,
                visited_symbols,
                visited_functions,
            )
        }),
        client_value,
        server_value,
    }
}

fn hydration_branch_match_called_function<'a>(
    function_id: NodeId,
    call: &oxc_ast::ast::CallExpression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    if call.arguments.iter().any(|argument| argument.is_spread())
        || visited_functions.contains(&function_id)
    {
        return None;
    }
    let arguments = call
        .arguments
        .iter()
        .filter_map(|argument| {
            argument.as_expression().map(|expression| {
                hydration_branch_argument_result(
                    expression,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })
        })
        .collect::<Vec<_>>();
    hydration_branch_match_function_with_arguments(
        function_id,
        &arguments,
        ctx,
        visited_symbols,
        visited_functions,
    )
}

fn hydration_branch_match_function_with_arguments<'a>(
    function_id: NodeId,
    arguments: &[HydrationArgumentResult],
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    hydration_branch_with_function_arguments(
        function_id,
        arguments,
        ctx,
        visited_symbols,
        |symbols| hydration_branch_match_function(function_id, ctx, symbols, visited_functions),
    )
}

fn hydration_branch_with_function_arguments<'a, ResultValue>(
    function_id: NodeId,
    arguments: &[HydrationArgumentResult],
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    evaluate: impl FnOnce(&mut HydrationBranchSymbols) -> Option<ResultValue>,
) -> Option<ResultValue> {
    let parameters = match ctx.nodes().get_node(function_id).kind() {
        AstKind::ArrowFunctionExpression(function) if !function.r#async => &function.params,
        AstKind::Function(function) if !function.r#async && !function.generator => &function.params,
        _ => return None,
    };
    if parameters.rest.is_some()
        || parameters
            .items
            .iter()
            .any(|parameter| !matches!(parameter.pattern, BindingPattern::BindingIdentifier(_)))
    {
        return None;
    }
    let previous_arguments = parameters
        .items
        .iter()
        .zip(arguments)
        .map(|(parameter, argument)| {
            let symbol_id = parameter
                .pattern
                .get_binding_identifier()
                .unwrap()
                .symbol_id();
            (
                symbol_id,
                visited_symbols
                    .arguments
                    .insert(symbol_id, argument.clone()),
            )
        })
        .collect::<Vec<_>>();
    let result = evaluate(visited_symbols);
    for (symbol_id, previous) in previous_arguments {
        if let Some(previous) = previous {
            visited_symbols.arguments.insert(symbol_id, previous);
        } else {
            visited_symbols.arguments.remove(&symbol_id);
        }
    }
    result
}

fn hydration_branch_match_statements<'a>(
    statements: &[Statement<'a>],
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    for statement in statements {
        let condition_match = match statement {
            Statement::ReturnStatement(return_statement) => {
                return_statement.argument.as_ref().and_then(|argument| {
                    hydration_branch_match_expression(
                        argument,
                        ctx,
                        visited_symbols,
                        visited_functions,
                    )
                })
            }
            Statement::IfStatement(if_statement) => hydration_branch_match_expression(
                &if_statement.test,
                ctx,
                visited_symbols,
                visited_functions,
            )
            .filter(|_| {
                let consequent_values = hydration_branch_returned_values(&if_statement.consequent);
                let alternate_values = if_statement.alternate.as_ref().map_or_else(
                    || {
                        hydration_branch_following_returns(
                            ctx.nodes().get_node(if_statement.node_id.get()),
                            ctx,
                        )
                    },
                    |alternate| hydration_branch_returned_values(alternate),
                );
                !consequent_values.is_empty()
                    && !alternate_values.is_empty()
                    && [&consequent_values, &alternate_values]
                        .into_iter()
                        .zip([&alternate_values, &consequent_values])
                        .any(|(values, candidates)| {
                            values.iter().any(|value| {
                                !candidates.iter().any(|candidate| {
                                    hydration_branch_rendered_branches_equivalent(
                                        value, candidate, ctx,
                                    )
                                })
                            })
                        })
                    || hydration_branch_guard_changes_returned_value(if_statement, ctx)
            })
            .or_else(|| {
                hydration_branch_match_statement(
                    &if_statement.consequent,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })
            .or_else(|| {
                if_statement.alternate.as_ref().and_then(|alternate| {
                    hydration_branch_match_statement(
                        alternate,
                        ctx,
                        visited_symbols,
                        visited_functions,
                    )
                })
            }),
            Statement::BlockStatement(block) => hydration_branch_match_statements(
                &block.body,
                ctx,
                visited_symbols,
                visited_functions,
            ),
            _ => None,
        };
        if condition_match.is_some() {
            return condition_match;
        }
        if statement_always_exits(statement) {
            break;
        }
    }
    None
}

fn hydration_branch_match_statement<'a>(
    statement: &Statement<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<HydrationBranchMatch> {
    match statement {
        Statement::BlockStatement(block) => {
            hydration_branch_match_statements(&block.body, ctx, visited_symbols, visited_functions)
        }
        Statement::ReturnStatement(return_statement) => {
            return_statement.argument.as_ref().and_then(|argument| {
                hydration_branch_match_expression(argument, ctx, visited_symbols, visited_functions)
            })
        }
        _ => None,
    }
}

fn hydration_branch_read_function_result<'a>(
    function_id: NodeId,
    client_runtime: bool,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> Option<bool> {
    if !visited_functions.insert(function_id) {
        return None;
    }
    let function_node = ctx.nodes().get_node(function_id);
    let result = match function_node.kind() {
        AstKind::ArrowFunctionExpression(function) if !function.r#async => function
            .get_expression()
            .and_then(|expression| {
                hydration_branch_read_condition(
                    expression,
                    client_runtime,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            })
            .or_else(|| {
                function.get_function_body().and_then(|body| {
                    hydration_branch_read_returning_statements(
                        &body.statements,
                        client_runtime,
                        ctx,
                        visited_symbols,
                        visited_functions,
                    )
                    .value
                })
            }),
        AstKind::Function(function) if !function.r#async && !function.generator => {
            function.body.as_ref().and_then(|body| {
                hydration_branch_read_returning_statements(
                    &body.statements,
                    client_runtime,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
                .value
            })
        }
        _ => None,
    };
    visited_functions.remove(&function_id);
    result
}

fn hydration_branch_read_returning_statements<'a>(
    statements: &[Statement<'a>],
    client_runtime: bool,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> HydrationStatementResult {
    for statement in statements {
        let result = hydration_branch_read_returning_statement(
            statement,
            client_runtime,
            ctx,
            visited_symbols,
            visited_functions,
        );
        if result.did_return {
            return result;
        }
        if statement_always_exits(statement) {
            break;
        }
    }
    HydrationStatementResult::default()
}

fn hydration_branch_read_returning_statement<'a>(
    statement: &Statement<'a>,
    client_runtime: bool,
    ctx: &LintContext<'a>,
    visited_symbols: &mut HydrationBranchSymbols,
    visited_functions: &mut FxHashSet<NodeId>,
) -> HydrationStatementResult {
    match statement {
        Statement::ReturnStatement(return_statement) => HydrationStatementResult {
            did_return: true,
            value: return_statement.argument.as_ref().and_then(|argument| {
                hydration_branch_read_condition(
                    argument,
                    client_runtime,
                    ctx,
                    visited_symbols,
                    visited_functions,
                )
            }),
        },
        Statement::BlockStatement(block) => hydration_branch_read_returning_statements(
            &block.body,
            client_runtime,
            ctx,
            visited_symbols,
            visited_functions,
        ),
        Statement::IfStatement(if_statement) => {
            if let Some(condition) = hydration_branch_read_condition(
                &if_statement.test,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            ) {
                let selected = if condition {
                    Some(&if_statement.consequent)
                } else {
                    if_statement.alternate.as_ref()
                };
                return selected.map_or_else(HydrationStatementResult::default, |selected| {
                    hydration_branch_read_returning_statement(
                        selected,
                        client_runtime,
                        ctx,
                        visited_symbols,
                        visited_functions,
                    )
                });
            }
            let consequent = hydration_branch_read_returning_statement(
                &if_statement.consequent,
                client_runtime,
                ctx,
                visited_symbols,
                visited_functions,
            );
            let alternate = if_statement.alternate.as_ref().map_or_else(
                HydrationStatementResult::default,
                |alternate| {
                    hydration_branch_read_returning_statement(
                        alternate,
                        client_runtime,
                        ctx,
                        visited_symbols,
                        visited_functions,
                    )
                },
            );
            HydrationStatementResult {
                did_return: consequent.did_return || alternate.did_return,
                value: if consequent.did_return
                    && alternate.did_return
                    && consequent.value == alternate.value
                {
                    consequent.value
                } else {
                    None
                },
            }
        }
        _ => HydrationStatementResult::default(),
    }
}

fn hydration_branch_returned_values<'a>(statement: &'a Statement<'a>) -> Vec<&'a Expression<'a>> {
    let mut returned_values = Vec::new();
    hydration_branch_collect_returned_values(statement, &mut returned_values);
    returned_values
}

fn hydration_branch_collect_returned_values<'a>(
    statement: &'a Statement<'a>,
    returned_values: &mut Vec<&'a Expression<'a>>,
) {
    match statement {
        Statement::ReturnStatement(return_statement) => {
            if let Some(argument) = &return_statement.argument {
                returned_values.push(argument);
            }
        }
        Statement::IfStatement(if_statement) => {
            hydration_branch_collect_returned_values(&if_statement.consequent, returned_values);
            if let Some(alternate) = &if_statement.alternate {
                hydration_branch_collect_returned_values(alternate, returned_values);
            }
        }
        Statement::BlockStatement(block) => {
            for child in &block.body {
                hydration_branch_collect_returned_values(child, returned_values);
                if statement_always_exits(child) {
                    break;
                }
            }
        }
        Statement::TryStatement(try_statement) => {
            for child in &try_statement.block.body {
                hydration_branch_collect_returned_values(child, returned_values);
            }
            if let Some(handler) = &try_statement.handler {
                for child in &handler.body.body {
                    hydration_branch_collect_returned_values(child, returned_values);
                }
            }
            if let Some(finalizer) = &try_statement.finalizer {
                for child in &finalizer.body {
                    hydration_branch_collect_returned_values(child, returned_values);
                }
            }
        }
        _ => {}
    }
}

fn hydration_branch_following_returns<'a>(
    if_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Vec<&'a Expression<'a>> {
    let parent = ctx.nodes().parent_node(if_node.id());
    let statements = match parent.kind() {
        AstKind::BlockStatement(block) => block.body.as_slice(),
        AstKind::FunctionBody(body) => body.statements.as_slice(),
        _ => return Vec::new(),
    };
    let Some(statement_index) = statements
        .iter()
        .position(|statement| statement.span() == if_node.span())
    else {
        return Vec::new();
    };
    let mut returned_values = Vec::new();
    for statement in statements.iter().skip(statement_index + 1) {
        hydration_branch_collect_returned_values(statement, &mut returned_values);
        if statement_always_exits(statement) {
            break;
        }
    }
    returned_values
}

fn hydration_branch_is_rendered_value<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    match expression.get_inner_expression() {
        Expression::JSXElement(_) | Expression::JSXFragment(_) => true,
        Expression::StringLiteral(literal) => !literal.value.is_empty(),
        Expression::NumericLiteral(_) | Expression::BigIntLiteral(_) => true,
        Expression::TemplateLiteral(template) => {
            !template.expressions.is_empty()
                || template
                    .quasis
                    .first()
                    .is_some_and(|quasi| !quasi.value.raw.is_empty())
        }
        Expression::CallExpression(call) => is_react_api_call(call, "createElement", ctx),
        _ => false,
    }
}

fn hydration_branch_is_potentially_rendered<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let expression = expression.get_inner_expression();
    if hydration_branch_is_rendered_value(expression, ctx) {
        return true;
    }
    match expression {
        Expression::ConditionalExpression(conditional) => {
            hydration_branch_is_potentially_rendered(&conditional.consequent, ctx)
                && hydration_branch_is_potentially_rendered(&conditional.alternate, ctx)
        }
        Expression::LogicalExpression(logical) => {
            hydration_branch_is_potentially_rendered(&logical.right, ctx)
        }
        _ => false,
    }
}

fn hydration_branch_is_in_rendered_output<'a>(
    node: &AstNode<'a>,
    render_owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXExpressionContainer(_) => {
                return !hydration_branch_is_event_handler_context(ancestor, ctx);
            }
            AstKind::ReturnStatement(_) => {
                return crate::ast_util::get_enclosing_function(ancestor, ctx)
                    .is_some_and(|function| function.id() == render_owner.id());
            }
            AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
                if ancestor.id() != render_owner.id()
                    && !function_executes_during_render(ancestor, ctx) =>
            {
                return false;
            }
            _ => {}
        }
        if ancestor.id() == render_owner.id() {
            return matches!(render_owner.kind(), AstKind::ArrowFunctionExpression(function)
            if function.get_expression().is_some_and(|expression| {
                expression.span().contains_inclusive(node.span())
            }));
        }
    }
    false
}

fn hydration_branch_render_owner<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    if let Some(render_owner) = find_render_phase_component_or_hook(node, ctx) {
        if !hydration_branch_is_in_rendered_output(node, render_owner, ctx)
            && let Some(state_consumer_owner) = hydration_branch_state_consumer_owner(node, ctx)
        {
            return Some(state_consumer_owner);
        }
        return Some(render_owner);
    }
    let helper_function = crate::ast_util::get_enclosing_function(node, ctx)?;
    let symbol_id = hydration_branch_function_symbol_id(helper_function, ctx)?;
    ctx.scoping()
        .get_resolved_references(symbol_id)
        .filter(|reference| !reference.is_write())
        .find_map(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let call_node = ctx.nodes().parent_node(reference_node.id());
            let AstKind::CallExpression(call) = call_node.kind() else {
                return None;
            };
            if call.callee.span() != reference_node.span() {
                return None;
            }
            let render_owner = find_render_phase_component_or_hook(call_node, ctx)?;
            hydration_branch_is_in_rendered_output(call_node, render_owner, ctx)
                .then_some(render_owner)
        })
}

fn hydration_branch_state_consumer_owner<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b AstNode<'a>> {
    let state_call_node = ctx.nodes().ancestors(node.id()).find(|ancestor| {
        matches!(ancestor.kind(), AstKind::CallExpression(call)
        if is_react_api_call(call, "useState", ctx)
            && call.arguments.first().is_some_and(|argument| {
                argument.span().contains_inclusive(node.span())
            }))
    })?;
    let state_call_root = transparent_expression_root(state_call_node, ctx);
    let declaration = ctx.nodes().parent_node(state_call_root.id());
    let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
        return None;
    };
    let BindingPattern::ArrayPattern(state_pattern) = &declarator.id else {
        return None;
    };
    let state_symbol_id = state_pattern
        .elements
        .first()
        .and_then(Option::as_ref)
        .and_then(BindingPattern::get_binding_identifier)
        .map(|identifier| identifier.symbol_id())?;
    let hook_function = crate::ast_util::get_enclosing_function(state_call_node, ctx)?;
    let state_is_returned = ctx
        .scoping()
        .get_resolved_references(state_symbol_id)
        .filter(|reference| !reference.is_write())
        .any(|reference| {
            ctx.nodes()
                .ancestors(reference.node_id())
                .take_while(|ancestor| ancestor.id() != hook_function.id())
                .any(|ancestor| matches!(ancestor.kind(), AstKind::ReturnStatement(_)))
        });
    if !state_is_returned {
        return None;
    }
    let hook_symbol_id = hydration_branch_function_symbol_id(hook_function, ctx)?;
    ctx.scoping()
        .get_resolved_references(hook_symbol_id)
        .filter(|reference| !reference.is_write())
        .find_map(|reference| {
            let reference_node = ctx.nodes().get_node(reference.node_id());
            let call_node = ctx.nodes().parent_node(reference_node.id());
            let AstKind::CallExpression(call) = call_node.kind() else {
                return None;
            };
            if call.callee.span() != reference_node.span() {
                return None;
            }
            let render_owner = find_render_phase_component_or_hook(call_node, ctx)?;
            if hydration_branch_is_in_rendered_output(call_node, render_owner, ctx) {
                return Some(render_owner);
            }
            let call_root = transparent_expression_root(call_node, ctx);
            let call_parent = ctx.nodes().parent_node(call_root.id());
            let AstKind::VariableDeclarator(result_declarator) = call_parent.kind() else {
                return None;
            };
            let mut result_symbols = Vec::new();
            hydration_branch_collect_binding_symbols(&result_declarator.id, &mut result_symbols);
            result_symbols.into_iter().find_map(|result_symbol_id| {
                ctx.scoping()
                    .get_resolved_references(result_symbol_id)
                    .filter(|reference| !reference.is_write())
                    .find_map(|result_reference| {
                        let result_node = ctx.nodes().get_node(result_reference.node_id());
                        hydration_branch_is_in_rendered_output(result_node, render_owner, ctx)
                            .then_some(render_owner)
                    })
            })
        })
}

fn hydration_branch_function_symbol_id<'a>(
    function_node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> Option<SymbolId> {
    match function_node.kind() {
        AstKind::Function(function) => function
            .id
            .as_ref()
            .map(|identifier| identifier.symbol_id()),
        AstKind::ArrowFunctionExpression(_) => {
            let expression_root = transparent_expression_root(function_node, ctx);
            let parent = ctx.nodes().parent_node(expression_root.id());
            let AstKind::VariableDeclarator(declarator) = parent.kind() else {
                return None;
            };
            declarator
                .id
                .get_binding_identifier()
                .map(|identifier| identifier.symbol_id())
        }
        _ => None,
    }
}

fn hydration_branch_collect_binding_symbols(
    pattern: &BindingPattern<'_>,
    symbols: &mut Vec<SymbolId>,
) {
    match pattern {
        BindingPattern::BindingIdentifier(identifier) => symbols.push(identifier.symbol_id()),
        BindingPattern::AssignmentPattern(assignment) => {
            hydration_branch_collect_binding_symbols(&assignment.left, symbols);
        }
        BindingPattern::ObjectPattern(object) => {
            for property in &object.properties {
                hydration_branch_collect_binding_symbols(&property.value, symbols);
            }
            if let Some(rest) = &object.rest {
                hydration_branch_collect_binding_symbols(&rest.argument, symbols);
            }
        }
        BindingPattern::ArrayPattern(array) => {
            for element in array.elements.iter().flatten() {
                hydration_branch_collect_binding_symbols(element, symbols);
            }
            if let Some(rest) = &array.rest {
                hydration_branch_collect_binding_symbols(&rest.argument, symbols);
            }
        }
    }
}

fn hydration_branch_is_event_handler_context(node: &AstNode<'_>, ctx: &LintContext<'_>) -> bool {
    ctx.nodes().ancestors(node.id()).any(|ancestor| {
        matches!(ancestor.kind(), AstKind::JSXAttribute(attribute)
            if matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                if identifier.name.starts_with("on")
                    && identifier.name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase)))
    })
}

fn hydration_branch_is_in_non_event_jsx_attribute(
    node: &AstNode<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    for ancestor in ctx.nodes().ancestors(node.id()) {
        match ancestor.kind() {
            AstKind::JSXAttribute(attribute) => {
                return !matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                    if identifier.name.starts_with("on")
                        && identifier.name.as_bytes().get(2).is_some_and(u8::is_ascii_uppercase));
            }
            AstKind::JSXElement(_)
            | AstKind::JSXFragment(_)
            | AstKind::Function(_)
            | AstKind::ArrowFunctionExpression(_) => return false,
            _ => {}
        }
    }
    false
}

fn hydration_branch_rendered_branches_equivalent(
    left: &Expression<'_>,
    right: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let left = left.get_inner_expression();
    let right = right.get_inner_expression();
    match (left, right) {
        (Expression::Identifier(left), Expression::Identifier(right)) => {
            return ctx.scoping().get_reference(left.reference_id()).symbol_id()
                == ctx
                    .scoping()
                    .get_reference(right.reference_id())
                    .symbol_id();
        }
        (Expression::NullLiteral(_), Expression::NullLiteral(_)) => return true,
        (Expression::BooleanLiteral(left), Expression::BooleanLiteral(right)) => {
            return left.value == right.value;
        }
        (Expression::NumericLiteral(left), Expression::NumericLiteral(right)) => {
            return left.value.to_bits() == right.value.to_bits();
        }
        (Expression::BigIntLiteral(left), Expression::BigIntLiteral(right)) => {
            return left.value == right.value;
        }
        (Expression::StringLiteral(left), Expression::StringLiteral(right)) => {
            return left.value == right.value;
        }
        _ => {}
    }
    hydration_branch_spans_binding_equivalent(left.span(), right.span(), ctx)
}

fn hydration_branch_return_trees_equivalent(
    left: &Statement<'_>,
    right: &Statement<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    if hydration_branch_spans_binding_equivalent(left.span(), right.span(), ctx) {
        return true;
    }
    match (left, right) {
        (Statement::ReturnStatement(left), Statement::ReturnStatement(right)) => {
            match (&left.argument, &right.argument) {
                (Some(left), Some(right)) => {
                    hydration_branch_rendered_branches_equivalent(left, right, ctx)
                }
                (None, None) => true,
                _ => false,
            }
        }
        (Statement::IfStatement(left), Statement::IfStatement(right)) => {
            hydration_branch_spans_binding_equivalent(left.test.span(), right.test.span(), ctx)
                && hydration_branch_return_trees_equivalent(
                    &left.consequent,
                    &right.consequent,
                    ctx,
                )
                && match (&left.alternate, &right.alternate) {
                    (Some(left), Some(right)) => {
                        hydration_branch_return_trees_equivalent(left, right, ctx)
                    }
                    (None, None) => true,
                    _ => false,
                }
        }
        (Statement::BlockStatement(left), Statement::BlockStatement(right)) => {
            let left_returning = left
                .body
                .iter()
                .filter(|statement| !hydration_branch_returned_values(statement).is_empty())
                .collect::<Vec<_>>();
            let right_returning = right
                .body
                .iter()
                .filter(|statement| !hydration_branch_returned_values(statement).is_empty())
                .collect::<Vec<_>>();
            left_returning.len() == right_returning.len()
                && left_returning
                    .iter()
                    .zip(right_returning)
                    .all(|(left, right)| hydration_branch_return_trees_equivalent(left, right, ctx))
        }
        _ => false,
    }
}

fn hydration_branch_spans_binding_equivalent(
    left_span: Span,
    right_span: Span,
    ctx: &LintContext<'_>,
) -> bool {
    if hydration_branch_normalized_source(left_span, ctx)
        != hydration_branch_normalized_source(right_span, ctx)
    {
        return false;
    }
    let binding_sequence = |span: Span| {
        ctx.nodes()
            .iter()
            .filter_map(|node| {
                if !span.contains_inclusive(node.span()) {
                    return None;
                }
                let AstKind::IdentifierReference(identifier) = node.kind() else {
                    return None;
                };
                Some(
                    ctx.scoping()
                        .get_reference(identifier.reference_id())
                        .symbol_id(),
                )
            })
            .collect::<Vec<_>>()
    };
    binding_sequence(left_span) == binding_sequence(right_span)
}

fn hydration_branch_normalized_source(span: Span, ctx: &LintContext<'_>) -> String {
    ctx.source_range(span)
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn hydration_branch_is_structural_rendered_value(expression: &Expression<'_>) -> bool {
    matches!(
        expression.get_inner_expression(),
        Expression::JSXElement(_) | Expression::JSXFragment(_)
    )
}

fn hydration_branch_roots_suppress_same_element(
    left: &Expression<'_>,
    right: &Expression<'_>,
    ctx: &LintContext<'_>,
) -> bool {
    let (Expression::JSXElement(left), Expression::JSXElement(right)) =
        (left.get_inner_expression(), right.get_inner_expression())
    else {
        return false;
    };
    hydration_branch_normalized_source(left.opening_element.name.span(), ctx)
        == hydration_branch_normalized_source(right.opening_element.name.span(), ctx)
        && hydration_branch_has_suppress_warning(&left.opening_element)
        && hydration_branch_has_suppress_warning(&right.opening_element)
}

fn hydration_branch_has_suppress_warning(opening: &oxc_ast::ast::JSXOpeningElement<'_>) -> bool {
    opening.attributes.iter().any(|attribute| {
        matches!(attribute, JSXAttributeItem::Attribute(attribute)
            if matches!(&attribute.name, JSXAttributeName::Identifier(identifier)
                if identifier.name == "suppressHydrationWarning"))
    })
}

fn hydration_branch_opening_element<'a, 'b>(
    node: &'b AstNode<'a>,
    ctx: &'b LintContext<'a>,
) -> Option<&'b oxc_ast::ast::JSXOpeningElement<'a>> {
    ctx.nodes()
        .ancestors(node.id())
        .find_map(|ancestor| match ancestor.kind() {
            AstKind::JSXElement(element) => Some(element.opening_element.as_ref()),
            _ => None,
        })
}

fn hydration_branch_is_generated_image_context<'a>(
    node: &AstNode<'a>,
    left_branch: &Expression<'a>,
    generated_image_opening_ids: &std::collections::HashSet<NodeId>,
    ctx: &LintContext<'a>,
) -> bool {
    hydration_branch_opening_element(node, ctx)
        .is_some_and(|opening| generated_image_opening_ids.contains(&opening.node_id.get()))
        || matches!(left_branch.get_inner_expression(), Expression::JSXElement(element)
            if generated_image_opening_ids.contains(&element.opening_element.node_id.get()))
}

fn hydration_branch_is_gated_by_initial_state<'a>(
    node: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        let is_gated = match ancestor.kind() {
            AstKind::LogicalExpression(logical) if logical.right.span() == child_span => {
                let initial_value = hydration_branch_read_initial_state_boolean(&logical.left, ctx);
                logical.operator == LogicalOperator::And && initial_value == Some(false)
                    || logical.operator == LogicalOperator::Or && initial_value == Some(true)
            }
            AstKind::ConditionalExpression(conditional) => {
                let initial_value =
                    hydration_branch_read_initial_state_boolean(&conditional.test, ctx);
                conditional.consequent.span() == child_span && initial_value == Some(false)
                    || conditional.alternate.span() == child_span && initial_value == Some(true)
            }
            AstKind::IfStatement(statement) => {
                let initial_value =
                    hydration_branch_read_initial_state_boolean(&statement.test, ctx);
                statement.consequent.span() == child_span && initial_value == Some(false)
                    || statement
                        .alternate
                        .as_ref()
                        .is_some_and(|alternate| alternate.span() == child_span)
                        && initial_value == Some(true)
            }
            _ => false,
        };
        if is_gated {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn hydration_branch_read_initial_state_boolean<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
) -> Option<bool> {
    hydration_branch_read_initial_state_boolean_inner(
        expression,
        ctx,
        &mut FxHashSet::default(),
        false,
    )
}

fn hydration_branch_read_initial_state_boolean_inner<'a>(
    expression: &Expression<'a>,
    ctx: &LintContext<'a>,
    visited_symbols: &mut FxHashSet<SymbolId>,
    allow_lazy_initializer: bool,
) -> Option<bool> {
    let expression = expression.get_inner_expression();
    if let Some(value) = static_literal_truthiness(expression) {
        return Some(value);
    }
    match expression {
        Expression::Identifier(identifier) => {
            if identifier.name == "undefined" && ctx.is_reference_to_global_variable(identifier) {
                return Some(false);
            }
            let symbol_id = ctx
                .scoping()
                .get_reference(identifier.reference_id())
                .symbol_id()?;
            if !visited_symbols.insert(symbol_id) {
                return None;
            }
            let declaration = ctx.symbol_declaration(symbol_id);
            let AstKind::VariableDeclarator(declarator) = declaration.kind() else {
                visited_symbols.remove(&symbol_id);
                return None;
            };
            let result = if let BindingPattern::ArrayPattern(pattern) = &declarator.id
                && pattern
                    .elements
                    .first()
                    .and_then(Option::as_ref)
                    .and_then(BindingPattern::get_binding_identifier)
                    .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && let Some(Expression::CallExpression(call)) = declarator
                    .init
                    .as_ref()
                    .map(Expression::get_inner_expression)
                && is_react_api_call(call, "useState", ctx)
            {
                match call.arguments.first() {
                    None => Some(false),
                    Some(argument) => argument.as_expression().and_then(|initial_value| {
                        hydration_branch_read_initial_state_boolean_inner(
                            initial_value,
                            ctx,
                            visited_symbols,
                            true,
                        )
                    }),
                }
            } else if declarator
                .id
                .get_binding_identifier()
                .is_some_and(|binding| binding.symbol_id() == symbol_id)
                && matches!(ctx.nodes().parent_node(declaration.id()).kind(), AstKind::VariableDeclaration(variable) if variable.kind.is_const())
            {
                declarator.init.as_ref().and_then(|initializer| {
                    hydration_branch_read_initial_state_boolean_inner(
                        initializer,
                        ctx,
                        visited_symbols,
                        allow_lazy_initializer,
                    )
                })
            } else {
                None
            };
            visited_symbols.remove(&symbol_id);
            result
        }
        Expression::ArrowFunctionExpression(function)
            if allow_lazy_initializer && !function.r#async =>
        {
            if let Some(body) = function.get_expression() {
                return hydration_branch_read_initial_state_boolean_inner(
                    body,
                    ctx,
                    visited_symbols,
                    false,
                );
            }
            let [Statement::ReturnStatement(statement)] =
                function.get_function_body()?.statements.as_slice()
            else {
                return None;
            };
            hydration_branch_read_initial_state_boolean_inner(
                statement.argument.as_ref()?,
                ctx,
                visited_symbols,
                false,
            )
        }
        Expression::FunctionExpression(function)
            if allow_lazy_initializer && !function.r#async && !function.generator =>
        {
            let [Statement::ReturnStatement(statement)] =
                function.body.as_ref()?.statements.as_slice()
            else {
                return None;
            };
            hydration_branch_read_initial_state_boolean_inner(
                statement.argument.as_ref()?,
                ctx,
                visited_symbols,
                false,
            )
        }
        Expression::UnaryExpression(unary) if unary.operator == UnaryOperator::LogicalNot => {
            hydration_branch_read_initial_state_boolean_inner(
                &unary.argument,
                ctx,
                visited_symbols,
                false,
            )
            .map(|value| !value)
        }
        Expression::LogicalExpression(logical)
            if matches!(logical.operator, LogicalOperator::And | LogicalOperator::Or) =>
        {
            let left = hydration_branch_read_initial_state_boolean_inner(
                &logical.left,
                ctx,
                &mut visited_symbols.clone(),
                false,
            );
            let right = hydration_branch_read_initial_state_boolean_inner(
                &logical.right,
                ctx,
                &mut visited_symbols.clone(),
                false,
            );
            hydration_branch_combine_logical(logical.operator, left, right)
        }
        _ => None,
    }
}

fn hydration_branch_is_after_client_only_early_return<'a>(
    node: &AstNode<'a>,
    render_owner: &AstNode<'a>,
    ctx: &LintContext<'a>,
) -> bool {
    let mut child_span = node.span();
    for ancestor in ctx.nodes().ancestors(node.id()) {
        if ancestor.id() == render_owner.id() {
            break;
        }
        let statements = match ancestor.kind() {
            AstKind::BlockStatement(block) => block.body.as_slice(),
            AstKind::FunctionBody(body) => body.statements.as_slice(),
            _ => {
                child_span = ancestor.span();
                continue;
            }
        };
        let Some(child_index) = statements
            .iter()
            .position(|statement| statement.span().contains_inclusive(child_span))
        else {
            child_span = ancestor.span();
            continue;
        };
        if statements[..child_index].iter().any(|statement| {
            let Statement::IfStatement(if_statement) = statement else {
                return false;
            };
            hydration_branch_read_initial_state_boolean(&if_statement.test, ctx).is_some_and(
                |initial| {
                    initial && statement_always_exits(&if_statement.consequent)
                        || !initial
                            && if_statement
                                .alternate
                                .as_ref()
                                .is_some_and(|alternate| statement_always_exits(alternate))
                },
            )
        }) {
            return true;
        }
        child_span = ancestor.span();
    }
    false
}

fn hydration_branch_has_client_render_evidence(ctx: &LintContext<'_>) -> bool {
    if ctx.nodes().iter().any(|node| {
        matches!(node.kind(), AstKind::Program(program)
            if program.directives.iter().any(|directive| directive.directive == "use client"))
    }) {
        return true;
    }
    ctx.nodes().iter().any(|node| match node.kind() {
            AstKind::ImportDeclaration(import) => REACT_RUNTIME_MODULE_SOURCES.contains(&import.source.value.as_str()),
            AstKind::IdentifierReference(identifier) => {
                identifier.name == "React" && ctx.is_reference_to_global_variable(identifier)
            }
            AstKind::CallExpression(call) => {
                matches!(call.callee.get_inner_expression(), Expression::Identifier(identifier)
                    if identifier.name == "require" && ctx.is_reference_to_global_variable(identifier))
                    && call
                        .arguments
                        .first()
                        .and_then(oxc_ast::ast::Argument::as_expression)
                        .and_then(hydration_branch_string_literal)
                        .is_some_and(|source| REACT_RUNTIME_MODULE_SOURCES.contains(&source))
            }
            _ => false,
        })
}

fn hydration_branch_is_email_template(ctx: &LintContext<'_>) -> bool {
    ctx.module_record().import_entries.iter().any(|entry| {
        let source = entry.module_request.name();
        EMAIL_TEMPLATE_MODULES.contains(&source)
            || EMAIL_TEMPLATE_MODULE_PREFIXES
                .iter()
                .any(|prefix| source.starts_with(prefix))
    })
}
